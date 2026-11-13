import type { DecisionSnapshot } from '../../shared/domain.js';

export interface BaselineResolution {
  status: 'selected' | 'clarification_required' | 'no_saved_baseline';
  snapshot: DecisionSnapshot | null;
  candidates: DecisionSnapshot[];
}

/** Resolve a complete stored lineage without dropping candidates to a display cap. */
export function resolveDecisionBaseline(
  snapshots: DecisionSnapshot[],
  options: { candidateOriginalMessageIds?: string[] } = {},
): BaselineResolution {
  const allowedIds = options.candidateOriginalMessageIds
    ? new Set(options.candidateOriginalMessageIds)
    : null;
  const candidates = allowedIds
    ? snapshots.filter((snapshot) => allowedIds.has(snapshot.originalMessageId))
    : snapshots;
  if (candidates.length === 0) {
    return { status: 'no_saved_baseline', snapshot: null, candidates: [] };
  }
  const superseded = new Set(
    candidates.map((snapshot) => snapshot.supersedesId).filter((id): id is string => id !== null),
  );
  const leaves = candidates.filter((snapshot) => !superseded.has(snapshot.id));
  if (leaves.length !== 1) {
    return { status: 'clarification_required', snapshot: null, candidates: leaves };
  }
  const selected = leaves[0]!;
  return { status: 'selected', snapshot: selected, candidates: [selected] };
}
