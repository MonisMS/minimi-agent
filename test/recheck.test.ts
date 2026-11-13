import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { ModelRequest, ModelResponse, ModelTransport, SearchProvider, SearchProviderRequest, SearchProviderResult, SourceObservation, VerificationResult } from '../shared/domain.js';
import { createChatExecutor } from '../server/agent/chat.js';
import { ManualClock } from '../server/clock.js';
import { DEFAULT_LIMITS, parseConfig } from '../server/config.js';
import { appendDecisionSnapshot } from '../server/db/decisions.js';
import { createApp } from '../server/http/app.js';
import { openInMemoryDatabase } from '../server/db/connection.js';
import { createConversation, type Scope } from '../server/db/conversations.js';
import { insertObservation } from '../server/db/evidence.js';
import { addMessage } from '../server/db/messages.js';
import { createOwner } from '../server/db/owners.js';
import { getVerificationResult } from '../server/db/verifications.js';
import { getMessage } from '../server/db/messages.js';
import { admitRun } from '../server/runs/admission.js';
import { RunEventWriter } from '../server/runs/events.js';
import { createRunExecution } from '../server/runs/executor.js';
import { RunAbortRegistry } from '../server/runs/registry.js';
import { cancelRun } from '../server/runs/lifecycle.js';
import { makeSearchOutcome } from './helpers/scripted.js';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const databases: DatabaseSync[] = [];
const writers: RunEventWriter[] = [];
afterEach(() => {
  while (writers.length) writers.pop()?.close();
  while (databases.length) databases.pop()?.close();
});

const names = ['Aster', 'Birch', 'Cedar', 'Dune', 'Elm'];
const oldAmounts: Record<string, string> = { Aster: '20', Birch: '20', Cedar: '30', Dune: '40', Elm: '18' };
const currentAmounts: Record<string, string> = { Aster: '24', Birch: '25', Cedar: '30', Dune: '45' };

function setup() {
  const database = openInMemoryDatabase(); databases.push(database);
  const clock = new ManualClock(new Date('2026-11-12T10:00:00.000Z'));
  const owner = createOwner(database, clock);
  const scope: Scope = { ownerId: owner.id, namespace: 'live' };
  const conversation = createConversation(database, clock, { ...scope, title: 'CRM shortlist' });
  const registry = new RunAbortRegistry();
  const events = new RunEventWriter({ database, clock, deltaFlushMs: 1 }); writers.push(events);
  return { database, clock, scope, conversation, registry, events, runId: '' };
}

function source(input: Partial<SourceObservation> & Pick<SourceObservation, 'id' | 'runId' | 'queryId' | 'exactEvidenceText'>): SourceObservation {
  const { id, runId, queryId, exactEvidenceText, ...rest } = input;
  return {
    id, ownerId: input.ownerId!, namespace: 'live', runId, queryId,
    originalUrl: 'https://vendor.example/pricing', safeCanonicalUrl: 'https://vendor.example/pricing', title: 'Official pricing',
    exactEvidenceText, contentHash: 'a'.repeat(64), textTruncated: false,
    retrievedAt: '2026-11-12T10:00:00.000Z', providerCaptureAt: null, publishedAt: null,
    effectiveAt: null, effectiveAtSpan: null, provider: 'scripted', freshnessRequested: 'live', freshnessMetadata: null,
    ...rest,
  };
}

function priceExtraction(request: ModelRequest): string {
  const payload = JSON.parse(request.input.at(-1)!.content) as {
    baseline: { observations: Array<{ id: string; text: string }> };
    members: Array<{ memberId: string; vendor: string | null; product: string | null; plan: string | null }>;
    currentObservations: Array<{ id: string; text: string; purpose: string; effectiveAt: string | null; effectiveAtSpan: { start: number; endExclusive: number } | null }>;
  };
  const memberByName = new Map(payload.members.map((member) => [member.vendor!, member]));
  const field = (raw: { id: string; text: string }, isCurrent: boolean) => {
    const name = names.find((candidate) => raw.text.includes(candidate));
    const member = name ? memberByName.get(name) : undefined;
    if (!member) return null;
    const amount = raw.text.match(/\$(\d+)/)?.[1];
    if (!amount) return null;
    const commitment = name === 'Birch' && isCurrent && raw.text.includes('monthly_flexible') ? 'monthly_flexible' : 'annual';
    return {
      memberId: member.memberId, sourceObservationId: raw.id, vendor: name, product: 'CRM', plan: 'Pro', amountDecimal: amount,
      currency: 'USD', unit: 'seat', quotedInterval: 'month', commitment, quantity: 20, minimumQuantity: 1,
      region: 'US', taxBasis: null, promotion: 'none', includedUsage: 'Standard',
      observedAt: null, effectiveAt: null, observedAtSpan: null, effectiveAtSpan: null,
    };
  };
  const baselinePrices = payload.baseline.observations.map((item) => field(item, false)).filter(Boolean);
  const currentPrices = payload.currentObservations.filter((item) => item.purpose === 'current_state').map((item) => {
    const extracted = field(item, true);
    return extracted && item.effectiveAt && item.effectiveAtSpan
      ? { ...extracted, effectiveAt: item.effectiveAt, effectiveAtSpan: item.effectiveAtSpan }
      : extracted;
  }).filter(Boolean);
  const historical = payload.currentObservations.find((item) => item.purpose === 'dated_change' && item.text.includes('Dune CRM Pro historical USD $45'));
  const historicalPrice = historical
    ? { ...field({ id: historical.id, text: historical.text }, true)!, observedAt: '2026-11-09T00:00:00.000Z',
      observedAtSpan: { start: historical.text.indexOf('9 November 2026'), endExclusive: historical.text.indexOf('9 November 2026') + '9 November 2026'.length } }
    : null;
  const allPrices = [...baselinePrices, ...currentPrices, ...(historicalPrice ? [historicalPrice] : [])];
  const sourceTexts = new Map([...payload.baseline.observations, ...payload.currentObservations].map((item) => [item.id, item.text]));
  const candidateFields = allPrices.flatMap((item) => {
    const text = sourceTexts.get(item!.sourceObservationId)!;
    const keys = ['vendor', 'product', 'plan', 'amountDecimal', 'currency', 'unit', 'quotedInterval', 'commitment',
      'quantity', 'minimumQuantity', 'region', 'taxBasis', 'promotion', 'includedUsage'] as const;
    const fields = keys.flatMap((key) => {
      const value = item![key];
      if (value === null) return [];
      const quote = String(value);
      const start = text.indexOf(quote);
      return [{ field: `${item!.memberId}.${key}`, proposedValue: quote, observationId: item!.sourceObservationId,
        supportSpan: { start, endExclusive: start + quote.length }, interpretationNotes: null }];
    });
    if (!item!.observedAt || !item!.observedAtSpan) return fields;
    const dateStart = item!.observedAtSpan.start;
    return [...fields, { field: `${item!.memberId}.observedAt`, proposedValue: text.slice(dateStart, item!.observedAtSpan.endExclusive),
      observationId: item!.sourceObservationId, supportSpan: item!.observedAtSpan, interpretationNotes: null }];
  });
  return JSON.stringify({ baselinePrices, currentPrices, historicalPrices: historicalPrice ? [historicalPrice] : [], candidateFields });
}

class ExtractingModel implements ModelTransport {
  requests: ModelRequest[] = [];
  constructor(private readonly onCall?: () => void) {}
  async respond(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    options.signal.throwIfAborted(); this.requests.push(request); this.onCall?.();
    const text = priceExtraction(request);
    return { status: 'completed', text, toolCalls: [], usage: { inputTokens: 20, outputTokens: 10 }, refusal: null, incompleteReason: null, errorCode: null };
  }
}

function sourceProvider(h: ReturnType<typeof setup>): SearchProvider {
  return {
    async search(request: SearchProviderRequest, { signal }): Promise<SearchProviderResult> {
      signal.throwIfAborted();
      const observations: SourceObservation[] = [];
      const outcomes = request.queries.map((query) => {
        const name = names.find((candidate) => query.text.includes(candidate));
        if (!name || name === 'Elm') return makeSearchOutcome({ queryId: query.queryId, status: 'empty', observationIds: [] });
        const isDated = query.purpose === 'dated_change';
        let text = `${name} CRM Pro USD $${currentAmounts[name]} monthly per seat, annual commitment, 20 seats minimum 1, US, promotion none, Standard included.`;
        if (name === 'Birch' && !isDated) text = text.replace('annual commitment', 'monthly_flexible commitment');
        let effectiveAt: string | null = null;
        let effectiveAtSpan: SourceObservation['effectiveAtSpan'] = null;
        if (name === 'Aster') {
          text = 'Aster CRM Pro USD $24 monthly per seat, annual commitment, 20 seats minimum 1, US, promotion none, Standard included. Effective 11 November 2026.';
          const start = text.indexOf('11 November 2026');
          effectiveAt = '2026-11-11T00:00:00.000Z'; effectiveAtSpan = { start, endExclusive: start + '11 November 2026'.length };
        }
        if (isDated && name === 'Dune') text = 'Dune CRM Pro historical USD $45 monthly per seat, annual commitment, 20 seats minimum 1, US, promotion none, Standard included on 9 November 2026';
        const observation = source({ id: randomUUID(), ownerId: h.scope.ownerId, namespace: 'live', runId: h.runId,
          queryId: query.queryId, exactEvidenceText: text, effectiveAt, effectiveAtSpan });
        insertObservation(h.database, h.scope, { ...observation, conversationId: h.conversation.id });
        observations.push(observation);
        return makeSearchOutcome({ queryId: query.queryId, status: 'succeeded', observationIds: [observation.id] });
      });
      return { outcomes, observations };
    },
  };
}

function addBaseline(h: ReturnType<typeof setup>) {
  const earlierQuestion = addMessage(h.database, { ...h.scope, conversationId: h.conversation.id, role: 'user',
    originalText: 'Compare five CRM vendors.', createdAt: '2026-11-09T04:30:00.000Z', timezone: 'Asia/Kolkata' });
  const previous = admitRun({ database: h.database, registry: h.registry, clock: h.clock, limits: DEFAULT_LIMITS }, {
    ...h.scope, conversationId: h.conversation.id, questionId: earlierQuestion.id, timezone: 'Asia/Kolkata', requestKey: 'old-run',
  });
  h.runId = previous.run.id;
  const originalText = 'Proposed Monday shortlist: Aster Pro, Birch Pro, Cedar Pro, Dune Pro, Elm Pro for 20 seats.';
  const oldSources = names.map((name) => source({ id: randomUUID(), ownerId: h.scope.ownerId, namespace: 'live', runId: previous.run.id,
    queryId: randomUUID(), exactEvidenceText: `${name} CRM Pro USD $${oldAmounts[name]} monthly per seat, annual commitment, 20 seats minimum 1, US, promotion none, Standard included.` }));
  oldSources.forEach((observation) => insertObservation(h.database, h.scope, { ...observation, conversationId: h.conversation.id }));
  const original = addMessage(h.database, { ...h.scope, id: previous.run.answerId!, conversationId: h.conversation.id, role: 'assistant',
    originalText, createdAt: '2026-11-09T04:31:00.000Z', timezone: 'Asia/Kolkata', runId: previous.run.id,
    answerState: 'complete', sourceObservationIds: oldSources.map((item) => item.id) });
  const members = names.map((name) => {
    const start = originalText.indexOf(name);
    return { memberId: `${original.id}:${names.indexOf(name) + 1}`, vendor: name, product: 'CRM', plan: 'Pro', aliases: [],
      sourceSpan: { start, endExclusive: start + `${name} Pro`.length } };
  });
  const seatsStart = originalText.indexOf('20 seats');
  const baseline = appendDecisionSnapshot(h.database, {
    ...h.scope, conversationId: h.conversation.id, originalMessageId: original.id,
    originalSpan: { start: 0, endExclusive: originalText.length }, state: 'assistant_proposed', members,
    constraints: { teamSize: 20, budget: null, region: null, sourceSpans: [{ start: seatsStart, endExclusive: seatsStart + '20 seats'.length }] }, validatedAt: null,
  });
  cancelRun(h.database, h.clock, h.scope, previous.run.id, undefined, h.registry);
  return { baseline, oldSources };
}

describe('historical recheck coordinator', () => {
  it('runs F01–F05 through search, extraction, comparison, and atomic result persistence', async () => {
    const h = setup();
    const { baseline } = addBaseline(h);
    const model = new ExtractingModel();
    const admitted = admitRun({ database: h.database, registry: h.registry, clock: h.clock, limits: DEFAULT_LIMITS }, {
      ...h.scope, conversationId: h.conversation.id, message: 'Recheck our CRM shortlist.', timezone: 'Asia/Kolkata',
      requestKey: 'recheck-f01-f05', baselineId: baseline.id,
    });
    const execution = createRunExecution({ database: h.database, clock: h.clock, scope: h.scope, run: admitted.run,
      question: admitted.question, signal: h.registry.register(admitted.run.id).signal, events: h.events, registry: h.registry });
    await createChatExecutor({ database: h.database, clock: h.clock, config: parseConfig({ OPENAI_API_KEY: 'scripted', OPENAI_MODEL: 'scripted' }),
      model, searchProvider: sourceProvider(Object.assign(h, { runId: admitted.run.id })) }).execute(execution);

    const saved = h.database.prepare('SELECT result_id FROM runs WHERE id = ?').get(admitted.run.id) as { result_id: string | null };
    expect(saved.result_id).toBeTruthy();
    const result = getVerificationResult(h.database, h.scope, saved.result_id!);
    expect(getVerificationResult(h.database, { ...h.scope, ownerId: randomUUID() }, saved.result_id!)).toBeNull();
    expect(result?.members).toHaveLength(5);
    expect(result?.searchCounts).toMatchObject({ attempted: 10, succeeded: 8, empty: 2, failed: 0 });
    expect(result?.coverageCounts).toEqual({ requested: 5, attempted: 5, resolved: 3, unresolved: 2 });
    const byVendor = new Map(result?.members.map((member) => [member.vendor!, member.memberId]));
    const verdicts = new Map(result?.outcomes.map((outcome) => [result?.members.find((member) => member.memberId === result.obligations.find((row) => row.id === outcome.obligationId)?.memberId)?.vendor, outcome]));
    expect(verdicts.get('Aster')?.verdict).toBe('confirmed_change');
    expect(verdicts.get('Aster')?.priceTotals).toMatchObject({
      baseline: { monthlyEquivalent: '400.00', annualCommitment: '4800.00' },
      current: { monthlyEquivalent: '480.00', annualCommitment: '5760.00' }, monthlyDelta: '80.00',
    });
    expect(verdicts.get('Birch')?.reasonCodes).toContain('commitment_mismatch');
    expect(verdicts.get('Cedar')?.verdict).toBe('same_observed');
    expect(verdicts.get('Dune')?.verdict).toBe('earlier_answer_wrong');
    expect(verdicts.get('Elm')?.reasonCodes).toContain('missing_current_evidence');
    expect(byVendor.size).toBe(5);
    expect(model.requests).toHaveLength(1);
    const run = h.database.prepare('SELECT state, result_id FROM runs WHERE id = ?').get(admitted.run.id) as { state: string; result_id: string | null };
    expect(run.state).toBe('completed');
    expect(h.events.listAfter(h.scope, admitted.run.id, 0).map((event) => event.type)).toContain('result_ready');
    expect(h.events.listAfter(h.scope, admitted.run.id, 0).map((event) => event.type)).not.toContain('answer_delta');
    expect(getMessage(h.database, h.scope, admitted.run.answerId!)?.answerState).toBe('complete');
    const app = createApp({ config: parseConfig({ NODE_ENV: 'test' }), database: h.database, clock: h.clock,
      registry: h.registry, events: h.events, executor: null, clientDir: '/tmp/minimi-recheck-no-client' });
    const server: Server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const address = server.address() as AddressInfo;
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/results/${saved.result_id}`, {
        headers: { cookie: `minimi_owner=${h.scope.ownerId}` },
      });
      expect(response.status).toBe(200);
      const payload = await response.json() as { baselineOriginal: { id: string }; observations: unknown[] };
      expect(payload.baselineOriginal.id).toBe(result?.members[0]?.memberId.split(':')[0]);
      expect(payload.observations.length).toBeGreaterThan(0);
    } finally {
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    }
  });

  it('keeps unsearched members unresolved when the shared acquisition budget is exhausted', async () => {
    const h = setup();
    const { baseline } = addBaseline(h);
    const model = new ExtractingModel();
    const admitted = admitRun({ database: h.database, registry: h.registry, clock: h.clock, limits: DEFAULT_LIMITS }, {
      ...h.scope, conversationId: h.conversation.id, message: 'Recheck our CRM shortlist.', timezone: 'Asia/Kolkata',
      requestKey: 'recheck-budget', baselineId: baseline.id,
    });
    h.runId = admitted.run.id;
    const executor = createChatExecutor({ database: h.database, clock: h.clock,
      config: parseConfig({ OPENAI_API_KEY: 'scripted', OPENAI_MODEL: 'scripted', MAX_SEARCH_QUERIES: '2' }),
      model, searchProvider: sourceProvider(h) });
    const signal = h.registry.register(admitted.run.id).signal;
    await executor.execute(createRunExecution({ database: h.database, clock: h.clock, scope: h.scope,
      run: admitted.run, question: admitted.question, signal, events: h.events, registry: h.registry }));
    const run = h.database.prepare('SELECT result_id FROM runs WHERE id = ?').get(admitted.run.id) as { result_id: string | null };
    const result = getVerificationResult(h.database, h.scope, run.result_id!);
    expect(result?.searchCounts.attempted).toBe(2);
    expect(result?.coverageCounts.requested).toBe(5);
    expect(result?.outcomes.some((item) => item.reasonCodes.includes('budget_exhausted'))).toBe(true);
    expect(result?.members).toHaveLength(5);
  });

  it('does not commit a result or emit result_ready when cancellation wins before commit', async () => {
    const h = setup();
    const { baseline } = addBaseline(h);
    const admitted = admitRun({ database: h.database, registry: h.registry, clock: h.clock, limits: DEFAULT_LIMITS }, {
      ...h.scope, conversationId: h.conversation.id, message: 'Recheck our CRM shortlist.', timezone: 'Asia/Kolkata',
      requestKey: 'recheck-cancel', baselineId: baseline.id,
    });
    h.runId = admitted.run.id;
    const model = new ExtractingModel(() => cancelRun(h.database, h.clock, h.scope, admitted.run.id, undefined, h.registry));
    const executor = createChatExecutor({ database: h.database, clock: h.clock,
      config: parseConfig({ OPENAI_API_KEY: 'scripted', OPENAI_MODEL: 'scripted' }), model, searchProvider: sourceProvider(h) });
    const signal = h.registry.register(admitted.run.id).signal;
    const execution = createRunExecution({ database: h.database, clock: h.clock, scope: h.scope,
      run: admitted.run, question: admitted.question, signal, events: h.events, registry: h.registry });
    await expect(executor.execute(execution)).rejects.toThrow();
    const uncommitted: VerificationResult = {
      id: randomUUID(), runId: admitted.run.id, baselineSnapshotId: baseline.id, constraints: baseline.constraints,
      members: baseline.members, obligations: [], outcomes: [], unresolvedReasons: [],
      searchCounts: { attempted: 0, succeeded: 0, empty: 0, failed: 0, cancelled: 0 },
      coverageCounts: { requested: 0, attempted: 0, resolved: 0, unresolved: 0 },
      checkedAt: h.clock.now().toISOString(), summary: 'Uncommitted test result',
    };
    expect(() => execution.complete({ answerText: 'Must roll back', resultId: uncommitted.id, verificationResult: uncommitted }))
      .toThrow();
    const run = h.database.prepare('SELECT state, result_id FROM runs WHERE id = ?').get(admitted.run.id) as { state: string; result_id: string | null };
    expect(run.state).toBe('cancelled');
    expect(run.result_id).toBeNull();
    expect(h.database.prepare('SELECT COUNT(*) AS count FROM verification_results WHERE run_id = ?').get(admitted.run.id)).toMatchObject({ count: 0 });
    expect(h.events.listAfter(h.scope, admitted.run.id, 0).map((event) => event.type)).not.toContain('result_ready');
  });
});
