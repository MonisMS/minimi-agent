import type { DatabaseSync } from 'node:sqlite';
import {
  idSchema,
  isoInstantSchema,
  messageSchema,
  messageRoleSchema,
  type Message,
  type MessageRole,
} from '../../shared/domain.js';
import type { Scope } from './conversations.js';
import { getMessage, listMessages } from './messages.js';

interface RecallMessageRow {
  id: string;
  conversation_id: string;
  owner_id: string;
  namespace: string;
  role: string;
  original_text: string;
  created_at: string;
  timezone: string;
  run_id: string | null;
  answer_state: string | null;
  source_observation_ids: string;
}

const MESSAGE_COLUMNS = `
  m.id, m.conversation_id, m.owner_id, m.namespace, m.role, m.original_text,
  m.created_at, m.timezone, m.run_id, m.answer_state, m.source_observation_ids
`;

const ELIGIBLE_MESSAGE_SQL = `
  (m.role = 'user' OR m.answer_state = 'complete')
`;

function mapMessage(row: RecallMessageRow): Message {
  return messageSchema.parse({
    id: row.id,
    conversationId: row.conversation_id,
    ownerId: row.owner_id,
    namespace: row.namespace,
    role: row.role,
    originalText: row.original_text,
    createdAt: row.created_at,
    timezone: row.timezone,
    runId: row.run_id,
    answerState: row.answer_state,
    sourceObservationIds: JSON.parse(row.source_observation_ids) as unknown,
  });
}

function validateScope(scope: Scope): void {
  idSchema.parse(scope.ownerId);
  if (scope.namespace !== 'live' && scope.namespace !== 'demo') {
    throw new Error('Invalid namespace');
  }
}

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Recall limit must be an integer between 1 and 100');
  }
}

function normalizeInstant(value: string): string {
  isoInstantSchema.parse(value);
  return new Date(value).toISOString();
}

interface ExclusionSql {
  sql: string;
  values: string[];
}

function exclusionSql(
  excludeMessageIds: readonly string[] = [],
  excludeRunId: string | null = null,
): ExclusionSql {
  const clauses: string[] = [];
  const values: string[] = [];
  const ids = [...new Set(excludeMessageIds)];
  for (const id of ids) idSchema.parse(id);
  if (ids.length > 0) {
    clauses.push(`m.id NOT IN (${ids.map(() => '?').join(', ')})`);
    values.push(...ids);
  }
  if (excludeRunId) {
    idSchema.parse(excludeRunId);
    clauses.push('(m.run_id IS NULL OR m.run_id <> ?)');
    values.push(excludeRunId);
  }
  return {
    sql: clauses.length > 0 ? ` AND ${clauses.join(' AND ')}` : '',
    values,
  };
}

export interface UtcWindowRecallQuery extends Scope {
  startUtc: string;
  endUtcExclusive: string;
  limit?: number;
  excludeMessageIds?: string[];
  excludeRunId?: string | null;
}

export function listRecallMessagesInUtcWindow(
  database: DatabaseSync,
  query: UtcWindowRecallQuery,
): Message[] {
  validateScope(query);
  const limit = query.limit ?? 50;
  validateLimit(limit);
  const exclusion = exclusionSql(query.excludeMessageIds, query.excludeRunId);
  const rows = database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.created_at >= ? AND m.created_at < ?
         AND m.owner_id = ? AND m.namespace = ?
         AND c.owner_id = ? AND c.namespace = ? AND c.deleted_at IS NULL
         AND ${ELIGIBLE_MESSAGE_SQL}
         ${exclusion.sql}
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT ?`,
    )
    .all(
      normalizeInstant(query.startUtc),
      normalizeInstant(query.endUtcExclusive),
      query.ownerId,
      query.namespace,
      query.ownerId,
      query.namespace,
      ...exclusion.values,
      limit,
    ) as unknown as RecallMessageRow[];
  return rows.map(mapMessage);
}

export interface RecentRecallQuery extends Scope {
  conversationId: string;
  limit?: number;
  roles?: MessageRole[];
  excludeMessageIds?: string[];
  excludeRunId?: string | null;
}

export function listRecentRecallMessages(
  database: DatabaseSync,
  query: RecentRecallQuery,
): Message[] {
  validateScope(query);
  idSchema.parse(query.conversationId);
  const limit = query.limit ?? 10;
  validateLimit(limit);
  const roles = query.roles ?? [];
  for (const role of roles) messageRoleSchema.parse(role);
  const exclusion = exclusionSql(query.excludeMessageIds, query.excludeRunId);
  const roleSql =
    roles.length > 0 ? ` AND m.role IN (${roles.map(() => '?').join(', ')})` : '';
  const rows = database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.conversation_id = ?
         AND m.owner_id = ? AND m.namespace = ?
         AND c.owner_id = ? AND c.namespace = ? AND c.deleted_at IS NULL
         AND ${ELIGIBLE_MESSAGE_SQL}
         ${roleSql}
         ${exclusion.sql}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT ?`,
    )
    .all(
      query.conversationId,
      query.ownerId,
      query.namespace,
      query.ownerId,
      query.namespace,
      ...roles,
      ...exclusion.values,
      limit,
    ) as unknown as RecallMessageRow[];
  return rows.map(mapMessage);
}

export interface FtsRecallQuery extends Scope {
  terms: string[];
  limit?: number;
  excludeMessageIds?: string[];
  excludeRunId?: string | null;
}

function ftsExpression(terms: string[]): string {
  return terms
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(' OR ');
}

export function searchRecallMessages(
  database: DatabaseSync,
  query: FtsRecallQuery,
): Message[] {
  validateScope(query);
  const limit = query.limit ?? 30;
  validateLimit(limit);
  const expression = ftsExpression(query.terms);
  if (expression.length === 0) return [];
  const exclusion = exclusionSql(query.excludeMessageIds, query.excludeRunId);
  const rows = database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       JOIN conversations c ON c.id = m.conversation_id
       WHERE messages_fts MATCH ?
         AND m.owner_id = ? AND m.namespace = ?
         AND c.owner_id = ? AND c.namespace = ? AND c.deleted_at IS NULL
         AND ${ELIGIBLE_MESSAGE_SQL}
         ${exclusion.sql}
       ORDER BY m.created_at DESC, m.id ASC
       LIMIT ?`,
    )
    .all(
      expression,
      query.ownerId,
      query.namespace,
      query.ownerId,
      query.namespace,
      ...exclusion.values,
      limit,
    ) as unknown as RecallMessageRow[];
  return rows.map(mapMessage);
}

export interface AliasRecallQuery extends Scope {
  aliases: string[];
  limit?: number;
  excludeMessageIds?: string[];
  excludeRunId?: string | null;
}

export function findAliasRecallMessages(
  database: DatabaseSync,
  query: AliasRecallQuery,
): Message[] {
  validateScope(query);
  const limit = query.limit ?? 20;
  validateLimit(limit);
  const aliases = [...new Set(query.aliases.map((alias) => alias.trim()).filter(Boolean))];
  if (aliases.length === 0) return [];
  const aliasSql = aliases.map(() => 'instr(lower(m.original_text), lower(?)) > 0').join(' OR ');
  const exclusion = exclusionSql(query.excludeMessageIds, query.excludeRunId);
  const rows = database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE (${aliasSql})
         AND m.owner_id = ? AND m.namespace = ?
         AND c.owner_id = ? AND c.namespace = ? AND c.deleted_at IS NULL
         AND ${ELIGIBLE_MESSAGE_SQL}
         ${exclusion.sql}
       ORDER BY m.created_at DESC, m.id ASC
       LIMIT ?`,
    )
    .all(
      ...aliases,
      query.ownerId,
      query.namespace,
      query.ownerId,
      query.namespace,
      ...exclusion.values,
      limit,
    ) as unknown as RecallMessageRow[];
  return rows.map(mapMessage);
}

export interface RunHistoryQuery extends Scope {
  runId: string;
}

export function listMessagesForRun(
  database: DatabaseSync,
  query: RunHistoryQuery,
): Message[] {
  validateScope(query);
  idSchema.parse(query.runId);
  const rows = database
    .prepare(
      `SELECT ${MESSAGE_COLUMNS}
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.run_id = ?
         AND m.owner_id = ? AND m.namespace = ?
         AND c.owner_id = ? AND c.namespace = ? AND c.deleted_at IS NULL
         AND ${ELIGIBLE_MESSAGE_SQL}
       ORDER BY m.created_at ASC, m.id ASC`,
    )
    .all(
      query.runId,
      query.ownerId,
      query.namespace,
      query.ownerId,
      query.namespace,
    ) as unknown as RecallMessageRow[];
  return rows.map(mapMessage);
}

export interface AdjacentHistoryQuery extends Scope {
  messageId: string;
  before?: number;
  after?: number;
}

export function listAdjacentMessages(
  database: DatabaseSync,
  query: AdjacentHistoryQuery,
): Message[] {
  validateScope(query);
  idSchema.parse(query.messageId);
  const before = query.before ?? 1;
  const after = query.after ?? 1;
  if (!Number.isInteger(before) || before < 0 || before > 5) {
    throw new Error('Adjacent before count must be between 0 and 5');
  }
  if (!Number.isInteger(after) || after < 0 || after > 5) {
    throw new Error('Adjacent after count must be between 0 and 5');
  }
  const anchor = getMessage(database, query, query.messageId);
  if (!anchor) return [];
  const all = listMessages(database, query, anchor.conversationId).filter(
    (message) =>
      message.role === 'user' ||
      message.answerState === 'complete',
  );
  const index = all.findIndex((message) => message.id === anchor.id);
  if (index < 0) return [];
  return all.slice(Math.max(0, index - before), index + after + 1);
}
