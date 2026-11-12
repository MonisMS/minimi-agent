import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  answerStateSchema,
  idSchema,
  ianaZoneSchema,
  isoInstantSchema,
  messageRoleSchema,
  messageSchema,
  type AnswerState,
  type Message,
  type MessageRole,
  type Namespace,
} from '../../shared/domain.js';
import { requireConversation, type Scope } from './conversations.js';
import { RepositoryNotFoundError } from './errors.js';
import { runTransaction } from './transaction.js';

export interface AddMessageInput extends Scope {
  id?: string;
  conversationId: string;
  role: MessageRole;
  originalText: string;
  createdAt: string;
  timezone: string;
  runId?: string | null;
  answerState?: AnswerState | null;
  sourceObservationIds?: string[];
}

export interface UpdateAnswerStateInput extends Scope {
  messageId: string;
  answerState: AnswerState;
  sourceObservationIds?: string[];
}

interface MessageRow {
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

const observationIdsSchema = z.array(idSchema);

function mapMessage(row: MessageRow): Message {
  const sourceObservationIds = observationIdsSchema.parse(
    JSON.parse(row.source_observation_ids) as unknown,
  );
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
    sourceObservationIds,
  });
}

function selectMessage(
  database: DatabaseSync,
  scope: Scope,
  messageId: string,
): Message | null {
  const row = database
    .prepare(
      `SELECT m.id, m.conversation_id, m.owner_id, m.namespace, m.role, m.original_text,
              m.created_at, m.timezone, m.run_id, m.answer_state, m.source_observation_ids
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ? AND m.owner_id = ? AND m.namespace = ?
         AND c.owner_id = ? AND c.namespace = ? AND c.deleted_at IS NULL`,
    )
    .get(
      messageId,
      scope.ownerId,
      scope.namespace,
      scope.ownerId,
      scope.namespace,
    ) as MessageRow | undefined;
  return row ? mapMessage(row) : null;
}

export function addMessage(database: DatabaseSync, input: AddMessageInput): Message {
  idSchema.parse(input.ownerId);
  idSchema.parse(input.conversationId);
  messageRoleSchema.parse(input.role);
  ianaZoneSchema.parse(input.timezone);
  isoInstantSchema.parse(input.createdAt);
  if (input.originalText.length === 0) {
    throw new Error('Message text cannot be empty');
  }
  if (input.runId != null) idSchema.parse(input.runId);
  if (input.answerState != null) answerStateSchema.parse(input.answerState);
  const sourceObservationIds = observationIdsSchema.parse(input.sourceObservationIds ?? []);

  const message: Message = {
    id: input.id ?? randomUUID(),
    conversationId: input.conversationId,
    ownerId: input.ownerId,
    namespace: input.namespace,
    role: input.role,
    originalText: input.originalText,
    createdAt: input.createdAt,
    timezone: input.timezone,
    runId: input.runId ?? null,
    answerState: input.answerState ?? null,
    sourceObservationIds,
  };
  messageSchema.parse(message);

  runTransaction(database, () => {
    requireConversation(database, input, input.conversationId);
    database
      .prepare(
        `INSERT INTO messages
          (id, conversation_id, owner_id, namespace, role, original_text, created_at,
           timezone, run_id, answer_state, source_observation_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.conversationId,
        message.ownerId,
        message.namespace,
        message.role,
        message.originalText,
        message.createdAt,
        message.timezone,
        message.runId,
        message.answerState,
        JSON.stringify(message.sourceObservationIds),
      );
    database
      .prepare(
        `UPDATE conversations SET updated_at = ?
         WHERE id = ? AND owner_id = ? AND namespace = ? AND deleted_at IS NULL`,
      )
      .run(message.createdAt, message.conversationId, message.ownerId, message.namespace);
  });

  return message;
}

export function listMessages(
  database: DatabaseSync,
  scope: Scope,
  conversationId: string,
): Message[] {
  requireConversation(database, scope, conversationId);
  const rows = database
    .prepare(
      `SELECT m.id, m.conversation_id, m.owner_id, m.namespace, m.role, m.original_text,
              m.created_at, m.timezone, m.run_id, m.answer_state, m.source_observation_ids
       FROM messages m
       WHERE m.conversation_id = ? AND m.owner_id = ? AND m.namespace = ?
       ORDER BY m.created_at ASC, m.id ASC`,
    )
    .all(conversationId, scope.ownerId, scope.namespace) as unknown as MessageRow[];
  return rows.map(mapMessage);
}

export function getMessage(
  database: DatabaseSync,
  scope: Scope,
  messageId: string,
): Message | null {
  idSchema.parse(scope.ownerId);
  idSchema.parse(messageId);
  return selectMessage(database, scope, messageId);
}

export function updateMessageAnswerState(
  database: DatabaseSync,
  input: UpdateAnswerStateInput,
): Message {
  idSchema.parse(input.ownerId);
  idSchema.parse(input.messageId);
  answerStateSchema.parse(input.answerState);
  const sourceObservationIds = observationIdsSchema.parse(input.sourceObservationIds ?? []);

  runTransaction(database, () => {
    const existing = selectMessage(database, input, input.messageId);
    if (!existing) {
      throw new RepositoryNotFoundError('Message was not found');
    }
    database
      .prepare(
        `UPDATE messages SET answer_state = ?, source_observation_ids = ?
         WHERE id = ? AND owner_id = ? AND namespace = ?`,
      )
      .run(
        input.answerState,
        JSON.stringify(sourceObservationIds),
        input.messageId,
        input.ownerId,
        input.namespace,
      );
  });

  const updated = selectMessage(database, input, input.messageId);
  if (!updated) {
    throw new RepositoryNotFoundError('Message was not found');
  }
  return updated;
}

export function searchMessages(
  database: DatabaseSync,
  scope: Scope,
  query: string,
  limit = 20,
): Message[] {
  idSchema.parse(scope.ownerId);
  if (query.trim().length === 0) return [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Search limit must be an integer between 1 and 100');
  }

  const match = `"${query.replace(/"/g, '""')}"`;
  const rows = database
    .prepare(
      `SELECT m.id, m.conversation_id, m.owner_id, m.namespace, m.role, m.original_text,
              m.created_at, m.timezone, m.run_id, m.answer_state, m.source_observation_ids
       FROM messages_fts
       JOIN messages m ON m.rowid = messages_fts.rowid
       JOIN conversations c ON c.id = m.conversation_id
       WHERE messages_fts MATCH ?
         AND m.owner_id = ? AND m.namespace = ?
         AND c.owner_id = ? AND c.namespace = ? AND c.deleted_at IS NULL
       ORDER BY m.created_at ASC, m.id ASC
       LIMIT ?`,
    )
    .all(
      match,
      scope.ownerId,
      scope.namespace,
      scope.ownerId,
      scope.namespace,
      limit,
    ) as unknown as MessageRow[];
  return rows.map(mapMessage);
}
