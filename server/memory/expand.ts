import type { DatabaseSync } from 'node:sqlite';
import type { Message } from '../../shared/domain.js';
import type { Scope } from '../db/conversations.js';
import { getMessage } from '../db/messages.js';
import {
  listAdjacentMessages,
  listMessagesForRun,
} from '../db/recall.js';

export interface ExpandedTurn {
  conversationId: string;
  runId: string | null;
  messageIds: string[];
  messages: Message[];
  text: string;
  truncated: boolean;
}

export interface ExpandOptions {
  before?: number;
  after?: number;
  excludeMessageIds?: string[];
  excludeRunId?: string | null;
}

function eligible(message: Message): boolean {
  return (
    message.role === 'user' ||
    message.answerState === 'complete'
  );
}

function groupKey(message: Message): string {
  return message.runId ? `run:${message.runId}` : `message:${message.id}`;
}

export function expandRecallMessages(
  database: DatabaseSync,
  scope: Scope,
  candidates: Message[],
  options: ExpandOptions = {},
): ExpandedTurn[] {
  const groups = new Map<string, ExpandedTurn>();
  const excludedIds = new Set(options.excludeMessageIds ?? []);

  for (const input of candidates) {
    const candidate = getMessage(database, scope, input.id);
    if (!candidate || !eligible(candidate) || excludedIds.has(candidate.id) ||
        (options.excludeRunId && candidate.runId === options.excludeRunId)) continue;
    const key = groupKey(candidate);
    if (groups.has(key)) continue;

    let messages: Message[];
    if (candidate.runId) {
      messages = listMessagesForRun(database, {
        ...scope,
        runId: candidate.runId,
      });
    } else {
      messages = listAdjacentMessages(database, {
        ...scope,
        messageId: candidate.id,
        before: options.before ?? 1,
        after: options.after ?? 1,
      });
    }

    messages = messages.filter(
      (message) =>
        !excludedIds.has(message.id) &&
        (!options.excludeRunId || message.runId !== options.excludeRunId) &&
        eligible(message),
    );
    if (messages.length === 0) continue;

    groups.set(key, {
      conversationId: candidate.conversationId,
      runId: candidate.runId,
      messageIds: messages.map((message) => message.id),
      messages,
      text: messages.map((message) => message.originalText).join('\n\n'),
      truncated: false,
    });
  }

  return [...groups.values()].sort((left, right) => {
    const leftTime = left.messages[0]?.createdAt ?? '';
    const rightTime = right.messages[0]?.createdAt ?? '';
    const byTime = leftTime.localeCompare(rightTime);
    if (byTime !== 0) return byTime;
    return (left.messages[0]?.id ?? '').localeCompare(right.messages[0]?.id ?? '');
  });
}
