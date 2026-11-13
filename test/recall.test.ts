import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../server/clock.js';
import { DEFAULT_LIMITS } from '../server/config.js';
import { closeDatabase, openInMemoryDatabase } from '../server/db/connection.js';
import {
  createConversation,
  type Scope,
} from '../server/db/conversations.js';
import { addMessage } from '../server/db/messages.js';
import { createOwner } from '../server/db/owners.js';
import { recallHistory } from '../server/memory/recall.js';
import { expandRecallMessages } from '../server/memory/expand.js';
import { admitRun } from '../server/runs/admission.js';
import { RunAbortRegistry } from '../server/runs/registry.js';
import type {
  AnswerState,
  Conversation,
  MessageRole,
  Owner,
} from '../shared/domain.js';

const openDatabases: DatabaseSync[] = [];

afterEach(() => {
  while (openDatabases.length > 0) {
    const database = openDatabases.pop();
    if (database) {
      try {
        closeDatabase(database);
      } catch {
        // Already closed.
      }
    }
  }
});

interface Harness {
  database: DatabaseSync;
  clock: ManualClock;
  owner: Owner;
  conversation: Conversation;
  registry: RunAbortRegistry;
  scope: Scope;
}

function makeHarness(): Harness {
  const database = openInMemoryDatabase();
  openDatabases.push(database);
  const clock = new ManualClock(new Date('2026-11-01T00:00:00.000Z'));
  const owner = createOwner(database, clock);
  const conversation = createConversation(database, clock, {
    ownerId: owner.id,
    namespace: 'live',
    title: 'CRM shortlist',
  });
  clock.advance(11 * 24 * 60 * 60 * 1000 + 4.5 * 60 * 60 * 1000);
  return {
    database,
    clock,
    owner,
    conversation,
    registry: new RunAbortRegistry(),
    scope: { ownerId: owner.id, namespace: 'live' },
  };
}

interface AddOptions {
  conversationId?: string;
  timezone?: string;
  answerState?: AnswerState | null;
  runId?: string | null;
}

function add(
  harness: Harness,
  role: MessageRole,
  text: string,
  createdAt: string,
  options: AddOptions = {},
) {
  return addMessage(harness.database, {
    ...harness.scope,
    conversationId: options.conversationId ?? harness.conversation.id,
    role,
    originalText: text,
    createdAt,
    timezone: options.timezone ?? 'Asia/Kolkata',
    runId: options.runId ?? null,
    answerState:
      options.answerState ?? (role === 'assistant' ? 'complete' : null),
  });
}

function admitCurrent(harness: Harness, message: string) {
  return admitRun(
    {
      database: harness.database,
      registry: harness.registry,
      clock: harness.clock,
      limits: DEFAULT_LIMITS,
    },
    {
      ...harness.scope,
      conversationId: harness.conversation.id,
      message,
      timezone: 'Asia/Kolkata',
      requestKey: `current-${Math.random()}`,
    },
  );
}

function recall(
  harness: Harness,
  questionText: string,
  current?: ReturnType<typeof admitCurrent>,
  timezone = 'Asia/Kolkata',
) {
  return recallHistory(harness.database, {
    ...harness.scope,
    conversationId: harness.conversation.id,
    questionText,
    reference: harness.clock.now(),
    timezone,
    currentQuestionId: current?.question.id ?? null,
    currentRunId: current?.run.id ?? null,
  });
}

describe('dated recall (F06-F09)', () => {
  it('does not substitute recent history for an invalid explicit calendar date', () => {
    const h = makeHarness();
    add(h, 'assistant', 'Recent CRM decision', '2026-11-09T04:30:00.000Z');
    const outcome = recall(h, 'What did we decide on February 30, 2026?');
    expect(outcome.interpretation.unsupportedPhrases.length).toBeGreaterThan(0);
    expect(outcome.result.candidates).toEqual([]);
  });

  it('reports a scan cap as a lower bound rather than a complete count', () => {
    const h = makeHarness();
    for (let index = 0; index < 101; index += 1) {
      add(h, 'assistant', `Saved item ${index}`, '2026-11-09T04:30:00.000Z');
    }
    const outcome = recallHistory(h.database, {
      ...h.scope, conversationId: h.conversation.id,
      questionText: 'What did we discuss on November 9, 2026?',
      reference: h.clock.now(), timezone: 'Asia/Kolkata', limit: 100,
    });
    expect(outcome.result.truncated).toBe(true);
    expect(outcome.result.matchedCount).toBeNull();
    expect(outcome.result.boundedCount).toBe(100);
  });

  it('anchors a relative follow-up to the earlier message date', () => {
    const h = makeHarness();
    add(h, 'assistant', 'Earlier CRM decision', '2026-11-09T04:30:00.000Z');
    add(h, 'user', 'What did we discuss yesterday?', '2026-11-10T04:30:00.000Z');
    const outcome = recall(h, 'What did we decide on that date?');
    expect(outcome.interpretation.candidates[0]?.startLocalDate).toBe('2026-11-09');
  });

  it('does not expand a candidate from another owner', () => {
    const h = makeHarness();
    const other = createOwner(h.database, h.clock);
    const conversation = createConversation(h.database, h.clock, {
      ownerId: other.id, namespace: 'live', title: 'Other',
    });
    const foreign = addMessage(h.database, {
      ownerId: other.id, namespace: 'live', conversationId: conversation.id,
      role: 'assistant', originalText: 'Private text', timezone: 'UTC',
      createdAt: h.clock.now().toISOString(), answerState: 'complete',
    });
    expect(expandRecallMessages(h.database, h.scope, [foreign])).toEqual([]);
  });

  it('excludes assistant messages without a completed answer state', () => {
    const h = makeHarness();
    addMessage(h.database, {
      ...h.scope, conversationId: h.conversation.id, role: 'assistant',
      originalText: 'Unfinished CRM decision', timezone: 'UTC',
      createdAt: '2026-11-09T04:30:00.000Z', answerState: null,
    });
    expect(recall(h, 'CRM decision').result.candidates).toEqual([]);
  });

  it('returns clarification candidates when an ambiguous weekday matches two discussions (F06)', () => {
    const harness = makeHarness();
    const first = add(
      harness,
      'assistant',
      'CRM shortlist: Aster, Birch, Cedar, Dune and Elm.',
      '2026-11-03T04:30:00.000Z',
    );
    const second = add(
      harness,
      'assistant',
      'CRM shortlist: Aster, Birch, Cedar, Dune and Elm.',
      '2026-11-10T04:30:00.000Z',
    );

    const outcome = recall(
      harness,
      'What did we decide about the CRM shortlist on Tuesday?',
    );

    expect(outcome.interpretation.ambiguous).toBe(true);
    expect(outcome.clarificationRequired).toBe(true);
    expect(outcome.clarificationCandidates).toHaveLength(2);
    expect(
      outcome.clarificationCandidates
        .flatMap((candidate) => candidate.messageIds)
        .sort(),
    ).toEqual([first.id, second.id].sort());
    expect(outcome.result.ambiguousBaselineIds.sort()).toEqual(
      [first.id, second.id].sort(),
    );
    expect(
      outcome.result.candidates.map((candidate) => candidate.turnId).sort(),
    ).toEqual([first.id, second.id].sort());
  });

  it('retrieves the explicit date rather than today (F07)', () => {
    const harness = makeHarness();
    const onDate = add(
      harness,
      'assistant',
      'Aster pricing was twenty dollars per seat.',
      '2026-11-03T04:30:00.000Z',
    );
    const today = add(
      harness,
      'assistant',
      'Aster pricing is twenty four dollars per seat today.',
      '2026-11-12T04:30:00.000Z',
    );

    const outcome = recall(harness, 'On 3 November, is it still right today?');

    expect(outcome.result.interpretation.windows).toEqual([
      { start: '2026-11-03', end: '2026-11-03', timezone: 'Asia/Kolkata' },
    ]);
    expect(outcome.interpretation.comparison?.startLocalDate).toBe('2026-11-12');
    expect(outcome.result.candidates.map((candidate) => candidate.turnId)).toEqual([
      onDate.id,
    ]);
    expect(outcome.result.candidates.map((candidate) => candidate.turnId)).not.toContain(
      today.id,
    );
    expect(outcome.clarificationRequired).toBe(false);
  });

  it('uses the local-day UTC window rather than a UTC date (F08)', () => {
    const harness = makeHarness();
    const beforeMidnight = add(
      harness,
      'user',
      'Question just after local midnight.',
      '2026-11-02T20:00:00.000Z',
    );
    const nextLocalDay = add(
      harness,
      'user',
      'Question after the next local midnight.',
      '2026-11-03T19:00:00.000Z',
    );

    const outcome = recall(harness, 'What did I ask on 3 November?');

    const ids = outcome.result.candidates.map((candidate) => candidate.turnId);
    expect(ids).toContain(beforeMidnight.id);
    expect(ids).not.toContain(nextLocalDay.id);
  });

  it('uses New York calendar boundaries across the DST fall-back (F09)', () => {
    const harness = makeHarness();
    const included = add(
      harness,
      'user',
      'A New York first-of-November question.',
      '2026-11-01T20:00:00.000Z',
      { timezone: 'America/New_York' },
    );
    const excluded = add(
      harness,
      'user',
      'A New York second-of-November question.',
      '2026-11-02T06:00:00.000Z',
      { timezone: 'America/New_York' },
    );

    const outcome = recall(
      harness,
      'What did I ask on 1 November 2026?',
      undefined,
      'America/New_York',
    );

    const ids = outcome.result.candidates.map((candidate) => candidate.turnId);
    expect(ids).toContain(included.id);
    expect(ids).not.toContain(excluded.id);
    expect(outcome.result.interpretation.windows).toEqual([
      { start: '2026-11-01', end: '2026-11-01', timezone: 'America/New_York' },
    ]);
  });
});

describe('raw-history recall and expansion (F10-F14)', () => {
  it('recovers a recent original set without an extracted index (F10)', () => {
    const harness = makeHarness();
    const original = add(
      harness,
      'assistant',
      'I recommend Aster, Birch, Cedar, Dune and Elm for a 20-seat team.',
      '2026-11-09T04:30:00.000Z',
    );
    const current = admitCurrent(harness, 'What about their pricing?');

    const outcome = recall(harness, 'What about their pricing?', current);

    expect(outcome.result.candidates.map((candidate) => candidate.turnId)).toContain(
      original.id,
    );
    expect(outcome.result.missingHistoryReason).toBeNull();
    expect(outcome.pendingIndex).toBe(false);
    expect(outcome.expanded.some((turn) => turn.text.includes('Elm'))).toBe(true);
    expect(
      outcome.expanded.some((turn) =>
        turn.text.includes('What about their pricing?'),
      ),
    ).toBe(false);
  });

  it('does not search when the date phrase is unsupported', () => {
    const harness = makeHarness();
    add(
      harness,
      'assistant',
      'CRM shortlist: Aster, Birch, Cedar, Dune and Elm.',
      '2026-11-09T04:30:00.000Z',
    );

    const outcome = recall(harness, 'sometime last week');

    expect(outcome.result.candidates).toEqual([]);
    expect(outcome.clarificationRequired).toBe(true);
    expect(outcome.result.missingHistoryReason).toMatch(/unsupported date phrase/);
  });

  it('keeps a later selection distinct from the earlier proposal (F11)', () => {
    const harness = makeHarness();
    const proposal = add(
      harness,
      'assistant',
      'Proposed five CRM tools: Aster, Birch, Cedar, Dune and Elm for 20 seats.',
      '2026-11-09T04:30:00.000Z',
    );
    const selection = add(
      harness,
      'user',
      'Let us select Birch and Cedar and change the team to 25.',
      '2026-11-10T04:30:00.000Z',
    );

    const outcome = recall(harness, 'What did we choose?');
    const ids = outcome.result.candidates.map((candidate) => candidate.turnId);

    expect(ids).toContain(proposal.id);
    expect(ids).toContain(selection.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(outcome.expanded.some((turn) => turn.text.includes('Aster'))).toBe(true);
    expect(outcome.expanded.some((turn) => turn.text.includes('25'))).toBe(true);
  });

  it('resolves "that date" from the previous dated question and returns both roles (F12)', () => {
    const harness = makeHarness();
    const question = add(
      harness,
      'user',
      'On 3 November, which CRM shortlist did we discuss?',
      '2026-11-03T04:30:00.000Z',
    );
    const answer = add(
      harness,
      'assistant',
      'We discussed Aster, Birch, Cedar, Dune and Elm.',
      '2026-11-03T04:35:00.000Z',
    );
    const current = admitCurrent(harness, 'What did I ask on that date?');

    const outcome = recall(harness, 'What did I ask on that date?', current);

    expect(outcome.result.interpretation.windows).toEqual([
      { start: '2026-11-03', end: '2026-11-03', timezone: 'Asia/Kolkata' },
    ]);
    expect(
      outcome.result.candidates.map((candidate) => candidate.turnId).sort(),
    ).toEqual([question.id, answer.id].sort());
    expect(
      outcome.expanded.some((turn) =>
        turn.messages.some((message) => message.role === 'user'),
      ),
    ).toBe(true);
    expect(
      outcome.expanded.some((turn) =>
        turn.messages.some((message) => message.role === 'assistant'),
      ),
    ).toBe(true);
  });

  it('reports missing saved history without inventing a baseline (F13)', () => {
    const harness = makeHarness();
    const current = admitCurrent(
      harness,
      'What did we decide about the CRM shortlist?',
    );

    const outcome = recall(
      harness,
      'What did we decide about the CRM shortlist?',
      current,
    );

    expect(outcome.result.candidates).toEqual([]);
    expect(outcome.result.includedCount).toBe(0);
    expect(outcome.result.missingHistoryReason).toMatch(/No saved messages/);
    expect(outcome.result.chosenBaselineIds).toEqual([]);
    expect(outcome.expanded).toEqual([]);
  });

  it('expands a long original answer without dropping the fifth member (F14)', () => {
    const harness = makeHarness();
    const longText = `CRM shortlist: ${'Aster, Birch, Cedar and Dune. '.repeat(
      200,
    )}The fifth member is Elm.`;
    const longAnswer = add(
      harness,
      'assistant',
      longText,
      '2026-11-09T04:30:00.000Z',
    );

    const outcome = recall(harness, 'CRM shortlist');
    const expanded = outcome.expanded.find((turn) =>
      turn.messageIds.includes(longAnswer.id),
    );

    expect(outcome.result.candidates.map((candidate) => candidate.turnId)).toContain(
      longAnswer.id,
    );
    expect(outcome.result.truncated).toBe(false);
    expect(expanded?.truncated).toBe(false);
    expect(expanded?.text).toBe(longText);
    expect(expanded?.text).toContain('Elm');
    expect(expanded?.text.length).toBeGreaterThan(2000);
  });

  it('keeps owner and namespace scopes isolated', () => {
    const harness = makeHarness();
    const otherOwner = createOwner(harness.database, harness.clock);
    const otherConversation = createConversation(harness.database, harness.clock, {
      ownerId: otherOwner.id,
      namespace: 'live',
      title: 'Other owner',
    });
    addMessage(harness.database, {
      ownerId: otherOwner.id,
      namespace: 'live',
      conversationId: otherConversation.id,
      role: 'assistant',
      originalText: 'Aster secret CRM shortlist.',
      createdAt: '2026-11-09T04:30:00.000Z',
      timezone: 'Asia/Kolkata',
      answerState: 'complete',
    });

    const outcome = recall(harness, 'CRM shortlist');

    expect(outcome.result.candidates).toEqual([]);
    expect(outcome.result.missingHistoryReason).toMatch(/No saved messages/);
  });

  it('returns deterministic candidate order', () => {
    const harness = makeHarness();
    add(
      harness,
      'assistant',
      'CRM shortlist: Aster, Birch, Cedar, Dune and Elm.',
      '2026-11-09T04:30:00.000Z',
    );
    add(
      harness,
      'assistant',
      'CRM shortlist follow-up: Aster pricing changed.',
      '2026-11-10T04:30:00.000Z',
    );

    const first = recall(harness, 'CRM shortlist');
    const second = recall(harness, 'CRM shortlist');

    expect(first.result.candidates).toEqual(second.result.candidates);
    expect(first.result.candidates.length).toBeGreaterThan(0);
  });
});
