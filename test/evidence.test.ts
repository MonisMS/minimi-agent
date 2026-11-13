import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../server/clock.js';
import { DEFAULT_LIMITS } from '../server/config.js';
import { deleteConversationPayload } from '../server/db/deletion.js';
import { getObservation } from '../server/db/evidence.js';
import { openInMemoryDatabase, openDatabase, closeDatabase } from '../server/db/connection.js';
import { createConversation } from '../server/db/conversations.js';
import { RepositoryNotFoundError } from '../server/db/errors.js';
import { createOwner } from '../server/db/owners.js';
import { admitRun } from '../server/runs/admission.js';
import { RunAbortRegistry } from '../server/runs/registry.js';
import { DomainValidationError } from '../shared/domain.js';
import { registerObservation } from '../server/evidence/registry.js';
import { validateEvidenceSpan } from '../server/evidence/spans.js';

const databases: DatabaseSync[] = [];
const temporaryDirectories: string[] = [];

function makeHarness(filePath?: string) {
  const database = filePath ? openDatabase({ filePath }) : openInMemoryDatabase();
  databases.push(database);
  const clock = new ManualClock(new Date('2026-11-12T10:00:00.000Z'));
  const owner = createOwner(database, clock);
  const conversation = createConversation(database, clock, {
    ownerId: owner.id,
    namespace: 'live',
  });
  const scope = { ownerId: owner.id, namespace: 'live' as const };
  const admitted = admitRun({
    database,
    clock,
    registry: new RunAbortRegistry(),
    limits: DEFAULT_LIMITS,
  }, {
    ...scope,
    conversationId: conversation.id,
    message: 'Research a plan',
    timezone: 'Asia/Kolkata',
    requestKey: randomUUID(),
  });
  return { database, clock, owner, conversation, scope, run: admitted.run };
}

function observationInput(harness: ReturnType<typeof makeHarness>, overrides: Record<string, unknown> = {}) {
  return {
    runId: harness.run.id,
    queryId: randomUUID(),
    originalUrl: 'https://vendor.example.com/pricing?plan=team&region=eu#monthly',
    title: 'Pricing',
    evidenceText: 'Team costs $20 per seat.',
    provider: 'scripted-test',
    ...overrides,
  };
}

afterEach(() => {
  while (databases.length) {
    const database = databases.pop();
    if (database) {
      try { closeDatabase(database); } catch { /* already closed */ }
    }
  }
  while (temporaryDirectories.length) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('immutable evidence observations', () => {
  it('stores separate captures for one URL and preserves meaningful query parameters', () => {
    const harness = makeHarness();
    const first = registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness, { evidenceText: 'The monthly price is $20.' }),
    );
    harness.clock.advance(60_000);
    const second = registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness, {
        evidenceText: 'The monthly price is $25.',
        providerCaptureAt: '2026-11-12T10:01:00.000Z',
      }),
    );

    expect(second.id).not.toBe(first.id);
    expect(second.contentHash).not.toBe(first.contentHash);
    expect(second.originalUrl).toContain('plan=team&region=eu#monthly');
    expect(second.safeCanonicalUrl).toBe('https://vendor.example.com/pricing?plan=team&region=eu#monthly');
    expect(getObservation(harness.database, harness.scope, first.id)).toEqual(first);
    expect(getObservation(harness.database, harness.scope, second.id)).toEqual(second);
  });

  it('bounds stored text exactly, flags truncation and hashes the stored bytes', () => {
    const harness = makeHarness();
    const evidenceText = `${'a'.repeat(7999)}🧭tail`;
    const saved = registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness, { evidenceText }),
    );
    expect(saved.exactEvidenceText).toBe('a'.repeat(7999));
    expect(saved.exactEvidenceText.length).toBe(7999);
    expect(saved.textTruncated).toBe(true);
    expect(saved.contentHash).toBe(createHash('sha256').update(saved.exactEvidenceText).digest('hex'));
  });

  it('validates quote offsets in UTF-16 units against stored text', () => {
    const harness = makeHarness();
    const text = 'Price 🧭 is $20 per seat';
    const saved = registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness, { evidenceText: text }),
    );
    const start = text.indexOf('$20');
    expect(start).toBe(12); // The compass occupies two UTF-16 code units.
    validateEvidenceSpan(saved, { start, endExclusive: start + 3 }, '$20');
    expect(() => validateEvidenceSpan(saved, { start, endExclusive: start + 3 }, '$25'))
      .toThrowError(DomainValidationError);
    expect(() => validateEvidenceSpan(saved, { start: text.length, endExclusive: text.length + 1 }, 'x'))
      .toThrowError(DomainValidationError);
    expect(() => validateEvidenceSpan(saved, { start: 7, endExclusive: 8 }, ' '))
      .toThrowError(DomainValidationError);
  });

  it('requires exact evidence quotes for effective-date spans before inserting', () => {
    const harness = makeHarness();
    expect(() => registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness, {
        evidenceText: 'New pricing effective 1 March 2027',
        effectiveAt: '2027-03-01T00:00:00.000Z',
        effectiveAtSpan: { start: 22, endExclusive: 34 },
        effectiveAtQuote: '1 March 2027',
      }),
    )).not.toThrow();
    expect(() => registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness, {
        effectiveAt: '2027-03-01T00:00:00.000Z',
        effectiveAtSpan: { start: 0, endExclusive: 2 },
        effectiveAtQuote: 'XX',
      }),
    )).toThrowError(DomainValidationError);
  });

  it.each([
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://user:pass@vendor.example.com/pricing',
    'http://localhost/pricing',
    'http://pricing.local/pricing',
    'http://127.0.0.1/pricing',
    'http://10.2.3.4/pricing',
    'http://[::1]/pricing',
  ])('rejects unsafe URL %s', (originalUrl) => {
    const harness = makeHarness();
    expect(() => registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness, { originalUrl }),
    )).toThrowError(DomainValidationError);
  });

  it('returns the same not-found result for missing and foreign-owner observations', () => {
    const harness = makeHarness();
    const saved = registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness),
    );
    const otherOwner = createOwner(harness.database, harness.clock);
    const otherScope = { ownerId: otherOwner.id, namespace: 'live' as const };
    expect(() => getObservation(harness.database, otherScope, saved.id))
      .toThrowError(RepositoryNotFoundError);
    expect(() => getObservation(harness.database, harness.scope, randomUUID()))
      .toThrowError(RepositoryNotFoundError);
  });

  it('rejects updates and cascades payload deletion when the conversation is deleted', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'minimi-evidence-'));
    temporaryDirectories.push(directory);
    const filePath = path.join(directory, 'evidence.db');
    const harness = makeHarness(filePath);
    const saved = registerObservation(
      harness.database, harness.clock, harness.scope, harness.conversation.id,
      observationInput(harness),
    );
    expect(() => harness.database.prepare(
      'UPDATE source_observations SET exact_evidence_text = ? WHERE id = ?',
    ).run('changed', saved.id)).toThrow(/immutable/);

    closeDatabase(harness.database);
    databases.pop();
    const reopened = openDatabase({ filePath });
    databases.push(reopened);
    expect(getObservation(reopened, harness.scope, saved.id)).toEqual(saved);
    deleteConversationPayload(reopened, harness.clock, harness.scope, harness.conversation.id);
    expect(() => getObservation(reopened, harness.scope, saved.id))
      .toThrowError(RepositoryNotFoundError);
  });
});
