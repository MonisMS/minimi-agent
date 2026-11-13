import { z } from 'zod';
import {
  answerStateSchema,
  conversationSchema,
  idSchema,
  messageSchema,
  messageRoleSchema,
  decisionSnapshotSchema,
  nonNegativeIntegerSchema,
  runSchema,
  runStateSchema,
  runUsageSchema,
  sourceObservationSchema,
  verificationResultSchema,
} from './domain.js';

export const readinessSchema = z.object({
  ok: z.literal(true),
  mode: z.enum(['live', 'offline']),
  model: z.string().nullable(),
  configured: z.object({
    openai: z.boolean(),
    tavily: z.boolean(),
  }),
  capabilities: z.object({
    liveGeneration: z.boolean(),
    search: z.boolean(),
  }),
  notes: z.array(z.string()),
});
export type Readiness = z.infer<typeof readinessSchema>;

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().min(1).max(120),
    userMessage: z.string().min(1).max(1000),
    retryable: z.boolean(),
    runId: idSchema.nullable(),
  }),
});
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

export const conversationViewSchema = conversationSchema.omit({ ownerId: true });
export type ConversationView = z.infer<typeof conversationViewSchema>;

export const conversationResponseSchema = z.object({
  conversation: conversationViewSchema,
});
export type ConversationResponse = z.infer<typeof conversationResponseSchema>;

export const createConversationRequestSchema = z.object({
  title: z.string().max(200).nullable().optional(),
});
export type CreateConversationRequest = z.infer<typeof createConversationRequestSchema>;

export const messageViewSchema = messageSchema
  .omit({ ownerId: true })
  .extend({
    runState: runStateSchema.nullable(),
    resultId: idSchema.nullable(),
  });
export type MessageView = z.infer<typeof messageViewSchema>;

export const createRunRequestSchema = z
  .object({
    conversationId: idSchema,
    message: z.string().min(1).max(20_000).optional(),
    questionId: idSchema.optional(),
    timezone: z.string().min(1).max(100),
    requestKey: z.string().min(1).max(200),
    retryOfRunId: idSchema.optional(),
    baselineId: idSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const hasMessage = typeof value.message === 'string' && value.message.trim().length > 0;
    const hasQuestion = typeof value.questionId === 'string';
    if (hasMessage === hasQuestion) {
      ctx.addIssue({
        code: 'custom',
        message: 'Provide exactly one of message or questionId',
        path: hasMessage ? ['questionId'] : ['message'],
      });
    }
  });
export type CreateRunRequest = z.infer<typeof createRunRequestSchema>;

export const createRunResponseSchema = z.object({
  runId: idSchema,
  questionId: idSchema,
  answerId: idSchema.nullable(),
  conversationId: idSchema,
  state: runStateSchema,
  version: z.number().int().nonnegative(),
  eventSeq: z.number().int().nonnegative(),
  existing: z.boolean(),
});
export type CreateRunResponse = z.infer<typeof createRunResponseSchema>;

export const runViewSchema = runSchema
  .omit({ ownerId: true })
  .extend({
    answerText: z.string().nullable(),
    baselineId: idSchema.nullable(),
  });
export type RunView = z.infer<typeof runViewSchema>;

export const cancelRunResponseSchema = z.object({
  runId: idSchema,
  state: runStateSchema,
  version: z.number().int().nonnegative(),
  cancelled: z.boolean(),
});
export type CancelRunResponse = z.infer<typeof cancelRunResponseSchema>;

export const cancelRunRequestSchema = z.object({
  expectedVersion: nonNegativeIntegerSchema.optional(),
});
export type CancelRunRequest = z.infer<typeof cancelRunRequestSchema>;

export const conversationsResponseSchema = z.object({
  conversations: z.array(conversationViewSchema),
});
export type ConversationsResponse = z.infer<typeof conversationsResponseSchema>;

export const messagesResponseSchema = z.object({
  messages: z.array(messageViewSchema),
});
export type MessagesResponse = z.infer<typeof messagesResponseSchema>;

export const runUsageViewSchema = runUsageSchema;
export type RunUsageView = z.infer<typeof runUsageViewSchema>;

export const verificationResultResponseSchema = z.object({
  result: verificationResultSchema,
  baselineSnapshot: decisionSnapshotSchema.nullable(),
  baselineOriginal: messageSchema.nullable(),
  observations: z.array(sourceObservationSchema),
});
export type VerificationResultResponse = z.infer<typeof verificationResultResponseSchema>;

export const answerStateViewSchema = answerStateSchema;
export type AnswerStateView = z.infer<typeof answerStateViewSchema>;

export const messageRoleViewSchema = messageRoleSchema;
export type MessageRoleView = z.infer<typeof messageRoleViewSchema>;
