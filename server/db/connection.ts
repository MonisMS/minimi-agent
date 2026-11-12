import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrations } from './migrations/index.js';

export interface OpenDatabaseOptions {
  filePath: string;
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseSync {
  const { filePath } = options;
  if (filePath !== ':memory:') {
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  const database = new DatabaseSync(filePath);
  database.exec('PRAGMA foreign_keys = ON');
  database.exec('PRAGMA busy_timeout = 5000');
  if (filePath !== ':memory:') {
    database.exec('PRAGMA journal_mode = WAL');
    database.exec('PRAGMA synchronous = NORMAL');
  }
  applyMigrations(database);
  return database;
}

export function openInMemoryDatabase(): DatabaseSync {
  return openDatabase({ filePath: ':memory:' });
}

export function closeDatabase(database: DatabaseSync): void {
  database.close();
}
