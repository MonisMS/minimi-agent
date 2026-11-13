import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { ManualClock } from '../server/clock.js';
import { DEFAULT_LIMITS } from '../server/config.js';
import { openInMemoryDatabase, closeDatabase } from '../server/db/connection.js';
import { appendDecisionSnapshot, getDecisionSnapshot, listDecisionSnapshots } from '../server/db/decisions.js';
import { createConversation } from '../server/db/conversations.js';
import { addMessage } from '../server/db/messages.js';
import { createOwner } from '../server/db/owners.js';
import { resolveDecisionBaseline } from '../server/memory/baseline.js';
import { interpretDecisionHistory } from '../server/memory/interpret.js';
import { BudgetedModelTransport, RunBudget } from '../server/runs/budget.js';
import { ScriptedModelTransport, completedModelResponse } from './helpers/scripted.js';

const databases: DatabaseSync[] = [];

function setup() {
  const database = openInMemoryDatabase();
  databases.push(database);
  const clock = new ManualClock(new Date('2026-11-12T10:00:00.000Z'));
  const owner = createOwner(database, clock);
  const conversation = createConversation(database, clock, {
    ownerId: owner.id,
    namespace: 'live',
  });
  return {
    database,
    clock,
    scope: { ownerId: owner.id, namespace: 'live' as const },
    conversation,
  };
}

afterEach(() => {
  while (databases.length) {
    try { closeDatabase(databases.pop()!); } catch { /* already closed */ }
  }
});

function span(text: string, quote: string) {
  const start = text.indexOf(quote);
  if (start < 0) throw new Error(`Quote not found: ${quote}`);
  return { start, endExclusive: start + quote.length, quote };
}

function makeExtraction(messageId: string, text: string, input: {
  state: 'assistant_proposed' | 'user_shortlisted' | 'user_selected';
  names: string[];
  constraint?: string;
  teamSize?: number | null;
}) {
  return {
    decisions: [{
      originalMessageId: messageId,
      state: input.state,
      originalSpan: span(text, text),
      members: input.names.map((name) => ({
        vendor: name,
        product: null,
        plan: null,
        aliases: [],
        sourceSpan: span(text, name),
      })),
      constraints: {
        teamSize: input.teamSize ?? null,
        budget: null,
        region: null,
        sourceSpans: input.constraint ? [span(text, input.constraint)] : [],
      },
    }],
  };
}

function modelWith(input: unknown): ScriptedModelTransport {
  return new ScriptedModelTransport().enqueue(
    completedModelResponse(JSON.stringify(input)),
  );
}

describe('historical decision baselines', () => {
  it('extracts and persists a complete five-member proposal on demand in one counted call (F10)', async () => {
    const harness = setup();
    const text = 'I recommend Aster, Birch, Cedar, Dune and Elm for a 20-seat team.';
    const original = addMessage(harness.database, {
      ...harness.scope,
      conversationId: harness.conversation.id,
      role: 'assistant',
      originalText: text,
      createdAt: '2026-11-09T04:30:00.000Z',
      timezone: 'Asia/Kolkata',
      answerState: 'complete',
    });
    const scripted = modelWith(makeExtraction(original.id, text, {
      state: 'assistant_proposed',
      names: ['Aster', 'Birch', 'Cedar', 'Dune', 'Elm'],
      constraint: '20-seat team',
      teamSize: 20,
    }));
    const budget = new RunBudget({ limits: DEFAULT_LIMITS, clock: harness.clock });
    const outcome = await interpretDecisionHistory({
      ...harness.scope,
      database: harness.database,
      conversationId: harness.conversation.id,
      originals: [original],
      model: new BudgetedModelTransport(scripted, budget),
      modelName: 'test-model',
      signal: new AbortController().signal,
      validatedAt: '2026-11-12T10:00:00.000Z',
    });

    expect(scripted.callCount).toBe(1);
    expect(budget.usage().modelCalls).toBe(1);
    expect(outcome.extractionAttempted).toBe(true);
    expect(outcome.snapshots).toHaveLength(1);
    expect(outcome.snapshots[0]?.members.map((member) => member.vendor)).toEqual([
      'Aster', 'Birch', 'Cedar', 'Dune', 'Elm',
    ]);
    expect(outcome.snapshots[0]?.constraints.teamSize).toBe(20);
    expect(resolveDecisionBaseline(outcome.snapshots).status).toBe('selected');
  });

  it('keeps the proposal and explicit user selection as linked immutable revisions (F11)', async () => {
    const harness = setup();
    const proposalText = 'Proposed five CRM tools: Aster, Birch, Cedar, Dune and Elm for 20 seats.';
    const proposal = addMessage(harness.database, {
      ...harness.scope, conversationId: harness.conversation.id, role: 'assistant',
      originalText: proposalText, createdAt: '2026-11-09T04:30:00.000Z',
      timezone: 'Asia/Kolkata', answerState: 'complete',
    });
    const selectionText = 'Let us select Birch and Cedar for a 25-seat team.';
    const selection = addMessage(harness.database, {
      ...harness.scope, conversationId: harness.conversation.id, role: 'user',
      originalText: selectionText, createdAt: '2026-11-10T04:30:00.000Z',
      timezone: 'Asia/Kolkata',
    });
    const extractionModel = new ScriptedModelTransport()
      .enqueue(completedModelResponse(JSON.stringify(makeExtraction(proposal.id, proposalText, {
      state: 'assistant_proposed', names: ['Aster', 'Birch', 'Cedar', 'Dune', 'Elm'],
      constraint: '20 seats', teamSize: 20,
    }))))
      .enqueue(completedModelResponse(JSON.stringify(makeExtraction(selection.id, selectionText, {
      state: 'user_selected', names: ['Birch', 'Cedar'],
      constraint: '25-seat team', teamSize: 25,
    }))));
    const budget = new RunBudget({ limits: DEFAULT_LIMITS, clock: harness.clock });
    const shared = new BudgetedModelTransport(extractionModel, budget);
    await interpretDecisionHistory({
      ...harness.scope, database: harness.database, conversationId: harness.conversation.id,
      originals: [proposal], model: shared, modelName: 'test-model',
      signal: new AbortController().signal, validatedAt: '2026-11-12T10:00:00.000Z',
    });
    await interpretDecisionHistory({
      ...harness.scope, database: harness.database, conversationId: harness.conversation.id,
      originals: [proposal, selection], model: shared, modelName: 'test-model',
      signal: new AbortController().signal, validatedAt: '2026-11-12T10:00:00.000Z',
    });

    const snapshots = listDecisionSnapshots(harness.database, harness.scope, harness.conversation.id);
    expect(snapshots.map((snapshot) => snapshot.state)).toEqual(['assistant_proposed', 'user_selected']);
    expect(snapshots.map((snapshot) => snapshot.revision)).toEqual([1, 2]);
    expect(snapshots[1]?.supersedesId).toBe(snapshots[0]?.id);
    expect(snapshots[0]?.members).toHaveLength(5);
    expect(snapshots[0]?.constraints.teamSize).toBe(20);
    expect(snapshots[1]?.members.map((member) => member.vendor)).toEqual(['Birch', 'Cedar']);
    expect(snapshots[1]?.constraints.teamSize).toBe(25);
    expect(extractionModel.callCount).toBe(2);
    expect(budget.usage().modelCalls).toBe(2);
  });

  it('rejects unsupported spans and isolates snapshots by owner and namespace', () => {
    const harness = setup();
    const text = 'We selected Birch for a 25-seat team.';
    const original = addMessage(harness.database, {
      ...harness.scope, conversationId: harness.conversation.id, role: 'user',
      originalText: text, createdAt: '2026-11-10T04:30:00.000Z', timezone: 'UTC',
    });
    const snapshot = appendDecisionSnapshot(harness.database, {
      ...harness.scope,
      conversationId: harness.conversation.id,
      originalMessageId: original.id,
      originalSpan: { start: 0, endExclusive: text.length },
      state: 'user_selected',
      members: [{
        memberId: `${original.id}:1`, vendor: 'Birch', product: null, plan: null,
        aliases: [], sourceSpan: span(text, 'Birch'),
      }],
      constraints: { teamSize: 25, budget: null, region: null, sourceSpans: [span(text, '25-seat team')] },
      validatedAt: '2026-11-12T10:00:00.000Z',
    });
    expect(getDecisionSnapshot(harness.database, harness.scope, snapshot.id)).toEqual(snapshot);
    expect(getDecisionSnapshot(harness.database, { ...harness.scope, ownerId: randomUUID() }, snapshot.id)).toBeNull();
    expect(() => appendDecisionSnapshot(harness.database, {
      ...harness.scope,
      conversationId: harness.conversation.id,
      originalMessageId: original.id,
      originalSpan: { start: 0, endExclusive: text.length },
      state: 'user_selected',
      members: [{
        memberId: `${original.id}:2`, vendor: 'Aster', product: null, plan: null,
        aliases: [], sourceSpan: span(text, 'Birch'),
      }],
      constraints: { teamSize: 25, budget: null, region: null, sourceSpans: [span(text, '25-seat team')] },
      validatedAt: null,
    })).toThrow(/not supported/);
  });

  it('requests clarification when independent complete baselines remain plausible', () => {
    const base = {
      id: randomUUID(), originalMessageId: randomUUID(), originalSpan: { start: 0, endExclusive: 1 },
      state: 'assistant_proposed' as const, revision: 1, supersedesId: null,
      members: [], constraints: { teamSize: null, budget: null, region: null, sourceSpans: [] },
      validatedAt: null,
    };
    const resolution = resolveDecisionBaseline([
      { ...base, id: randomUUID() },
      { ...base, id: randomUUID(), originalMessageId: randomUUID() },
    ]);
    expect(resolution.status).toBe('clarification_required');
    expect(resolution.candidates).toHaveLength(2);
    expect(resolveDecisionBaseline([
      { ...base, id: randomUUID() },
      { ...base, id: randomUUID(), originalMessageId: 'later-decision' },
    ], { candidateOriginalMessageIds: [base.originalMessageId] }).status).toBe('selected');
  });

  it('leaves missing originals missing without spending an extraction call (F13)', async () => {
    const harness = setup();
    const scripted = new ScriptedModelTransport();
    const outcome = await interpretDecisionHistory({
      ...harness.scope,
      database: harness.database,
      conversationId: harness.conversation.id,
      originals: [],
      model: scripted,
      modelName: 'test-model',
      signal: new AbortController().signal,
      validatedAt: '2026-11-12T10:00:00.000Z',
    });
    expect(outcome).toEqual({ snapshots: [], extractionAttempted: false, error: 'no_relevant_originals' });
    expect(scripted.callCount).toBe(0);
  });

  it('does not persist model output whose cited member quote differs from the original', async () => {
    const harness = setup();
    const text = 'I recommend Aster, Birch, Cedar, Dune and Elm for a 20-seat team.';
    const original = addMessage(harness.database, {
      ...harness.scope, conversationId: harness.conversation.id, role: 'assistant',
      originalText: text, createdAt: '2026-11-09T04:30:00.000Z',
      timezone: 'Asia/Kolkata', answerState: 'complete',
    });
    const malformed = makeExtraction(original.id, text, {
      state: 'assistant_proposed', names: ['Aster', 'Birch', 'Cedar', 'Dune', 'Elm'],
      constraint: '20-seat team', teamSize: 20,
    });
    malformed.decisions[0]!.members[0]!.sourceSpan.quote = 'Aster invented';
    const scripted = modelWith(malformed);
    const outcome = await interpretDecisionHistory({
      ...harness.scope, database: harness.database, conversationId: harness.conversation.id,
      originals: [original], model: scripted, modelName: 'test-model',
      signal: new AbortController().signal, validatedAt: '2026-11-12T10:00:00.000Z',
    });

    expect(outcome.error).toBe('invalid_extraction');
    expect(outcome.snapshots).toEqual([]);
    expect(listDecisionSnapshots(harness.database, harness.scope, harness.conversation.id)).toEqual([]);
  });
});
