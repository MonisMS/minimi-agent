import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  decisionSnapshotSchema,
  idSchema,
  type DecisionSnapshot,
  type Span,
} from '../../shared/domain.js';
import { getConversation, type Scope } from './conversations.js';
import { RepositoryNotFoundError } from './errors.js';
import { getMessage } from './messages.js';
import { runTransaction } from './transaction.js';

interface DecisionRow {
  id: string;
  owner_id: string;
  namespace: string;
  conversation_id: string;
  original_message_id: string;
  state: string;
  revision: number;
  supersedes_id: string | null;
  snapshot_json: string;
  validated_at: string | null;
}

export interface AppendDecisionSnapshotInput extends Scope {
  conversationId: string;
  originalMessageId: string;
  originalSpan: Span;
  state: DecisionSnapshot['state'];
  supersedesId?: string | null;
  members: DecisionSnapshot['members'];
  constraints: DecisionSnapshot['constraints'];
  validatedAt: string | null;
}

function asDecision(row: DecisionRow): DecisionSnapshot {
  const snapshot = decisionSnapshotSchema.parse(JSON.parse(row.snapshot_json) as unknown);
  if (
    snapshot.id !== row.id || snapshot.originalMessageId !== row.original_message_id ||
    snapshot.state !== row.state || snapshot.revision !== row.revision ||
    snapshot.supersedesId !== row.supersedes_id || snapshot.validatedAt !== row.validated_at
  ) {
    throw new Error('Stored decision snapshot metadata is inconsistent');
  }
  return snapshot;
}

function spanText(text: string, span: Span, label: string): string {
  if (span.endExclusive <= span.start || span.endExclusive > text.length) {
    throw new Error(`${label} span is empty or outside the original message`);
  }
  return text.slice(span.start, span.endExclusive);
}

function isWithin(child: Span, parent: Span): boolean {
  return child.start >= parent.start && child.endExclusive <= parent.endExclusive;
}

function textHas(text: string, value: string): boolean {
  return text.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase());
}

function validateSnapshotAgainstOriginal(
  snapshot: DecisionSnapshot,
  originalText: string,
  originalRole: 'user' | 'assistant',
): void {
  const decisionText = spanText(originalText, snapshot.originalSpan, 'Decision');
  if (snapshot.members.length === 0) throw new Error('A decision snapshot must include members');
  if (new Set(snapshot.members.map((member) => member.memberId)).size !== snapshot.members.length) {
    throw new Error('Decision member IDs must be unique within the original decision');
  }
  if (snapshot.state === 'assistant_proposed' && originalRole !== 'assistant') {
    throw new Error('Assistant proposals must cite an original assistant message');
  }
  if (snapshot.state !== 'assistant_proposed' && originalRole !== 'user') {
    throw new Error('User decisions must cite an original user message');
  }
  if (snapshot.state === 'user_selected' && !/\b(?:select(?:ed)?|cho(?:ose|sen)|pick(?:ed)?|decid(?:e|ed))\b/i.test(decisionText)) {
    throw new Error('Selected decisions require explicit selection language in the original');
  }
  if (snapshot.state === 'user_shortlisted' && !/\b(?:shortlist(?:ed)?|consider(?:ing|ed)?|narrow(?:ed|ing)?|options?)\b/i.test(decisionText)) {
    throw new Error('Shortlists require shortlist or consideration language in the original');
  }

  for (const member of snapshot.members) {
    if (!member.memberId.startsWith(`${snapshot.originalMessageId}:`)) {
      throw new Error('Decision member IDs must be local to their original message');
    }
    if (!member.sourceSpan || !isWithin(member.sourceSpan, snapshot.originalSpan)) {
      throw new Error('Every decision member requires a source span within its decision');
    }
    const evidence = spanText(originalText, member.sourceSpan, 'Member');
    const identity = [member.vendor, member.product, ...member.aliases]
      .filter((value): value is string => Boolean(value?.trim()));
    if (identity.length === 0 || !identity.some((value) => textHas(evidence, value))) {
      throw new Error('Member identity is not supported by its original source span');
    }
    if (member.plan && !textHas(evidence, member.plan)) {
      throw new Error('Member plan is not supported by its original source span');
    }
  }

  const constraintTexts = snapshot.constraints.sourceSpans.map((span) => {
    if (!isWithin(span, snapshot.originalSpan)) {
      throw new Error('Constraint source span lies outside the original decision');
    }
    return spanText(originalText, span, 'Constraint');
  });
  const constraintText = constraintTexts.join(' ');
  const { teamSize, budget, region } = snapshot.constraints;
  if (teamSize !== null && !new RegExp(`\\b${teamSize}\\b`).test(constraintText)) {
    throw new Error('Team size is not supported by a constraint source span');
  }
  if (budget) {
    const amount = budget.amountDecimal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`(?:^|\\D)${amount}(?:\\D|$)`).test(constraintText)) {
      throw new Error('Budget amount is not supported by a constraint source span');
    }
    const currencyIndicators: Record<string, string[]> = {
      USD: ['$', 'usd', 'dollar'], EUR: ['€', 'eur', 'euro'], GBP: ['£', 'gbp', 'pound'],
      INR: ['₹', 'inr', 'rupee'], CAD: ['cad', 'canadian dollar'], AUD: ['aud', 'australian dollar'],
    };
    const indicators = currencyIndicators[budget.currency] ?? [budget.currency.toLocaleLowerCase()];
    if (!indicators.some((indicator) => textHas(constraintText, indicator))) {
      throw new Error('Budget currency is not supported by a constraint source span');
    }
  }
  if (region && !textHas(constraintText, region)) {
    throw new Error('Region is not supported by a constraint source span');
  }
  if (snapshot.members.some((member) => !textHas(decisionText, member.vendor ?? member.product ?? member.aliases[0] ?? ''))) {
    throw new Error('Decision span does not cover every member');
  }
}

function getScopedRow(database: DatabaseSync, scope: Scope, id: string): DecisionRow | null {
  return database.prepare(
    `SELECT id, owner_id, namespace, conversation_id, original_message_id, state,
            revision, supersedes_id, snapshot_json, validated_at
     FROM decision_snapshots
     WHERE id = ? AND owner_id = ? AND namespace = ?`,
  ).get(id, scope.ownerId, scope.namespace) as DecisionRow | undefined ?? null;
}

export function appendDecisionSnapshot(
  database: DatabaseSync,
  input: AppendDecisionSnapshotInput,
): DecisionSnapshot {
  idSchema.parse(input.ownerId);
  idSchema.parse(input.conversationId);
  idSchema.parse(input.originalMessageId);
  const conversation = getConversation(database, input, input.conversationId);
  if (!conversation) throw new RepositoryNotFoundError('Conversation was not found');
  const original = getMessage(database, input, input.originalMessageId);
  if (!original || original.conversationId !== input.conversationId) {
    throw new RepositoryNotFoundError('Original decision message was not found');
  }

  let previous: DecisionSnapshot | null = null;
  if (input.supersedesId) {
    const row = getScopedRow(database, input, input.supersedesId);
    if (!row || row.conversation_id !== input.conversationId) {
      throw new RepositoryNotFoundError('Superseded decision was not found');
    }
    previous = asDecision(row);
  }
  const snapshot = decisionSnapshotSchema.parse({
    id: randomUUID(),
    originalMessageId: original.id,
    originalSpan: input.originalSpan,
    state: input.state,
    revision: previous ? previous.revision + 1 : 1,
    supersedesId: previous?.id ?? null,
    members: input.members,
    constraints: input.constraints,
    validatedAt: input.validatedAt,
  });
  validateSnapshotAgainstOriginal(snapshot, original.originalText, original.role);

  runTransaction(database, () => {
    database.prepare(
      `INSERT INTO decision_snapshots
        (id, owner_id, namespace, conversation_id, original_message_id, state, revision,
         supersedes_id, snapshot_json, validated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      snapshot.id, input.ownerId, input.namespace, input.conversationId,
      snapshot.originalMessageId, snapshot.state, snapshot.revision, snapshot.supersedesId,
      JSON.stringify(snapshot), snapshot.validatedAt, new Date().toISOString(),
    );
  });
  return snapshot;
}

export function getDecisionSnapshot(
  database: DatabaseSync,
  scope: Scope,
  snapshotId: string,
): DecisionSnapshot | null {
  idSchema.parse(scope.ownerId);
  idSchema.parse(snapshotId);
  const row = getScopedRow(database, scope, snapshotId);
  return row ? asDecision(row) : null;
}

export function listDecisionSnapshots(
  database: DatabaseSync,
  scope: Scope,
  conversationId: string,
): DecisionSnapshot[] {
  idSchema.parse(scope.ownerId);
  idSchema.parse(conversationId);
  const rows = database.prepare(
    `SELECT id, owner_id, namespace, conversation_id, original_message_id, state,
            revision, supersedes_id, snapshot_json, validated_at
     FROM decision_snapshots
     WHERE owner_id = ? AND namespace = ? AND conversation_id = ?
       AND EXISTS (
         SELECT 1 FROM conversations c WHERE c.id = decision_snapshots.conversation_id
           AND c.owner_id = ? AND c.namespace = ? AND c.deleted_at IS NULL
       )
     ORDER BY revision ASC, created_at ASC, id ASC`,
  ).all(scope.ownerId, scope.namespace, conversationId, scope.ownerId, scope.namespace) as unknown as DecisionRow[];
  return rows.map(asDecision);
}

