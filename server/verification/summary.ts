import type {
  DecisionMember,
  Obligation,
  VerificationOutcome,
} from '../../shared/domain.js';

export interface MemberVerificationRow {
  member: DecisionMember;
  obligations: Obligation[];
  outcomes: VerificationOutcome[];
  requested: number;
  attempted: number;
  evidenced: number;
  comparable: number;
  resolved: number;
}

export interface VerificationSummary {
  memberRows: MemberVerificationRow[];
  counts: {
    members: number;
    requested: number;
    attempted: number;
    evidenced: number;
    comparable: number;
    resolved: number;
    unresolved: number;
  };
  text: string;
}

/** Derive coverage from typed obligations; absent evidence never counts as unchanged. */
export function summarizeVerification(
  members: DecisionMember[],
  obligations: Obligation[],
  outcomes: VerificationOutcome[],
): VerificationSummary {
  const outcomeByObligation = new Map(outcomes.map((outcome) => [outcome.obligationId, outcome]));
  const memberRows = members.map((member): MemberVerificationRow => {
    const rows = obligations.filter((item) => item.memberId === member.memberId);
    const rowOutcomes = rows.map((item) => outcomeByObligation.get(item.id)).filter((item): item is VerificationOutcome => Boolean(item));
    return {
      member,
      obligations: rows,
      outcomes: rowOutcomes,
      requested: rows.length,
      attempted: rows.filter((item) => item.acquisition === 'attempted').length,
      evidenced: rows.filter((item) => item.observationIds.length > 0).length,
      comparable: rows.filter((item) => item.comparability === 'compatible').length,
      resolved: rows.filter((item) => item.resolution === 'resolved').length,
    };
  });
  const counts = {
    members: members.length,
    requested: obligations.length,
    attempted: obligations.filter((item) => item.acquisition === 'attempted').length,
    evidenced: obligations.filter((item) => item.observationIds.length > 0).length,
    comparable: obligations.filter((item) => item.comparability === 'compatible').length,
    resolved: obligations.filter((item) => item.resolution === 'resolved').length,
    unresolved: obligations.filter((item) => item.resolution !== 'resolved').length,
  };
  const text = `${counts.resolved} of ${counts.requested} requested obligations resolved across ${counts.members} baseline members; ${counts.unresolved} remain unresolved.`;
  return { memberRows, counts, text };
}

export function noSavedBaselineOutcome(input: {
  id: string;
  obligationId: string;
}): VerificationOutcome {
  return {
    id: input.id,
    obligationId: input.obligationId,
    verdict: 'no_saved_baseline',
    reasonCodes: [],
    supportingObservationIds: [],
    summary: 'No saved decision baseline exists; no replacement baseline was inferred.',
  };
}
