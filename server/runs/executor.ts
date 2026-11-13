import type { DatabaseSync } from 'node:sqlite';
import type { EventEnvelope } from '../../shared/events.js';
import {
  isTerminalRunState,
  type Message,
  type RunState,
  type RunUsage,
  type VerificationResult,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import type { Scope } from '../db/conversations.js';
import type { RunRecord } from '../db/runs.js';
import type { RunEventWriter, PersistedEventType } from './events.js';
import {
  completeRun,
  failRun,
  recordUsage,
  requireClarification,
  transitionRun,
  updateCheckpoint,
} from './lifecycle.js';
import type { RunAbortRegistry } from './registry.js';
import { addMessage } from '../db/messages.js';
import { runTransaction } from '../db/transaction.js';
import { insertVerificationResult } from '../db/verifications.js';

function answerTimestamp(clock: Clock, question: Message): string {
  return new Date(Math.max(clock.now().getTime(), Date.parse(question.createdAt) + 1)).toISOString();
}

export interface RunExecution {
  readonly run: RunRecord;
  readonly question: Message;
  readonly signal: AbortSignal;
  emit(type: PersistedEventType, payload: unknown): EventEnvelope;
  emitDelta(text: string): void;
  flushDeltas(): void;
  setState(toState: RunState): RunRecord;
  checkpoint(answerText: string): boolean;
  recordUsage(usage: RunUsage): void;
  complete(input: {
    answerText: string;
    resultId?: string | null;
    usage?: RunUsage;
    sourceObservationIds?: string[];
    verificationResult?: VerificationResult;
  }): RunRecord;
  clarify(answerText: string): RunRecord;
  fail(errorCode: string): RunRecord;
}

export interface RunExecutor {
  execute(execution: RunExecution): Promise<void>;
}

export interface RunExecutionDependencies {
  database: DatabaseSync;
  clock: Clock;
  scope: Scope;
  run: RunRecord;
  question: Message;
  signal: AbortSignal;
  events: RunEventWriter;
  registry: RunAbortRegistry;
}

export function createRunExecution(
  dependencies: RunExecutionDependencies,
): RunExecution {
  const { database, clock, scope, question, signal, events, registry } = dependencies;
  let current = dependencies.run;

  const execution: RunExecution = {
    get run() {
      return current;
    },
    question,
    signal,
    emit(type, payload) {
      return events.append(scope, current.id, type, payload);
    },
    emitDelta(text) {
      events.appendDelta(scope, current.id, text);
    },
    flushDeltas() {
      events.flushDelta(scope, current.id);
    },
    setState(toState) {
      if (isTerminalRunState(toState)) {
        throw new Error('Use complete, clarify, or fail for terminal states');
      }
      current = transitionRun(database, clock, {
        ...scope,
        runId: current.id,
        expectedVersion: current.version,
        toState,
      });
      events.append(scope, current.id, 'status', {
        state: current.state,
        version: current.version,
        message: null,
      });
      return current;
    },
    checkpoint(answerText) {
      return updateCheckpoint(database, clock, scope, current.id, answerText);
    },
    recordUsage(usage) {
      recordUsage(database, clock, scope, current.id, usage);
      current = {
        ...current,
        usage: { ...usage },
      };
    },
    complete(input) {
      if (!current.answerId) {
        throw new Error('The run has no answer message to complete');
      }
      const answerId = current.answerId;
      events.flushDelta(scope, current.id);
      current = runTransaction(database, () => {
        if (input.verificationResult) {
          if (input.resultId !== input.verificationResult.id || input.verificationResult.runId !== current.id) {
            throw new Error('Verification result does not match the completing run');
          }
          insertVerificationResult(database, {
            ...scope,
            conversationId: current.conversationId,
            result: input.verificationResult,
            createdAt: clock.now().toISOString(),
          });
        }
        addMessage(database, {
          ...scope,
          id: answerId,
          conversationId: current.conversationId,
          role: 'assistant',
          originalText: input.answerText,
          createdAt: answerTimestamp(clock, question),
          timezone: question.timezone,
          runId: current.id,
          answerState: 'complete',
          sourceObservationIds: input.sourceObservationIds ?? [],
        });
        return completeRun(database, clock, {
          ...scope,
          runId: current.id,
          expectedVersion: current.version,
          answerId,
          answerText: input.answerText,
          resultId: input.resultId ?? null,
          usage: input.usage ?? current.usage,
        });
      });
      registry.unregister(current.id);
      if (input.resultId) {
        events.append(scope, current.id, 'result_ready', {
          resultId: input.resultId,
        });
      }
      events.append(scope, current.id, 'done', {
        state: current.state,
        completedAt: current.completedAt,
      });
      return current;
    },
    clarify(answerText) {
      events.appendDelta(scope, current.id, answerText);
      events.flushDelta(scope, current.id);
      if (!current.answerId) throw new Error('The run has no answer message to clarify');
      const answerId = current.answerId;
      current = runTransaction(database, () => {
        addMessage(database, {
          ...scope,
          id: answerId,
          conversationId: current.conversationId,
          role: 'assistant',
          originalText: answerText,
          createdAt: answerTimestamp(clock, question),
          timezone: question.timezone,
          runId: current.id,
          answerState: 'partial',
        });
        return requireClarification(
          database,
          clock,
          scope,
          current.id,
          current.version,
        );
      });
      registry.unregister(current.id);
      events.append(scope, current.id, 'done', {
        state: current.state,
        completedAt: current.completedAt,
      });
      return current;
    },
    fail(errorCode) {
      events.flushDelta(scope, current.id);
      current = failRun(
        database,
        clock,
        scope,
        current.id,
        current.version,
        errorCode,
        registry,
      );
      events.append(scope, current.id, 'error', {
        code: errorCode,
        userMessage: 'The run could not be completed.',
        retryable: false,
        runId: current.id,
      });
      events.append(scope, current.id, 'done', {
        state: current.state,
        completedAt: current.completedAt,
      });
      return current;
    },
  };

  return execution;
}
