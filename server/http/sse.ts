import type { Request, Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../clock.js';
import type { Scope } from '../db/conversations.js';
import { getRun, type RunRecord } from '../db/runs.js';
import { isTerminalRunState } from '../../shared/domain.js';
import {
  snapshotEventSchema,
  type EventEnvelope,
  type SnapshotEvent,
} from '../../shared/events.js';
import { runViewSchema } from '../../shared/api.js';
import type { RunEventWriter } from '../runs/events.js';
import { RunNotFoundError } from '../runs/errors.js';

const HEARTBEAT_MS = 15_000;

function writeEvent(res: Response, event: EventEnvelope): void {
  res.write(`id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}

function snapshotFor(run: RunRecord, clock: Clock, seq: number): SnapshotEvent {
  const view = runViewSchema.parse({
    ...run,
    answerText: run.answerText,
  });
  return snapshotEventSchema.parse({
    version: 1,
    runId: run.id,
    conversationId: run.conversationId,
    seq,
    timestamp: clock.now().toISOString(),
    type: 'snapshot',
    payload: {
      run: view,
      answerText: run.answerText,
      terminal: isTerminalRunState(run.state),
      resultId: run.resultId,
    },
  });
}

export interface StreamRunEventsOptions {
  req: Request;
  res: Response;
  database: DatabaseSync;
  scope: Scope;
  runId: string;
  events: RunEventWriter;
  clock: Clock;
}

export function streamRunEvents(options: StreamRunEventsOptions): void {
  const { req, res, database, scope, runId, events, clock } = options;

  let ended = false;
  let live = false;
  let lastSentSeq = -1;
  const pending: EventEnvelope[] = [];
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: () => void = () => {};

  const cleanup = (): void => {
    if (ended) return;
    ended = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    unsubscribe();
  };

  const finish = (): void => {
    if (ended) return;
    cleanup();
    if (!res.writableEnded) res.end();
  };

  const deliver = (event: EventEnvelope): void => {
    if (ended) return;
    const isTerminalEvent = event.type === 'done' || event.type === 'error';
    if (!isTerminalEvent && event.seq <= lastSentSeq) return;
    writeEvent(res, event);
    if (event.seq > lastSentSeq) lastSentSeq = event.seq;
    if (event.type === 'done') finish();
  };

  unsubscribe = events.bus.subscribe(runId, (event) => {
    if (ended) return;
    if (!live) {
      pending.push(event);
      return;
    }
    deliver(event);
  });

  let current: RunRecord | null;
  try {
    current = getRun(database, scope, runId);
  } catch (error) {
    unsubscribe();
    throw error;
  }
  if (!current) {
    unsubscribe();
    throw new RunNotFoundError();
  }

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  req.on('close', cleanup);
  res.on('close', cleanup);

  let terminal = isTerminalRunState(current.state)
    ? events.getTerminalEvent(scope, runId)
    : null;
  if (isTerminalRunState(current.state) && terminal?.type !== 'done') {
    terminal = events.append(scope, runId, 'done', {
      state: current.state,
      completedAt: current.completedAt,
    });
  }
  const snapshotSeq = terminal ? Math.max(0, terminal.seq - 1) : current.eventSeq;
  lastSentSeq = snapshotSeq;
  writeEvent(res, snapshotFor(current, clock, snapshotSeq));

  if (terminal) {
    writeEvent(res, terminal);
    finish();
    return;
  }

  for (const event of events.listAfter(scope, runId, lastSentSeq)) {
    deliver(event);
    if (ended) return;
  }

  live = true;
  for (const event of pending.splice(0)) {
    deliver(event);
    if (ended) return;
  }

  heartbeat = setInterval(() => {
    if (!ended) res.write(': keep-alive\n\n');
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
}
