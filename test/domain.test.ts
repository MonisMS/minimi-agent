import { describe, expect, it } from 'vitest';
import {
  BudgetExceededError,
  BudgetedModelTransport,
  BudgetedSearchProvider,
  RunBudget,
} from '../server/runs/budget.js';
import { ManualClock } from '../server/clock.js';
import { DEFAULT_LIMITS } from '../server/config.js';
import {
  DomainValidationError,
  candidateFieldSchema,
  decimalStringSchema,
  ianaZoneSchema,
  idSchema,
  localDateSchema,
  modelResponseSchema,
  priceObservationSchema,
  spanSchema,
  validateSpan,
} from '../shared/domain.js';
import {
  ScriptedModelTransport,
  ScriptedSearchProvider,
  completedModelResponse,
  failedModelResponse,
  incompleteModelResponse,
  makeSearchOutcome,
  makeSourceObservation,
  refusedModelResponse,
} from './helpers/scripted.js';

const baseDate = new Date('2026-11-12T10:00:00.000Z');

function budgetWith(
  clock: ManualClock,
  overrides: Partial<typeof DEFAULT_LIMITS> = {},
): RunBudget {
  return new RunBudget({
    limits: { ...DEFAULT_LIMITS, ...overrides },
    clock,
  });
}

describe('run budget reservations', () => {
  it('cannot exceed the model-call limit under concurrent reservations', async () => {
    const clock = new ManualClock(baseDate);
    const budget = budgetWith(clock, { maxModelCalls: 4 });

    const results = await Promise.all(
      Array.from({ length: 10 }, async () => {
        try {
          budget.reserveModelCall();
          return 'reserved';
        } catch {
          return 'blocked';
        }
      }),
    );

    expect(results.filter((result) => result === 'reserved')).toHaveLength(4);
    expect(budget.usage().modelCalls).toBe(4);
    expect(budget.remaining().modelCalls).toBe(0);
  });

  it('reserves search batches and queries together without exceeding either cap', () => {
    const clock = new ManualClock(baseDate);
    const budget = budgetWith(clock, {
      maxSearchBatches: 3,
      maxSearchQueries: 5,
    });

    budget.reserveSearchBatch(4);
    expect(() => budget.reserveSearchBatch(2)).toThrowError(BudgetExceededError);
    budget.reserveSearchBatch(1);

    expect(budget.usage().searchBatches).toBe(2);
    expect(budget.usage().searchQueries).toBe(5);
    expect(budget.remaining().searchQueries).toBe(0);
  });

  it('stops acquisition at the cutoff and stops model reservations at the hard deadline', () => {
    const clock = new ManualClock(baseDate);
    const budget = budgetWith(clock, { maxRunMs: 1000, acquisitionCutoffMs: 800 });

    clock.advance(799);
    budget.reserveSearchBatch(1);

    clock.advance(1);
    try {
      budget.reserveSearchBatch(1);
      throw new Error('expected acquisition cutoff to block');
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      expect((error as BudgetExceededError).code).toBe('acquisition_closed');
    }

    expect(() => budget.reserveModelCall()).not.toThrow();
    clock.advance(200);
    try {
      budget.reserveModelCall();
      throw new Error('expected deadline to block');
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetExceededError);
      expect((error as BudgetExceededError).code).toBe('deadline_exceeded');
    }
  });
});

describe('budget ownership', () => {
  it('keeps failed dispatched model usage unknown rather than reporting zero', async () => {
    const budget = budgetWith(new ManualClock(baseDate));
    const transport = new BudgetedModelTransport({
      async respond() { throw new Error('connection lost after dispatch'); },
    }, budget);
    await expect(transport.respond({
      model: 'test-model', input: [{ role: 'user', content: 'hi' }],
      tools: [], responseFormat: null, temperature: null,
    }, { signal: new AbortController().signal })).rejects.toThrow('connection lost');
    expect(budget.usage().modelCalls).toBe(1);
    expect(budget.usage().inputTokens).toBeNull();
    expect(budget.usage().outputTokens).toBeNull();
  });

  it('counts every wrapped model request and records available tokens', async () => {
    const clock = new ManualClock(baseDate);
    const budget = budgetWith(clock);
    const inner = new ScriptedModelTransport().enqueue(
      completedModelResponse('hello', { inputTokens: 12, outputTokens: 7 }),
    );
    const transport = new BudgetedModelTransport(inner, budget);

    const response = await transport.respond(
      {
        model: 'test-model',
        input: [{ role: 'user', content: 'hi' }],
        tools: [],
        responseFormat: null,
        temperature: null,
      },
      { signal: new AbortController().signal },
    );

    expect(response.text).toBe('hello');
    expect(inner.callCount).toBe(1);
    expect(budget.usage()).toMatchObject({
      modelCalls: 1,
      inputTokens: 12,
      outputTokens: 7,
    });
  });

  it('keeps token totals unknown when a wrapped response omits usage', async () => {
    const clock = new ManualClock(baseDate);
    const budget = budgetWith(clock);
    const inner = new ScriptedModelTransport().enqueue(
      completedModelResponse('hello', { inputTokens: null, outputTokens: null }),
    );
    const transport = new BudgetedModelTransport(inner, budget);

    await transport.respond(
      {
        model: 'test-model',
        input: [{ role: 'user', content: 'hi' }],
        tools: [],
        responseFormat: null,
        temperature: null,
      },
      { signal: new AbortController().signal },
    );

    expect(budget.usage().inputTokens).toBeNull();
    expect(budget.usage().outputTokens).toBeNull();
  });

  it('reserves a search batch before delegating to the raw provider', async () => {
    const clock = new ManualClock(baseDate);
    const budget = budgetWith(clock);
    const observation = makeSourceObservation();
    const outcome = makeSearchOutcome({ observationIds: [observation.id] });
    const inner = new ScriptedSearchProvider().enqueue({
      outcomes: [outcome],
      observations: [observation],
    });
    const provider = new BudgetedSearchProvider(inner, budget);

    const result = await provider.search(
      {
        queries: [
          {
            queryId: outcome.queryId,
            text: 'example pricing',
            purpose: 'current_state',
            memberIds: [],
            obligationIds: [],
            domainRestrictions: [],
            publicationStart: null,
            publicationEnd: null,
            freshnessIntent: 'live',
          },
        ],
        maxResultsPerQuery: 5,
      },
      { signal: new AbortController().signal },
    );

    expect(result.outcomes).toHaveLength(1);
    expect(budget.usage()).toMatchObject({ searchBatches: 1, searchQueries: 1 });
  });
});

describe('unknown values are not zero or success', () => {
  it('preserves null price fields instead of substituting zero', () => {
    const observation = priceObservationSchema.parse({
      id: crypto.randomUUID(),
      sourceObservationId: crypto.randomUUID(),
      vendor: 'Aster',
      product: null,
      plan: null,
      amountDecimal: null,
      currency: null,
      unit: null,
      quotedInterval: null,
      commitment: null,
      quantity: null,
      minimumQuantity: null,
      region: null,
      taxBasis: null,
      promotion: null,
      includedUsage: null,
      observedAt: null,
      effectiveAt: null,
      effectiveAtSpan: null,
    });

    expect(observation.amountDecimal).toBeNull();
    expect(observation.currency).toBeNull();
    expect(observation.quantity).toBeNull();
  });

  it('keeps a proposed candidate value null rather than inventing one', () => {
    const field = candidateFieldSchema.parse({
      field: 'plan',
      proposedValue: null,
      observationId: crypto.randomUUID(),
      supportSpan: { start: 0, endExclusive: 5 },
      interpretationNotes: null,
    });

    expect(field.proposedValue).toBeNull();
  });

  it('keeps refusal, incomplete and failed responses distinct from completion', async () => {
    expect(modelResponseSchema.parse(refusedModelResponse('cannot comply')).status).toBe(
      'refused',
    );
    expect(modelResponseSchema.parse(incompleteModelResponse('max tokens')).status).toBe(
      'incomplete',
    );
    expect(modelResponseSchema.parse(failedModelResponse('provider_error')).status).toBe(
      'failed',
    );

    const transport = new ScriptedModelTransport().enqueue(
      refusedModelResponse('cannot comply'),
    );
    const response = await transport.respond(
      {
        model: 'test-model',
        input: [{ role: 'user', content: 'hi' }],
        tools: [],
        responseFormat: null,
        temperature: null,
      },
      { signal: new AbortController().signal },
    );

    expect(response.status).toBe('refused');
    expect(response.text).toBeNull();
    expect(response.refusal).toBe('cannot comply');
  });
});

describe('span and boundary validation', () => {
  it('accepts an exact UTF-16 span and rejects a mismatched or out-of-bounds span', () => {
    const text = 'Aster costs $20/seat. 😀 Dune costs $40.';
    const start = text.indexOf('$20/seat');
    const quote = '$20/seat';

    validateSpan(text, { start, endExclusive: start + quote.length }, quote);

    expect(() =>
      validateSpan(text, { start, endExclusive: start + 3 }, quote),
    ).toThrowError(DomainValidationError);
    expect(() =>
      validateSpan(text, { start: 0, endExclusive: text.length + 1 }, text),
    ).toThrowError(DomainValidationError);

    const emojiStart = text.indexOf('😀');
    validateSpan(text, { start: emojiStart, endExclusive: emojiStart + 2 }, '😀');
  });

  it('rejects malformed IDs, calendar dates, decimals and zones', () => {
    expect(idSchema.safeParse('not-a-uuid').success).toBe(false);
    expect(localDateSchema.safeParse('2026-02-30').success).toBe(false);
    expect(localDateSchema.safeParse('2026-02-28').success).toBe(true);
    expect(decimalStringSchema.safeParse('01.20').success).toBe(false);
    expect(decimalStringSchema.safeParse('1e3').success).toBe(false);
    expect(decimalStringSchema.safeParse('25.50').success).toBe(true);
    expect(ianaZoneSchema.safeParse('Not/AZone').success).toBe(false);
    expect(ianaZoneSchema.safeParse('Asia/Kolkata').success).toBe(true);
  });

  it('rejects spans with negative offsets or an end before the start', () => {
    expect(spanSchema.safeParse({ start: -1, endExclusive: 2 }).success).toBe(false);
    expect(spanSchema.safeParse({ start: 5, endExclusive: 4 }).success).toBe(false);
    expect(spanSchema.safeParse({ start: 0, endExclusive: 0 }).success).toBe(true);
  });
});
