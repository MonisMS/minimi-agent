import {
  validateSpan,
  type SourceObservation,
  type Span,
} from '../../shared/domain.js';

/** Validate offsets against the exact immutable evidence string (JavaScript UTF-16 units). */
export function validateEvidenceSpan(
  observation: Pick<SourceObservation, 'exactEvidenceText'>,
  span: Span,
  quote: string,
): void {
  validateSpan(observation.exactEvidenceText, span, quote);
}
