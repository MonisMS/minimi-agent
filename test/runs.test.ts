import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../server/clock.js';
import { DEFAULT_LIMITS, type RunLimits } from '../server/config.js';
import { openInMemoryDatabase, closeDatabase } from '../server/db/connection.js';
import {
  createConversation,
  type Scope,
} from '../server/db/conversations.js';
import { RepositoryNotFoundError } from '../server/db/errors.js';
import { listMessages } from '../server/db/messages.js';
import { createOwner } from '../server/db/owners.js';
import {
  countActiveRuns,
  getRun,
  getRunByRequestKey,
} from '../server/db/runs.js';
import {
  admitRun,
  type AdmissionDependencies,
} from '../server/runs/admission.js';
import {
  ConversationBusyError,
  ProcessCapacityError,
  RequestKeyConflictError,
  RunStateConflictError,
} from '../server/runs/errors.js';
import {
  cancelRun,
  completeRun,
  failRun,
  recoverInterruptedRuns,
  transitionRun,
  updateCheckpoint,
} from '../server/runs/lifecycle.js';
import { RunAbortRegistry } from '../server/runs/registry.js';
import type { Conversation, Owner } from '../shared/domain.js';

const openDatabases: DatabaseSync[] = [];

afterEach(() => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop();
    if (database) {
      try {
        closeDatabase(database);
      } catch {
        // Already closed.
      }
    }
  }
});

interface Harness {
  database: DatabaseSync;
  clock: ManualClock;
  owner: Owner;
  conversation: Conversation;
  registry: RunAbortRegistry;
  limits: RunLimits;
  dependencies: AdmissionDependencies;
  scope: Scope;
}

function makeHarness(overrides: Partial<RunLimits> = {}): Harness {
  const database = openInMemoryDatabase();
  openDatabases.push(database);
  const clock = new ManualClock(new Date('2026-11-12T10:00:00.000Z'));
  const owner = createOwner(database, clock);
  const conversation = createConversation(database, clock, {
    ownerId: owner.id,
    namespace: 'live',
    title: 'CRM shortlist',
  });
  const registry = new RunAbortRegistry();
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  return {
    database,
    clock,
    owner,
    conversation,
    registry,
    limits,
    dependencies: { database, registry, clock, limits },
    scope: { ownerId: owner.id, namespace: 'live' },
  };
}

function admit(
  harness: Harness,
  requestKey: string,
  message: string,
  conversationId = harness.conversation.id,
) {
  return admitRun(harness.dependencies, {
    ownerId: harness.owner.id,
    namespace: 'live',
    conversationId,
    message,
    timezone: 'Asia/Kolkata',
    requestKey,
  });
}

function countRuns(database: DatabaseSync): number {
  const row = database.prepare('SELECT COUNT(*) AS count FROM runs').get() as
    | { count: number }
    | undefined;
  return row?.count ?? 0;
}

describe('idempotent admission (F25)', () => {
  it('reconciles the same request key and body to one question and run', () => {
    const harness = makeHarness();
    const first = admit(harness, 'request-1', 'Hello there');
    const second = admit(harness, 'request-1', 'Hello there');

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(second.question.id).toBe(first.question.id);
    expect(listMessages(harness.database, harness.scope, harness.conversation.id)).toHaveLength(
      1,
    );
    expect(countRuns(harness.database)).toBe(1);
    expect(getRunByRequestKey(harness.database, harness.scope, 'request-1')?.id).toBe(
      first.run.id,
    );
  });

  it('rejects a different body that reuses an existing request key', () => {
    const harness = makeHarness();
    admit(harness, 'request-1', 'Hello there');

    expect(() => admit(harness, 'request-1', 'A different question')).toThrowError(
      RequestKeyConflictError,
    );
    expect(countRuns(harness.database)).toBe(1);
  });

  it('admits one of two concurrent submissions to the same conversation (F26)', async () => {
    const harness = makeHarness();
    const results = await Promise.allSettled([
      Promise.resolve().then(() => admit(harness, 'request-a', 'First question')),
      Promise.resolve().then(() => admit(harness, 'request-b', 'Second question')),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ConversationBusyError,
    );
    expect(countActiveRuns(harness.database)).toBe(1);
    expect(countRuns(harness.database)).toBe(1);
  });

  it('keeps owner scope on runs and original messages', () => {
    const harness = makeHarness();
    const run = admit(harness, 'request-1', 'Hello there').run;
    const otherOwner = createOwner(
      harness.database,
      new ManualClock(new Date('2026-11-12T11:00:00.000Z')),
    );
    const otherScope: Scope = { ownerId: otherOwner.id, namespace: 'live' };

    expect(getRun(harness.database, otherScope, run.id)).toBeNull();
    expect(() =>
      listMessages(harness.database, otherScope, harness.conversation.id),
    ).toThrowError(RepositoryNotFoundError);
    expect(() =>
      admitRun(harness.dependencies, {
        ownerId: otherOwner.id,
        namespace: 'live',
        conversationId: harness.conversation.id,
        message: 'Cross-owner attempt',
        timezone: 'Asia/Kolkata',
        requestKey: 'request-other-owner',
      }),
    ).toThrowError(RepositoryNotFoundError);
  });

  it('enforces the process-wide active-run capacity', () => {
    const harness = makeHarness({ processActiveRuns: 2 });
    const secondConversation = createConversation(harness.database, harness.clock, {
      ownerId: harness.owner.id,
      namespace: 'live',
      title: 'Second',
    });
    const thirdConversation = createConversation(harness.database, harness.clock, {
      ownerId: harness.owner.id,
      namespace: 'live',
      title: 'Third',
    });

    admit(harness, 'request-1', 'One');
    admit(harness, 'request-2', 'Two', secondConversation.id);

    expect(() => admit(harness, 'request-3', 'Three', thirdConversation.id)).toThrowError(
      ProcessCapacityError,
    );
  });
});

describe('terminal lifecycle and retries (F27-F29)', () => {
  it('preserves the admitted question when execution fails and keeps no factual answer', () => {
    const harness = makeHarness();
    const admitted = admit(harness, 'request-1', 'What changed?');

    const failed = failRun(
      harness.database,
      harness.clock,
      harness.scope,
      admitted.run.id,
      admitted.run.version,
      'provider_error',
      harness.registry,
    );

    expect(failed.state).toBe('failed');
    expect(failed.errorCode).toBe('provider_error');
    expect(listMessages(harness.database, harness.scope, harness.conversation.id)).toHaveLength(
      1,
    );
    expect(harness.registry.size).toBe(0);
    expect(
      updateCheckpoint(
        harness.database,
        harness.clock,
        harness.scope,
        admitted.run.id,
        'late partial text',
      ),
    ).toBe(false);
  });

  it('has exactly one terminal winner and rejects late writes', () => {
    const harness = makeHarness();
    const admitted = admit(harness, 'request-1', 'Question');
    const generating = transitionRun(harness.database, harness.clock, {
      ...harness.scope,
      runId: admitted.run.id,
      expectedVersion: admitted.run.version,
      toState: 'generating',
    });

    const completed = completeRun(harness.database, harness.clock, {
      ...harness.scope,
      runId: generating.id,
      expectedVersion: generating.version,
      answerId: admitted.run.answerId ?? crypto.randomUUID(),
      answerText: 'Final answer',
      resultId: null,
      usage: generating.usage,
      registry: harness.registry,
    });
    expect(completed.state).toBe('completed');

    const lateCancel = cancelRun(
      harness.database,
      harness.clock,
      harness.scope,
      completed.id,
      generating.version,
      harness.registry,
    );
    expect(lateCancel.won).toBe(false);
    expect(lateCancel.run.state).toBe('completed');
    expect(() =>
      transitionRun(harness.database, harness.clock, {
        ...harness.scope,
        runId: completed.id,
        expectedVersion: generating.version,
        toState: 'generating',
      }),
    ).toThrowError(RunStateConflictError);
  });

  it('lets cancellation win and rejects a late completion', () => {
    const harness = makeHarness();
    const admitted = admit(harness, 'request-1', 'Question');
    const generating = transitionRun(harness.database, harness.clock, {
      ...harness.scope,
      runId: admitted.run.id,
      expectedVersion: admitted.run.version,
      toState: 'generating',
    });

    const cancelled = cancelRun(
      harness.database,
      harness.clock,
      harness.scope,
      generating.id,
      generating.version,
      harness.registry,
    );
    expect(cancelled.won).toBe(true);
    expect(cancelled.run.state).toBe('cancelled');

    expect(() =>
      completeRun(harness.database, harness.clock, {
        ...harness.scope,
        runId: generating.id,
        expectedVersion: generating.version,
        answerId: admitted.run.answerId ?? crypto.randomUUID(),
        answerText: 'Late answer',
        resultId: null,
        usage: generating.usage,
        registry: harness.registry,
      }),
    ).toThrowError(RunStateConflictError);
    expect(
      updateCheckpoint(
        harness.database,
        harness.clock,
        harness.scope,
        generating.id,
        'late partial text',
      ),
    ).toBe(false);
  });

  it('fails a late write when the conversation generation changed', () => {
    const harness = makeHarness();
    const admitted = admit(harness, 'request-1', 'Question');

    harness.database
      .prepare('UPDATE conversations SET generation = generation + 1 WHERE id = ?')
      .run(harness.conversation.id);

    expect(() =>
      transitionRun(harness.database, harness.clock, {
        ...harness.scope,
        runId: admitted.run.id,
        expectedVersion: admitted.run.version,
        toState: 'generating',
      }),
    ).toThrowError(RunStateConflictError);
  });

  it('aborts the registered controller when cancellation wins', () => {
    const harness = makeHarness();
    const admitted = admit(harness, 'request-1', 'Question');
    const controller = harness.registry.get(admitted.run.id);
    expect(controller?.signal.aborted).toBe(false);

    const cancelled = cancelRun(
      harness.database,
      harness.clock,
      harness.scope,
      admitted.run.id,
      admitted.run.version,
      harness.registry,
    );

    expect(cancelled.won).toBe(true);
    expect(controller?.signal.aborted).toBe(true);
    expect(harness.registry.size).toBe(0);
  });

  it('marks previous-process active runs interrupted without replaying them (F29)', () => {
    const harness = makeHarness();
    const admitted = admit(harness, 'request-1', 'Question');

    const interrupted = recoverInterruptedRuns(
      harness.database,
      harness.clock,
      harness.registry,
    );
    expect(interrupted).toBe(1);
    expect(harness.registry.size).toBe(0);

    const recovered = getRun(harness.database, harness.scope, admitted.run.id);
    expect(recovered?.state).toBe('interrupted');
    expect(recovered?.completedAt).not.toBeNull();
    expect(countActiveRuns(harness.database)).toBe(0);
    expect(countRuns(harness.database)).toBe(1);
    expect(recoverInterruptedRuns(harness.database, harness.clock)).toBe(0);
  });

  it('links a retry to the persisted question without creating a duplicate message', () => {
    const harness = makeHarness();
    const first = admit(harness, 'request-1', 'Original question');
    const failed = failRun(
      harness.database,
      harness.clock,
      harness.scope,
      first.run.id,
      first.run.version,
      'provider_error',
    );

    const retry = admitRun(harness.dependencies, {
      ownerId: harness.owner.id,
      namespace: 'live',
      conversationId: harness.conversation.id,
      questionId: first.question.id,
      timezone: 'Asia/Kolkata',
      requestKey: 'request-retry-1',
    });

    expect(retry.run.questionId).toBe(first.question.id);
    expect(retry.run.retryOfRunId).toBe(failed.id);
    expect(retry.question.id).toBe(first.question.id);
    expect(listMessages(harness.database, harness.scope, harness.conversation.id)).toHaveLength(
      1,
    );
    expect(countRuns(harness.database)).toBe(2);
  });
});
