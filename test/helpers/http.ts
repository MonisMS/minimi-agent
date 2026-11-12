import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { ManualClock } from '../../server/clock.js';
import { parseConfig } from '../../server/config.js';
import { openInMemoryDatabase } from '../../server/db/connection.js';
import { createApp } from '../../server/http/app.js';
import { RunEventWriter } from '../../server/runs/events.js';
import type { RunExecutor } from '../../server/runs/executor.js';
import { RunAbortRegistry } from '../../server/runs/registry.js';
import {
  eventEnvelopeSchema,
  type EventEnvelope,
} from '../../shared/events.js';

export interface Harness {
  baseUrl: string;
  database: DatabaseSync;
  clock: ManualClock;
  registry: RunAbortRegistry;
  events: RunEventWriter;
  close(): Promise<void>;
}

export async function startHarness(
  executor: RunExecutor | null,
): Promise<Harness> {
  const database = openInMemoryDatabase();
  const clock = new ManualClock();
  const registry = new RunAbortRegistry();
  const events = new RunEventWriter({ database, clock, deltaFlushMs: 1 });
  const config = parseConfig({ NODE_ENV: 'test' });
  const clientDir = mkdtempSync(path.join(tmpdir(), 'minimi-http-'));
  const app = createApp({
    config,
    database,
    clock,
    registry,
    events,
    executor,
    clientDir,
  });
  const server: Server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    database,
    clock,
    registry,
    events,
    async close() {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
      events.close();
      database.close();
      rmSync(clientDir, { recursive: true, force: true });
    },
  };
}

export class TestClient {
  cookie: string | null = null;

  constructor(private readonly baseUrl: string) {}

  async request(pathname: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookie && !headers.has('cookie')) {
      headers.set('cookie', this.cookie);
    }
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...init,
      headers,
    });
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      this.cookie = setCookie.split(';')[0] ?? null;
    }
    return response;
  }

  async createConversation(title: string | null = null): Promise<string> {
    const response = await this.request('/api/conversations', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (response.status !== 201) {
      throw new Error(`Conversation creation failed with ${response.status}`);
    }
    const body = (await response.json()) as {
      conversation: { id: string };
    };
    return body.conversation.id;
  }

  async createRun(
    conversationId: string,
    message: string,
    requestKey: string,
  ): Promise<{ runId: string; questionId: string; existing: boolean }> {
    const response = await this.request('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        conversationId,
        message,
        timezone: 'UTC',
        requestKey,
      }),
    });
    if (response.status !== 202 && response.status !== 200) {
      throw new Error(`Run creation failed with ${response.status}`);
    }
    return (await response.json()) as {
      runId: string;
      questionId: string;
      existing: boolean;
    };
  }

  async getRun(runId: string): Promise<{
    id: string;
    state: string;
    version: number;
    eventSeq: number;
    answerText: string | null;
  }> {
    const response = await this.request(`/api/runs/${runId}`);
    if (response.status !== 200) {
      throw new Error(`Run lookup failed with ${response.status}`);
    }
    return (await response.json()) as {
      id: string;
      state: string;
      version: number;
      eventSeq: number;
      answerText: string | null;
    };
  }

  async waitForRun(
    runId: string,
    predicate: (run: Awaited<ReturnType<TestClient['getRun']>>) => boolean,
    timeoutMs = 3000,
  ): Promise<Awaited<ReturnType<TestClient['getRun']>>> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const run = await this.getRun(runId);
      if (predicate(run)) return run;
      await delay(10);
    }
    throw new Error(`Timed out waiting for run ${runId}`);
  }
}

export interface SseEvent {
  id: number | null;
  event: string;
  data: EventEnvelope;
}

function parseSseBlock(block: string): SseEvent | null {
  let id: number | null = null;
  let eventName: string | null = null;
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('id:')) {
      const value = Number(line.slice(3).trim());
      id = Number.isInteger(value) ? value : null;
    } else if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (dataLines.length === 0) return null;
  const data = eventEnvelopeSchema.parse(JSON.parse(dataLines.join('\n')) as unknown);
  return {
    id,
    event: eventName ?? data.type,
    data,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out waiting for SSE data')), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class SseReader {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private buffer = '';
  private ended = false;

  constructor(response: Response) {
    if (!response.body) throw new Error('SSE response has no body');
    this.reader = response.body.getReader();
  }

  async next(timeoutMs = 3000): Promise<SseEvent | null> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const separator = this.buffer.indexOf('\n\n');
      if (separator >= 0) {
        const block = this.buffer.slice(0, separator);
        this.buffer = this.buffer.slice(separator + 2);
        const parsed = parseSseBlock(block);
        if (parsed) return parsed;
        continue;
      }
      if (this.ended) return null;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out waiting for SSE event');
      const result = await withTimeout(this.reader.read(), remaining);
      if (result.done) {
        this.ended = true;
        return null;
      }
      this.buffer += this.decoder.decode(result.value, { stream: true });
    }
  }

  async collectUntilDone(timeoutMs = 3000): Promise<SseEvent[]> {
    const events: SseEvent[] = [];
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const event = await this.next(Math.max(1, deadline - Date.now()));
      if (!event) break;
      events.push(event);
      if (event.data.type === 'done') break;
    }
    return events;
  }

  async close(): Promise<void> {
    await this.reader.cancel().catch(() => undefined);
  }
}

export async function openSse(
  client: TestClient,
  runId: string,
): Promise<SseReader> {
  const response = await client.request(`/api/runs/${runId}/events`);
  if (response.status !== 200) {
    throw new Error(`SSE open failed with ${response.status}`);
  }
  return new SseReader(response);
}

export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForCondition(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error('Timed out waiting for condition');
}
