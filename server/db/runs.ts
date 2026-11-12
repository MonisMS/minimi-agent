import type { DatabaseSync } from 'node:sqlite';
import {
  ACTIVE_RUN_STATES,
  runSchema,
  runUsageSchema,
  type Run,
  type RunState,
  type RunUsage,
} from '../../shared/domain.js';
import type { Scope } from './conversations.js';
import { runTransaction } from './transaction.js';
import { RunNotFoundError, RunStateConflictError } from '../runs/errors.js';

export interface RunRecord extends Run {
  answerText: string | null;
  baselineId: string | null;
}

interface RunRow {
  id: string;
  owner_id: string;
  namespace: string;
  conversation_id: string;
  question_id: string;
  answer_id: string | null;
  request_key: string;
  normalized_payload_hash: string;
  retry_of_run_id: string | null;
  baseline_id: string | null;
  task_kind: string;
  state: string;
  version: number;
  event_seq: number;
  started_at: string;
  acquisition_deadline_at: string;
  deadline_at: string;
  completed_at: string | null;
  usage_json: string;
  error_code: string | null;
  result_id: string | null;
  captured_generation: number;
  answer_text: string | null;
}

const RUN_COLUMNS = `
  r.id, r.owner_id, r.namespace, r.conversation_id, r.question_id, r.answer_id,
  r.request_key, r.normalized_payload_hash, r.retry_of_run_id, r.baseline_id,
  r.task_kind, r.state, r.version, r.event_seq, r.started_at,
  r.acquisition_deadline_at, r.deadline_at, r.completed_at, r.usage_json,
  r.error_code, r.result_id, r.captured_generation, r.answer_text
`;

function mapRun(row: RunRow): RunRecord {
  const run = runSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    namespace: row.namespace,
    conversationId: row.conversation_id,
    questionId: row.question_id,
    answerId: row.answer_id,
    requestKey: row.request_key,
    normalizedPayloadHash: row.normalized_payload_hash,
    retryOfRunId: row.retry_of_run_id,
    taskKind: row.task_kind,
    state: row.state,
    version: row.version,
    eventSeq: row.event_seq,
    startedAt: row.started_at,
    acquisitionDeadlineAt: row.acquisition_deadline_at,
    deadlineAt: row.deadline_at,
    completedAt: row.completed_at,
    usage: runUsageSchema.parse(JSON.parse(row.usage_json) as unknown),
    errorCode: row.error_code,
    resultId: row.result_id,
    capturedGeneration: row.captured_generation,
  });
  return {
    ...run,
    answerText: row.answer_text,
    baselineId: row.baseline_id,
  };
}

export interface InsertRunInput {
  run: Run;
  answerText: string | null;
  baselineId: string | null;
}

export function insertRun(database: DatabaseSync, input: InsertRunInput): void {
  const run = runSchema.parse(input.run);
  runTransaction(database, () => {
    database
      .prepare(
        `INSERT INTO runs
          (id, owner_id, namespace, conversation_id, question_id, answer_id, request_key,
           normalized_payload_hash, retry_of_run_id, baseline_id, task_kind, state, version,
           event_seq, started_at, acquisition_deadline_at, deadline_at, completed_at,
           usage_json, error_code, result_id, captured_generation, answer_text, created_at,
           updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.ownerId,
        run.namespace,
        run.conversationId,
        run.questionId,
        run.answerId,
        run.requestKey,
        run.normalizedPayloadHash,
        run.retryOfRunId,
        input.baselineId,
        run.taskKind,
        run.state,
        run.version,
        run.eventSeq,
        run.startedAt,
        run.acquisitionDeadlineAt,
        run.deadlineAt,
        run.completedAt,
        JSON.stringify(run.usage),
        run.errorCode,
        run.resultId,
        run.capturedGeneration,
        input.answerText,
        run.startedAt,
        run.startedAt,
      );
  });
}

export function getRun(
  database: DatabaseSync,
  scope: Scope,
  runId: string,
): RunRecord | null {
  const row = database
    .prepare(
      `SELECT ${RUN_COLUMNS}
       FROM runs r
       JOIN conversations c ON c.id = r.conversation_id AND c.deleted_at IS NULL
       WHERE r.id = ? AND r.owner_id = ? AND r.namespace = ?`,
    )
    .get(runId, scope.ownerId, scope.namespace) as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function getRunByRequestKey(
  database: DatabaseSync,
  scope: Scope,
  requestKey: string,
): RunRecord | null {
  const row = database
    .prepare(
      `SELECT ${RUN_COLUMNS}
       FROM runs r
       JOIN conversations c ON c.id = r.conversation_id AND c.deleted_at IS NULL
       WHERE r.request_key = ? AND r.owner_id = ? AND r.namespace = ?`,
    )
    .get(requestKey, scope.ownerId, scope.namespace) as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function getLatestRunForQuestion(
  database: DatabaseSync,
  scope: Scope,
  questionId: string,
): RunRecord | null {
  const row = database
    .prepare(
      `SELECT ${RUN_COLUMNS}
       FROM runs r
       JOIN conversations c ON c.id = r.conversation_id AND c.deleted_at IS NULL
       WHERE r.question_id = ? AND r.owner_id = ? AND r.namespace = ?
       ORDER BY r.started_at DESC, r.id DESC
       LIMIT 1`,
    )
    .get(questionId, scope.ownerId, scope.namespace) as RunRow | undefined;
  return row ? mapRun(row) : null;
}

export function countActiveRuns(database: DatabaseSync): number {
  const placeholders = ACTIVE_RUN_STATES.map(() => '?').join(', ');
  const row = database
    .prepare(`SELECT COUNT(*) AS count FROM runs WHERE state IN (${placeholders})`)
    .get(...ACTIVE_RUN_STATES) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function countActiveRunsForConversation(
  database: DatabaseSync,
  scope: Scope,
  conversationId: string,
): number {
  const placeholders = ACTIVE_RUN_STATES.map(() => '?').join(', ');
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM runs
       WHERE conversation_id = ? AND owner_id = ? AND namespace = ?
         AND state IN (${placeholders})`,
    )
    .get(
      conversationId,
      scope.ownerId,
      scope.namespace,
      ...ACTIVE_RUN_STATES,
    ) as { count: number } | undefined;
  return row?.count ?? 0;
}

export interface TransitionRunStateInput extends Scope {
  runId: string;
  expectedVersion: number;
  toState: RunState;
  fromStates: readonly RunState[];
  updatedAt: string;
  completedAt?: string | null;
  errorCode?: string | null;
  resultId?: string | null;
  answerId?: string | null;
  answerText?: string | null;
  usage?: RunUsage;
}

type SqlValue = string | number | null;

export function transitionRunState(
  database: DatabaseSync,
  input: TransitionRunStateInput,
): RunRecord {
  if (input.fromStates.length === 0) {
    throw new Error('transitionRunState requires at least one source state');
  }

  const assignments = ['state = ?', 'version = version + 1', 'updated_at = ?'];
  const values: SqlValue[] = [input.toState, input.updatedAt];

  if (input.completedAt !== undefined) {
    assignments.push('completed_at = ?');
    values.push(input.completedAt);
  }
  if (input.errorCode !== undefined) {
    assignments.push('error_code = ?');
    values.push(input.errorCode);
  }
  if (input.resultId !== undefined) {
    assignments.push('result_id = ?');
    values.push(input.resultId);
  }
  if (input.answerId !== undefined) {
    assignments.push('answer_id = ?');
    values.push(input.answerId);
  }
  if (input.answerText !== undefined) {
    assignments.push('answer_text = ?');
    values.push(input.answerText);
  }
  if (input.usage !== undefined) {
    assignments.push('usage_json = ?');
    values.push(JSON.stringify(input.usage));
  }

  const statePlaceholders = input.fromStates.map(() => '?').join(', ');
  const result = database
    .prepare(
      `UPDATE runs
       SET ${assignments.join(', ')}
       WHERE id = ? AND owner_id = ? AND namespace = ? AND version = ?
         AND state IN (${statePlaceholders})
         AND EXISTS (
           SELECT 1 FROM conversations c
           WHERE c.id = runs.conversation_id
             AND c.deleted_at IS NULL
             AND c.generation = runs.captured_generation
         )`,
    )
    .run(
      ...values,
      input.runId,
      input.ownerId,
      input.namespace,
      input.expectedVersion,
      ...input.fromStates,
    );

  if (Number(result.changes) !== 1) {
    const actual = getRun(database, input, input.runId);
    if (!actual) {
      throw new RunNotFoundError();
    }
    throw new RunStateConflictError(
      `Run is ${actual.state} at version ${actual.version}, not the expected version ${input.expectedVersion}`,
    );
  }

  const updated = getRun(database, input, input.runId);
  if (!updated) {
    throw new RunNotFoundError();
  }
  return updated;
}

export interface CheckpointInput extends Scope {
  runId: string;
  answerText: string;
  updatedAt: string;
}

export function tryUpdateRunCheckpoint(
  database: DatabaseSync,
  input: CheckpointInput,
): boolean {
  const placeholders = ACTIVE_RUN_STATES.map(() => '?').join(', ');
  const result = database
    .prepare(
      `UPDATE runs
       SET answer_text = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND namespace = ?
         AND state IN (${placeholders})
         AND EXISTS (
           SELECT 1 FROM conversations c
           WHERE c.id = runs.conversation_id
             AND c.deleted_at IS NULL
             AND c.generation = runs.captured_generation
         )`,
    )
    .run(
      input.answerText,
      input.updatedAt,
      input.runId,
      input.ownerId,
      input.namespace,
      ...ACTIVE_RUN_STATES,
    );
  return Number(result.changes) === 1;
}

export interface UpdateUsageInput extends Scope {
  runId: string;
  usage: RunUsage;
  updatedAt: string;
}

export function updateRunUsage(database: DatabaseSync, input: UpdateUsageInput): void {
  const placeholders = ACTIVE_RUN_STATES.map(() => '?').join(', ');
  const result = database
    .prepare(
      `UPDATE runs
       SET usage_json = ?, updated_at = ?
       WHERE id = ? AND owner_id = ? AND namespace = ?
         AND state IN (${placeholders})
         AND EXISTS (
           SELECT 1 FROM conversations c
           WHERE c.id = runs.conversation_id
             AND c.deleted_at IS NULL
             AND c.generation = runs.captured_generation
         )`,
    )
    .run(
      JSON.stringify(runUsageSchema.parse(input.usage)),
      input.updatedAt,
      input.runId,
      input.ownerId,
      input.namespace,
      ...ACTIVE_RUN_STATES,
    );
  if (Number(result.changes) !== 1) {
    throw new RunStateConflictError('The run is no longer active');
  }
}

export function interruptActiveRuns(database: DatabaseSync, now: string): number {
  const placeholders = ACTIVE_RUN_STATES.map(() => '?').join(', ');
  const result = database
    .prepare(
      `UPDATE runs
       SET state = 'interrupted', version = version + 1, completed_at = ?,
           updated_at = ?, error_code = 'interrupted'
       WHERE state IN (${placeholders})`,
    )
    .run(now, now, ...ACTIVE_RUN_STATES);
  return Number(result.changes);
}

export function listActiveRunIdsForConversation(
  database: DatabaseSync,
  scope: Scope,
  conversationId: string,
): string[] {
  const placeholders = ACTIVE_RUN_STATES.map(() => '?').join(', ');
  const rows = database
    .prepare(
      `SELECT id FROM runs
       WHERE conversation_id = ? AND owner_id = ? AND namespace = ?
         AND state IN (${placeholders})
       ORDER BY started_at ASC, id ASC`,
    )
    .all(
      conversationId,
      scope.ownerId,
      scope.namespace,
      ...ACTIVE_RUN_STATES,
    ) as unknown as Array<{ id: string }>;
  return rows.map((row) => row.id);
}
