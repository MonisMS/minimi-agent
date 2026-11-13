import type { DatabaseSync } from 'node:sqlite';
import { DateTime } from 'luxon';
import {
  ianaZoneSchema,
  idSchema,
  recallResultSchema,
  type Message,
  type RecallResult,
} from '../../shared/domain.js';
import { requireConversation, type Scope } from '../db/conversations.js';
import {
  findAliasRecallMessages,
  listRecentRecallMessages,
  listRecallMessagesInUtcWindow,
  searchRecallMessages,
} from '../db/recall.js';
import {
  interpretDateText,
  type DateCandidate,
  type DateInterpretation,
} from './dates.js';
import { expandRecallMessages, type ExpandedTurn } from './expand.js';

export interface RecallRequest extends Scope {
  conversationId: string;
  questionText: string;
  reference: Date;
  timezone: string;
  currentQuestionId?: string | null;
  currentRunId?: string | null;
  limit?: number;
}

export type RecallCandidateSource = 'date' | 'fts' | 'alias' | 'recent';

export interface RecallCandidate {
  message: Message;
  conversationId: string;
  source: RecallCandidateSource;
  reason: string;
  score: number;
}

export interface RecallClarificationCandidate {
  startLocalDate: string;
  endLocalDate: string;
  label: string;
  messageIds: string[];
}

export interface RecallOutcome {
  result: RecallResult;
  interpretation: DateInterpretation;
  candidates: RecallCandidate[];
  expanded: ExpandedTurn[];
  clarificationRequired: boolean;
  clarificationCandidates: RecallClarificationCandidate[];
  pendingIndex: boolean;
  scope: Scope & { conversationId: string };
}

const SEARCH_STOPWORDS = new Set([
  'a',
  'about',
  'after',
  'again',
  'all',
  'also',
  'an',
  'and',
  'any',
  'are',
  'as',
  'ask',
  'asked',
  'at',
  'be',
  'been',
  'before',
  'being',
  'but',
  'by',
  'can',
  'could',
  'current',
  'currently',
  'date',
  'day',
  'did',
  'do',
  'does',
  'for',
  'from',
  'get',
  'give',
  'had',
  'has',
  'have',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'no',
  'not',
  'now',
  'of',
  'on',
  'or',
  'our',
  'please',
  'right',
  'said',
  'say',
  'show',
  'so',
  'still',
  'tell',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'those',
  'to',
  'today',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'will',
  'with',
  'would',
  'you',
  'your',
]);

const NON_ALIAS_WORDS = new Set([
  ...SEARCH_STOPWORDS,
  'april',
  'august',
  'december',
  'february',
  'friday',
  'january',
  'july',
  'june',
  'march',
  'may',
  'monday',
  'november',
  'october',
  'saturday',
  'september',
  'sunday',
  'thursday',
  'tomorrow',
  'tuesday',
  'wednesday',
  'yesterday',
]);

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function validateLimit(limit: number): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('Recall limit must be an integer between 1 and 100');
  }
}

function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}

function extractSearchTerms(text: string): string[] {
  return unique(
    words(text).filter(
      (word) => word.length >= 3 && !SEARCH_STOPWORDS.has(word),
    ),
  ).slice(0, 8);
}

function extractAliases(text: string): string[] {
  const matches = text.match(/\b[A-Z][A-Za-z0-9&.-]{1,}\b/g) ?? [];
  return unique(
    matches
      .map((value) => value.trim())
      .filter(
        (value) =>
          value.length >= 2 && !NON_ALIAS_WORDS.has(value.toLowerCase()),
      ),
  ).slice(0, 8);
}

function hasReferentialLanguage(text: string): boolean {
  return /\b(?:above|choose|chosen|decide|decided|earlier|former|it|its|latter|list|option|options|previous|same|select|selected|set|shortlist|that|their|them|these|they|this|those|vendor|vendors)\b/i.test(
    text,
  );
}

function inclusiveEnd(window: DateCandidate): string {
  const end = DateTime.fromISO(window.endLocalDateExclusive, {
    zone: window.timezone,
  })
    .minus({ days: 1 })
    .toISODate();
  if (!end) throw new Error('Could not derive an inclusive date-window end');
  return end;
}

function clampReason(reason: string): string {
  return reason.slice(0, 300);
}

function contextualDateInterpretation(
  database: DatabaseSync,
  request: RecallRequest,
  scope: Scope,
): DateInterpretation | null {
  if (!/\b(?:that|same)\s+(?:date|day)\b/i.test(request.questionText)) {
    return null;
  }
  const recent = listRecentRecallMessages(database, {
    ...scope,
    conversationId: request.conversationId,
    limit: 10,
    roles: ['user'],
    excludeMessageIds: request.currentQuestionId ? [request.currentQuestionId] : [],
    excludeRunId: request.currentRunId ?? null,
  });
  for (const message of recent) {
    const interpretation = interpretDateText(message.originalText, {
      reference: new Date(message.createdAt),
      timezone: message.timezone,
    });
    if (interpretation.candidates.length > 0) return interpretation;
  }
  return null;
}

function addCandidate(
  candidates: Map<string, RecallCandidate>,
  candidate: RecallCandidate,
): void {
  const existing = candidates.get(candidate.message.id);
  if (!existing || candidate.score > existing.score) {
    candidates.set(candidate.message.id, candidate);
  }
}

function compareCandidates(left: RecallCandidate, right: RecallCandidate): number {
  if (right.score !== left.score) return right.score - left.score;
  const byTime = left.message.createdAt.localeCompare(right.message.createdAt);
  if (byTime !== 0) return byTime;
  return left.message.id.localeCompare(right.message.id);
}

function buildClarificationCandidates(
  interpretation: DateInterpretation,
  matches: Map<string, Message[]>,
): RecallClarificationCandidate[] {
  const byWindow = new Map<string, RecallClarificationCandidate>();
  for (const candidate of interpretation.candidates) {
    const messages = matches.get(candidate.startUtc) ?? [];
    if (messages.length === 0) continue;
    const key = `${candidate.startLocalDate}|${candidate.endLocalDateExclusive}`;
    const existing = byWindow.get(key);
    const ids = messages.map((message) => message.id);
    if (existing) {
      existing.messageIds = unique([...existing.messageIds, ...ids]);
      continue;
    }
    byWindow.set(key, {
      startLocalDate: candidate.startLocalDate,
      endLocalDate: inclusiveEnd(candidate),
      label: `${candidate.startLabel} - ${candidate.endLabel}`,
      messageIds: ids,
    });
  }
  return [...byWindow.values()].sort((left, right) =>
    left.startLocalDate.localeCompare(right.startLocalDate),
  );
}

function missingHistoryReason(
  interpretation: DateInterpretation,
  hasDateCandidates: boolean,
): string {
  if (hasDateCandidates) {
    return 'No saved messages were found in the requested date window.';
  }
  if (interpretation.unsupportedPhrases.length > 0) {
    return clampReason(
      `No saved history matched the unsupported date phrase: ${interpretation.unsupportedPhrases.join(
        ', ',
      )}.`,
    );
  }
  return 'No saved messages matched the requested history in this conversation scope.';
}

export function recallHistory(
  database: DatabaseSync,
  request: RecallRequest,
): RecallOutcome {
  idSchema.parse(request.ownerId);
  idSchema.parse(request.conversationId);
  ianaZoneSchema.parse(request.timezone);
  if (request.currentQuestionId) idSchema.parse(request.currentQuestionId);
  if (request.currentRunId) idSchema.parse(request.currentRunId);
  const limit = request.limit ?? 20;
  validateLimit(limit);

  const scope: Scope = {
    ownerId: request.ownerId,
    namespace: request.namespace,
  };
  requireConversation(database, scope, request.conversationId);
  const excludeMessageIds = request.currentQuestionId
    ? [request.currentQuestionId]
    : [];
  const direct = interpretDateText(request.questionText, {
    reference: request.reference,
    timezone: request.timezone,
  });
  const interpretation =
    direct.candidates.length === 0 && !direct.comparison
      ? contextualDateInterpretation(database, request, scope) ?? direct
      : direct;

  const candidates = new Map<string, RecallCandidate>();
  const windowMatches = new Map<string, Message[]>();
  const scanLimit = 100;
  let scanCapped = false;

  if (interpretation.candidates.length > 0) {
    for (const [index, window] of interpretation.candidates.entries()) {
      const messages = listRecallMessagesInUtcWindow(database, {
        ...scope,
        startUtc: window.startUtc,
        endUtcExclusive: window.endUtcExclusive,
        limit: scanLimit,
        excludeMessageIds,
        excludeRunId: request.currentRunId ?? null,
      });
      if (messages.length >= scanLimit) scanCapped = true;
      windowMatches.set(window.startUtc, messages);
      for (const message of messages) {
        addCandidate(candidates, {
          message,
          conversationId: message.conversationId,
          source: 'date',
          reason: clampReason(`Matched the saved history window for ${window.startLabel}.`),
          score:
            1000 -
            index * 10 +
            (message.conversationId === request.conversationId ? 5 : 0),
        });
      }
    }
  } else if (interpretation.unsupportedPhrases.length === 0) {
    const terms = extractSearchTerms(request.questionText);
    const ftsMessages = searchRecallMessages(database, {
      ...scope,
      terms,
      limit: scanLimit,
      excludeMessageIds,
      excludeRunId: request.currentRunId ?? null,
    });
    if (ftsMessages.length >= scanLimit) scanCapped = true;
    for (const message of ftsMessages) {
      const matchedTerms = terms.filter((term) =>
        message.originalText.toLowerCase().includes(term),
      );
      addCandidate(candidates, {
        message,
        conversationId: message.conversationId,
        source: 'fts',
        reason: clampReason(
          `Matched saved history terms: ${(matchedTerms.length > 0 ? matchedTerms : terms).join(
            ', ',
          )}.`,
        ),
        score:
          200 +
          matchedTerms.length * 10 +
          (message.conversationId === request.conversationId ? 5 : 0),
      });
    }

    const aliases = extractAliases(request.questionText);
    const aliasMessages = findAliasRecallMessages(database, {
      ...scope,
      aliases,
      limit: scanLimit,
      excludeMessageIds,
      excludeRunId: request.currentRunId ?? null,
    });
    if (aliasMessages.length >= scanLimit) scanCapped = true;
    for (const message of aliasMessages) {
      const matchedAliases = aliases.filter((alias) =>
        message.originalText.toLowerCase().includes(alias.toLowerCase()),
      );
      addCandidate(candidates, {
        message,
        conversationId: message.conversationId,
        source: 'alias',
        reason: clampReason(
          `Matched saved decision alias: ${(matchedAliases.length > 0 ? matchedAliases : aliases).join(
            ', ',
          )}.`,
        ),
        score:
          300 +
          matchedAliases.length * 10 +
          (message.conversationId === request.conversationId ? 5 : 0),
      });
    }

    const recentMessages = listRecentRecallMessages(database, {
      ...scope,
      conversationId: request.conversationId,
      limit: 8,
      excludeMessageIds,
      excludeRunId: request.currentRunId ?? null,
    });
    const useRecent =
      recentMessages.length > 0 &&
      (ftsMessages.length === 0 && aliasMessages.length === 0
        ? true
        : hasReferentialLanguage(request.questionText));
    if (useRecent) {
      for (const [index, message] of recentMessages.entries()) {
        addCandidate(candidates, {
          message,
          conversationId: message.conversationId,
          source: 'recent',
          reason: 'Recent original history in this conversation.',
          score:
            100 -
            index * 5 +
            (message.conversationId === request.conversationId ? 5 : 0),
        });
      }
    }
  }

  const allCandidates = [...candidates.values()].sort(compareCandidates);
  const included = allCandidates.slice(0, limit);
  const truncated = scanCapped || allCandidates.length > limit;
  const clarificationCandidates = buildClarificationCandidates(
    interpretation,
    windowMatches,
  );
  const clarificationRequired =
    clarificationCandidates.length > 1 ||
    interpretation.unsupportedPhrases.length > 0;
  const ambiguousBaselineIds = clarificationRequired
    ? unique(clarificationCandidates.flatMap((candidate) => candidate.messageIds))
    : [];

  const windows = interpretation.candidates.map((candidate) => ({
    start: candidate.startLocalDate,
    end: inclusiveEnd(candidate),
    timezone: candidate.timezone,
  }));

  const missingReason =
    included.length === 0
      ? missingHistoryReason(
          interpretation,
          interpretation.candidates.length > 0,
        )
      : null;

  const result = recallResultSchema.parse({
    interpretation: {
      text: interpretation.text,
      windows,
      ambiguous: interpretation.ambiguous,
    },
    candidates: included.map((candidate) => ({
      turnId: candidate.message.id,
      reason: clampReason(candidate.reason),
    })),
    matchedCount: scanCapped ? null : allCandidates.length,
    boundedCount: scanCapped ? allCandidates.length : null,
    includedCount: included.length,
    truncated,
    pendingIndex: false,
    missingHistoryReason: missingReason,
    chosenBaselineIds: [],
    ambiguousBaselineIds,
  });

  return {
    result,
    interpretation,
    candidates: included,
    expanded: expandRecallMessages(
      database,
      scope,
      included.map((candidate) => candidate.message),
      {
        excludeMessageIds,
        excludeRunId: request.currentRunId ?? null,
      },
    ),
    clarificationRequired,
    clarificationCandidates,
    pendingIndex: false,
    scope: {
      ...scope,
      conversationId: request.conversationId,
    },
  };
}
