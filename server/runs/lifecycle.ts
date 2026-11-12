import type { DatabaseSync } from 'node:sqlite';
import {
  isTerminalRunState,
  type RunState,
  type RunUsage,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import type { Scope } from '../db/conversations.js';
import {
  getRun,
  interruptActiveRuns,
  transitionRunState,
  tryUpdateRunCheckpoint,
  updateRunUsage,
  type RunRecord,
} from '../db/runs.js';
import {
  InvalidRunTransitionError,
  RunNotFoundError,
  RunStateConflictError,
} from './errors.js';
import type { RunAbortRegistry } from './registry.js';

export const ALLOWED_TRANSITIONS: Record<RunState, readonly RunState[]> = {
  received: [
    'recalling',
    'generating',
    'researching',
    'validating',
    'clarification_required',
    'cancelled',
    'failed',
  ],
  recalling: [
    'generating',
    'researching',
    'validating',
    'clarification_required',
    'cancelled',
    'failed',
  ],
  generating: [
    'researching',
    'validating',
    'completed',
    'clarification_required',
    'cancelled',
    'failed',
  ],
  researching: [
    'generating',
    'validating',
    'completed',
    'clarification_required',
    'cancelled',
    'failed',
  ],
  validating: ['completed', 'clarification_required', 'cancelled', 'failed'],
  completed: [],
  clarification_required: [],
  cancelled: [],
  failed: [],
  interrupted: [],
};

export function assertTransitionAllowed(from: RunState, to: RunState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new InvalidRunTransitionError(from, to);
  }
}

export interface TransitionRunInput extends Scope {
  runId: string;
  expectedVersion: number;
  toState: RunState;
  completedAt?: string | null;
  errorCode?: string | null;
  resultId?: string | null;
  answerId?: string | null;
  answerText?: string | null;
  usage?: RunUsage;
}

export function transitionRun(
  database: DatabaseSync,
  clock: Clock,
  input: TransitionRunInput,
): RunRecord {
  const run = getRun(database, input, input.runId);
  if (!run) {
    throw new RunNotFoundError();
  }
  if (run.version !== input.expectedVersion) {
    throw new RunStateConflictError(
      `Run is at version ${run.version}, not the expected version ${input.expectedVersion}`,
    );
  }
  assertTransitionAllowed(run.state, input.toState);

  const now = clock.now().toISOString();
  return transitionRunState(database, {
    ...input,
    fromStates: [run.state],
    updatedAt: now,
    completedAt: isTerminalRunState(input.toState)
      ? (input.completedAt ?? now)
      : input.completedAt,
  });
}

export interface TerminalResult {
  run: RunRecord;
  won: boolean;
}

export function cancelRun(
  database: DatabaseSync,
  clock: Clock,
  scope: Scope,
  runId: string,
  expectedVersion?: number,
  registry?: RunAbortRegistry,
): TerminalResult {
  const run = getRun(database, scope, runId);
  if (!run) {
    throw new RunNotFoundError();
  }
  if (isTerminalRunState(run.state)) {
    registry?.unregister(runId);
    return { run, won: false };
  }

  const version = expectedVersion ?? run.version;
  try {
    const updated = transitionRun(database, clock, {
      ...scope,
      runId,
      expectedVersion: version,
      toState: 'cancelled',
    });
    registry?.abort(runId);
    registry?.unregister(runId);
    return { run: updated, won: true };
  } catch (error) {
    const actual = getRun(database, scope, runId);
    if (actual && isTerminalRunState(actual.state)) {
      registry?.unregister(runId);
      return { run: actual, won: false };
    }
    throw error;
  }
}

export interface CompleteRunInput extends Scope {
  runId: string;
  expectedVersion: number;
  answerId: string;
  answerText: string;
  resultId: string | null;
  usage: RunUsage;
  registry?: RunAbortRegistry;
}

export function completeRun(
  database: DatabaseSync,
  clock: Clock,
  input: CompleteRunInput,
): RunRecord {
  try {
    const updated = transitionRun(database, clock, {
      ownerId: input.ownerId,
      namespace: input.namespace,
      runId: input.runId,
      expectedVersion: input.expectedVersion,
      toState: 'completed',
      answerId: input.answerId,
      answerText: input.answerText,
      resultId: input.resultId,
      usage: input.usage,
    });
    input.registry?.unregister(input.runId);
    return updated;
  } catch (error) {
    const actual = getRun(database, input, input.runId);
    if (actual && isTerminalRunState(actual.state)) {
      input.registry?.unregister(input.runId);
    }
    throw error;
  }
}

export function failRun(
  database: DatabaseSync,
  clock: Clock,
  scope: Scope,
  runId: string,
  expectedVersion: number,
  errorCode: string,
  registry?: RunAbortRegistry,
): RunRecord {
  const updated = transitionRun(database, clock, {
    ...scope,
    runId,
    expectedVersion,
    toState: 'failed',
    errorCode,
  });
  registry?.unregister(runId);
  return updated;
}

export function requireClarification(
  database: DatabaseSync,
  clock: Clock,
  scope: Scope,
  runId: string,
  expectedVersion: number,
  registry?: RunAbortRegistry,
): RunRecord {
  const updated = transitionRun(database, clock, {
    ...scope,
    runId,
    expectedVersion,
    toState: 'clarification_required',
  });
  registry?.unregister(runId);
  return updated;
}

export function updateCheckpoint(
  database: DatabaseSync,
  clock: Clock,
  scope: Scope,
  runId: string,
  answerText: string,
): boolean {
  return tryUpdateRunCheckpoint(database, {
    ...scope,
    runId,
    answerText,
    updatedAt: clock.now().toISOString(),
  });
}

export function recordUsage(
  database: DatabaseSync,
  clock: Clock,
  scope: Scope,
  runId: string,
  usage: RunUsage,
): void {
  updateRunUsage(database, {
    ...scope,
    runId,
    usage,
    updatedAt: clock.now().toISOString(),
  });
}

export function recoverInterruptedRuns(
  database: DatabaseSync,
  clock: Clock,
  registry?: RunAbortRegistry,
): number {
  registry?.abortAll();
  return interruptActiveRuns(database, clock.now().toISOString());
}
