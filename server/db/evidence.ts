import type { DatabaseSync } from 'node:sqlite';
import {
  idSchema,
  namespaceSchema,
  sourceObservationSchema,
  type SourceObservation,
} from '../../shared/domain.js';
import { RepositoryNotFoundError } from './errors.js';
import type { Scope } from './conversations.js';

interface ObservationRow {
  id: string;
  owner_id: string;
  namespace: string;
  run_id: string;
  query_id: string;
  original_url: string;
  safe_canonical_url: string;
  title: string;
  exact_evidence_text: string;
  content_hash: string;
  text_truncated: number;
  retrieved_at: string;
  provider_capture_at: string | null;
  published_at: string | null;
  effective_at: string | null;
  effective_at_span_json: string | null;
  provider: string;
  freshness_requested: string | null;
  freshness_metadata_json: string | null;
}

function mapObservation(row: ObservationRow): SourceObservation {
  return sourceObservationSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    namespace: row.namespace,
    runId: row.run_id,
    queryId: row.query_id,
    originalUrl: row.original_url,
    safeCanonicalUrl: row.safe_canonical_url,
    title: row.title,
    exactEvidenceText: row.exact_evidence_text,
    contentHash: row.content_hash,
    textTruncated: row.text_truncated === 1,
    retrievedAt: row.retrieved_at,
    providerCaptureAt: row.provider_capture_at,
    publishedAt: row.published_at,
    effectiveAt: row.effective_at,
    effectiveAtSpan: row.effective_at_span_json
      ? JSON.parse(row.effective_at_span_json) as unknown
      : null,
    provider: row.provider,
    freshnessRequested: row.freshness_requested,
    freshnessMetadata: row.freshness_metadata_json
      ? JSON.parse(row.freshness_metadata_json) as unknown
      : null,
  });
}

function validateScope(scope: Scope): void {
  idSchema.parse(scope.ownerId);
  namespaceSchema.parse(scope.namespace);
}

export interface InsertObservationInput extends SourceObservation {
  conversationId: string;
}

export function insertObservation(
  database: DatabaseSync,
  scope: Scope,
  input: InsertObservationInput,
): SourceObservation {
  validateScope(scope);
  const observation = sourceObservationSchema.parse(input);
  idSchema.parse(input.conversationId);
  if (observation.ownerId !== scope.ownerId || observation.namespace !== scope.namespace) {
    throw new RepositoryNotFoundError('Run was not found');
  }

  const run = database.prepare(
    `SELECT id FROM runs
     WHERE id = ? AND owner_id = ? AND namespace = ? AND conversation_id = ?`,
  ).get(observation.runId, scope.ownerId, scope.namespace, input.conversationId);
  if (!run) throw new RepositoryNotFoundError('Run was not found');

  database.prepare(
    `INSERT INTO source_observations (
       id, owner_id, namespace, conversation_id, run_id, query_id,
       original_url, safe_canonical_url, title, exact_evidence_text, content_hash,
       text_truncated, retrieved_at, provider_capture_at, published_at, effective_at,
       effective_at_span_json, provider, freshness_requested, freshness_metadata_json
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    observation.id,
    observation.ownerId,
    observation.namespace,
    input.conversationId,
    observation.runId,
    observation.queryId,
    observation.originalUrl,
    observation.safeCanonicalUrl,
    observation.title,
    observation.exactEvidenceText,
    observation.contentHash,
    observation.textTruncated ? 1 : 0,
    observation.retrievedAt,
    observation.providerCaptureAt,
    observation.publishedAt,
    observation.effectiveAt,
    observation.effectiveAtSpan ? JSON.stringify(observation.effectiveAtSpan) : null,
    observation.provider,
    observation.freshnessRequested,
    observation.freshnessMetadata === null ? null : JSON.stringify(observation.freshnessMetadata),
  );
  return observation;
}

export function getObservation(
  database: DatabaseSync,
  scope: Scope,
  observationId: string,
): SourceObservation {
  validateScope(scope);
  idSchema.parse(observationId);
  const row = database.prepare(
    `SELECT id, owner_id, namespace, run_id, query_id, original_url,
            safe_canonical_url, title, exact_evidence_text, content_hash,
            text_truncated, retrieved_at, provider_capture_at, published_at,
            effective_at, effective_at_span_json, provider, freshness_requested,
            freshness_metadata_json
     FROM source_observations
     WHERE id = ? AND owner_id = ? AND namespace = ?`,
  ).get(observationId, scope.ownerId, scope.namespace) as ObservationRow | undefined;
  if (!row) throw new RepositoryNotFoundError('Evidence was not found');
  return mapObservation(row);
}

export function listObservations(
  database: DatabaseSync,
  scope: Scope,
  observationIds: string[],
  conversationId?: string,
): SourceObservation[] {
  validateScope(scope);
  const ids = [...new Set(observationIds)];
  if (!ids.length) return [];
  ids.forEach((id) => idSchema.parse(id));
  const placeholders = ids.map(() => '?').join(', ');
  const conversationFilter = conversationId ? 'AND conversation_id = ?' : '';
  const values: Array<string> = [scope.ownerId, scope.namespace, ...ids];
  if (conversationId) values.splice(2, 0, conversationId);
  const rows = database.prepare(
    `SELECT id, owner_id, namespace, run_id, query_id, original_url,
            safe_canonical_url, title, exact_evidence_text, content_hash,
            text_truncated, retrieved_at, provider_capture_at, published_at,
            effective_at, effective_at_span_json, provider, freshness_requested,
            freshness_metadata_json
     FROM source_observations
     WHERE owner_id = ? AND namespace = ? ${conversationFilter} AND id IN (${placeholders})`,
  ).all(...values) as unknown as ObservationRow[];
  return rows.map(mapObservation);
}
