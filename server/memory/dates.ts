import * as chrono from 'chrono-node';
import { DateTime } from 'luxon';
import { ianaZoneSchema } from '../../shared/domain.js';

export interface DateWindow {
  startLocalDate: string;
  endLocalDateExclusive: string;
  startUtc: string;
  endUtcExclusive: string;
  timezone: string;
  startLabel: string;
  endLabel: string;
  days: number;
}

export type DateCandidateKind = 'day' | 'range' | 'month' | 'year';

export interface DateCandidate extends DateWindow {
  phrase: string;
  kind: DateCandidateKind;
  weekday: string | null;
  ambiguous: boolean;
  ambiguityReason: string | null;
}

export interface DateInterpretation {
  text: string | null;
  referenceLocalDate: string;
  timezone: string;
  candidates: DateCandidate[];
  comparison: DateCandidate | null;
  ambiguous: boolean;
  unsupportedPhrases: string[];
  unsupportedReason: string | null;
}

export interface InterpretDateOptions {
  reference: Date;
  timezone: string;
}

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  february: 2,
  feb: 2,
  march: 3,
  mar: 3,
  april: 4,
  apr: 4,
  may: 5,
  june: 6,
  jun: 6,
  july: 7,
  jul: 7,
  august: 8,
  aug: 8,
  september: 9,
  sep: 9,
  sept: 9,
  october: 10,
  oct: 10,
  november: 11,
  nov: 11,
  december: 12,
  dec: 12,
};

const WEEKDAYS: Record<string, number> = {
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
  sunday: 7,
};

const WEEKDAY_PATTERN =
  'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const MONTH_PATTERN = Object.keys(MONTHS).join('|');
const UNSUPPORTED_PATTERNS = [
  /\b(?:last|next|this|past|previous|coming)\s+(?:week|month|year|weekend)\b/gi,
  /\b(?:a while ago|sometime|recently|the other day|these days)\b/gi,
  /\b\d+\s+(?:days?|weeks?|months?|years?)\s+ago\b/gi,
  /\b(?:last|next|past|previous|coming)\s+\d+\s+(?:days?|weeks?|months?|years?)\b/gi,
];

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function buildWindow(
  start: DateTime,
  endExclusive: DateTime,
  timezone: string,
  phrase: string,
  kind: DateCandidateKind,
  ambiguous = false,
  ambiguityReason: string | null = null,
): DateCandidate | null {
  if (!start.isValid || !endExclusive.isValid || start >= endExclusive) return null;
  const startUtc = start.toUTC().toISO({ suppressMilliseconds: true });
  const endUtcExclusive = endExclusive.toUTC().toISO({ suppressMilliseconds: true });
  const startLocalDate = start.toISODate();
  const endLocalDateExclusive = endExclusive.toISODate();
  if (!startUtc || !endUtcExclusive || !startLocalDate || !endLocalDateExclusive) {
    return null;
  }
  return {
    startLocalDate,
    endLocalDateExclusive,
    startUtc,
    endUtcExclusive,
    timezone,
    startLabel: start.toFormat('ccc, dd LLL yyyy'),
    endLabel: endExclusive.minus({ days: 1 }).toFormat('ccc, dd LLL yyyy'),
    days: Math.round(endExclusive.diff(start, 'days').days),
    phrase,
    kind,
    weekday: kind === 'day' || kind === 'range' ? start.toFormat('cccc') : null,
    ambiguous,
    ambiguityReason,
  };
}

function buildDay(
  year: number,
  month: number,
  day: number,
  timezone: string,
  phrase: string,
  ambiguous = false,
  ambiguityReason: string | null = null,
): DateCandidate | null {
  const start = DateTime.fromObject({ year, month, day }, { zone: timezone }).startOf('day');
  if (!start.isValid) return null;
  return buildWindow(
    start,
    start.plus({ days: 1 }).startOf('day'),
    timezone,
    phrase,
    'day',
    ambiguous,
    ambiguityReason,
  );
}

function buildRange(
  startYear: number,
  startMonth: number,
  startDay: number,
  endYear: number,
  endMonth: number,
  endDay: number,
  timezone: string,
  phrase: string,
): DateCandidate | null {
  const start = DateTime.fromObject(
    { year: startYear, month: startMonth, day: startDay },
    { zone: timezone },
  ).startOf('day');
  const end = DateTime.fromObject(
    { year: endYear, month: endMonth, day: endDay },
    { zone: timezone },
  ).startOf('day');
  if (!start.isValid || !end.isValid) return null;
  return buildWindow(
    start,
    end.plus({ days: 1 }).startOf('day'),
    timezone,
    phrase,
    'range',
  );
}

function buildMonth(
  year: number,
  month: number,
  timezone: string,
  phrase: string,
): DateCandidate | null {
  const start = DateTime.fromObject({ year, month, day: 1 }, { zone: timezone }).startOf('day');
  if (!start.isValid) return null;
  return buildWindow(
    start,
    start.plus({ months: 1 }).startOf('day'),
    timezone,
    phrase,
    'month',
  );
}

function buildYear(year: number, timezone: string, phrase: string): DateCandidate | null {
  const start = DateTime.fromObject({ year, month: 1, day: 1 }, { zone: timezone }).startOf('day');
  if (!start.isValid) return null;
  return buildWindow(
    start,
    start.plus({ years: 1 }).startOf('day'),
    timezone,
    phrase,
    'year',
  );
}

function mostRecentPastDay(
  month: number,
  day: number,
  reference: DateTime,
  timezone: string,
  phrase: string,
  ambiguous = false,
  ambiguityReason: string | null = null,
): DateCandidate | null {
  for (let year = reference.year; year >= reference.year - 8; year -= 1) {
    const candidate = buildDay(
      year,
      month,
      day,
      timezone,
      phrase,
      ambiguous,
      ambiguityReason,
    );
    if (!candidate) continue;
    if (candidate.startLocalDate <= reference.toISODate()!) return candidate;
  }
  return null;
}

function collectUnsupportedPhrases(text: string): string[] {
  const matches: string[] = [];
  for (const pattern of UNSUPPORTED_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      if (match[0]) matches.push(match[0]);
    }
  }
  return unique(matches.map((value) => value.trim()));
}

function overlapsUnsupported(phrase: string, unsupported: string[]): boolean {
  const lower = phrase.toLowerCase();
  return unsupported.some((value) => {
    const candidate = value.toLowerCase();
    return lower.includes(candidate) || candidate.includes(lower);
  });
}

function dayFromMatch(
  match: RegExpExecArray,
  timezone: string,
  reference: DateTime,
): DateCandidate | null {
  const weekdayName = match[2]?.toLowerCase();
  if (!weekdayName || !WEEKDAYS[weekdayName]) return null;
  const target = WEEKDAYS[weekdayName];
  const modifier = match[1]?.toLowerCase();
  const referenceDay = reference.startOf('day');

  if (modifier === 'last' || modifier === 'past') {
    let delta = (referenceDay.weekday - target + 7) % 7;
    if (delta === 0) delta = 7;
    const start = referenceDay.minus({ days: delta });
    return buildDay(
      start.year,
      start.month,
      start.day,
      timezone,
      match[0],
    );
  }

  if (modifier === 'next') {
    let delta = (target - referenceDay.weekday + 7) % 7;
    if (delta === 0) delta = 7;
    const start = referenceDay.plus({ days: delta });
    return buildDay(
      start.year,
      start.month,
      start.day,
      timezone,
      match[0],
    );
  }

  const weekStart = referenceDay.startOf('week');
  const start = weekStart.plus({ days: target - 1 });
  return buildDay(
    start.year,
    start.month,
    start.day,
    timezone,
    match[0],
    true,
    'This weekday may mean the current or upcoming occurrence.',
  );
}

function component(
  components: chrono.ParsedComponents,
  name: chrono.Component,
): number | undefined {
  return components.get(name) ?? undefined;
}

function absoluteCandidate(
  result: chrono.ParsedResult,
  reference: DateTime,
  timezone: string,
): DateCandidate | null {
  const month = component(result.start, 'month');
  const day = component(result.start, 'day');
  if (!month) return null;

  if (result.end) {
    const endMonth = component(result.end, 'month');
    const endDay = component(result.end, 'day');
    if (!endMonth || !endDay || !day) return null;

    const startYearCertain = result.start.isCertain('year');
    const endYearCertain = result.end.isCertain('year');
    let startYear = component(result.start, 'year');
    let endYear = component(result.end, 'year');

    if (!startYearCertain && endYearCertain && endYear !== undefined) {
      startYear = endYear;
      if (month > endMonth || (month === endMonth && day > endDay)) {
        startYear -= 1;
      }
    }
    if (!startYearCertain && !endYearCertain) {
      const start = mostRecentPastDay(month, day, reference, timezone, result.text);
      if (!start) return null;
      startYear = Number(start.startLocalDate.slice(0, 4));
      endYear = startYear;
      if (endMonth < month || (endMonth === month && endDay < day)) {
        endYear += 1;
      }
    } else if (startYearCertain && !endYearCertain && startYear !== undefined) {
      endYear = startYear;
      if (endMonth < month || (endMonth === month && endDay < day)) {
        endYear += 1;
      }
    }

    if (startYear === undefined || endYear === undefined) return null;
    return buildRange(
      startYear,
      month,
      day,
      endYear,
      endMonth,
      endDay,
      timezone,
      result.text,
    );
  }

  if (!result.start.isCertain('day')) {
    let year = component(result.start, 'year');
    if (!result.start.isCertain('year')) {
      year = month > reference.month ? reference.year - 1 : reference.year;
    }
    if (year === undefined) return null;
    return buildMonth(year, month, timezone, result.text);
  }

  if (day === undefined) return null;
  const year = component(result.start, 'year');
  if (result.start.isCertain('year') && year !== undefined) {
    return buildDay(year, month, day, timezone, result.text);
  }

  return mostRecentPastDay(month, day, reference, timezone, result.text);
}

function monthDayFallback(
  text: string,
  reference: DateTime,
  timezone: string,
): DateCandidate | null {
  if (/\b(?:19|20)\d{2}\b/.test(text)) return null;
  const patterns = [
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)\b/i,
    /\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    const firstIsDay = /\d/.test(match[1] ?? '');
    const day = Number(firstIsDay ? match[1] : match[2]);
    const monthWord = (firstIsDay ? match[2] : match[1])?.toLowerCase();
    if (!monthWord) continue;
    const month = MONTHS[monthWord];
    if (!month || !Number.isInteger(day)) continue;
    return mostRecentPastDay(month, day, reference, timezone, match[0]);
  }
  return null;
}

function numericCandidates(
  text: string,
  timezone: string,
): DateCandidate[] {
  const match = /\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/.exec(text);
  if (!match) return [];
  const first = Number(match[1]);
  const second = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (!Number.isInteger(first) || !Number.isInteger(second)) return [];

  if (first > 12 && second > 12) return [];
  if (first > 12) {
    const candidate = buildDay(year, second, first, timezone, match[0]);
    return candidate ? [candidate] : [];
  }
  if (second > 12) {
    const candidate = buildDay(year, first, second, timezone, match[0]);
    return candidate ? [candidate] : [];
  }
  if (first === second) {
    const candidate = buildDay(year, first, second, timezone, match[0]);
    return candidate ? [candidate] : [];
  }

  const candidates = [
    buildDay(
      year,
      first,
      second,
      timezone,
      match[0],
      true,
      'Numeric date order is ambiguous between day/month and month/day.',
    ),
    buildDay(
      year,
      second,
      first,
      timezone,
      match[0],
      true,
      'Numeric date order is ambiguous between day/month and month/day.',
    ),
  ].filter((candidate): candidate is DateCandidate => candidate !== null);
  return candidates;
}

export function interpretDateText(
  text: string,
  options: InterpretDateOptions,
): DateInterpretation {
  ianaZoneSchema.parse(options.timezone);
  const reference = DateTime.fromJSDate(options.reference, {
    zone: options.timezone,
  });
  if (!reference.isValid) {
    throw new Error('The reference instant is invalid');
  }
  const referenceDay = reference.startOf('day');
  const referenceLocalDate = referenceDay.toISODate();
  if (!referenceLocalDate) throw new Error('The reference local date is invalid');

  const unsupportedPhrases = collectUnsupportedPhrases(text);
  const candidates: DateCandidate[] = [];
  const handledWeekdays = new Set<string>();
  const handledPhrases: string[] = [];
  let comparison: DateCandidate | null = null;

  const todayMatch = /\b(?:today|now|currently|right now|as of today)\b/i.exec(text);
  if (todayMatch) {
    comparison = buildDay(
      referenceDay.year,
      referenceDay.month,
      referenceDay.day,
      options.timezone,
      todayMatch[0],
    );
    handledPhrases.push(todayMatch[0]);
  }

  const relativeDayMatch = /\b(yesterday|tomorrow)\b/i.exec(text);
  if (relativeDayMatch) {
    const offset = relativeDayMatch[1]?.toLowerCase() === 'yesterday' ? -1 : 1;
    const start = referenceDay.plus({ days: offset });
    const candidate = buildDay(
      start.year,
      start.month,
      start.day,
      options.timezone,
      relativeDayMatch[0],
    );
    if (candidate) candidates.push(candidate);
    handledPhrases.push(relativeDayMatch[0]);
  }

  const relativeWeekday = new RegExp(
    `\\b(last|past|next|this)\\s+(${WEEKDAY_PATTERN})\\b`,
    'i',
  ).exec(text);
  if (relativeWeekday) {
    const candidate = dayFromMatch(relativeWeekday, options.timezone, reference);
    if (candidate) candidates.push(candidate);
    handledWeekdays.add(relativeWeekday[2]!.toLowerCase());
    handledPhrases.push(relativeWeekday[0]);
  }

  if (!relativeWeekday) {
    const bareWeekday = new RegExp(
      `\\b(?:on\\s+)?(?:the\\s+)?(${WEEKDAY_PATTERN})\\b`,
      'i',
    ).exec(text);
    const hasAbsoluteDate =
      /\d/.test(text) || new RegExp(`\\b(?:${MONTH_PATTERN})\\b`, 'i').test(text);
    if (bareWeekday && !hasAbsoluteDate) {
      const weekdayName = bareWeekday[1]!.toLowerCase();
      const target = WEEKDAYS[weekdayName]!;
      let delta = (referenceDay.weekday - target + 7) % 7;
      const mostRecent = referenceDay.minus({ days: delta });
      const previous = mostRecent.minus({ days: 7 });
      const reason = 'Bare weekday could refer to more than one date.';
      const first = buildDay(
        mostRecent.year,
        mostRecent.month,
        mostRecent.day,
        options.timezone,
        bareWeekday[0],
        true,
        reason,
      );
      const second = buildDay(
        previous.year,
        previous.month,
        previous.day,
        options.timezone,
        bareWeekday[0],
        true,
        reason,
      );
      if (first) candidates.push(first);
      if (second) candidates.push(second);
      handledWeekdays.add(weekdayName);
      handledPhrases.push(bareWeekday[0]);
    }
  }

  const numeric = numericCandidates(text, options.timezone);
  if (numeric.length > 0) {
    candidates.push(...numeric);
    handledPhrases.push(numeric[0]!.phrase);
  }

  const parsed = chrono.parse(text, options.reference);
  for (const result of parsed) {
    const lower = result.text.toLowerCase();
    if (overlapsUnsupported(result.text, unsupportedPhrases)) continue;
    if (handledPhrases.some((phrase) => lower.includes(phrase.toLowerCase()))) {
      continue;
    }
    if (
      handledWeekdays.size > 0 &&
      [...handledWeekdays].some((weekday) => lower.includes(weekday))
    ) {
      continue;
    }
    if (/\b(?:today|now|currently|right now|as of today)\b/i.test(lower)) continue;
    if (/\b(?:yesterday|tomorrow)\b/i.test(lower)) continue;

    const candidate = absoluteCandidate(result, referenceDay, options.timezone);
    if (candidate) candidates.push(candidate);
  }

  if (candidates.length === 0 && !comparison) {
    const fallback = monthDayFallback(text, referenceDay, options.timezone);
    if (fallback) candidates.push(fallback);
  }

  if (candidates.length === 0 && !comparison) {
    const yearOnly = /^\s*(?:in\s+)?((?:19|20)\d{2})\s*$/i.exec(text);
    if (yearOnly) {
      const candidate = buildYear(Number(yearOnly[1]), options.timezone, yearOnly[0]);
      if (candidate) candidates.push(candidate);
    }
  }

  const deduplicated = new Map<string, DateCandidate>();
  for (const candidate of candidates) {
    const key = `${candidate.startUtc}|${candidate.endUtcExclusive}|${candidate.phrase}`;
    if (!deduplicated.has(key)) deduplicated.set(key, candidate);
  }
  const finalCandidates = [...deduplicated.values()].sort((left, right) =>
    left.startUtc.localeCompare(right.startUtc),
  );

  const distinctWindows = new Set(
    finalCandidates.map((candidate) => candidate.startLocalDate),
  );
  const ambiguous =
    finalCandidates.some((candidate) => candidate.ambiguous) ||
    distinctWindows.size > 1;
  const phrases = unique([
    ...finalCandidates.map((candidate) => candidate.phrase),
    ...(comparison ? [comparison.phrase] : []),
  ]);

  let unsupportedReason: string | null = null;
  if (finalCandidates.length === 0 && !comparison) {
    const explicitDate = new RegExp(
      `\\b(?:\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[/.]\\d{1,2}(?:[/.]\\d{2,4})?|(?:${MONTH_PATTERN})\\s+\\d{1,2}(?:,?\\s+\\d{4})?)\\b`,
      'i',
    ).exec(text);
    if (explicitDate && !unsupportedPhrases.includes(explicitDate[0])) {
      unsupportedPhrases.push(explicitDate[0]);
    }
    if (unsupportedPhrases.length > 0) {
      unsupportedReason = `Unsupported date phrase: ${unsupportedPhrases.join(', ')}.`;
    } else if (text.trim().length === 0) {
      unsupportedReason = 'No date phrase was provided.';
    } else {
      unsupportedReason = 'No supported calendar date was found.';
    }
  }

  return {
    text: phrases.length > 0 ? phrases.join(' | ').slice(0, 500) : null,
    referenceLocalDate,
    timezone: options.timezone,
    candidates: finalCandidates,
    comparison,
    ambiguous,
    unsupportedPhrases,
    unsupportedReason,
  };
}
