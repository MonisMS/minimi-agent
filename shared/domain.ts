import { z } from 'zod';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isValidLocalDate(value: string): boolean {
  const match = LOCAL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const idSchema = z.string().regex(UUID_PATTERN, 'Expected an opaque UUID');
export const namespaceSchema = z.enum(['live', 'demo']);
export type Namespace = z.infer<typeof namespaceSchema>;
export const isoInstantSchema = z
  .string()
  .refine(
    (value) => ISO_INSTANT_PATTERN.test(value) && !Number.isNaN(Date.parse(value)),
    'Expected a UTC ISO timestamp',
  );
export const localDateSchema = z
  .string()
  .refine(isValidLocalDate, 'Expected a valid YYYY-MM-DD calendar date');
export const ianaZoneSchema = z.string().min(1).refine((zone) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}, 'Expected an IANA time zone');
export const decimalStringSchema = z
  .string()
  .refine(
    (value) => DECIMAL_PATTERN.test(value) && Number.isFinite(Number(value)),
    'Expected a finite decimal string',
  );
export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => Number(value) > 0,
  'Expected a positive decimal string',
);
export const currencySchema = z.string().regex(CURRENCY_PATTERN, 'Expected an ISO 4217 code');
export const quantitySchema = z.number().int().positive();
export const nonNegativeIntegerSchema = z.number().int().nonnegative();

export const spanSchema = z
  .object({
    start: nonNegativeIntegerSchema,
    endExclusive: nonNegativeIntegerSchema,
  })
  .superRefine((span, ctx) => {
    if (span.endExclusive < span.start) {
      ctx.addIssue({
        code: 'custom',
        message: 'endExclusive must be greater than or equal to start',
        path: ['endExclusive'],
      });
    }
  });

export type Span = z.infer<typeof spanSchema>;

export class DomainValidationError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'DomainValidationError';
    this.code = code;
    this.details = details;
  }
}

export function validateSpan(text: string, span: Span, quote: string): void {
  const parsed = spanSchema.safeParse(span);
  if (!parsed.success) {
    throw new DomainValidationError('invalid_span', 'Span is malformed', {
      issues: parsed.error.issues,
    });
  }
  if (span.endExclusive > text.length) {
    throw new DomainValidationError('span_out_of_bounds', 'Span exceeds the stored text', {
      length: text.length,
      span,
    });
  }
  const actual = text.slice(span.start, span.endExclusive);
  if (actual !== quote) {
    throw new DomainValidationError('span_quote_mismatch', 'Span does not match the quote', {
      expected: quote,
      actual,
      span,
    });
  }
}

export function spanMatches(text: string, span: Span, quote: string): boolean {
  try {
    validateSpan(text, span, quote);
    return true;
  } catch {
    return false;
  }
}

export const runStateSchema = z.enum([
  'received',
  'recalling',
  'generating',
  'researching',
  'validating',
  'completed',
  'clarification_required',
  'cancelled',
  'failed',
  'interrupted',
]);
export type RunState = z.infer<typeof runStateSchema>;

export const ACTIVE_RUN_STATES = [
  'received',
  'recalling',
  'generating',
  'researching',
  'validating',
] as const satisfies readonly RunState[];

export const TERMINAL_RUN_STATES = [
  'completed',
  'clarification_required',
  'cancelled',
  'failed',
  'interrupted',
] as const satisfies readonly RunState[];

export const activeRunStateSchema = z.enum(ACTIVE_RUN_STATES);
export const terminalRunStateSchema = z.enum(TERMINAL_RUN_STATES);

export function isActiveRunState(state: RunState): boolean {
  return (ACTIVE_RUN_STATES as readonly RunState[]).includes(state);
}

export function isTerminalRunState(state: RunState): boolean {
  return (TERMINAL_RUN_STATES as readonly RunState[]).includes(state);
}

export const taskKindSchema = z.enum(['chat', 'recall', 'research', 'recheck']);
export const messageRoleSchema = z.enum(['user', 'assistant']);
export type MessageRole = z.infer<typeof messageRoleSchema>;
export const answerStateSchema = z.enum(['complete', 'partial', 'cancelled', 'failed']);
export type AnswerState = z.infer<typeof answerStateSchema>;
export const decisionSnapshotStateSchema = z.enum([
  'assistant_proposed',
  'user_shortlisted',
  'user_selected',
]);
export const queryPurposeSchema = z.enum(['current_state', 'dated_change', 'general']);
export const searchStatusSchema = z.enum(['succeeded', 'empty', 'failed', 'cancelled']);
export const acquisitionSchema = z.enum(['unattempted', 'attempted']);
export const comparabilitySchema = z.enum(['pending', 'compatible', 'incompatible', 'insufficient']);
export const resolutionSchema = z.enum(['unresolved', 'resolved']);
export const verdictSchema = z.enum([
  'confirmed_change',
  'different_now_timing_unknown',
  'same_observed',
  'earlier_answer_wrong',
  'cannot_compare',
  'no_saved_baseline',
]);
export const reasonCodeSchema = z.enum([
  'missing_historical_evidence',
  'missing_current_evidence',
  'plan_mismatch',
  'commitment_mismatch',
  'currency_mismatch',
  'quantity_unknown',
  'unsupported_pricing',
  'conflicting_sources',
  'unknown_transition_date',
  'budget_exhausted',
]);
export const priceUnitSchema = z.enum(['seat', 'account', 'flat', 'other']);
export const quotedIntervalSchema = z.enum(['month', 'year', 'usage', 'other']);
export const commitmentSchema = z.enum(['monthly_flexible', 'annual', 'other', 'unknown']);
export const eventTypeSchema = z.enum([
  'snapshot',
  'status',
  'recall',
  'search',
  'sources',
  'answer_delta',
  'result_ready',
  'done',
  'error',
]);

export const runUsageSchema = z.object({
  modelCalls: nonNegativeIntegerSchema,
  searchQueries: nonNegativeIntegerSchema,
  searchBatches: nonNegativeIntegerSchema,
  inputTokens: nonNegativeIntegerSchema.nullable(),
  outputTokens: nonNegativeIntegerSchema.nullable(),
  providerCredits: nonNegativeIntegerSchema.nullable(),
});
export type RunUsage = z.infer<typeof runUsageSchema>;

export const ownerSchema = z.object({
  id: idSchema,
  createdAt: isoInstantSchema,
});
export type Owner = z.infer<typeof ownerSchema>;

export const conversationSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  namespace: namespaceSchema,
  generation: nonNegativeIntegerSchema,
  title: z.string().max(200).nullable(),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});
export type Conversation = z.infer<typeof conversationSchema>;

export const messageSchema = z.object({
  id: idSchema,
  conversationId: idSchema,
  ownerId: idSchema,
  namespace: namespaceSchema,
  role: messageRoleSchema,
  originalText: z.string().min(1),
  createdAt: isoInstantSchema,
  timezone: ianaZoneSchema,
  runId: idSchema.nullable(),
  answerState: answerStateSchema.nullable(),
  sourceObservationIds: z.array(idSchema),
});
export type Message = z.infer<typeof messageSchema>;

export const runSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  namespace: namespaceSchema,
  conversationId: idSchema,
  questionId: idSchema,
  answerId: idSchema.nullable(),
  requestKey: z.string().min(1).max(200),
  normalizedPayloadHash: z.string().regex(/^[0-9a-f]{64}$/),
  retryOfRunId: idSchema.nullable(),
  taskKind: taskKindSchema,
  state: runStateSchema,
  version: nonNegativeIntegerSchema,
  eventSeq: nonNegativeIntegerSchema,
  startedAt: isoInstantSchema,
  acquisitionDeadlineAt: isoInstantSchema,
  deadlineAt: isoInstantSchema,
  completedAt: isoInstantSchema.nullable(),
  usage: runUsageSchema,
  errorCode: z.string().max(120).nullable(),
  resultId: idSchema.nullable(),
  capturedGeneration: nonNegativeIntegerSchema,
});
export type Run = z.infer<typeof runSchema>;

export const decisionMemberSchema = z.object({
  memberId: z.string().min(1).max(128),
  vendor: z.string().max(200).nullable(),
  product: z.string().max(200).nullable(),
  plan: z.string().max(200).nullable(),
  aliases: z.array(z.string().max(200)),
  sourceSpan: spanSchema.nullable(),
});
export type DecisionMember = z.infer<typeof decisionMemberSchema>;

export const decisionConstraintsSchema = z.object({
  teamSize: quantitySchema.nullable(),
  budget: z
    .object({
      amountDecimal: positiveDecimalStringSchema,
      currency: currencySchema,
    })
    .nullable(),
  region: z.string().max(200).nullable(),
  sourceSpans: z.array(spanSchema),
});
export type DecisionConstraints = z.infer<typeof decisionConstraintsSchema>;

export const decisionSnapshotSchema = z.object({
  id: idSchema,
  originalMessageId: idSchema,
  originalSpan: spanSchema,
  state: decisionSnapshotStateSchema,
  revision: z.number().int().positive(),
  supersedesId: idSchema.nullable(),
  members: z.array(decisionMemberSchema),
  constraints: decisionConstraintsSchema,
  validatedAt: isoInstantSchema.nullable(),
});
export type DecisionSnapshot = z.infer<typeof decisionSnapshotSchema>;

export const recallResultSchema = z.object({
  interpretation: z.object({
    text: z.string().max(500).nullable(),
    windows: z.array(
      z.object({
        start: localDateSchema,
        end: localDateSchema,
        timezone: ianaZoneSchema,
      }),
    ),
    ambiguous: z.boolean(),
  }),
  candidates: z.array(
    z.object({
      turnId: idSchema,
      reason: z.string().max(300),
    }),
  ),
  matchedCount: nonNegativeIntegerSchema.nullable(),
  boundedCount: nonNegativeIntegerSchema.nullable(),
  includedCount: nonNegativeIntegerSchema,
  truncated: z.boolean(),
  pendingIndex: z.boolean(),
  missingHistoryReason: z.string().max(300).nullable(),
  chosenBaselineIds: z.array(idSchema),
  ambiguousBaselineIds: z.array(idSchema),
});
export type RecallResult = z.infer<typeof recallResultSchema>;

const httpUrlSchema = z.string().max(4096).superRefine((value, ctx) => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    ctx.addIssue({ code: 'custom', message: 'Expected a valid URL' });
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    ctx.addIssue({ code: 'custom', message: 'Only http/https URLs are allowed' });
  }
  if (url.username || url.password) {
    ctx.addIssue({ code: 'custom', message: 'URLs with embedded credentials are not allowed' });
  }
});

export const searchInputSchema = z.object({
  queryId: idSchema,
  text: z.string().min(1).max(500),
  purpose: queryPurposeSchema,
  memberIds: z.array(z.string().min(1).max(128)),
  obligationIds: z.array(idSchema),
  domainRestrictions: z.array(z.string().max(253)),
  publicationStart: localDateSchema.nullable(),
  publicationEnd: localDateSchema.nullable(),
  freshnessIntent: z.string().max(64).nullable(),
});
export type SearchInput = z.infer<typeof searchInputSchema>;

export const searchOutcomeSchema = z.object({
  queryId: idSchema,
  attemptedAt: isoInstantSchema,
  status: searchStatusSchema,
  observationIds: z.array(idSchema),
  providerErrorCode: z.string().max(120).nullable(),
  elapsedMs: nonNegativeIntegerSchema,
});
export type SearchOutcome = z.infer<typeof searchOutcomeSchema>;

export const sourceObservationSchema = z.object({
  id: idSchema,
  ownerId: idSchema,
  namespace: namespaceSchema,
  runId: idSchema,
  queryId: idSchema,
  originalUrl: httpUrlSchema,
  safeCanonicalUrl: httpUrlSchema,
  title: z.string().max(500),
  exactEvidenceText: z.string().max(8000),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  textTruncated: z.boolean(),
  retrievedAt: isoInstantSchema,
  providerCaptureAt: isoInstantSchema.nullable(),
  publishedAt: isoInstantSchema.nullable(),
  effectiveAt: isoInstantSchema.nullable(),
  effectiveAtSpan: spanSchema.nullable(),
  provider: z.string().max(80),
  freshnessRequested: z.string().max(64).nullable(),
  freshnessMetadata: z.record(z.string(), z.unknown()).nullable(),
});
export type SourceObservation = z.infer<typeof sourceObservationSchema>;

export const candidateFieldSchema = z.object({
  field: z.string().min(1).max(120),
  proposedValue: z.string().max(500).nullable(),
  observationId: idSchema,
  supportSpan: spanSchema,
  interpretationNotes: z.string().max(500).nullable(),
});
export type CandidateField = z.infer<typeof candidateFieldSchema>;

export const priceObservationSchema = z.object({
  id: idSchema,
  sourceObservationId: idSchema,
  vendor: z.string().max(200).nullable(),
  product: z.string().max(200).nullable(),
  plan: z.string().max(200).nullable(),
  amountDecimal: positiveDecimalStringSchema.nullable(),
  currency: currencySchema.nullable(),
  unit: priceUnitSchema.nullable(),
  quotedInterval: quotedIntervalSchema.nullable(),
  commitment: commitmentSchema.nullable(),
  quantity: quantitySchema.nullable(),
  minimumQuantity: quantitySchema.nullable(),
  region: z.string().max(200).nullable(),
  taxBasis: z.string().max(200).nullable(),
  promotion: z.string().max(300).nullable(),
  includedUsage: z.string().max(500).nullable(),
  observedAt: isoInstantSchema.nullable(),
  effectiveAt: isoInstantSchema.nullable(),
  effectiveAtSpan: spanSchema.nullable(),
});
export type PriceObservation = z.infer<typeof priceObservationSchema>;

export const obligationSchema = z.object({
  id: idSchema,
  runId: idSchema,
  memberId: z.string().min(1).max(128),
  attribute: z.string().min(1).max(120),
  baselineClaimId: z.string().min(1).max(128),
  acquisition: acquisitionSchema,
  observationIds: z.array(idSchema),
  comparability: comparabilitySchema,
  missingDimensions: z.array(z.string().max(120)),
  mismatchedDimensions: z.array(z.string().max(120)),
  resolution: resolutionSchema,
  outcomeId: idSchema.nullable(),
});
export type Obligation = z.infer<typeof obligationSchema>;

export const verificationOutcomeSchema = z.object({
  id: idSchema,
  obligationId: idSchema,
  verdict: verdictSchema,
  reasonCodes: z.array(reasonCodeSchema),
  supportingObservationIds: z.array(idSchema),
  summary: z.string().max(1000),
  priceTotals: z.object({
    baseline: z.object({
      quantity: quantitySchema,
      monthlyEquivalent: decimalStringSchema,
      annualCommitment: decimalStringSchema.nullable(),
      monthlyEquivalentLabel: z.string().max(200),
      annualCommitmentLabel: z.string().max(200).nullable(),
    }).nullable(),
    current: z.object({
      quantity: quantitySchema,
      monthlyEquivalent: decimalStringSchema,
      annualCommitment: decimalStringSchema.nullable(),
      monthlyEquivalentLabel: z.string().max(200),
      annualCommitmentLabel: z.string().max(200).nullable(),
    }).nullable(),
    monthlyDelta: decimalStringSchema.nullable(),
  }).optional(),
});
export type VerificationOutcome = z.infer<typeof verificationOutcomeSchema>;

export const verificationResultSchema = z.object({
  id: idSchema,
  runId: idSchema,
  baselineSnapshotId: idSchema.nullable(),
  constraints: decisionConstraintsSchema.nullable(),
  members: z.array(decisionMemberSchema),
  obligations: z.array(obligationSchema),
  outcomes: z.array(verificationOutcomeSchema),
  unresolvedReasons: z.array(reasonCodeSchema),
  searchCounts: z.object({
    attempted: nonNegativeIntegerSchema,
    succeeded: nonNegativeIntegerSchema,
    empty: nonNegativeIntegerSchema,
    failed: nonNegativeIntegerSchema,
    cancelled: nonNegativeIntegerSchema,
  }),
  coverageCounts: z.object({
    requested: nonNegativeIntegerSchema,
    attempted: nonNegativeIntegerSchema,
    resolved: nonNegativeIntegerSchema,
    unresolved: nonNegativeIntegerSchema,
  }),
  checkedAt: isoInstantSchema,
  summary: z.string().max(4000),
});
export type VerificationResult = z.infer<typeof verificationResultSchema>;

export const modelMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant', 'tool']),
  content: z.string(),
  toolCallId: z.string().max(200).nullable().optional(),
});
export type ModelMessage = z.infer<typeof modelMessageSchema>;

export const modelToolDefinitionSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(2000),
  parameters: z.record(z.string(), z.unknown()),
});
export type ModelToolDefinition = z.infer<typeof modelToolDefinitionSchema>;

export const modelRequestSchema = z.object({
  model: z.string().min(1),
  input: z.array(modelMessageSchema),
  // Completed Responses output items (including reasoning and function calls)
  // must be resent with matching function_call_output items on tool turns.
  continuationItems: z.array(z.unknown()).optional(),
  tools: z.array(modelToolDefinitionSchema),
  responseFormat: z
    .object({
      name: z.string().min(1).max(64),
      schema: z.record(z.string(), z.unknown()),
    })
    .nullable(),
  temperature: z.number().min(0).max(2).nullable(),
});
export type ModelRequest = z.infer<typeof modelRequestSchema>;

export const modelResponseSchema = z.object({
  status: z.enum(['completed', 'refused', 'incomplete', 'failed']),
  text: z.string().nullable(),
  // Opaque provider items are passed back on the next turn to preserve context.
  continuationItems: z.array(z.unknown()).optional(),
  toolCalls: z.array(
    z.object({
      callId: z.string().min(1).max(200),
      name: z.string().min(1).max(64),
      arguments: z.record(z.string(), z.unknown()),
    }),
  ),
  usage: z.object({
    inputTokens: nonNegativeIntegerSchema.nullable(),
    outputTokens: nonNegativeIntegerSchema.nullable(),
  }),
  refusal: z.string().nullable(),
  incompleteReason: z.string().nullable(),
  errorCode: z.string().max(120).nullable(),
});
export type ModelResponse = z.infer<typeof modelResponseSchema>;

export interface ModelTransport {
  respond(
    request: ModelRequest,
    options: { signal: AbortSignal },
  ): Promise<ModelResponse>;
}

export interface SearchProviderRequest {
  queries: SearchInput[];
  maxResultsPerQuery: number;
}

export interface SearchProviderResult {
  outcomes: SearchOutcome[];
  observations: SourceObservation[];
}

export interface SearchProvider {
  search(
    request: SearchProviderRequest,
    options: { signal: AbortSignal },
  ): Promise<SearchProviderResult>;
}
