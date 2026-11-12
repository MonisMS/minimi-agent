import { z } from 'zod';
import { runViewSchema } from './api.js';
import {
  eventTypeSchema,
  idSchema,
  isoInstantSchema,
  nonNegativeIntegerSchema,
  recallResultSchema,
  runStateSchema,
  searchOutcomeSchema,
  terminalRunStateSchema,
} from './domain.js';

const baseEventFields = {
  version: z.literal(1),
  runId: idSchema,
  conversationId: idSchema,
  seq: nonNegativeIntegerSchema,
  timestamp: isoInstantSchema,
};

export const snapshotEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('snapshot'),
  payload: z.object({
    run: runViewSchema,
    answerText: z.string().nullable(),
    terminal: z.boolean(),
    resultId: idSchema.nullable(),
  }),
});

export const statusEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('status'),
  payload: z.object({
    state: runStateSchema,
    version: nonNegativeIntegerSchema,
    message: z.string().max(500).nullable(),
  }),
});

export const recallEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('recall'),
  payload: z.object({
    result: recallResultSchema,
  }),
});

export const searchEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('search'),
  payload: z.object({
    outcome: searchOutcomeSchema,
  }),
});

export const sourcesEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('sources'),
  payload: z.object({
    observationIds: z.array(idSchema),
  }),
});

export const answerDeltaEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('answer_delta'),
  payload: z.object({
    text: z.string().min(1),
  }),
});

export const resultReadyEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('result_ready'),
  payload: z.object({
    resultId: idSchema,
  }),
});

export const doneEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('done'),
  payload: z.object({
    state: terminalRunStateSchema,
    completedAt: isoInstantSchema.nullable(),
  }),
});

export const errorEventSchema = z.object({
  ...baseEventFields,
  type: z.literal('error'),
  payload: z.object({
    code: z.string().min(1).max(120),
    userMessage: z.string().min(1).max(1000),
    retryable: z.boolean(),
    runId: idSchema.nullable(),
  }),
});

export const eventEnvelopeSchema = z.discriminatedUnion('type', [
  snapshotEventSchema,
  statusEventSchema,
  recallEventSchema,
  searchEventSchema,
  sourcesEventSchema,
  answerDeltaEventSchema,
  resultReadyEventSchema,
  doneEventSchema,
  errorEventSchema,
]);
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

export const eventTypeViewSchema = eventTypeSchema;
export type EventTypeView = z.infer<typeof eventTypeViewSchema>;

export type SnapshotEvent = z.infer<typeof snapshotEventSchema>;
export type StatusEvent = z.infer<typeof statusEventSchema>;
export type RecallEvent = z.infer<typeof recallEventSchema>;
export type SearchEvent = z.infer<typeof searchEventSchema>;
export type SourcesEvent = z.infer<typeof sourcesEventSchema>;
export type AnswerDeltaEvent = z.infer<typeof answerDeltaEventSchema>;
export type ResultReadyEvent = z.infer<typeof resultReadyEventSchema>;
export type DoneEvent = z.infer<typeof doneEventSchema>;
export type ErrorEvent = z.infer<typeof errorEventSchema>;
