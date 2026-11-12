import { afterEach, describe, expect, it } from 'vitest';
import { request as httpRequest } from 'node:http';
import type { RunExecution, RunExecutor } from '../server/runs/executor.js';
import {
  TestClient,
  delay,
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

function rawPost(
  baseUrl: string,
  pathname: string,
  headers: Record<string, string>,
  body: string,
): Promise<{ status: number; body: string }> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          ...headers,
        },
      },
      (response) => {
        let data = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => {
          data += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, body: data });
        });
      },
    );
    request.on('error', reject);
    request.end(body);
  });
}

describe('HTTP API', () => {
  it('issues an HttpOnly owner cookie and isolates conversation lists', async () => {
    const started = await harness(null);
    const first = await fetch(`${started.baseUrl}/api/conversations`);
    const setCookie = first.headers.get('set-cookie');
    expect(setCookie).toContain('minimi_owner=');
    expect(setCookie?.toLowerCase()).toContain('httponly');

    const alice = new TestClient(started.baseUrl);
    const bob = new TestClient(started.baseUrl);
    const conversationId = await alice.createConversation('Alice only');

    const aliceList = await alice.request('/api/conversations');
    const aliceBody = (await aliceList.json()) as {
      conversations: Array<{ id: string }>;
    };
    expect(aliceBody.conversations.map((conversation) => conversation.id)).toEqual([
      conversationId,
    ]);

    const bobList = await bob.request('/api/conversations');
    const bobBody = (await bobList.json()) as {
      conversations: Array<{ id: string }>;
    };
    expect(bobBody.conversations).toEqual([]);

    const bobMessages = await bob.request(
      `/api/conversations/${conversationId}/messages`,
    );
    expect(bobMessages.status).toBe(404);
  });

  it('rejects live runs when no executor is configured and admits no question', async () => {
    const started = await harness(null);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();

    const response = await client.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        message: 'Should not be stored',
        timezone: 'UTC',
        requestKey: 'offline-run',
      }),
    });
    expect(response.status).toBe(503);
    const body = (await response.json()) as {
      error: { code: string; retryable: boolean };
    };
    expect(body.error.code).toBe('service_unavailable');
    expect(body.error.retryable).toBe(true);

    const messages = await client.request(
      `/api/conversations/${conversationId}/messages`,
    );
    const messagesBody = (await messages.json()) as { messages: unknown[] };
    expect(messagesBody.messages).toEqual([]);
  });

  it('admits idempotently and executes a duplicate request only once', async () => {
    const executor = new ControlledExecutor();
    const started = await harness(executor);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();

    const first = await client.createRun(conversationId, 'hello', 'same-key');
    expect(first.existing).toBe(false);
    await waitForCondition(() => executor.calls === 1);

    const duplicate = await client.createRun(conversationId, 'hello', 'same-key');
    expect(duplicate.existing).toBe(true);
    expect(duplicate.runId).toBe(first.runId);
    await delay(20);
    expect(executor.calls).toBe(1);

    executor.release();
    const run = await client.waitForRun(
      first.runId,
      (candidate) => candidate.state === 'completed',
    );
    expect(run.answerText).toBe('Hello world');

    const messages = await client.request(
      `/api/conversations/${conversationId}/messages`,
    );
    const messagesBody = (await messages.json()) as {
      messages: Array<{ role: string; runState: string | null; originalText: string; answerState: string | null }>;
    };
    expect(messagesBody.messages).toHaveLength(2);
    expect(messagesBody.messages[0]?.role).toBe('user');
    expect(messagesBody.messages[0]?.runState).toBe('completed');
    expect(messagesBody.messages[0]?.originalText).toBe('hello');
    expect(messagesBody.messages[1]).toMatchObject({
      role: 'assistant', originalText: 'Hello world', answerState: 'complete', runState: 'completed',
    });
  });

  it('keeps the admitted question when the executor fails', async () => {
    const executor: RunExecutor = {
      async execute() {
        throw new Error('scripted executor failure');
      },
    };
    const started = await harness(executor);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();
    const admitted = await client.createRun(conversationId, 'keep me', 'failure-key');

    const run = await client.waitForRun(
      admitted.runId,
      (candidate) => candidate.state === 'failed',
    );
    expect(run.answerText).toBeNull();

    const messages = await client.request(
      `/api/conversations/${conversationId}/messages`,
    );
    const messagesBody = (await messages.json()) as {
      messages: Array<{ role: string; originalText: string; runState: string | null }>;
    };
    expect(messagesBody.messages).toHaveLength(1);
    expect(messagesBody.messages[0]?.originalText).toBe('keep me');
    expect(messagesBody.messages[0]?.runState).toBe('failed');
  });

  it('cancels idempotently and ignores late executor writes', async () => {
    const executor = new ControlledExecutor();
    const started = await harness(executor);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation();
    const admitted = await client.createRun(conversationId, 'cancel me', 'cancel-key');
    await waitForCondition(() => executor.calls === 1);

    const firstCancel = await client.request(
      `/api/runs/${admitted.runId}/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    expect(firstCancel.status).toBe(200);
    const firstBody = (await firstCancel.json()) as {
      state: string;
      version: number;
      cancelled: boolean;
    };
    expect(firstBody.state).toBe('cancelled');
    expect(firstBody.cancelled).toBe(true);

    const secondCancel = await client.request(
      `/api/runs/${admitted.runId}/cancel`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      },
    );
    const secondBody = (await secondCancel.json()) as {
      state: string;
      version: number;
      cancelled: boolean;
    };
    expect(secondBody.state).toBe('cancelled');
    expect(secondBody.version).toBe(firstBody.version);
    expect(secondBody.cancelled).toBe(false);

    executor.release();
    await delay(40);
    const run = await client.getRun(admitted.runId);
    expect(run.state).toBe('cancelled');
    expect(run.version).toBe(firstBody.version);
  });

  it('ignores client-supplied owner identity', async () => {
    const started = await harness(null);
    const alice = new TestClient(started.baseUrl);
    const bob = new TestClient(started.baseUrl);
    await alice.createConversation('Alice conversation');
    const aliceOwnerId = alice.cookie?.split('=')[1] ?? '';
    expect(aliceOwnerId).not.toBe('');

    const bobCreate = await bob.request('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Bob conversation',
        ownerId: aliceOwnerId,
      }),
    });
    expect(bobCreate.status).toBe(201);

    const aliceList = await alice.request('/api/conversations');
    const aliceBody = (await aliceList.json()) as {
      conversations: Array<{ title: string | null }>;
    };
    expect(aliceBody.conversations.map((conversation) => conversation.title)).toEqual([
      'Alice conversation',
    ]);

    const bobList = await bob.request('/api/conversations');
    const bobBody = (await bobList.json()) as {
      conversations: Array<{ title: string | null }>;
    };
    expect(bobBody.conversations.map((conversation) => conversation.title)).toEqual([
      'Bob conversation',
    ]);
  });

  it('restricts mutations to loopback Host headers', async () => {
    const started = await harness(null);
    const blocked = await rawPost(
      started.baseUrl,
      '/api/conversations',
      { host: 'evil.example' },
      JSON.stringify({ title: 'blocked host' }),
    );
    expect(blocked.status).toBe(403);
    const blockedBody = JSON.parse(blocked.body) as { error: { code: string } };
    expect(blockedBody.error.code).toBe('forbidden_origin');

    const allowed = await rawPost(
      started.baseUrl,
      '/api/conversations',
      { host: new URL(started.baseUrl).host },
      JSON.stringify({ title: 'allowed host' }),
    );
    expect(allowed.status).toBe(201);
  });

  it('rejects cross-origin mutations and accepts loopback origins', async () => {
    const started = await harness(null);
    const client = new TestClient(started.baseUrl);

    const blocked = await client.request('/api/conversations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://evil.example',
      },
      body: JSON.stringify({ title: 'blocked' }),
    });
    expect(blocked.status).toBe(403);
    const blockedBody = (await blocked.json()) as {
      error: { code: string };
    };
    expect(blockedBody.error.code).toBe('forbidden_origin');

    const allowed = await client.request('/api/conversations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://localhost:5173',
      },
      body: JSON.stringify({ title: 'allowed' }),
    });
    expect(allowed.status).toBe(201);
  });

  it('deletes conversation payloads and derived runs', async () => {
    const executor = new ImmediateExecutor();
    const started = await harness(executor);
    const client = new TestClient(started.baseUrl);
    const conversationId = await client.createConversation('delete me');
    const admitted = await client.createRun(conversationId, 'temporary', 'delete-key');
    await client.waitForRun(
      admitted.runId,
      (candidate) => candidate.state === 'completed',
    );

    const deleted = await client.request(
      `/api/conversations/${conversationId}`,
      { method: 'DELETE' },
    );
    expect(deleted.status).toBe(204);

    const messages = await client.request(
      `/api/conversations/${conversationId}/messages`,
    );
    expect(messages.status).toBe(404);
    const run = await client.request(`/api/runs/${admitted.runId}`);
    expect(run.status).toBe(404);
    const conversations = await client.request('/api/conversations');
    const conversationsBody = (await conversations.json()) as {
      conversations: unknown[];
    };
    expect(conversationsBody.conversations).toEqual([]);

    const counts = started.database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM messages) AS messages,
          (SELECT COUNT(*) FROM runs) AS runs,
          (SELECT COUNT(*) FROM run_events) AS events,
          (SELECT COUNT(*) FROM conversations WHERE deleted_at IS NOT NULL) AS tombstones`,
      )
      .get() as {
      messages: number;
      runs: number;
      events: number;
      tombstones: number;
    };
    expect(counts.messages).toBe(0);
    expect(counts.runs).toBe(0);
    expect(counts.events).toBe(0);
    expect(counts.tombstones).toBe(1);
  });

  it('returns a standardized error envelope for invalid payloads', async () => {
    const started = await harness(null);
    const client = new TestClient(started.baseUrl);
    const response = await client.request('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x'.repeat(201) }),
    });
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      error: {
        code: string;
        userMessage: string;
        retryable: boolean;
        runId: string | null;
      };
    };
    expect(body.error).toEqual({
      code: 'invalid_payload',
      userMessage: 'The request payload is invalid.',
      retryable: false,
      runId: null,
    });
  });
});
