import {
  candidateFieldSchema,
  type CandidateField,
  type SourceObservation,
} from '../../shared/domain.js';

export interface CandidateFieldValidation {
  valid: CandidateField[];
  rejected: Array<{ field: CandidateField; reason: 'malformed' | 'missing_observation' | 'unexpected_observation' | 'invalid_span' }>;
}

/** Validate field shape, source linkage and UTF-16 span/value containment. */
export function validateCandidateFields(
  fields: CandidateField[],
  observations: SourceObservation[],
  expectedObservationIds?: string[],
): CandidateFieldValidation {
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  const expected = expectedObservationIds ? new Set(expectedObservationIds) : null;
  const result: CandidateFieldValidation = { valid: [], rejected: [] };
  for (const raw of fields) {
    const parsed = candidateFieldSchema.safeParse(raw);
    if (!parsed.success) {
      result.rejected.push({ field: raw, reason: 'malformed' });
      continue;
    }
    const field = parsed.data;
    if (expected && !expected.has(field.observationId)) {
      result.rejected.push({ field, reason: 'unexpected_observation' });
      continue;
    }
    const observation = byId.get(field.observationId);
    if (!observation) {
      result.rejected.push({ field, reason: 'missing_observation' });
      continue;
    }
    const quotedText = observation.exactEvidenceText.slice(field.supportSpan.start, field.supportSpan.endExclusive);
    if (field.supportSpan.endExclusive > observation.exactEvidenceText.length || quotedText.length === 0 ||
        (field.proposedValue != null && !quotedText.includes(field.proposedValue))) {
      result.rejected.push({ field, reason: 'invalid_span' });
      continue;
    }
    // CandidateField stores offsets rather than a quote; require the proposed value to occur
    // in that exact immutable slice. This validates linkage, not semantic support.
    result.valid.push(field);
  }
  return result;
}
