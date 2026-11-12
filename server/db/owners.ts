import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  idSchema,
  isoInstantSchema,
  ownerSchema,
  type Owner,
} from '../../shared/domain.js';
import type { Clock } from '../clock.js';
import { RepositoryNotFoundError } from './errors.js';
import { runTransaction } from './transaction.js';

interface OwnerRow {
  id: string;
  created_at: string;
}

function mapOwner(row: OwnerRow): Owner {
  return ownerSchema.parse({
    id: row.id,
    createdAt: row.created_at,
  });
}

export function createOwner(database: DatabaseSync, clock: Clock): Owner {
  const owner: Owner = {
    id: randomUUID(),
    createdAt: clock.now().toISOString(),
  };
  runTransaction(database, () => {
    database
      .prepare('INSERT INTO owners (id, created_at) VALUES (?, ?)')
      .run(owner.id, owner.createdAt);
  });
  return ownerSchema.parse(owner);
}

export function getOwner(database: DatabaseSync, ownerId: string): Owner | null {
  idSchema.parse(ownerId);
  const row = database
    .prepare('SELECT id, created_at FROM owners WHERE id = ?')
    .get(ownerId) as OwnerRow | undefined;
  return row ? mapOwner(row) : null;
}

export function requireOwner(database: DatabaseSync, ownerId: string): Owner {
  const owner = getOwner(database, ownerId);
  if (!owner) {
    throw new RepositoryNotFoundError('Owner was not found');
  }
  return owner;
}

export function isInstant(value: string): boolean {
  return isoInstantSchema.safeParse(value).success;
}
