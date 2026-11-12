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
  {
    id: 2,
    name: 'runs_and_admission',
    sql: `
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES owners(id) ON DELETE CASCADE,
        namespace TEXT NOT NULL CHECK (namespace IN ('live', 'demo')),
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        question_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        answer_id TEXT,
        request_key TEXT NOT NULL,
        normalized_payload_hash TEXT NOT NULL,
        retry_of_run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
        baseline_id TEXT,
        task_kind TEXT NOT NULL CHECK (task_kind IN ('chat', 'recall', 'research', 'recheck')),
        state TEXT NOT NULL CHECK (
          state IN (
            'received', 'recalling', 'generating', 'researching', 'validating',
            'completed', 'clarification_required', 'cancelled', 'failed', 'interrupted'
          )
        ),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 0),
        event_seq INTEGER NOT NULL DEFAULT 0 CHECK (event_seq >= 0),
        started_at TEXT NOT NULL,
        acquisition_deadline_at TEXT NOT NULL,
        deadline_at TEXT NOT NULL,
        completed_at TEXT,
        usage_json TEXT NOT NULL,
        error_code TEXT,
        result_id TEXT,
        captured_generation INTEGER NOT NULL,
        answer_text TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (owner_id, namespace, request_key)
      );
      CREATE INDEX runs_conversation_idx
        ON runs(conversation_id, started_at, id);
      CREATE INDEX runs_owner_idx
        ON runs(owner_id, namespace, started_at);
      CREATE UNIQUE INDEX runs_one_active_per_conversation
        ON runs(conversation_id)
        WHERE state IN ('received', 'recalling', 'generating', 'researching', 'validating');
      CREATE INDEX runs_active_idx
        ON runs(state)
        WHERE state IN ('received', 'recalling', 'generating', 'researching', 'validating');
    `,
  },
  {
    id: 3,
    name: 'run_events',
    sql: `
      CREATE TABLE run_events (
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL,
        seq INTEGER NOT NULL CHECK (seq >= 0),
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
      CREATE INDEX run_events_run_idx ON run_events(run_id, seq);
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
