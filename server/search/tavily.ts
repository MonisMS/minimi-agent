import { z } from 'zod';
import type { DatabaseSync } from 'node:sqlite';
import {
  searchOutcomeSchema,
  type SearchInput,
  type SearchOutcome,
  type SearchProvider,
  type SearchProviderRequest,
  type SearchProviderResult,
  type SourceObservation,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import { registerObservation } from '../evidence/registry.js';
import type { Scope } from '../db/conversations.js';

const tavilyResultSchema = z.object({
  title: z.string().max(500),
  url: z.string().min(1).max(4096),
  content: z.string().min(1),
  raw_content: z.string().nullable().optional(),
  published_date: z.string().nullable().optional(),
});

const tavilyResponseSchema = z.object({
  results: z.array(tavilyResultSchema),
  request_id: z.string().optional(),
  usage: z.object({ credits: z.number().int().nonnegative().optional() }).optional(),
});

export interface TavilyObservationInput {
  query: SearchInput;
  originalUrl: string;
  title: string;
  evidenceText: string;
  publishedAt: string | null;
  freshnessMetadata: Record<string, unknown>;
}

export interface TavilySearchOptions {
  apiKey: string;
  fetch?: typeof fetch;
  clock: Clock;
  registerObservation(input: TavilyObservationInput): SourceObservation;
  timeoutMs?: number;
  concurrency?: number;
}

export function createTavilyObservationRegistrar(options: {
  database: DatabaseSync;
  clock: Clock;
  scope: Scope;
  conversationId: string;
  runId: string;
}): TavilySearchOptions['registerObservation'] {
  return (input) => registerObservation(
    options.database,
    options.clock,
    options.scope,
    options.conversationId,
    {
      runId: options.runId,
      queryId: input.query.queryId,
      originalUrl: input.originalUrl,
      title: input.title,
      evidenceText: input.evidenceText,
      publishedAt: input.publishedAt,
      provider: 'tavily',
      freshnessRequested: input.query.freshnessIntent,
      freshnessMetadata: input.freshnessMetadata,
    },
  );
}

function errorCode(status: number): string {
  if (status === 401 || status === 403) return 'provider_auth';
  if (status === 429) return 'provider_rate_limit';
  if (status === 434) return 'live_acquisition_unavailable';
  return `provider_http_${status}`;
}

function publicationInstant(value: string | null | undefined): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function requestBody(query: SearchInput, maxResults: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    query: query.text,
    topic: 'general',
    search_depth: 'basic',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: true,
    max_age_hours: 0,
  };
  if (query.domainRestrictions.length) body.include_domains = query.domainRestrictions;
  if (query.purpose === 'dated_change') {
    if (query.publicationStart) body.start_date = query.publicationStart;
    if (query.publicationEnd) body.end_date = query.publicationEnd;
    if (query.publicationStart || query.publicationEnd) body.filter_by_published_date = true;
  }
  return body;
}

export class TavilySearchProvider implements SearchProvider {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly clock: Clock;
  private readonly registerObservation: TavilySearchOptions['registerObservation'];
  private readonly timeoutMs: number;
  private readonly concurrency: number;

  constructor(options: TavilySearchOptions) {
    this.apiKey = options.apiKey;
    this.fetcher = options.fetch ?? fetch;
    this.clock = options.clock;
    this.registerObservation = options.registerObservation;
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.concurrency = Math.max(1, Math.min(3, options.concurrency ?? 3));
  }

  async search(
    request: SearchProviderRequest,
    options: { signal: AbortSignal },
  ): Promise<SearchProviderResult> {
    const outcomes: SearchOutcome[] = [];
    const observations: SourceObservation[] = [];
    let cursor = 0;
    const worker = async () => {
      while (cursor < request.queries.length) {
        const query = request.queries[cursor++];
        if (query) {
          const result = await this.searchOne(query, request.maxResultsPerQuery, options.signal);
          outcomes.push(result.outcome);
          observations.push(...result.observations);
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(this.concurrency, request.queries.length) },
      () => worker(),
    ));
    const queryOrder = new Map(request.queries.map((query, index) => [query.queryId, index]));
    outcomes.sort((a, b) => (queryOrder.get(a.queryId) ?? 0) - (queryOrder.get(b.queryId) ?? 0));
    return { outcomes, observations };
  }

  private async searchOne(
    query: SearchInput,
    maxResults: number,
    signal: AbortSignal,
  ): Promise<{ outcome: SearchOutcome; observations: SourceObservation[] }> {
    const started = this.clock.monotonicMs();
    const attemptedAt = this.clock.now().toISOString();
    const fail = (
      status: 'failed' | 'cancelled',
      code: string,
      registered: SourceObservation[] = [],
    ) => ({
      outcome: searchOutcomeSchema.parse({
        queryId: query.queryId,
        attemptedAt,
        status,
        observationIds: registered.map((observation) => observation.id),
        providerErrorCode: code,
        elapsedMs: Math.max(0, Math.floor(this.clock.monotonicMs() - started)),
      }),
      observations: registered,
    });

    if (signal.aborted) return fail('cancelled', 'aborted');
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await this.fetcher('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody(query, maxResults)),
        signal: requestSignal,
      });
    } catch {
      return fail(signal.aborted ? 'cancelled' : 'failed',
        signal.aborted ? 'aborted' : timeout.aborted ? 'timeout' : 'network_error');
    }

    if (!response.ok) return fail('failed', errorCode(response.status));
    let payload: z.infer<typeof tavilyResponseSchema>;
    try {
      payload = tavilyResponseSchema.parse(await response.json());
    } catch {
      return fail('failed', 'malformed_response');
    }
    if (signal.aborted) return fail('cancelled', 'aborted');

    const saved: SourceObservation[] = [];
    try {
      for (const item of payload.results) {
        saved.push(this.registerObservation({
          query,
          originalUrl: item.url,
          title: item.title,
          evidenceText: item.raw_content || item.content,
          publishedAt: publicationInstant(item.published_date),
          freshnessMetadata: {
            liveRequested: true,
            requestId: payload.request_id ?? null,
            providerCredits: payload.usage?.credits ?? null,
          },
        }));
      }
    } catch {
      return fail('failed', 'observation_registration_failed', saved);
    }
    const outcome = searchOutcomeSchema.parse({
      queryId: query.queryId,
      attemptedAt,
      status: saved.length ? 'succeeded' : 'empty',
      observationIds: saved.map((observation) => observation.id),
      providerErrorCode: null,
      elapsedMs: Math.max(0, Math.floor(this.clock.monotonicMs() - started)),
    });
    return { outcome, observations: saved };
  }
}
