import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../clock.js';
import { requireConversation, type Scope } from './conversations.js';
import { runTransaction } from './transaction.js';

export function deleteConversationPayload(
  database: DatabaseSync,
  clock: Clock,
  scope: Scope,
  conversationId: string,
): void {
  runTransaction(database, () => {
    requireConversation(database, scope, conversationId);
    const now = clock.now().toISOString();

    const updated = database
      .prepare(
        `UPDATE conversations
         SET generation = generation + 1, deleted_at = ?, title = NULL, updated_at = ?
         WHERE id = ? AND owner_id = ? AND namespace = ? AND deleted_at IS NULL`,
      )
      .run(now, now, conversationId, scope.ownerId, scope.namespace);
    if (Number(updated.changes) !== 1) {
      requireConversation(database, scope, conversationId);
    }

    database
      .prepare(
        `DELETE FROM messages
         WHERE conversation_id = ? AND owner_id = ? AND namespace = ?`,
      )
      .run(conversationId, scope.ownerId, scope.namespace);
  });
}
