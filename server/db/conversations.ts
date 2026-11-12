import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  conversationSchema,
  idSchema,
  namespaceSchema,
  type Conversation,
  type Namespace,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import { RepositoryNotFoundError } from './errors.js';
import { runTransaction } from './transaction.js';

export interface Scope {
  ownerId: string;
  namespace: Namespace;
}

export interface CreateConversationInput extends Scope {
  title?: string | null;
}

interface ConversationRow {
  id: string;
  owner_id: string;
  namespace: string;
  generation: number;
  title: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

function mapConversation(row: ConversationRow): Conversation {
  return conversationSchema.parse({
    id: row.id,
    ownerId: row.owner_id,
    namespace: row.namespace,
    generation: row.generation,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function validateScope(scope: Scope): void {
  idSchema.parse(scope.ownerId);
  namespaceSchema.parse(scope.namespace);
}

export function createConversation(
  database: DatabaseSync,
  clock: Clock,
  input: CreateConversationInput,
): Conversation {
  validateScope(input);
  if (input.title != null && input.title.length > 200) {
    throw new Error('Conversation title is too long');
  }

  const now = clock.now().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    ownerId: input.ownerId,
    namespace: input.namespace,
    generation: 0,
    title: input.title ?? null,
    createdAt: now,
    updatedAt: now,
  };

  runTransaction(database, () => {
    database
      .prepare(
        `INSERT INTO conversations
          (id, owner_id, namespace, generation, title, created_at, updated_at, deleted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        conversation.id,
        conversation.ownerId,
        conversation.namespace,
        conversation.generation,
        conversation.title,
        conversation.createdAt,
        conversation.updatedAt,
      );
  });

  return conversationSchema.parse(conversation);
}

export function getConversation(
  database: DatabaseSync,
  scope: Scope,
  conversationId: string,
): Conversation | null {
  validateScope(scope);
  idSchema.parse(conversationId);
  const row = database
    .prepare(
      `SELECT id, owner_id, namespace, generation, title, created_at, updated_at, deleted_at
       FROM conversations
       WHERE id = ? AND owner_id = ? AND namespace = ? AND deleted_at IS NULL`,
    )
    .get(conversationId, scope.ownerId, scope.namespace) as ConversationRow | undefined;
  return row ? mapConversation(row) : null;
}

export function requireConversation(
  database: DatabaseSync,
  scope: Scope,
  conversationId: string,
): Conversation {
  const conversation = getConversation(database, scope, conversationId);
  if (!conversation) {
    throw new RepositoryNotFoundError('Conversation was not found');
  }
  return conversation;
}

export function listConversations(
  database: DatabaseSync,
  scope: Scope,
): Conversation[] {
  validateScope(scope);
  const rows = database
    .prepare(
      `SELECT id, owner_id, namespace, generation, title, created_at, updated_at, deleted_at
       FROM conversations
       WHERE owner_id = ? AND namespace = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC, id ASC`,
    )
    .all(scope.ownerId, scope.namespace) as unknown as ConversationRow[];
  return rows.map(mapConversation);
}

export function touchConversation(
  database: DatabaseSync,
  scope: Scope,
  conversationId: string,
  updatedAt: string,
): void {
  validateScope(scope);
  idSchema.parse(conversationId);
  runTransaction(database, () => {
    const result = database
      .prepare(
        `UPDATE conversations
         SET updated_at = ?
         WHERE id = ? AND owner_id = ? AND namespace = ? AND deleted_at IS NULL`,
      )
      .run(updatedAt, conversationId, scope.ownerId, scope.namespace);
    if (Number(result.changes) !== 1) {
      throw new RepositoryNotFoundError('Conversation was not found');
    }
  });
}
