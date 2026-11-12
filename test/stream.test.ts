import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '../server/config.js';
import { interruptActiveRuns } from '../server/db/runs.js';
import { admitRun } from '../server/runs/admission.js';
import type { RunExecution, RunExecutor } from '../server/runs/executor.js';
import {
  TestClient,
  openSse,
  startHarness,
  waitForCondition,
  type Harness,
} from './helpers/http.js';

const harnesses: Harness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop();
    if (harness) await harness.close();
  }
});

async function harness(executor: RunExecutor | null): Promise<Harness> {
  const started = await startHarness(executor);
  harnesses.push(started);
  return started;
}

class ControlledExecutor implements RunExecutor {
  calls = 0;
  private releaseGate: (() => void) | null = null;
  private readonly gate = new Promise<void>((resolve) => {
    this.releaseGate = resolve;
  });

  release(): void {
    this.releaseGate?.();
  }

  async execute(execution: RunExecution): Promise<void> {
    this.calls += 1;
    await this.gate;
    execution.setState('generating');
    execution.emitDelta('Hello ');
    execution.emitDelta('world');
    execution.complete({ answerText: 'Hello world' });
  }
}

class ImmediateExecutor implements RunExecutor {
  calls = 0;

  async execute(execution: RunExecution): Promise<void> {
    this.calls += 1;
    execution.setState('generating');
    execution.emitDelta('Final answer');
    execution.complete({ answerText: 'Final answer' });
  }
}

describe('run event stream', () => {
  it('closes a live stream after explicit cancellation', async () => {
    const started = await harness(null);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();
    const owner = started.database.prepare('SELECT id FROM owners LIMIT 1').get() as { id: string };
    const admitted = admitRun({ database: started.database, registry: started.registry,
      clock: started.clock, limits: DEFAULT_LIMITS }, {
      ownerId: owner.id, namespace: 'live', conversationId, message: 'cancel me',
      timezone: 'UTC', requestKey: 'cancel-live',
    });
    const reader = await openSse(client, admitted.run.id);
    try {
      expect((await reader.next())?.data.type).toBe('snapshot');
      const cancelled = await client.request(`/api/runs/${admitted.run.id}/cancel`, { method: 'POST' });
      expect(cancelled.status).toBe(200);
      const events = await reader.collectUntilDone();
      const done = events.find(event => event.data.type === 'done');
      expect(done?.data.type === 'done' && done.data.payload.state).toBe('cancelled');
      expect(await reader.next(500)).toBeNull();
    } finally { await reader.close(); }
  });

  it('reconciles a saved request without an executor and closes recovered terminal streams', async () => {
    const started = await harness(null);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();
    const owner = started.database.prepare('SELECT id FROM owners LIMIT 1').get() as { id: string };
    const admitted = admitRun({ database: started.database, registry: started.registry,
      clock: started.clock, limits: DEFAULT_LIMITS }, {
      ownerId: owner.id, namespace: 'live', conversationId, message: 'saved request',
      timezone: 'UTC', requestKey: 'saved-key',
    });
    interruptActiveRuns(started.database, started.clock.now().toISOString());
    const reconciled = await client.createRun(conversationId, 'saved request', 'saved-key');
    expect(reconciled.runId).toBe(admitted.run.id);
    expect(reconciled.existing).toBe(true);
    const reader = await openSse(client, admitted.run.id);
    try {
      const snapshot = await reader.next();
      expect(snapshot?.data.type === 'snapshot' && snapshot.data.payload.terminal).toBe(true);
      const events = await reader.collectUntilDone();
      expect(events[0]?.data.type === 'done' && events[0].data.payload.state).toBe('interrupted');
      expect(await reader.next(500)).toBeNull();
    } finally { await reader.close(); }
  });

  it('streams a snapshot followed by coalesced deltas without duplicate text', async () => {
    const executor = new ControlledExecutor();
    const started = await harness(executor);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();
    const admitted = await client.createRun(conversationId, 'stream me', 'stream-key');
    await waitForCondition(() => executor.calls === 1);

    const reader = await openSse(client, admitted.runId);
    try {
      const snapshot = await reader.next();
      expect(snapshot?.data.type).toBe('snapshot');
      if (snapshot?.data.type !== 'snapshot') throw new Error('expected snapshot');
      expect(snapshot.data.payload.terminal).toBe(false);
      expect(snapshot.data.payload.answerText).toBeNull();

      executor.release();
      const events = await reader.collectUntilDone();

      let text = snapshot.data.payload.answerText ?? '';
      for (const event of events) {
        if (event.data.type === 'answer_delta') {
          text += event.data.payload.text;
        }
      }
      expect(text).toBe('Hello world');

      const done = events.find((event) => event.data.type === 'done');
      expect(done?.data.type).toBe('done');
      if (done?.data.type !== 'done') throw new Error('expected done');
      expect(done.data.payload.state).toBe('completed');

      const sequences = [snapshot, ...events].map((event) => event.data.seq);
      expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
    } finally {
      await reader.close();
    }
  });

  it('reconnects to a completed run with a terminal snapshot and saved done event', async () => {
    const executor = new ImmediateExecutor();
    const started = await harness(executor);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();
    const admitted = await client.createRun(conversationId, 'finished', 'finished-key');
    await client.waitForRun(
      admitted.runId,
      (candidate) => candidate.state === 'completed',
    );

    const reader = await openSse(client, admitted.runId);
    try {
      const snapshot = await reader.next();
      expect(snapshot?.data.type).toBe('snapshot');
      if (snapshot?.data.type !== 'snapshot') throw new Error('expected snapshot');
      expect(snapshot.data.payload.terminal).toBe(true);
      expect(snapshot.data.payload.answerText).toBe('Final answer');

      const events = await reader.collectUntilDone();
      expect(events.map((event) => event.data.type)).toEqual(['done']);
      expect(events[0]?.data.type).toBe('done');
      if (events[0]?.data.type !== 'done') throw new Error('expected done');
      expect(events[0].data.payload.state).toBe('completed');
      expect(events[0].data.seq).toBeGreaterThan(snapshot.data.seq);
      expect(await reader.next(500)).toBeNull();
      expect(executor.calls).toBe(1);
    } finally {
      await reader.close();
    }
  });

  it('does not initiate execution when a run is subscribed to', async () => {
    const executor = new ImmediateExecutor();
    const started = await harness(executor);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();
    const owner = started.database
      .prepare('SELECT id FROM owners LIMIT 1')
      .get() as { id: string } | undefined;
    if (!owner) throw new Error('expected an owner');

    const admitted = admitRun(
      {
        database: started.database,
        registry: started.registry,
        clock: started.clock,
        limits: DEFAULT_LIMITS,
      },
      {
        ownerId: owner.id,
        namespace: 'live',
        conversationId,
        message: 'do not start me',
        timezone: 'UTC',
        requestKey: 'direct-admission',
      },
    );

    const reader = await openSse(client, admitted.run.id);
    try {
      const snapshot = await reader.next();
      expect(snapshot?.data.type).toBe('snapshot');
      if (snapshot?.data.type !== 'snapshot') throw new Error('expected snapshot');
      expect(snapshot.data.payload.terminal).toBe(false);
      expect(executor.calls).toBe(0);

      const cancelled = await client.request(
        `/api/runs/${admitted.run.id}/cancel`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      expect(cancelled.status).toBe(200);
    } finally {
      await reader.close();
    }
  });
});
