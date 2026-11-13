import { createHash } from 'node:crypto';
import {
  obligationSchema,
  type DecisionMember,
  type Obligation,
} from '../../shared/domain.js';

export interface RequestedObligation {
  memberId: string;
  attribute: string;
  baselineClaimId: string;
}

function stableId(runId: string, item: RequestedObligation): string {
  const bytes = createHash('sha256')
    .update(`${runId}\u0000${item.memberId}\u0000${item.attribute}\u0000${item.baselineClaimId}`)
    .digest();
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Create one row per requested member/attribute pair, retaining every baseline member. */
export function createObligations(
  runId: string,
  members: DecisionMember[],
  requested: RequestedObligation[],
): Obligation[] {
  const memberIds = new Set(members.map((member) => member.memberId));
  const seen = new Set<string>();
  const rows: Obligation[] = [];
  for (const item of requested) {
    if (!memberIds.has(item.memberId)) continue;
    const key = `${item.memberId}\u0000${item.attribute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(obligationSchema.parse({
      id: stableId(runId, item),
      runId,
      memberId: item.memberId,
      attribute: item.attribute,
      baselineClaimId: item.baselineClaimId,
      acquisition: 'unattempted',
      observationIds: [],
      comparability: 'pending',
      missingDimensions: [],
      mismatchedDimensions: [],
      resolution: 'unresolved',
      outcomeId: null,
    }));
  }
  return rows;
}
