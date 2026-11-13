import { Decimal } from 'decimal.js';
import type { PriceObservation } from '../../shared/domain.js';

const MoneyDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export interface PriceTotals {
  quantity: number;
  monthlyEquivalent: string;
  annualCommitment: string | null;
  monthlyEquivalentLabel: string;
  annualCommitmentLabel: string | null;
}

function display(value: Decimal): string {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
}

/** Calculate base-plan totals only; tax and promotions are not silently estimated. */
export function calculatePriceTotals(
  price: PriceObservation,
  quantity: number,
): PriceTotals | null {
  if (!price.amountDecimal || !price.currency || !price.unit || price.unit === 'other' ||
      !price.quotedInterval || !price.commitment || !Number.isInteger(quantity) || quantity < 1) return null;
  const multiplier = price.unit === 'flat' ? 1 : quantity;
  const amount = new MoneyDecimal(price.amountDecimal).mul(multiplier);
  let monthly: Decimal;
  let annualCommitment: Decimal | null = null;
  if (price.quotedInterval === 'month') {
    monthly = amount;
    if (price.commitment === 'annual') annualCommitment = amount.mul(12);
  } else if (price.quotedInterval === 'year') {
    monthly = amount.div(12);
    if (price.commitment === 'annual') annualCommitment = amount;
  } else {
    return null;
  }
  const currency = price.currency;
  return {
    quantity: multiplier,
    monthlyEquivalent: display(monthly),
    annualCommitment: annualCommitment ? display(annualCommitment) : null,
    monthlyEquivalentLabel: `${currency} ${display(monthly)} base-plan monthly equivalent`,
    annualCommitmentLabel: annualCommitment ? `${currency} ${display(annualCommitment)} annual commitment` : null,
  };
}

/** Compute displayed change from unrounded rates, rounding only the final result. */
export function calculateMonthlyPriceDelta(
  oldPrice: PriceObservation,
  newPrice: PriceObservation,
  quantity: number,
): string | null {
  if (!oldPrice.amountDecimal || !newPrice.amountDecimal || !oldPrice.unit || !oldPrice.quotedInterval ||
      !newPrice.unit || !newPrice.quotedInterval || oldPrice.unit === 'other' || newPrice.unit === 'other' ||
      oldPrice.quotedInterval === 'usage' || oldPrice.quotedInterval === 'other' ||
      newPrice.quotedInterval === 'usage' || newPrice.quotedInterval === 'other') return null;
  const oldMultiplier = oldPrice.unit === 'flat' ? 1 : quantity;
  const newMultiplier = newPrice.unit === 'flat' ? 1 : quantity;
  const oldTotal = new MoneyDecimal(oldPrice.amountDecimal).mul(oldMultiplier);
  const newTotal = new MoneyDecimal(newPrice.amountDecimal).mul(newMultiplier);
  const oldMonthly = oldPrice.quotedInterval === 'year' ? oldTotal.div(12) : oldTotal;
  const newMonthly = newPrice.quotedInterval === 'year' ? newTotal.div(12) : newTotal;
  return display(newMonthly.minus(oldMonthly));
}
