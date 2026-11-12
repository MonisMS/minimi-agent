import {
  Router,
  type ErrorRequestHandler,
  type Response,
} from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { ZodError } from 'zod';
import {
  cancelRunRequestSchema,
  cancelRunResponseSchema,
  conversationResponseSchema,
  conversationsResponseSchema,
  createConversationRequestSchema,
  createRunRequestSchema,
  createRunResponseSchema,
  messageViewSchema,
  messagesResponseSchema,
  runViewSchema,
  type CancelRunResponse,
  type CreateRunResponse,
} from '../../shared/api.js';
import {
  idSchema,
  isTerminalRunState,
} from '../../shared/domain.js';
import type { AppConfig } from '../config.js';
import type { Clock } from '../clock.js';
import type { Scope } from '../db/conversations.js';
import {
  createConversation,
  listConversations,
} from '../db/conversations.js';
import { deleteConversationPayload } from '../db/deletion.js';
import { listMessages } from '../db/messages.js';
import {
  getRun,
  listActiveRunIdsForConversation,
} from '../db/runs.js';
import {
  admitRun,
  type AdmissionResult,
} from '../runs/admission.js';
import {
  RunError,
  RunNotFoundError,
} from '../runs/errors.js';
import {
  createRunExecution,
  type RunExecutor,
} from '../runs/executor.js';
import type { RunEventWriter } from '../runs/events.js';
import { cancelRun } from '../runs/lifecycle.js';
import type { RunAbortRegistry } from '../runs/registry.js';
import { RepositoryNotFoundError } from '../db/errors.js';
import {
  localOriginGuard,
  ownerMiddleware,
  requestOwnerId,
} from './owner.js';
import { streamRunEvents } from './sse.js';

export interface ApiDependencies {
  config: AppConfig;
  database: DatabaseSync;
  clock: Clock;
  registry: RunAbortRegistry;
  events: RunEventWriter;
  executor: RunExecutor | null;
}

function liveScope(res: Response): Scope {
  return {
    ownerId: requestOwnerId(res),
    namespace: 'live',
  };
}

function startExecution(
  dependencies: ApiDependencies,
  scope: Scope,
  admitted: AdmissionResult,
): void {
  const executor = dependencies.executor;
  if (!executor) return;

  const controller = dependencies.registry.register(admitted.run.id);
  const execution = createRunExecution({
    database: dependencies.database,
    clock: dependencies.clock,
    scope,
    run: admitted.run,
    question: admitted.question,
    signal: controller.signal,
    events: dependencies.events,
    registry: dependencies.registry,
  });

  Promise.resolve()
    .then(() => executor.execute(execution))
    .catch(() => {
      try {
        const latest = getRun(dependencies.database, scope, admitted.run.id);
        if (!latest || isTerminalRunState(latest.state) || controller.signal.aborted) {
          return;
        }
        execution.fail('executor_error');
      } catch {
        return;
      }
    });
}

export function createApiRouter(dependencies: ApiDependencies): Router {
  const router = Router();
  router.use(localOriginGuard());
  router.use(
    ownerMiddleware({
      database: dependencies.database,
      clock: dependencies.clock,
    }),
  );

  router.get('/conversations', (_req, res) => {
    const scope = liveScope(res);
    const conversations = listConversations(dependencies.database, scope);
    res.json(conversationsResponseSchema.parse({ conversations }));
  });

  router.post('/conversations', (req, res) => {
    const scope = liveScope(res);
    const body = createConversationRequestSchema.parse(req.body ?? {});
    const conversation = createConversation(dependencies.database, dependencies.clock, {
      ...scope,
      title: body.title ?? null,
    });
    res.status(201).json(conversationResponseSchema.parse({ conversation }));
  });

  router.get('/conversations/:conversationId/messages', (req, res) => {
    const scope = liveScope(res);
    const conversationId = req.params.conversationId;
    const messages = listMessages(
      dependencies.database,
      scope,
      conversationId,
    ).map((message) => {
      const run = message.runId
        ? getRun(dependencies.database, scope, message.runId)
        : null;
      return messageViewSchema.parse({
        ...message,
        runState: run?.state ?? null,
        resultId: run?.resultId ?? null,
      });
    });
    res.json(messagesResponseSchema.parse({ messages }));
  });

  router.delete('/conversations/:conversationId', (req, res) => {
    const scope = liveScope(res);
    const conversationId = req.params.conversationId;
    const activeRunIds = listActiveRunIdsForConversation(
      dependencies.database,
      scope,
      conversationId,
    );
    for (const runId of activeRunIds) {
      dependencies.registry.abort(runId);
      dependencies.registry.unregister(runId);
    }
    deleteConversationPayload(
      dependencies.database,
      dependencies.clock,
      scope,
      conversationId,
    );
    res.status(204).end();
  });

  router.post('/runs', (req, res) => {
    const scope = liveScope(res);
    const body = createRunRequestSchema.parse(req.body);
    const admitted = admitRun(
      {
        database: dependencies.database,
        registry: dependencies.registry,
        clock: dependencies.clock,
        limits: dependencies.config.limits,
        isReady: () => dependencies.executor !== null,
      },
      {
        ...scope,
        ...body,
      },
    );

    const response: CreateRunResponse = {
      runId: admitted.run.id,
      questionId: admitted.question.id,
      answerId: admitted.run.answerId,
      conversationId: admitted.run.conversationId,
      state: admitted.run.state,
      version: admitted.run.version,
      eventSeq: admitted.run.eventSeq,
      existing: admitted.existing,
    };
    res
      .status(admitted.existing ? 200 : 202)
      .json(createRunResponseSchema.parse(response));

    if (!admitted.existing) {
      startExecution(dependencies, scope, admitted);
    }
  });

  router.get('/runs/:runId', (req, res) => {
    const scope = liveScope(res);
    const run = getRun(dependencies.database, scope, req.params.runId);
    if (!run) throw new RunNotFoundError();
    res.json(runViewSchema.parse({ ...run, answerText: run.answerText }));
  });

  router.get('/runs/:runId/events', (req, res) => {
    const scope = liveScope(res);
    streamRunEvents({
      req,
      res,
      database: dependencies.database,
      scope,
      runId: req.params.runId,
      events: dependencies.events,
      clock: dependencies.clock,
    });
  });

  router.post('/runs/:runId/cancel', (req, res) => {
    const scope = liveScope(res);
    const body = cancelRunRequestSchema.parse(req.body ?? {});
    const result = cancelRun(
      dependencies.database,
      dependencies.clock,
      scope,
      req.params.runId,
      body.expectedVersion,
      dependencies.registry,
    );
    if (result.won) {
      dependencies.events.append(scope, result.run.id, 'done', {
        state: result.run.state,
        completedAt: result.run.completedAt,
      });
    }
    const response: CancelRunResponse = {
      runId: result.run.id,
      state: result.run.state,
      version: result.run.version,
      cancelled: result.won,
    };
    res.json(cancelRunResponseSchema.parse(response));
  });

  return router;
}

interface MappedError {
  status: number;
  code: string;
  userMessage: string;
  retryable: boolean;
  runId: string | null;
}

function mapError(error: unknown): MappedError {
  if (error instanceof RunError) {
    const candidateRunId = error.details.runId;
    const runId =
      typeof candidateRunId === 'string' && idSchema.safeParse(candidateRunId).success
        ? candidateRunId
        : null;
    return {
      status: error.httpStatus,
      code: error.code,
      userMessage: error.message,
      retryable: error.retryable,
      runId,
    };
  }
  if (error instanceof RepositoryNotFoundError) {
    return {
      status: 404,
      code: 'not_found',
      userMessage: error.message,
      retryable: false,
      runId: null,
    };
  }
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'invalid_payload',
      userMessage: 'The request payload is invalid.',
      retryable: false,
      runId: null,
    };
  }
  if (error instanceof SyntaxError) {
    return {
      status: 400,
      code: 'invalid_json',
      userMessage: 'The request body is not valid JSON.',
      retryable: false,
      runId: null,
    };
  }

  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status?: unknown }).status)
      : 500;
  if (status === 413) {
    return {
      status: 413,
      code: 'payload_too_large',
      userMessage: 'The request payload is too large.',
      retryable: false,
      runId: null,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      status,
      code: 'invalid_request',
      userMessage: 'The request could not be processed.',
      retryable: false,
      runId: null,
    };
  }
  return {
    status: 500,
    code: 'internal_error',
    userMessage: 'The server could not process the request.',
    retryable: true,
    runId: null,
  };
}

export const apiErrorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  const mapped = mapError(error);
  res.status(mapped.status).json({
    error: {
      code: mapped.code,
      userMessage: mapped.userMessage,
      retryable: mapped.retryable,
      runId: mapped.runId,
    },
  });
};
