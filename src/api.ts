import {
  cancelRunResponseSchema,
  conversationResponseSchema,
  conversationsResponseSchema,
  createRunResponseSchema,
  messagesResponseSchema,
  readinessSchema,
  type ConversationView,
  type CreateRunResponse,
  type MessageView,
  type Readiness,
  type VerificationResultResponse,
  verificationResultResponseSchema,
} from '../shared/api.js';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function json<T>(response: Response, parse: (value: unknown) => T): Promise<T> {
  const value: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const envelope = value as {
      error?: { code?: unknown; userMessage?: unknown; retryable?: unknown };
    } | null;
    throw new ApiError(
      typeof envelope?.error?.userMessage === 'string'
        ? envelope.error.userMessage
        : `Request failed (${response.status}).`,
      typeof envelope?.error?.code === 'string' ? envelope.error.code : 'request_failed',
      envelope?.error?.retryable === true,
    );
  }
  return parse(value);
}

export async function getReadiness(): Promise<Readiness> {
  return json(await fetch('/api/readiness'), (value) => readinessSchema.parse(value));
}

export async function listConversations(): Promise<ConversationView[]> {
  return json(await fetch('/api/conversations'), (value) =>
    conversationsResponseSchema.parse(value).conversations,
  );
}

export async function createConversation(): Promise<ConversationView> {
  return json(
    await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }),
    (value) => conversationResponseSchema.parse(value).conversation,
  );
}

export async function getMessages(conversationId: string): Promise<MessageView[]> {
  return json(
    await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`),
    (value) => messagesResponseSchema.parse(value).messages,
  );
}

export interface AdmissionInput {
  conversationId: string;
  timezone: string;
  requestKey: string;
  message?: string;
  questionId?: string;
  retryOfRunId?: string;
  baselineId?: string;
}

export async function getVerificationResult(resultId: string): Promise<VerificationResultResponse> {
  return json(
    await fetch(`/api/results/${encodeURIComponent(resultId)}`),
    (value) => verificationResultResponseSchema.parse(value),
  );
}

export async function admitRun(input: AdmissionInput): Promise<CreateRunResponse> {
  const body = JSON.stringify(input);
  // A failed fetch has an unknown outcome. Reuse the same request key and body once
  // so a lost response reconciles with the original admission.
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    } catch (error) {
      if (attempt === 0) continue;
      throw error;
    }
    return json(response, (value) => createRunResponseSchema.parse(value));
  }
}

export async function cancelRun(runId: string, expectedVersion?: number): Promise<void> {
  await json(
    await fetch(`/api/runs/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(expectedVersion === undefined ? {} : { expectedVersion }),
    }),
    (value) => cancelRunResponseSchema.parse(value),
  );
}

