import { randomUUID } from 'node:crypto';
import {
  searchInputSchema,
  searchOutcomeSchema,
  type SearchInput,
  type SearchOutcome,
  type SearchProvider,
  type SearchProviderResult,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import type { RunBudget } from '../runs/budget.js';
import { BudgetedSearchProvider } from '../runs/budget.js';

export interface ScheduledSearchResult extends SearchProviderResult {
  skippedQueryIds: string[];
}

function fairOrder(queries: SearchInput[]): SearchInput[] {
  const lanes = new Map<string, SearchInput[]>();
  for (const query of queries) {
    // A query for several members is assigned to its first member for queue fairness;
    // it is still returned once and retains every member ID.
    const lane = query.memberIds[0] ?? '__general__';
    const queue = lanes.get(lane) ?? [];
    queue.push(query);
    lanes.set(lane, queue);
  }
  const keys = [...lanes.keys()].sort();
  const ordered: SearchInput[] = [];
  while (keys.length) {
    for (const key of [...keys]) {
      const item = lanes.get(key)?.shift();
      if (item) ordered.push(item);
    }
    for (let index = keys.length - 1; index >= 0; index -= 1) {
      if (!lanes.get(keys[index] ?? '')?.length) keys.splice(index, 1);
    }
  }
  return ordered;
}

function terminalOutcome(
  query: SearchInput,
  clock: Clock,
  status: 'failed' | 'cancelled',
  code: string,
): SearchOutcome {
  return searchOutcomeSchema.parse({
    queryId: query.queryId,
    attemptedAt: clock.now().toISOString(),
    status,
    observationIds: [],
    providerErrorCode: code,
    elapsedMs: 0,
  });
}

export class SearchScheduler {
  private readonly provider: SearchProvider;
  private readonly budget: RunBudget;
  private readonly clock: Clock;
  private readonly maxResultsPerQuery: number;

  constructor(options: {
    provider: SearchProvider;
    budget: RunBudget;
    clock: Clock;
    maxResultsPerQuery?: number;
  }) {
    this.provider = new BudgetedSearchProvider(options.provider, options.budget);
    this.budget = options.budget;
    this.clock = options.clock;
    this.maxResultsPerQuery = options.maxResultsPerQuery ?? 5;
  }

  async search(rawQueries: unknown, options: { signal: AbortSignal }): Promise<ScheduledSearchResult> {
    if (!Array.isArray(rawQueries) || rawQueries.length > 100) {
      throw new TypeError('Search request must be an array of at most 100 queries');
    }
    const queries = rawQueries.map((query) => searchInputSchema.strict().parse(query));
    const uniqueIds = new Set<string>();
    for (const query of queries) {
      if (uniqueIds.has(query.queryId)) throw new TypeError('Search query IDs must be unique');
      uniqueIds.add(query.queryId);
    }

    const remaining = this.budget.remaining();
    const dispatchLimit = Math.min(remaining.searchQueries, remaining.searchBatches * 4);
    const ordered = fairOrder(queries);
    const selected = ordered.slice(0, dispatchLimit);
    const skipped = ordered.slice(dispatchLimit);
    const outcomes: SearchOutcome[] = [];
    const observations = [] as SearchProviderResult['observations'];

    for (let offset = 0; offset < selected.length; offset += 4) {
      const batch = selected.slice(offset, offset + 4);
      if (options.signal.aborted) {
        outcomes.push(...batch.map((query) => terminalOutcome(query, this.clock, 'cancelled', 'aborted')));
        continue;
      }
      try {
        const result = await this.provider.search({
          queries: batch,
          maxResultsPerQuery: this.maxResultsPerQuery,
        }, options);
        outcomes.push(...result.outcomes);
        observations.push(...result.observations);
      } catch {
        outcomes.push(...batch.map((query) => terminalOutcome(
          query,
          this.clock,
          options.signal.aborted ? 'cancelled' : 'failed',
          options.signal.aborted ? 'aborted' : 'provider_error',
        )));
      }
    }

    const order = new Map(queries.map((query, index) => [query.queryId, index]));
    outcomes.sort((a, b) => (order.get(a.queryId) ?? Number.MAX_SAFE_INTEGER)
      - (order.get(b.queryId) ?? Number.MAX_SAFE_INTEGER));
    return {
      outcomes,
      observations,
      skippedQueryIds: skipped.map((query) => query.queryId),
    };
  }
}

export function createSearchInput(
  input: Omit<SearchInput, 'queryId'>,
): SearchInput {
  return searchInputSchema.parse({ ...input, queryId: randomUUID() });
}
