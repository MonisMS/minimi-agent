import { randomUUID } from 'node:crypto';
import type {
  ModelRequest,
  ModelResponse,
  ModelTransport,
  SearchOutcome,
  SearchProvider,
  SearchProviderRequest,
  SearchProviderResult,
  SourceObservation,
} from '../../shared/domain.js';

export function completedModelResponse(
  text: string,
  usage: { inputTokens: number | null; outputTokens: number | null } = {
    inputTokens: 10,
    outputTokens: 5,
  },
): ModelResponse {
  return {
    status: 'completed',
    text,
    toolCalls: [],
    usage,
    refusal: null,
    incompleteReason: null,
    errorCode: null,
  };
}

export function refusedModelResponse(refusal: string): ModelResponse {
  return {
    status: 'refused',
    text: null,
    toolCalls: [],
    usage: { inputTokens: null, outputTokens: null },
    refusal,
    incompleteReason: null,
    errorCode: null,
  };
}

export function incompleteModelResponse(reason: string): ModelResponse {
  return {
    status: 'incomplete',
    text: null,
    toolCalls: [],
    usage: { inputTokens: null, outputTokens: null },
    refusal: null,
    incompleteReason: reason,
    errorCode: null,
  };
}

export function failedModelResponse(errorCode: string): ModelResponse {
  return {
    status: 'failed',
    text: null,
    toolCalls: [],
    usage: { inputTokens: null, outputTokens: null },
    refusal: null,
    incompleteReason: null,
    errorCode,
  };
}

export class ScriptedModelTransport implements ModelTransport {
  readonly requests: ModelRequest[] = [];
  private readonly queue: Array<ModelResponse | Error> = [];

  enqueue(response: ModelResponse | Error): this {
    this.queue.push(response);
    return this;
  }

  enqueueText(text: string): this {
    return this.enqueue(completedModelResponse(text));
  }

  get callCount(): number {
    return this.requests.length;
  }

  async respond(
    request: ModelRequest,
    options: { signal: AbortSignal },
  ): Promise<ModelResponse> {
    options.signal.throwIfAborted();
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) {
      throw new Error('ScriptedModelTransport has no response queued');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

export class ScriptedSearchProvider implements SearchProvider {
  readonly requests: SearchProviderRequest[] = [];
  private readonly queue: Array<SearchProviderResult | Error> = [];

  enqueue(result: SearchProviderResult | Error): this {
    this.queue.push(result);
    return this;
  }

  get callCount(): number {
    return this.requests.length;
  }

  async search(
    request: SearchProviderRequest,
    options: { signal: AbortSignal },
  ): Promise<SearchProviderResult> {
    options.signal.throwIfAborted();
    this.requests.push(request);
    const next = this.queue.shift();
    if (!next) {
      throw new Error('ScriptedSearchProvider has no result queued');
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }
}

export function makeSearchOutcome(overrides: Partial<SearchOutcome> = {}): SearchOutcome {
  return {
    queryId: randomUUID(),
    attemptedAt: '2026-11-12T10:00:00.000Z',
    status: 'succeeded',
    observationIds: [],
    providerErrorCode: null,
    elapsedMs: 25,
    ...overrides,
  };
}

export function makeSourceObservation(
  overrides: Partial<SourceObservation> = {},
): SourceObservation {
  return {
    id: randomUUID(),
    ownerId: randomUUID(),
    namespace: 'live',
    runId: randomUUID(),
    queryId: randomUUID(),
    originalUrl: 'https://example.com/pricing',
    safeCanonicalUrl: 'https://example.com/pricing',
    title: 'Example pricing',
    exactEvidenceText: 'The plan costs $20 per seat per month.',
    contentHash: 'a'.repeat(64),
    textTruncated: false,
    retrievedAt: '2026-11-12T10:00:00.000Z',
    providerCaptureAt: null,
    publishedAt: null,
    effectiveAt: null,
    effectiveAtSpan: null,
    provider: 'tavily',
    freshnessRequested: 'live',
    freshnessMetadata: null,
    ...overrides,
  };
}
