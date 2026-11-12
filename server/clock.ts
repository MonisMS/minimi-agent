export interface Clock {
  now(): Date;
  monotonicMs(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  monotonicMs(): number {
    return performance.now();
  }
}

export class ManualClock implements Clock {
  private wallMs: number;
  private monotonic: number;

  constructor(start: Date = new Date('2026-11-12T00:00:00.000Z'), monotonicStart = 0) {
    this.wallMs = start.getTime();
    this.monotonic = monotonicStart;
  }

  now(): Date {
    return new Date(this.wallMs);
  }

  monotonicMs(): number {
    return this.monotonic;
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError('advance requires a non-negative finite duration');
    }
    this.wallMs += milliseconds;
    this.monotonic += milliseconds;
  }
}
