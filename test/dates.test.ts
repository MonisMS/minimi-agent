import { describe, expect, it } from 'vitest';
import { interpretDateText } from '../server/memory/dates.js';

function interpret(text: string, referenceIso: string, timezone: string) {
  return interpretDateText(text, {
    reference: new Date(referenceIso),
    timezone,
  });
}

describe('calendar windows (F07-F09)', () => {
  it('uses local midnight in Asia/Kolkata rather than a UTC-day window', () => {
    const result = interpret('3 November 2026', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(result.referenceLocalDate).toBe('2026-11-12');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      phrase: '3 November 2026',
      kind: 'day',
      startLocalDate: '2026-11-03',
      endLocalDateExclusive: '2026-11-04',
      startUtc: '2026-11-02T18:30:00Z',
      endUtcExclusive: '2026-11-03T18:30:00Z',
      timezone: 'Asia/Kolkata',
      days: 1,
      ambiguous: false,
    });
    expect(result.ambiguous).toBe(false);
    expect(result.comparison).toBeNull();
  });

  it('matches the same local date in different user zones with different UTC bounds', () => {
    const kolkata = interpret('3 November', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');
    const newYork = interpret('3 November', '2026-11-12T04:30:00.000Z', 'America/New_York');

    expect(kolkata.candidates[0]?.startLocalDate).toBe('2026-11-03');
    expect(newYork.candidates[0]?.startLocalDate).toBe('2026-11-03');
    expect(kolkata.candidates[0]?.startUtc).toBe('2026-11-02T18:30:00Z');
    expect(newYork.candidates[0]?.startUtc).toBe('2026-11-03T05:00:00Z');
    expect(kolkata.candidates[0]?.endUtcExclusive).not.toBe(
      newYork.candidates[0]?.endUtcExclusive,
    );
  });

  it('uses 25-hour calendar days when New York leaves daylight saving time', () => {
    const result = interpret('1 November 2026', '2026-11-12T15:00:00.000Z', 'America/New_York');

    expect(result.candidates[0]).toMatchObject({
      startLocalDate: '2026-11-01',
      endLocalDateExclusive: '2026-11-02',
      startUtc: '2026-11-01T04:00:00Z',
      endUtcExclusive: '2026-11-02T05:00:00Z',
      days: 1,
    });
    const start = Date.parse(result.candidates[0]!.startUtc);
    const end = Date.parse(result.candidates[0]!.endUtcExclusive);
    expect(end - start).toBe(25 * 60 * 60 * 1000);
  });

  it('uses 23-hour calendar days when New York enters daylight saving time', () => {
    const result = interpret('8 March 2026', '2026-11-12T15:00:00.000Z', 'America/New_York');

    expect(result.candidates[0]).toMatchObject({
      startLocalDate: '2026-03-08',
      endLocalDateExclusive: '2026-03-09',
      startUtc: '2026-03-08T05:00:00Z',
      endUtcExclusive: '2026-03-09T04:00:00Z',
      days: 1,
    });
    const start = Date.parse(result.candidates[0]!.startUtc);
    const end = Date.parse(result.candidates[0]!.endUtcExclusive);
    expect(end - start).toBe(23 * 60 * 60 * 1000);
  });

  it('keeps 3 November separate from today', () => {
    const result = interpret(
      'On 3 November, is it still right today?',
      '2026-11-12T04:30:00.000Z',
      'Asia/Kolkata',
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.startLocalDate).toBe('2026-11-03');
    expect(result.comparison?.startLocalDate).toBe('2026-11-12');
    expect(result.ambiguous).toBe(false);
    expect(result.text).toContain('3 November');
    expect(result.text).toContain('today');
  });
});

describe('missing years, explicit years and invalid dates', () => {
  it('interprets a missing year as the most recent past occurrence', () => {
    const before = interpret('3 November', '2026-11-02T04:30:00.000Z', 'Asia/Kolkata');
    const after = interpret('3 November', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(before.candidates[0]?.startLocalDate).toBe('2025-11-03');
    expect(after.candidates[0]?.startLocalDate).toBe('2026-11-03');
  });

  it('keeps an explicit year even when it is in the past', () => {
    const result = interpret('3 November 2025', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(result.candidates[0]?.startLocalDate).toBe('2025-11-03');
  });

  it('accepts a leap day only when the year supports it', () => {
    const missingYear = interpret('29 February', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');
    const leapYear = interpret('29 February 2024', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');
    const nonLeapYear = interpret('29 February 2025', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');
    const impossible = interpret('31 February 2026', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(missingYear.candidates[0]?.startLocalDate).toBe('2024-02-29');
    expect(leapYear.candidates[0]?.startLocalDate).toBe('2024-02-29');
    expect(nonLeapYear.candidates).toEqual([]);
    expect(nonLeapYear.unsupportedReason).not.toBeNull();
    expect(impossible.candidates).toEqual([]);
    expect(impossible.unsupportedReason).not.toBeNull();
  });

  it('expands explicit ranges with an exclusive end', () => {
    const result = interpret('3-5 November 2026', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(result.candidates[0]).toMatchObject({
      kind: 'range',
      startLocalDate: '2026-11-03',
      endLocalDateExclusive: '2026-11-06',
      days: 3,
    });
  });

  it('supports month and year windows', () => {
    const month = interpret('November 2026', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');
    const year = interpret('in 2026', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(month.candidates[0]).toMatchObject({
      kind: 'month',
      startLocalDate: '2026-11-01',
      endLocalDateExclusive: '2026-12-01',
      days: 30,
    });
    expect(year.candidates[0]).toMatchObject({
      kind: 'year',
      startLocalDate: '2026-01-01',
      endLocalDateExclusive: '2027-01-01',
      days: 365,
    });
  });
});

describe('ambiguous and unsupported language', () => {
  it('keeps relative weekdays unambiguous', () => {
    const last = interpret('last Tuesday', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');
    const next = interpret('next Tuesday', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(last.candidates[0]?.startLocalDate).toBe('2026-11-10');
    expect(last.ambiguous).toBe(false);
    expect(next.candidates[0]?.startLocalDate).toBe('2026-11-17');
    expect(next.ambiguous).toBe(false);
  });

  it('returns both recent bare weekday candidates and marks the phrase ambiguous', () => {
    const result = interpret('Tuesday', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(result.candidates.map((candidate) => candidate.startLocalDate)).toEqual([
      '2026-11-03',
      '2026-11-10',
    ]);
    expect(result.ambiguous).toBe(true);
    expect(result.candidates.every((candidate) => candidate.ambiguous)).toBe(true);
  });

  it('marks ambiguous numeric dates instead of choosing an order', () => {
    const result = interpret('3/11/2026', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(result.candidates.map((candidate) => candidate.startLocalDate).sort()).toEqual([
      '2026-03-11',
      '2026-11-03',
    ]);
    expect(result.ambiguous).toBe(true);
  });

  it('documents unsupported phrases instead of fabricating dates', () => {
    for (const phrase of ['sometime last week', 'the other day', 'a while ago', '3 days ago']) {
      const result = interpret(phrase, '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');
      expect(result.candidates).toEqual([]);
      expect(result.unsupportedPhrases.length).toBeGreaterThan(0);
      expect(result.unsupportedReason).not.toBeNull();
    }
  });

  it('returns a comparison-only interpretation for today', () => {
    const result = interpret('today', '2026-11-12T04:30:00.000Z', 'Asia/Kolkata');

    expect(result.candidates).toEqual([]);
    expect(result.comparison?.startLocalDate).toBe('2026-11-12');
    expect(result.unsupportedReason).toBeNull();
  });

  it('rejects an invalid IANA zone', () => {
    expect(() =>
      interpret('3 November', '2026-11-12T04:30:00.000Z', 'Mars/Olympus'),
    ).toThrow();
  });
});
