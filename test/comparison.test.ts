import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  CandidateField,
  DecisionMember,
  PriceObservation,
  SourceObservation,
} from '../shared/domain.js';
import { comparePrice } from '../server/verification/compare.js';
import { validateCandidateFields } from '../server/verification/fields.js';
import { createObligations } from '../server/verification/obligations.js';
import { calculatePriceTotals } from '../server/verification/money.js';
import { noSavedBaselineOutcome, summarizeVerification } from '../server/verification/summary.js';

const uuid = () => randomUUID();

function observation(text: string, input: {
  id?: string;
  publishedAt?: string | null;
  effectiveAt?: string | null;
  effectiveAtSpan?: { start: number; endExclusive: number } | null;
} = {}): SourceObservation {
  return {
    id: input.id ?? uuid(), ownerId: uuid(), namespace: 'live', runId: uuid(), queryId: uuid(),
    originalUrl: 'https://prices.example.com/page', safeCanonicalUrl: 'https://prices.example.com/page',
    title: 'Pricing source', exactEvidenceText: text, contentHash: 'a'.repeat(64), textTruncated: false,
    retrievedAt: '2026-11-12T00:00:00.000Z', providerCaptureAt: null, publishedAt: input.publishedAt ?? null,
    effectiveAt: input.effectiveAt ?? null, effectiveAtSpan: input.effectiveAtSpan ?? null,
    provider: 'scripted', freshnessRequested: null, freshnessMetadata: null,
  };
}

function price(sourceObservationId: string, amountDecimal: string, overrides: Partial<PriceObservation> = {}): PriceObservation {
  return {
    id: uuid(), sourceObservationId, vendor: 'Aster', product: 'CRM', plan: 'Pro',
    amountDecimal, currency: 'USD', unit: 'seat', quotedInterval: 'month', commitment: 'annual',
    quantity: 20, minimumQuantity: 1, region: 'US', taxBasis: null, promotion: 'none',
    includedUsage: 'Standard', observedAt: null, effectiveAt: null, effectiveAtSpan: null,
    ...overrides,
  };
}

const member: DecisionMember = {
  memberId: 'aster', vendor: 'Aster', product: 'CRM', plan: 'Pro', aliases: [], sourceSpan: null,
};

function compare(input: {
  baselinePrice?: PriceObservation | null;
  currentPrice?: PriceObservation | null;
  observations?: SourceObservation[];
  baselineDate?: string;
  transition?: SourceObservation | null;
  historical?: { price: PriceObservation; observation: SourceObservation } | null;
  candidateFields?: CandidateField[];
  requestedQuantity?: number | null;
} = {}) {
  return comparePrice({
    outcomeId: uuid(), obligationId: uuid(), member,
    baselinePrice: input.baselinePrice ?? null, currentPrice: input.currentPrice ?? null,
    observations: input.observations ?? [], baselineDate: input.baselineDate ?? '2026-11-09',
    transitionEvidence: input.transition ? { observation: input.transition } : null,
    historicalStateEvidence: input.historical ?? null,
    candidateFields: input.candidateFields,
    requestedQuantity: input.requestedQuantity,
  });
}

describe('pure obligation and pricing verification', () => {
  it('creates obligations only for requested attributes and retains every baseline member', () => {
    const members = ['Aster', 'Birch', 'Cedar', 'Dune', 'Elm'].map((vendor, index) => ({
      ...member, memberId: vendor.toLowerCase(), vendor,
    }));
    const requests = members.flatMap((item) => [
      { memberId: item.memberId, attribute: 'price', baselineClaimId: `${item.memberId}-price` },
      ...(item.memberId === 'aster' ? [{ memberId: item.memberId, attribute: 'release', baselineClaimId: 'aster-release' }] : []),
    ]);
    const rows = createObligations(uuid(), members, requests);
    expect(new Set(rows.map((row) => row.memberId))).toEqual(new Set(members.map((item) => item.memberId)));
    expect(rows.filter((row) => row.memberId === 'aster')).toHaveLength(2);
    expect(rows.every((row) => row.acquisition === 'unattempted' && row.resolution === 'unresolved')).toBe(true);
    expect(createObligations(rows[0]!.runId, members, requests).map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it('calculates fixed annual-commitment seat subtotals with decimal arithmetic and labels', () => {
    const oldPrice = price(uuid(), '20.00');
    const newPrice = price(uuid(), '24.00');
    expect(calculatePriceTotals(oldPrice, 20)).toMatchObject({
      monthlyEquivalent: '400.00', annualCommitment: '4800.00',
      monthlyEquivalentLabel: 'USD 400.00 base-plan monthly equivalent',
      annualCommitmentLabel: 'USD 4800.00 annual commitment',
    });
    expect(calculatePriceTotals(newPrice, 20)?.monthlyEquivalent).toBe('480.00');
    const oldSource = observation('Aster Pro price $20 per seat monthly, annual commitment.');
    const currentText = 'Aster Pro price $24 per seat monthly, annual commitment. Effective 11 November 2026.';
    const dateStart = currentText.indexOf('11 November 2026');
    const currentSource = observation(currentText, {
      effectiveAt: '2026-11-11T00:00:00.000Z',
      effectiveAtSpan: { start: dateStart, endExclusive: dateStart + '11 November 2026'.length },
    });
    const result = compare({
      baselinePrice: price(oldSource.id, '20.00'), currentPrice: price(currentSource.id, '24.00'),
      observations: [oldSource, currentSource], transition: currentSource,
    });
    expect(result.outcome.verdict).toBe('confirmed_change');
    expect(result.totals).toMatchObject({ baseline: { monthlyEquivalent: '400.00', annualCommitment: '4800.00' }, current: { monthlyEquivalent: '480.00', annualCommitment: '5760.00' }, monthlyDelta: '80.00' });
  });

  it('blocks annual versus monthly-flexible pricing (F02)', () => {
    const oldSource = observation('Old annual terms');
    const currentSource = observation('New flexible terms');
    const result = compare({
      baselinePrice: price(oldSource.id, '20'),
      currentPrice: price(currentSource.id, '25', { commitment: 'monthly_flexible' }),
      observations: [oldSource, currentSource],
    });
    expect(result.outcome.verdict).toBe('cannot_compare');
    expect(result.outcome.reasonCodes).toContain('commitment_mismatch');
    expect(result.totals.monthlyDelta).toBeNull();
  });

  it('reports same endpoints without claiming no intervening change (F03)', () => {
    const oldSource = observation('Aster Pro $30');
    const currentSource = observation('Aster Pro $30');
    const result = compare({ baselinePrice: price(oldSource.id, '30'), currentPrice: price(currentSource.id, '30'), observations: [oldSource, currentSource] });
    expect(result.outcome.verdict).toBe('same_observed');
    expect(result.outcome.summary).toContain('does not establish');
  });

  it('requires historical-state evidence before correcting an earlier answer (F04)', () => {
    const oldSource = observation('Saved earlier answer $40');
    const historicSource = observation('Official price was $45 on 9 November 2026', { publishedAt: '2026-11-09T10:00:00.000Z' });
    const currentSource = observation('Current price $45');
    const baseline = price(oldSource.id, '40');
    const current = price(currentSource.id, '45');
    const historical = price(historicSource.id, '45', { observedAt: '2026-11-09T10:00:00.000Z' });
    const args = { baselinePrice: baseline, currentPrice: current, observations: [oldSource, historicSource, currentSource] };
    expect(compare(args).outcome.verdict).toBe('different_now_timing_unknown');
    expect(compare({ ...args, historical: { price: historical, observation: historicSource } }).outcome.verdict).toBe('earlier_answer_wrong');
  });

  it('keeps missing current acquisition unresolved and the member present (F05)', () => {
    const oldSource = observation('Aster Pro $20');
    const result = compare({ baselinePrice: price(oldSource.id, '20'), observations: [oldSource] });
    expect(result.outcome.verdict).toBe('cannot_compare');
    expect(result.outcome.reasonCodes).toContain('missing_current_evidence');
    expect(result.comparability).toBe('insufficient');
  });

  it('does not treat unrelated or renamed plans as equivalent (F15/F16)', () => {
    const oldSource = observation('Aster Pro $20');
    const currentSource = observation('Aster Basic $25');
    for (const [vendor, plan] of [['Other', 'Pro'], ['Aster', 'Basic']]) {
      const result = compare({
        baselinePrice: price(oldSource.id, '20'),
        currentPrice: price(currentSource.id, '25', { vendor, plan }),
        observations: [oldSource, currentSource],
      });
      expect(result.outcome.verdict).toBe('cannot_compare');
      expect(result.mismatchedDimensions.length).toBeGreaterThan(0);
      expect(result.outcome.reasonCodes).toContain('plan_mismatch');
    }
  });

  it('blocks currency, unit, unknown minimum and unknown promotion calculations (F17)', () => {
    const oldSource = observation('Old terms');
    const currentSource = observation('New terms');
    const old = price(oldSource.id, '20');
    const variants: PriceObservation[] = [
      price(currentSource.id, '25', { currency: 'EUR' }),
      price(currentSource.id, '25', { unit: 'account' }),
      price(currentSource.id, '25', { minimumQuantity: null }),
      price(currentSource.id, '25', { promotion: null }),
      price(currentSource.id, '25', { commitment: 'unknown' }),
    ];
    for (const current of variants) {
      const result = compare({ baselinePrice: old, currentPrice: current, observations: [oldSource, currentSource] });
      expect(result.outcome.verdict).toBe('cannot_compare');
      expect(result.totals.monthlyDelta).toBeNull();
    }
  });

  it('labels changed comparable endpoints unresolved when transition timing is absent (F18/F21)', () => {
    const oldSource = observation('Aster Pro $20');
    const currentSource = observation('Aster Pro $25');
    const result = compare({ baselinePrice: price(oldSource.id, '20'), currentPrice: price(currentSource.id, '25'), observations: [oldSource, currentSource] });
    expect(result.outcome.verdict).toBe('different_now_timing_unknown');
    expect(result.outcome.reasonCodes).toContain('unknown_transition_date');
  });

  it('requires member and plan linkage when a transition notice is a separate source', () => {
    const oldSource = observation('Aster Pro $20');
    const currentSource = observation('Aster Pro $25');
    const noticeText = 'Aster Pro effective 11 November 2026';
    const datePhrase = '11 November 2026';
    const noticeSource = observation(noticeText, {
      effectiveAt: '2026-11-11T00:00:00.000Z',
      effectiveAtSpan: { start: noticeText.indexOf(datePhrase), endExclusive: noticeText.indexOf(datePhrase) + datePhrase.length },
    });
    const base = price(oldSource.id, '20');
    const current = price(currentSource.id, '25');
    const input = { baselinePrice: base, currentPrice: current, observations: [oldSource, currentSource, noticeSource], transition: noticeSource };
    expect(compare(input).outcome.verdict).toBe('different_now_timing_unknown');
    const field = (name: string, value: string): CandidateField => {
      const start = noticeText.indexOf(value);
      return { field: name, proposedValue: value, observationId: noticeSource.id, supportSpan: { start, endExclusive: start + value.length }, interpretationNotes: null };
    };
    expect(compare({ ...input, candidateFields: [field('vendor', 'Aster'), field('plan', 'Pro'), field('effectiveAt', datePhrase)] }).outcome.verdict).toBe('confirmed_change');
  });

  it('rejects a candidate whose cited field is not in its exact evidence slice (F20)', () => {
    const source = observation('Aster Pro costs $20 per seat.');
    const bad: CandidateField = {
      field: 'amount', proposedValue: '99', observationId: source.id,
      supportSpan: { start: 0, endExclusive: 10 }, interpretationNotes: null,
    };
    expect(validateCandidateFields([bad], [source]).rejected[0]?.reason).toBe('invalid_span');
    const result = compare({ baselinePrice: price(source.id, '20'), currentPrice: price(source.id, '25'), observations: [source], candidateFields: [bad] });
    expect(result.outcome.verdict).toBe('cannot_compare');
    expect(result.outcome.reasonCodes).toContain('conflicting_sources');
  });

  it('derives denominator labels from obligations and keeps unresolved members in deterministic rows (F24)', () => {
    const members = [{ ...member, memberId: 'aster' }, { ...member, memberId: 'birch', vendor: 'Birch' }];
    const runId = uuid();
    const obligations = createObligations(runId, members, [
      { memberId: 'aster', attribute: 'price', baselineClaimId: 'a-price' },
      { memberId: 'birch', attribute: 'price', baselineClaimId: 'b-price' },
    ]);
    const result = summarizeVerification(members, obligations, [noSavedBaselineOutcome({ id: uuid(), obligationId: obligations[0]!.id })]);
    expect(result.memberRows.map((row) => row.member.vendor)).toEqual(['Aster', 'Birch']);
    expect(result.counts).toEqual({ members: 2, requested: 2, attempted: 0, evidenced: 0, comparable: 0, resolved: 0, unresolved: 2 });
    expect(result.text).toContain('0 of 2 requested obligations resolved');
    expect(result.memberRows[0]?.outcomes[0]?.verdict).toBe('no_saved_baseline');
  });
});
