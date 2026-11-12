import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../server/clock.js';
import { closeDatabase, openDatabase } from '../server/db/connection.js';
import {
  createConversation,
  getConversation,
  listConversations,
  type Scope,
} from '../server/db/conversations.js';
import { RepositoryNotFoundError } from '../server/db/errors.js';
import { migrations } from '../server/db/migrations/index.js';
import {
  addMessage,
  getMessage,
  listMessages,
  searchMessages,
  updateMessageAnswerState,
} from '../server/db/messages.js';
import { createOwner } from '../server/db/owners.js';
import type { Namespace } from '../shared/domain.js';

const temporaryDirectories: string[] = [];
const openDatabases: DatabaseSync[] = [];

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'minimi-storage-'));
  temporaryDirectories.push(directory);
  return directory;
}

function openTestDatabase(filePath: string): DatabaseSync {
  const database = openDatabase({ filePath });
  openDatabases.push(database);
  return database;
}

afterEach(() => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop();
    if (database) {
      try {
        closeDatabase(database);
      } catch {
        // Already closed by the test.
      }
    }
  }
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function setup(namespace: Namespace = 'live') {
  const directory = makeTemporaryDirectory();
  const filePath = path.join(directory, 'minimi.db');
  const database = openTestDatabase(filePath);
  const clock = new ManualClock(new Date('2026-11-12T10:00:00.000Z'));
  const owner = createOwner(database, clock);
  const conversation = createConversation(database, clock, {
    ownerId: owner.id,
    namespace,
    title: 'CRM shortlist',
  });
  return { directory, filePath, database, clock, owner, conversation };
}

function scopeFor(ownerId: string, namespace: Namespace = 'live'): Scope {
  return { ownerId, namespace };
}

describe('file-backed original history', () => {
  it('closes and reopens without losing original messages', () => {
    const { directory, filePath, database, owner, conversation } = setup();
    const createdAt = '2026-11-12T10:00:01.000Z';

    const first = addMessage(database, {
      ownerId: owner.id,
      namespace: 'live',
      conversationId: conversation.id,
      role: 'user',
      originalText: 'On Monday we shortlisted five CRM tools for a 20-person team.',
      createdAt,
      timezone: 'Asia/Kolkata',
    });
    const second = addMessage(database, {
      ownerId: owner.id,
      namespace: 'live',
      conversationId: conversation.id,
      role: 'assistant',
      originalText: 'The shortlist was Aster, Birch, Cedar, Dune and Elm.',
      createdAt: '2026-11-12T10:00:02.000Z',
      timezone: 'Asia/Kolkata',
      runId: null,
      answerState: 'complete',
    });

    closeDatabase(database);
    openDatabases.pop();

    const reopened = openTestDatabase(filePath);
    const messages = listMessages(reopened, scopeFor(owner.id), conversation.id);
    expect(messages.map((message) => message.id)).toEqual([first.id, second.id]);
    expect(messages[0]?.originalText).toBe(first.originalText);
    expect(messages[1]?.answerState).toBe('complete');
    expect(messages[1]?.timezone).toBe('Asia/Kolkata');

    const conversations = listConversations(reopened, scopeFor(owner.id));
    expect(conversations.map((item) => item.id)).toEqual([conversation.id]);
    expect(directory).toBeTruthy();
  });

  it('orders equal timestamps deterministically and keeps listing stable', () => {
    const { database, owner, conversation } = setup();
    const createdAt = '2026-11-12T10:00:01.000Z';

    for (const text of ['first', 'second', 'third']) {
      addMessage(database, {
        ownerId: owner.id,
        namespace: 'live',
        conversationId: conversation.id,
        role: 'user',
        originalText: text,
        createdAt,
        timezone: 'Asia/Kolkata',
      });
    }

    const firstListing = listMessages(database, scopeFor(owner.id), conversation.id);
    const secondListing = listMessages(database, scopeFor(owner.id), conversation.id);
    const ids = firstListing.map((message) => message.id);

    expect(firstListing.map((message) => message.id)).toEqual(secondListing.map((m) => m.id));
    expect(ids).toEqual([...ids].sort());
  });

  it('isolates owners and namespaces in every repository lookup', () => {
    const { database, clock, owner, conversation } = setup();
    const otherOwner = createOwner(database, clock);
    const demoConversation = createConversation(database, clock, {
      ownerId: owner.id,
      namespace: 'demo',
      title: 'Demo shortlist',
    });

    const liveMessage = addMessage(database, {
      ownerId: owner.id,
      namespace: 'live',
      conversationId: conversation.id,
      role: 'user',
      originalText: 'A live message',
      createdAt: '2026-11-12T10:00:01.000Z',
      timezone: 'Asia/Kolkata',
    });
    addMessage(database, {
      ownerId: owner.id,
      namespace: 'demo',
      conversationId: demoConversation.id,
      role: 'user',
      originalText: 'A demo message',
      createdAt: '2026-11-12T10:00:02.000Z',
      timezone: 'Asia/Kolkata',
    });

    expect(
      getConversation(database, scopeFor(otherOwner.id), conversation.id),
    ).toBeNull();
    expect(getMessage(database, scopeFor(otherOwner.id), liveMessage.id)).toBeNull();
    expect(() =>
      listMessages(database, scopeFor(otherOwner.id), conversation.id),
    ).toThrowError(RepositoryNotFoundError);
    expect(searchMessages(database, scopeFor(otherOwner.id), 'live')).toEqual([]);

    const liveMessages = listMessages(database, scopeFor(owner.id, 'live'), conversation.id);
    expect(liveMessages.map((message) => message.originalText)).toEqual(['A live message']);
    const demoMessages = listMessages(database, scopeFor(owner.id, 'demo'), demoConversation.id);
    expect(demoMessages.map((message) => message.originalText)).toEqual(['A demo message']);
  });

  it('treats SQL-like text as literal data and keeps the table intact', () => {
    const { database, owner, conversation } = setup();
    const hostileText = "'); DROP TABLE messages;--";

    const message = addMessage(database, {
      ownerId: owner.id,
      namespace: 'live',
      conversationId: conversation.id,
      role: 'user',
      originalText: hostileText,
      createdAt: '2026-11-12T10:00:01.000Z',
      timezone: 'Asia/Kolkata',
    });

    expect(getMessage(database, scopeFor(owner.id), message.id)?.originalText).toBe(
      hostileText,
    );
    expect(() => searchMessages(database, scopeFor(owner.id), hostileText)).not.toThrow();
    expect(listMessages(database, scopeFor(owner.id), conversation.id)).toHaveLength(1);
  });

  it('finds messages through FTS inside the owner and namespace scope', () => {
    const { database, owner, conversation } = setup();
    addMessage(database, {
      ownerId: owner.id,
      namespace: 'live',
      conversationId: conversation.id,
      role: 'assistant',
      originalText: 'Aster pricing increased to twenty four dollars per seat.',
      createdAt: '2026-11-12T10:00:01.000Z',
      timezone: 'Asia/Kolkata',
      answerState: 'complete',
    });

    const matches = searchMessages(database, scopeFor(owner.id), 'pricing');
    expect(matches).toHaveLength(1);
    expect(matches[0]?.originalText).toContain('Aster');

    const otherOwner = createOwner(database, new ManualClock(new Date('2026-11-12T11:00:00.000Z')));
    expect(searchMessages(database, scopeFor(otherOwner.id), 'pricing')).toEqual([]);
  });

  it('updates answer status without editing completed original text', () => {
    const { database, owner, conversation } = setup();
    const message = addMessage(database, {
      ownerId: owner.id,
      namespace: 'live',
      conversationId: conversation.id,
      role: 'assistant',
      originalText: 'Aster costs $20 per seat per month.',
      createdAt: '2026-11-12T10:00:01.000Z',
      timezone: 'Asia/Kolkata',
      answerState: 'partial',
    });

    const updated = updateMessageAnswerState(database, {
      ownerId: owner.id,
      namespace: 'live',
      messageId: message.id,
      answerState: 'complete',
      sourceObservationIds: [crypto.randomUUID()],
    });

    expect(updated.originalText).toBe(message.originalText);
    expect(updated.answerState).toBe('complete');
    expect(updated.sourceObservationIds).toHaveLength(1);
    expect(updated.createdAt).toBe(message.createdAt);
  });

  it('applies numbered migrations once across reopen', () => {
    const { filePath, database, owner, conversation } = setup();
    addMessage(database, {
      ownerId: owner.id,
      namespace: 'live',
      conversationId: conversation.id,
      role: 'user',
      originalText: 'Persisted before reopen',
      createdAt: '2026-11-12T10:00:01.000Z',
      timezone: 'Asia/Kolkata',
    });

    closeDatabase(database);
    openDatabases.pop();

    const reopened = openTestDatabase(filePath);
    const applied = reopened
      .prepare('SELECT id, name FROM schema_migrations ORDER BY id')
      .all() as Array<{ id: number; name: string }>;
    expect(applied).toHaveLength(migrations.length);
    expect(applied.map((row) => row.id)).toEqual(migrations.map((migration) => migration.id));
    expect(listMessages(reopened, scopeFor(owner.id), conversation.id)).toHaveLength(1);
  });
});
