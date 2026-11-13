import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  ianaZoneSchema,
  idSchema,
  namespaceSchema,
  type Message,
  type Namespace,
  type Run,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import type { RunLimits } from '../config.js';
import {
  countActiveRuns,
  countActiveRunsForConversation,
  getLatestRunForQuestion,
  getRun,
  getRunByRequestKey,
  insertRun,
  type RunRecord,
} from '../db/runs.js';
import { getMessage, addMessage } from '../db/messages.js';
import { requireConversation, type Scope } from '../db/conversations.js';
import { runTransaction } from '../db/transaction.js';
import {
  AdmissionError,
  ConversationBusyError,
  ProcessCapacityError,
  RequestKeyConflictError,
  RunNotFoundError,
  ServiceUnavailableError,
} from './errors.js';
import type { RunAbortRegistry } from './registry.js';
import { classifyConversation } from '../agent/route.js';

export interface AdmissionInput extends Scope {
  conversationId: string;
  message?: string;
  questionId?: string;
  timezone: string;
  requestKey: string;
  retryOfRunId?: string;
  baselineId?: string;
}

export interface AdmissionResult {
  run: RunRecord;
  question: Message;
  existing: boolean;
}

export interface AdmissionDependencies {
  database: DatabaseSync;
  registry: RunAbortRegistry;
  clock: Clock;
  limits: RunLimits;
  isReady?: () => boolean;
}

const admissionInputSchema = z
  .object({
    ownerId: idSchema,
    namespace: namespaceSchema,
    conversationId: idSchema,
    message: z.string().max(20_000).optional(),
    questionId: idSchema.optional(),
    timezone: ianaZoneSchema,
    requestKey: z.string().min(1).max(200),
    retryOfRunId: idSchema.optional(),
    baselineId: idSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasMessage = typeof value.message === 'string';
    const hasQuestion = typeof value.questionId === 'string';
    if (hasMessage === hasQuestion) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of message or questionId',
        path: hasMessage ? ['questionId'] : ['message'],
      });
    }
  });

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function normalizedPayloadHash(payload: {
  conversationId: string;
  message: string | null;
  questionId: string | null;
  timezone: string;
  retryOfRunId: string | null;
  baselineId: string | null;
}): string {
  return createHash('sha256').update(stableStringify(payload)).digest('hex');
}

function parseAdmissionInput(input: AdmissionInput) {
  const parsed = admissionInputSchema.safeParse(input);
  if (!parsed.success) {
    throw new AdmissionError(
      'invalid_admission',
      parsed.error.issues.map((issue) => issue.message).join('; '),
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

function requireScopedRun(
  database: DatabaseSync,
  scope: Scope,
  runId: string,
): RunRecord {
  const run = getRun(database, scope, runId);
  if (!run) {
    throw new AdmissionError('invalid_retry', 'The retry run was not found');
  }
  return run;
}

export function admitRun(
  dependencies: AdmissionDependencies,
  input: AdmissionInput,
): AdmissionResult {
  const { database, registry, clock, limits } = dependencies;
  const parsed = parseAdmissionInput(input);
  const scope: Scope = { ownerId: parsed.ownerId, namespace: parsed.namespace };
  const message = parsed.message?.trim();

  if (parsed.message !== undefined && (message === undefined || message.length === 0)) {
    throw new AdmissionError('invalid_message', 'The message cannot be empty');
  }

  const payloadHash = normalizedPayloadHash({
    conversationId: parsed.conversationId,
    message: message ?? null,
    questionId: parsed.questionId ?? null,
    timezone: parsed.timezone,
    retryOfRunId: parsed.retryOfRunId ?? null,
    baselineId: parsed.baselineId ?? null,
  });

  const existing = getRunByRequestKey(database, scope, parsed.requestKey);
  if (existing) {
    if (existing.normalizedPayloadHash !== payloadHash) {
      throw new RequestKeyConflictError();
    }
    const question = getMessage(database, scope, existing.questionId);
    if (!question) {
      throw new RunNotFoundError('The existing run question was not found');
    }
    return { run: existing, question, existing: true };
  }

  if (dependencies.isReady && !dependencies.isReady()) {
    throw new ServiceUnavailableError();
  }

  let result: AdmissionResult;
  try {
    result = runTransaction(database, () => {
      const conversation = requireConversation(database, scope, parsed.conversationId);
      if (countActiveRuns(database) >= limits.processActiveRuns) {
        throw new ProcessCapacityError();
      }
      if (
        countActiveRunsForConversation(database, scope, parsed.conversationId) >=
        limits.activeRunPerConversation
      ) {
        throw new ConversationBusyError();
      }

      const startedAt = clock.now();
      const now = startedAt.toISOString();
      const nowMs = startedAt.getTime();
      const runId = randomUUID();
      const answerId = randomUUID();
      let retryOfRunId = parsed.retryOfRunId ?? null;

      if (retryOfRunId) {
        const retryRun = requireScopedRun(database, scope, retryOfRunId);
        if (retryRun.conversationId !== parsed.conversationId) {
          throw new AdmissionError(
            'invalid_retry',
            'The retry run belongs to a different conversation',
          );
        }
      }

      let question: Message;
      if (message !== undefined) {
        question = addMessage(database, {
          ...scope,
          conversationId: parsed.conversationId,
          role: 'user',
          originalText: message,
          createdAt: now,
          timezone: parsed.timezone,
          runId,
        });
      } else {
        if (!parsed.questionId) {
          throw new AdmissionError('invalid_question', 'A question ID is required');
        }
        const existingQuestion = getMessage(database, scope, parsed.questionId);
        if (
          !existingQuestion ||
          existingQuestion.conversationId !== parsed.conversationId ||
          existingQuestion.role !== 'user'
        ) {
          throw new AdmissionError(
            'invalid_question',
            'The question does not belong to this conversation',
          );
        }
        question = existingQuestion;
        if (!retryOfRunId) {
          const latest = getLatestRunForQuestion(database, scope, question.id);
          retryOfRunId = latest?.id ?? null;
        }
      }

      const run: Run = {
        id: runId,
        ownerId: parsed.ownerId,
        namespace: parsed.namespace,
        conversationId: parsed.conversationId,
        questionId: question.id,
        answerId,
        requestKey: parsed.requestKey,
        normalizedPayloadHash: payloadHash,
        retryOfRunId,
        taskKind: parsed.baselineId || classifyConversation(question.originalText).historicalRecheck
          ? 'recheck'
          : 'chat',
        state: 'received',
        version: 1,
        eventSeq: 0,
        startedAt: now,
        acquisitionDeadlineAt: new Date(nowMs + limits.acquisitionCutoffMs).toISOString(),
        deadlineAt: new Date(nowMs + limits.maxRunMs).toISOString(),
        completedAt: null,
        usage: {
          modelCalls: 0,
          searchQueries: 0,
          searchBatches: 0,
          inputTokens: null,
          outputTokens: null,
          providerCredits: null,
        },
        errorCode: null,
        resultId: null,
        capturedGeneration: conversation.generation,
      };

      insertRun(database, {
        run,
        answerText: null,
        baselineId: parsed.baselineId ?? null,
      });

      return {
        run: { ...run, answerText: null, baselineId: parsed.baselineId ?? null },
        question,
        existing: false,
      };
    });
  } catch (error) {
    const raced = getRunByRequestKey(database, scope, parsed.requestKey);
    if (raced) {
      if (raced.normalizedPayloadHash !== payloadHash) {
        throw new RequestKeyConflictError();
      }
      const question = getMessage(database, scope, raced.questionId);
      if (!question) {
        throw new RunNotFoundError('The existing run question was not found');
      }
      return { run: raced, question, existing: true };
    }
    throw error;
  }

  registry.register(result.run.id);
  return result;
}
