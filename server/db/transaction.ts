import { DatabaseSync } from 'node:sqlite';

const transactionDepth = new WeakMap<DatabaseSync, number>();

export function runTransaction<T>(database: DatabaseSync, work: () => T): T {
  const depth = transactionDepth.get(database) ?? 0;
  if (depth > 0) {
    transactionDepth.set(database, depth + 1);
    try {
      return work();
    } finally {
      transactionDepth.set(database, depth);
    }
  }

  database.exec('BEGIN IMMEDIATE');
  transactionDepth.set(database, 1);
  try {
    const result = work();
    database.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      database.exec('ROLLBACK');
    } catch {
      // Preserve the original failure; a failed rollback must not hide it.
    }
    throw error;
  } finally {
    transactionDepth.set(database, 0);
  }
}
