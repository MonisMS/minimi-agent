import type {
  ModelRequest,
  ModelResponse,
  ModelTransport,
  RunUsage,
  SearchProvider,
  SearchProviderRequest,
  SearchProviderResult,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import type { RunLimits } from '../config.js';

export type BudgetErrorCode =
  | 'model_call_budget_exhausted'
  | 'search_query_budget_exhausted'
  | 'search_batch_budget_exhausted'
  | 'deadline_exceeded'
  | 'acquisition_closed'
  | 'invalid_search_batch';

export class BudgetExceededError extends Error {
  readonly code: BudgetErrorCode;
  readonly details: Record<string, unknown>;

  constructor(code: BudgetErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'BudgetExceededError';
    this.code = code;
    this.details = details;
  }
}

export interface RunBudgetOptions {
  limits: RunLimits;
  clock: Clock;
}

export interface RemainingBudget {
  modelCalls: number;
  searchQueries: number;
  searchBatches: number;
  msUntilDeadline: number;
  msUntilAcquisitionCutoff: number;
}

export class RunBudget {
  private readonly limits: RunLimits;
  private readonly clock: Clock;
  private readonly startedAt: Date;
  private readonly startedMonotonic: number;
  readonly deadlineAt: Date;
  readonly acquisitionDeadlineAt: Date;

  private modelCalls = 0;
  private searchQueries = 0;
  private searchBatches = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private providerCredits = 0;
  private inputTokensUnknown = false;
  private outputTokensUnknown = false;
  private providerCreditsUnknown = false;

  constructor(options: RunBudgetOptions) {
    this.limits = options.limits;
    this.clock = options.clock;
    this.startedAt = new Date(options.clock.now().getTime());
    this.startedMonotonic = options.clock.monotonicMs();
    this.deadlineAt = new Date(this.startedAt.getTime() + this.limits.maxRunMs);
    this.acquisitionDeadlineAt = new Date(
      this.startedAt.getTime() + this.limits.acquisitionCutoffMs,
    );
  }

  get start(): Date {
    return new Date(this.startedAt.getTime());
  }

  elapsedMs(): number {
    return Math.max(0, this.clock.monotonicMs() - this.startedMonotonic);
  }

  isPastDeadline(): boolean {
    return this.elapsedMs() >= this.limits.maxRunMs;
  }

  isAcquisitionClosed(): boolean {
    return this.elapsedMs() >= this.limits.acquisitionCutoffMs;
  }

  assertAcquisitionOpen(): void {
    if (this.isPastDeadline()) {
      throw new BudgetExceededError('deadline_exceeded', 'The run deadline has passed', {
        elapsedMs: this.elapsedMs(),
        maxRunMs: this.limits.maxRunMs,
      });
    }
    if (this.isAcquisitionClosed()) {
      throw new BudgetExceededError(
        'acquisition_closed',
        'The acquisition cutoff has passed',
        {
          elapsedMs: this.elapsedMs(),
          acquisitionCutoffMs: this.limits.acquisitionCutoffMs,
        },
      );
    }
  }

  reserveModelCall(): void {
    if (this.isPastDeadline()) {
      throw new BudgetExceededError('deadline_exceeded', 'The run deadline has passed', {
        elapsedMs: this.elapsedMs(),
        maxRunMs: this.limits.maxRunMs,
      });
    }
    if (this.modelCalls >= this.limits.maxModelCalls) {
      throw new BudgetExceededError(
        'model_call_budget_exhausted',
        'The model-call budget is exhausted',
        {
          modelCalls: this.modelCalls,
          maxModelCalls: this.limits.maxModelCalls,
        },
      );
    }
    this.modelCalls += 1;
  }

  reserveSearchBatch(queryCount: number): void {
    if (!Number.isInteger(queryCount) || queryCount < 1) {
      throw new BudgetExceededError(
        'invalid_search_batch',
        'A search batch must contain at least one query',
        { queryCount },
      );
    }
    this.assertAcquisitionOpen();
    if (this.searchBatches >= this.limits.maxSearchBatches) {
      throw new BudgetExceededError(
        'search_batch_budget_exhausted',
        'The search-batch budget is exhausted',
        {
          searchBatches: this.searchBatches,
          maxSearchBatches: this.limits.maxSearchBatches,
        },
      );
    }
    if (this.searchQueries + queryCount > this.limits.maxSearchQueries) {
      throw new BudgetExceededError(
        'search_query_budget_exhausted',
        'The search-query budget is exhausted',
        {
          searchQueries: this.searchQueries,
          requested: queryCount,
          maxSearchQueries: this.limits.maxSearchQueries,
        },
      );
    }
    this.searchBatches += 1;
    this.searchQueries += queryCount;
  }

  recordModelTokens(inputTokens: number | null, outputTokens: number | null): void {
    if (inputTokens === null) {
      this.inputTokensUnknown = true;
    } else {
      this.inputTokens += inputTokens;
    }
    if (outputTokens === null) {
      this.outputTokensUnknown = true;
    } else {
      this.outputTokens += outputTokens;
    }
  }

  recordProviderCredits(credits: number | null): void {
    if (credits === null) {
      this.providerCreditsUnknown = true;
    } else {
      this.providerCredits += credits;
    }
  }

  usage(): RunUsage {
    return {
      modelCalls: this.modelCalls,
      searchQueries: this.searchQueries,
      searchBatches: this.searchBatches,
      inputTokens: this.inputTokensUnknown ? null : this.inputTokens,
      outputTokens: this.outputTokensUnknown ? null : this.outputTokens,
      providerCredits: this.providerCreditsUnknown ? null : this.providerCredits,
    };
  }

  remaining(): RemainingBudget {
    return {
      modelCalls: Math.max(0, this.limits.maxModelCalls - this.modelCalls),
      searchQueries: Math.max(0, this.limits.maxSearchQueries - this.searchQueries),
      searchBatches: Math.max(0, this.limits.maxSearchBatches - this.searchBatches),
      msUntilDeadline: Math.max(0, this.limits.maxRunMs - this.elapsedMs()),
      msUntilAcquisitionCutoff: Math.max(
        0,
        this.limits.acquisitionCutoffMs - this.elapsedMs(),
      ),
    };
  }
}

export class BudgetedModelTransport implements ModelTransport {
  private readonly inner: ModelTransport;
  private readonly budget: RunBudget;

  constructor(inner: ModelTransport, budget: RunBudget) {
    this.inner = inner;
    this.budget = budget;
  }

  async respond(
    request: ModelRequest,
    options: { signal: AbortSignal },
  ): Promise<ModelResponse> {
    this.budget.reserveModelCall();
    let response: ModelResponse;
    try {
      response = await this.inner.respond(request, options);
    } catch (error) {
      // A failed dispatch may still have consumed provider tokens.
      this.budget.recordModelTokens(null, null);
      throw error;
    }
    this.budget.recordModelTokens(response.usage.inputTokens, response.usage.outputTokens);
    return response;
  }
}

export class BudgetedSearchProvider implements SearchProvider {
  private readonly inner: SearchProvider;
  private readonly budget: RunBudget;

  constructor(inner: SearchProvider, budget: RunBudget) {
    this.inner = inner;
    this.budget = budget;
  }

  async search(
    request: SearchProviderRequest,
    options: { signal: AbortSignal },
  ): Promise<SearchProviderResult> {
    this.budget.reserveSearchBatch(request.queries.length);
    // This interface has no billing metadata; zero would claim a known free call.
    this.budget.recordProviderCredits(null);
    return this.inner.search(request, options);
  }
}
