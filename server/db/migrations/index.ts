import type { DatabaseSync } from 'node:sqlite';
import { runTransaction } from '../transaction.js';

export interface Migration {
  id: number;
  name: string;
  sql: string;
}

export const migrations: readonly Migration[] = [
  {
    id: 1,
    name: 'initial_owners_conversations_messages',
    sql: `
      CREATE TABLE owners (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL CHECK (namespace IN ('live', 'demo')),
        generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
        title TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX conversations_owner_idx
        ON conversations(owner_id, namespace, updated_at DESC, id);

      CREATE TABLE messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL CHECK (namespace IN ('live', 'demo')),
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        original_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        timezone TEXT NOT NULL,
        run_id TEXT,
        answer_state TEXT CHECK (
          answer_state IS NULL OR answer_state IN ('complete', 'partial', 'cancelled', 'failed')
        ),
        source_observation_ids TEXT NOT NULL DEFAULT '[]'
      );
      CREATE INDEX messages_conversation_idx
        ON messages(conversation_id, created_at, id);
      CREATE INDEX messages_owner_idx
        ON messages(owner_id, namespace, created_at, id);

      CREATE VIRTUAL TABLE messages_fts USING fts5(
        original_text,
        content = 'messages',
        content_rowid = 'rowid',
        tokenize = 'unicode61'
      );

      CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
        INSERT INTO messages_fts(rowid, original_text)
        VALUES (new.rowid, new.original_text);
      END;

      CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, original_text)
        VALUES ('delete', old.rowid, old.original_text);
      END;

      CREATE TRIGGER messages_au AFTER UPDATE OF original_text ON messages BEGIN
        INSERT INTO messages_fts(messages_fts, rowid, original_text)
        VALUES ('delete', old.rowid, old.original_text);
        INSERT INTO messages_fts(rowid, original_text)
        VALUES (new.rowid, new.original_text);
      END;
    `,
  },
];

export function applyMigrations(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set(
    (database.prepare('SELECT id FROM schema_migrations').all() as Array<{ id: number }>).map(
      (row) => row.id,
    ),
  );

  for (const migration of migrations) {
    if (applied.has(migration.id)) continue;
    runTransaction(database, () => {
      database.exec(migration.sql);
      database
        .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
        .run(migration.id, migration.name, new Date().toISOString());
    });
  }
}
