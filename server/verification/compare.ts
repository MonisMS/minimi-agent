import {
  priceObservationSchema,
  sourceObservationSchema,
  type CandidateField,
  type DecisionMember,
  type PriceObservation,
  type SourceObservation,
  type VerificationOutcome,
} from '../../shared/domain.js';
import { Decimal } from 'decimal.js';
import { calculateMonthlyPriceDelta, calculatePriceTotals } from './money.js';
import { validateCandidateFields } from './fields.js';

export interface HistoricalStateEvidence {
  price: PriceObservation;
  observation: SourceObservation;
}

export interface TransitionEvidence {
  observation: SourceObservation;
}

export interface PriceComparisonInput {
  outcomeId: string;
  obligationId: string;
  member: DecisionMember;
  baselinePrice: PriceObservation | null;
  currentPrice: PriceObservation | null;
  observations: SourceObservation[];
  candidateFields?: CandidateField[];
  baselineDate: string;
  transitionEvidence?: TransitionEvidence | null;
  historicalStateEvidence?: HistoricalStateEvidence | null;
  requestedQuantity?: number | null;
}

export interface PriceComparison {
  outcome: VerificationOutcome;
  comparability: 'compatible' | 'incompatible' | 'insufficient';
  missingDimensions: string[];
  mismatchedDimensions: string[];
  totals: { baseline: ReturnType<typeof calculatePriceTotals>; current: ReturnType<typeof calculatePriceTotals>; monthlyDelta: string | null };
}

const fold = (value: string | null): string | null => value?.trim().toLocaleLowerCase('en-US') ?? null;

function evidenceFor(price: PriceObservation | null, observations: Map<string, SourceObservation>): SourceObservation | null {
  if (!price) return null;
  const parsed = priceObservationSchema.safeParse(price);
  const observation = observations.get(price.sourceObservationId);
  return parsed.success && observation && sourceObservationSchema.safeParse(observation).success ? observation : null;
}

function checkIdentity(
  label: 'vendor' | 'product' | 'plan',
  expected: string | null,
  oldValue: string | null,
  newValue: string | null,
  missing: Set<string>,
  mismatched: Set<string>,
): void {
  const a = fold(oldValue);
  const b = fold(newValue);
  const target = fold(expected);
  if (!a || !b || !target) missing.add(label);
  else if (a !== b || a !== target) mismatched.add(`${label}_mismatch`);
}

function outcome(
  input: PriceComparisonInput,
  verdict: VerificationOutcome['verdict'],
  reasonCodes: VerificationOutcome['reasonCodes'],
  supportingObservationIds: string[],
  summary: string,
): VerificationOutcome {
  return { id: input.outcomeId, obligationId: input.obligationId, verdict, reasonCodes, supportingObservationIds, summary };
}

/** Compare endpoint evidence without inferring an unobserved transition or historical state. */
export function comparePrice(input: PriceComparisonInput): PriceComparison {
  const sourceMap = new Map(input.observations.map((item) => [item.id, item]));
  const missing = new Set<string>();
  const mismatched = new Set<string>();
  const baseSource = evidenceFor(input.baselinePrice, sourceMap);
  const currentSource = evidenceFor(input.currentPrice, sourceMap);
  const validatedFields = validateCandidateFields(input.candidateFields ?? [], input.observations,
    input.observations.map((observation) => observation.id));
  const fieldsValid = (input.candidateFields ?? []).length === 0 || validatedFields.rejected.length === 0;
  const base = input.baselinePrice;
  const current = input.currentPrice;

  if (!base) missing.add('baseline_price');
  else if (!baseSource) missing.add('baseline_evidence');
  if (!current) missing.add('current_price');
  else if (!currentSource) missing.add('current_evidence');
  if (!fieldsValid) missing.add('candidate_field_evidence');

  if (base && current && baseSource && currentSource && fieldsValid) {
    checkIdentity('vendor', input.member.vendor, base.vendor, current.vendor, missing, mismatched);
    checkIdentity('product', input.member.product, base.product, current.product, missing, mismatched);
    checkIdentity('plan', input.member.plan, base.plan, current.plan, missing, mismatched);
    for (const dimension of ['currency', 'unit', 'quotedInterval', 'commitment'] as const) {
      if (base[dimension] == null || current[dimension] == null) missing.add(dimension);
      else if ((dimension === 'commitment' && (base[dimension] === 'unknown' || base[dimension] === 'other')) ||
          (dimension === 'unit' && base[dimension] === 'other') ||
          (dimension === 'quotedInterval' && (base[dimension] === 'usage' || base[dimension] === 'other'))) missing.add(dimension);
      else if (base[dimension] !== current[dimension]) mismatched.add(`${dimension}_mismatch`);
    }
    if (base.amountDecimal == null || current.amountDecimal == null) missing.add('amount');
    if (base.unit === 'seat') {
      if (input.requestedQuantity != null) {
        if (!Number.isInteger(input.requestedQuantity) || input.requestedQuantity < 1) missing.add('quantity');
        else if ((base.quantity != null && base.quantity !== input.requestedQuantity) || (current.quantity != null && current.quantity !== input.requestedQuantity)) mismatched.add('quantity_mismatch');
      } else if (base.quantity == null || current.quantity == null) missing.add('quantity');
      else if (base.quantity !== current.quantity) mismatched.add('quantity_mismatch');
      if (base.minimumQuantity == null || current.minimumQuantity == null) missing.add('minimum_quantity');
      else if (base.minimumQuantity !== current.minimumQuantity) mismatched.add('minimum_quantity_mismatch');
    } else if (base.unit === 'account') {
      if (base.quantity == null || current.quantity == null) missing.add('quantity');
      else if (base.quantity !== current.quantity) mismatched.add('quantity_mismatch');
      if (base.minimumQuantity == null || current.minimumQuantity == null) missing.add('minimum_quantity');
      else if (base.minimumQuantity !== current.minimumQuantity) mismatched.add('minimum_quantity_mismatch');
    }
    if (base.promotion == null || current.promotion == null) missing.add('promotion');
    else if (fold(base.promotion) !== fold(current.promotion)) mismatched.add('promotion_mismatch');
    if (base.region == null || current.region == null) missing.add('region');
    else if (fold(base.region) !== fold(current.region)) mismatched.add('region_mismatch');
    if (base.includedUsage == null || current.includedUsage == null) missing.add('included_usage');
    else if (fold(base.includedUsage) !== fold(current.includedUsage)) mismatched.add('included_usage_mismatch');
    if (base.taxBasis != null && current.taxBasis != null && fold(base.taxBasis) !== fold(current.taxBasis)) mismatched.add('tax_basis_mismatch');
  }

  const mismatchCodes = [...mismatched].flatMap((dimension) => {
    if (dimension.startsWith('commitment')) return ['commitment_mismatch' as const];
    if (dimension.startsWith('currency')) return ['currency_mismatch' as const];
    if (dimension.startsWith('plan') || dimension.startsWith('product') || dimension.startsWith('vendor')) return ['plan_mismatch' as const];
    if (dimension.includes('quantity')) return ['quantity_unknown' as const];
    return [];
  });
  const supportIds = [baseSource?.id, currentSource?.id].filter((id): id is string => Boolean(id));
  const none = { baseline: null, current: null, monthlyDelta: null } as const;
  if (mismatched.size > 0) {
    const reasons = [...new Set(mismatchCodes)];
    return { outcome: outcome(input, 'cannot_compare', reasons.length ? reasons : ['unsupported_pricing'], supportIds, 'Price terms do not match.'), comparability: 'incompatible', missingDimensions: [...missing], mismatchedDimensions: [...mismatched], totals: none };
  }
  if (missing.size > 0 || !base || !current || !baseSource || !currentSource) {
    const reasons: VerificationOutcome['reasonCodes'] = [];
    if (!base || !baseSource) reasons.push('missing_historical_evidence');
    if (!current || !currentSource) reasons.push('missing_current_evidence');
    if (missing.has('quantity') || missing.has('minimum_quantity')) reasons.push('quantity_unknown');
    if (missing.has('plan') || missing.has('product') || missing.has('vendor')) reasons.push('plan_mismatch');
    if (missing.has('candidate_field_evidence')) reasons.push('conflicting_sources');
    if (reasons.length === 0) reasons.push('unsupported_pricing');
    return { outcome: outcome(input, 'cannot_compare', [...new Set(reasons)], supportIds, 'Evidence or required price terms are incomplete.'), comparability: 'insufficient', missingDimensions: [...missing], mismatchedDimensions: [], totals: none };
  }

  const quantity = base.unit === 'flat' ? 1 : input.requestedQuantity ?? base.quantity ?? current.quantity ?? 1;
  const baseTotal = calculatePriceTotals(base, quantity);
  const currentTotal = calculatePriceTotals(current, quantity);
  if (!baseTotal || !currentTotal || base.amountDecimal == null || current.amountDecimal == null) {
    return { outcome: outcome(input, 'cannot_compare', ['unsupported_pricing'], supportIds, 'This pricing structure is outside supported fixed pricing.'), comparability: 'insufficient', missingDimensions: ['unsupported_pricing'], mismatchedDimensions: [], totals: none };
  }
  if (input.historicalStateEvidence) {
    const historical = input.historicalStateEvidence;
    const source = evidenceFor(historical.price, sourceMap);
    if (source && historical.price.amountDecimal != null &&
        new Decimal(historical.price.amountDecimal).comparedTo(base.amountDecimal) !== 0 &&
        fold(historical.price.vendor) === fold(base.vendor) &&
        fold(historical.price.product) === fold(base.product) &&
        fold(historical.price.plan) === fold(base.plan) &&
        historical.price.currency === base.currency && historical.price.unit === base.unit &&
        historical.price.quotedInterval === base.quotedInterval && historical.price.commitment === base.commitment &&
        historical.price.quantity === base.quantity && historical.price.minimumQuantity === base.minimumQuantity &&
        fold(historical.price.region) === fold(base.region) &&
        fold(historical.price.promotion) === fold(base.promotion) &&
        fold(historical.price.includedUsage) === fold(base.includedUsage) &&
        fold(historical.price.taxBasis) === fold(base.taxBasis) &&
        (historical.price.observedAt ?? source.publishedAt ?? source.providerCaptureAt ?? '').slice(0, 10) <= input.baselineDate) {
      return { outcome: outcome(input, 'earlier_answer_wrong', [], [source.id, currentSource.id], 'Reliable evidence records a different price at the time of the earlier answer.'), comparability: 'compatible', missingDimensions: [], mismatchedDimensions: [], totals: { baseline: baseTotal, current: currentTotal, monthlyDelta: calculateMonthlyPriceDelta(base, current, quantity) } };
    }
  }
  const sameAmount = new Decimal(base.amountDecimal).comparedTo(current.amountDecimal) === 0;
  let verdict: VerificationOutcome['verdict'];
  let reasons: VerificationOutcome['reasonCodes'] = [];
  let summary: string;
  if (sameAmount) {
    verdict = 'same_observed';
    summary = 'The compared price endpoints match; this does not establish that no intervening change occurred.';
  } else {
    const transition = input.transitionEvidence?.observation;
    const transitionSource = transition ? sourceMap.get(transition.id) : undefined;
    const effective = transitionSource?.effectiveAt;
    const effectiveQuote = transitionSource?.effectiveAtSpan && transitionSource.effectiveAt
      ? transitionSource.exactEvidenceText.slice(transitionSource.effectiveAtSpan.start, transitionSource.effectiveAtSpan.endExclusive)
      : '';
    const hasDateSpan = Boolean(transitionSource?.effectiveAtSpan && transitionSource.effectiveAt &&
      transitionSource.effectiveAtSpan.endExclusive <= transitionSource.exactEvidenceText.length &&
      effectiveQuote.length > 0);
    const transitionFields = validateCandidateFields(
      (input.candidateFields ?? []).filter((field) => field.observationId === transitionSource?.id),
      input.observations,
      transitionSource ? [transitionSource.id] : [],
    ).valid;
    const transitionAssociated = transitionSource?.id === currentSource.id || (
      transitionFields.some((field) => field.field === 'vendor' && fold(field.proposedValue) === fold(input.member.vendor)) &&
      transitionFields.some((field) => field.field === 'plan' && fold(field.proposedValue) === fold(input.member.plan)) &&
      transitionFields.some((field) => field.field === 'effectiveAt' && transitionSource?.effectiveAtSpan &&
        field.supportSpan.start === transitionSource.effectiveAtSpan.start &&
        field.supportSpan.endExclusive === transitionSource.effectiveAtSpan.endExclusive)
    );
    if (transitionSource && transitionSource.id === transition?.id && transitionAssociated && effective && hasDateSpan && effective.slice(0, 10) > input.baselineDate) {
      verdict = 'confirmed_change';
      summary = `A supported transition is dated ${effective.slice(0, 10)} after the baseline.`;
      supportIds.push(transitionSource.id);
    } else {
      verdict = 'different_now_timing_unknown';
      reasons = ['unknown_transition_date'];
      summary = 'The comparable current endpoint differs, but the transition time is not established.';
    }
  }
  return { outcome: outcome(input, verdict, reasons, supportIds, summary), comparability: 'compatible', missingDimensions: [], mismatchedDimensions: [], totals: { baseline: baseTotal, current: currentTotal, monthlyDelta: calculateMonthlyPriceDelta(base, current, quantity) } };
}
