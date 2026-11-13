import type { DatabaseSync } from 'node:sqlite';
import { verificationResultSchema, type VerificationResult } from '../../shared/domain.js';
import type { Scope } from './conversations.js';
import { idSchema } from '../../shared/domain.js';
import { RepositoryNotFoundError } from './errors.js';

interface ResultRow {
  id: string;
  owner_id: string;
  namespace: string;
  conversation_id: string;
  run_id: string;
  baseline_snapshot_id: string | null;
  result_json: string;
}

export function insertVerificationResult(
  database: DatabaseSync,
  input: Scope & { conversationId: string; result: VerificationResult; createdAt: string },
): void {
  const result = verificationResultSchema.parse(input.result);
  idSchema.parse(input.ownerId);
  idSchema.parse(input.conversationId);
  const run = database.prepare(
    `SELECT id FROM runs WHERE id = ? AND owner_id = ? AND namespace = ? AND conversation_id = ?`,
  ).get(result.runId, input.ownerId, input.namespace, input.conversationId);
  if (!run) throw new RepositoryNotFoundError('Run was not found');
  if (result.baselineSnapshotId) {
    const baseline = database.prepare(
      `SELECT id FROM decision_snapshots WHERE id = ? AND owner_id = ? AND namespace = ? AND conversation_id = ?`,
    ).get(result.baselineSnapshotId, input.ownerId, input.namespace, input.conversationId);
    if (!baseline) throw new RepositoryNotFoundError('Baseline snapshot was not found');
  }
  database.prepare(
    `INSERT INTO verification_results
       (id, owner_id, namespace, conversation_id, run_id, baseline_snapshot_id, result_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(result.id, input.ownerId, input.namespace, input.conversationId, result.runId,
    result.baselineSnapshotId, JSON.stringify(result), input.createdAt);
}

export function getVerificationResult(
  database: DatabaseSync,
  scope: Scope,
  resultId: string,
): VerificationResult | null {
  idSchema.parse(scope.ownerId);
  idSchema.parse(resultId);
  const row = database.prepare(
    `SELECT vr.id, vr.owner_id, vr.namespace, vr.conversation_id, vr.run_id,
            vr.baseline_snapshot_id, vr.result_json
     FROM verification_results vr
     JOIN conversations c ON c.id = vr.conversation_id AND c.deleted_at IS NULL
     WHERE vr.id = ? AND vr.owner_id = ? AND vr.namespace = ?`,
  ).get(resultId, scope.ownerId, scope.namespace) as ResultRow | undefined;
  if (!row) return null;
  const result = verificationResultSchema.parse(JSON.parse(row.result_json) as unknown);
  if (result.id !== row.id || result.runId !== row.run_id || result.baselineSnapshotId !== row.baseline_snapshot_id) {
    throw new Error('Stored verification result metadata is inconsistent');
  }
  return result;
}
