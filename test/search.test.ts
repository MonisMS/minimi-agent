import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManualClock } from '../server/clock.js';
import { DEFAULT_LIMITS } from '../server/config.js';
import { closeDatabase, openInMemoryDatabase } from '../server/db/connection.js';
import { createConversation } from '../server/db/conversations.js';
import { getObservation } from '../server/db/evidence.js';
import { createOwner } from '../server/db/owners.js';
import { admitRun } from '../server/runs/admission.js';
import { RunAbortRegistry } from '../server/runs/registry.js';
import { RunBudget } from '../server/runs/budget.js';
import { SearchScheduler } from '../server/search/scheduler.js';
import { createTavilyObservationRegistrar, TavilySearchProvider } from '../server/search/tavily.js';
import type { TavilyObservationInput } from '../server/search/tavily.js';
import { parseWebSearchArguments, webSearchTool } from '../server/search/tool.js';
import type { SearchInput, SearchOutcome, SearchProvider, SearchProviderRequest, SearchProviderResult } from '../shared/domain.js';
import { makeSourceObservation } from './helpers/scripted.js';
import type { DatabaseSync } from 'node:sqlite';

const clocks: ManualClock[] = [];
const databases: DatabaseSync[] = [];

function input(overrides: Partial<SearchInput> = {}): SearchInput {
  return {
    queryId: randomUUID(),
    text: 'Acme Team plan public pricing',
    purpose: 'current_state',
    memberIds: ['acme'],
    obligationIds: [],
    domainRestrictions: ['acme.example.com'],
    publicationStart: null,
    publicationEnd: null,
    freshnessIntent: 'live',
    ...overrides,
  };
}

function makeClock(): ManualClock {
  const clock = new ManualClock(new Date('2026-11-12T10:00:00.000Z'));
  clocks.push(clock);
  return clock;
}

function makeBudget(clock: ManualClock, overrides: Partial<typeof DEFAULT_LIMITS> = {}): RunBudget {
  return new RunBudget({ limits: { ...DEFAULT_LIMITS, ...overrides }, clock });
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function tavilyResult(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Acme Team pricing',
    url: 'https://acme.example.com/pricing?plan=team',
    content: 'Team costs $20 per seat.',
    raw_content: 'Full captured page: Team costs $20 per seat.',
    published_date: '2026-11-10',
    ...overrides,
  };
}

function makeProvider(
  fetcher: typeof fetch,
  clock: ManualClock,
  register: (saved: TavilyObservationInput) => ReturnType<typeof makeSourceObservation> = vi.fn((saved: TavilyObservationInput) =>
    makeSourceObservation({
    queryId: saved.query.queryId,
    originalUrl: saved.originalUrl,
    safeCanonicalUrl: saved.originalUrl,
    title: saved.title,
    exactEvidenceText: saved.evidenceText,
    publishedAt: saved.publishedAt,
    freshnessMetadata: saved.freshnessMetadata,
    })),
) {
  const registration = vi.fn(register);
  return {
    provider: new TavilySearchProvider({
      apiKey: 'test-key', fetch: fetcher, clock, registerObservation: registration,
    }),
    register: registration,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  while (databases.length) {
    const database = databases.pop();
    if (database) closeDatabase(database);
  }
});

describe('web_search schema and Tavily adapter', () => {
  it('exports one strict tool schema and rejects unknown or oversized tool arguments', () => {
    expect(webSearchTool.name).toBe('web_search');
    expect(parseWebSearchArguments({ queries: [input()] }).queries).toHaveLength(1);
    expect(() => parseWebSearchArguments({ queries: [input()], extra: 'private chat' })).toThrow();
    expect(() => parseWebSearchArguments({ queries: [input(), input(), input(), input(), input()] })).toThrow();
    expect(() => parseWebSearchArguments({ queries: [{ ...input(), privateConversation: 'do not send' }] })).toThrow();
  });

  it('sends the exact snake_case current-state request without a publication cutoff', async () => {
    const clock = makeClock();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({
      results: [tavilyResult()], request_id: 'req-1', usage: { credits: 2 },
    }));
    const { provider, register } = makeProvider(fetcher, clock);
    const query = input();
    const result = await provider.search({ queries: [query], maxResultsPerQuery: 5 }, { signal: new AbortController().signal });

    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: 'Bearer test-key', 'content-type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      query: query.text,
      topic: 'general',
      search_depth: 'basic',
      max_results: 5,
      include_answer: false,
      include_raw_content: true,
      max_age_hours: 0,
      include_domains: ['acme.example.com'],
    });
    expect(JSON.stringify(init.body)).not.toContain('start_date');
    expect(JSON.stringify(init.body)).not.toContain('include_answer":true');
    expect(result.outcomes[0]).toMatchObject({ status: 'succeeded', observationIds: [result.observations[0]?.id] });
    expect(register).toHaveBeenCalledWith(expect.objectContaining({
      evidenceText: 'Full captured page: Team costs $20 per seat.',
      publishedAt: '2026-11-10T00:00:00.000Z',
      freshnessMetadata: { liveRequested: true, requestId: 'req-1', providerCredits: 2 },
    }));
  });

  it('registers returned result captures through the scoped chunk 08 observation registry', async () => {
    const clock = makeClock();
    const database = openInMemoryDatabase();
    databases.push(database);
    const owner = createOwner(database, clock);
    const conversation = createConversation(database, clock, { ownerId: owner.id, namespace: 'live' });
    const scope = { ownerId: owner.id, namespace: 'live' as const };
    const run = admitRun({ database, clock, registry: new RunAbortRegistry(), limits: DEFAULT_LIMITS }, {
      ...scope,
      conversationId: conversation.id,
      message: 'Research Acme',
      timezone: 'Asia/Kolkata',
      requestKey: randomUUID(),
    }).run;
    const registrar = createTavilyObservationRegistrar({
      database, clock, scope, conversationId: conversation.id, runId: run.id,
    });
    const { provider } = makeProvider(
      vi.fn<typeof fetch>().mockResolvedValue(response({ results: [tavilyResult()] })),
      clock,
      registrar,
    );
    const result = await provider.search({ queries: [input()], maxResultsPerQuery: 2 }, { signal: new AbortController().signal });
    const saved = result.observations[0];
    expect(saved).toBeDefined();
    expect(getObservation(database, scope, saved!.id)).toEqual(saved);
    expect(saved).toMatchObject({ runId: run.id, namespace: 'live', provider: 'tavily' });
  });

  it('adds actual publication dates only to dated-change queries', async () => {
    const clock = makeClock();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ results: [] }));
    const { provider } = makeProvider(fetcher, clock);
    const query = input({
      purpose: 'dated_change', publicationStart: '2026-11-01', publicationEnd: '2026-11-11',
    });
    await provider.search({ queries: [query], maxResultsPerQuery: 3 }, { signal: new AbortController().signal });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      start_date: '2026-11-01', end_date: '2026-11-11', filter_by_published_date: true,
    });
  });

  it.each([
    [401, 'provider_auth'], [429, 'provider_rate_limit'], [434, 'live_acquisition_unavailable'], [503, 'provider_http_503'],
  ])('keeps Tavily HTTP %i explicit as %s', async (status, code) => {
    const clock = makeClock();
    const { provider } = makeProvider(vi.fn<typeof fetch>().mockResolvedValue(response({}, status)), clock);
    const result = await provider.search({ queries: [input()], maxResultsPerQuery: 3 }, { signal: new AbortController().signal });
    expect(result.outcomes[0]).toMatchObject({ status: 'failed', providerErrorCode: code });
  });

  it('distinguishes empty, malformed, aborted, timeout and invalid source responses', async () => {
    const clock = makeClock();
    const emptyProvider = makeProvider(vi.fn<typeof fetch>().mockResolvedValue(response({ results: [] })), clock).provider;
    expect((await emptyProvider.search({ queries: [input()], maxResultsPerQuery: 3 }, { signal: new AbortController().signal })).outcomes[0]?.status).toBe('empty');

    const malformedProvider = makeProvider(vi.fn<typeof fetch>().mockResolvedValue(response({ results: [{ title: 'missing URL' }] })), clock).provider;
    expect((await malformedProvider.search({ queries: [input()], maxResultsPerQuery: 3 }, { signal: new AbortController().signal })).outcomes[0]).toMatchObject({ status: 'failed', providerErrorCode: 'malformed_response' });

    const aborted = new AbortController();
    aborted.abort();
    const abortedProvider = makeProvider(vi.fn<typeof fetch>(), clock).provider;
    expect((await abortedProvider.search({ queries: [input()], maxResultsPerQuery: 3 }, { signal: aborted.signal })).outcomes[0]).toMatchObject({ status: 'cancelled', providerErrorCode: 'aborted' });

    const slowFetch = vi.fn<typeof fetch>().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }));
    const timeoutProvider = new TavilySearchProvider({ apiKey: 'test', fetch: slowFetch, clock, timeoutMs: 5, registerObservation: () => makeSourceObservation() });
    expect((await timeoutProvider.search({ queries: [input()], maxResultsPerQuery: 3 }, { signal: new AbortController().signal })).outcomes[0]).toMatchObject({ status: 'failed', providerErrorCode: 'timeout' });

    const invalidSourceProvider = makeProvider(vi.fn<typeof fetch>().mockResolvedValue(response({ results: [tavilyResult({ url: 'javascript:alert(1)' })] })), clock, () => { throw new Error('unsafe source'); }).provider;
    expect((await invalidSourceProvider.search({ queries: [input()], maxResultsPerQuery: 3 }, { signal: new AbortController().signal })).outcomes[0]).toMatchObject({ status: 'failed', providerErrorCode: 'observation_registration_failed' });
  });

  it('caps query concurrency at three and records no invented provider-credit total', async () => {
    const clock = makeClock();
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn<typeof fetch>(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return response({ results: [] });
    });
    const { provider } = makeProvider(fetcher, clock);
    const budget = makeBudget(clock);
    const scheduler = new SearchScheduler({ provider, budget, clock });
    await scheduler.search(Array.from({ length: 4 }, () => input()), { signal: new AbortController().signal });
    expect(maximum).toBeLessThanOrEqual(3);
    expect(budget.usage()).toMatchObject({ searchQueries: 4, searchBatches: 1, providerCredits: null });
  });
});

describe('fair bounded search scheduling', () => {
  it('interleaves member work, reserves at most 12 queries, and leaves excess undispatched', async () => {
    const clock = makeClock();
    const requests: SearchProviderRequest[] = [];
    const provider: SearchProvider = {
      async search(request): Promise<SearchProviderResult> {
        requests.push(request);
        const outcomes: SearchOutcome[] = request.queries.map((query) => ({
          queryId: query.queryId,
          attemptedAt: clock.now().toISOString(),
          status: 'empty',
          observationIds: [],
          providerErrorCode: null,
          elapsedMs: 1,
        }));
        return { outcomes, observations: [] };
      },
    };
    const budget = makeBudget(clock);
    const scheduler = new SearchScheduler({ provider, budget, clock });
    const all = [
      ...Array.from({ length: 10 }, (_, index) => input({ text: `A public query ${index}`, memberIds: ['A'] })),
      ...Array.from({ length: 6 }, (_, index) => input({ text: `B public query ${index}`, memberIds: ['B'] })),
    ];
    const result = await scheduler.search(all, { signal: new AbortController().signal });
    const dispatched = requests.flatMap((request) => request.queries);
    expect(dispatched).toHaveLength(12);
    expect(result.outcomes).toHaveLength(12);
    expect(result.skippedQueryIds).toHaveLength(4);
    expect(dispatched.slice(0, 6).map((query) => query.memberIds[0])).toEqual(['A', 'B', 'A', 'B', 'A', 'B']);
    expect(requests.map((request) => request.queries.length)).toEqual([4, 4, 4]);
    expect(budget.usage()).toMatchObject({ searchQueries: 12, searchBatches: 3, providerCredits: null });
  });

  it('does not dispatch if cancelled before scheduling and rejects malformed inputs before reservation', async () => {
    const clock = makeClock();
    let calls = 0;
    const provider: SearchProvider = { async search(): Promise<SearchProviderResult> { calls += 1; return { outcomes: [], observations: [] }; } };
    const budget = makeBudget(clock);
    const scheduler = new SearchScheduler({ provider, budget, clock });
    await expect(scheduler.search([{}], { signal: new AbortController().signal })).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    const result = await scheduler.search([input()], { signal: controller.signal });
    expect(result.outcomes[0]).toMatchObject({ status: 'cancelled', providerErrorCode: 'aborted' });
    expect(calls).toBe(0);
    expect(budget.usage()).toMatchObject({ searchQueries: 0, searchBatches: 0 });
  });
});
