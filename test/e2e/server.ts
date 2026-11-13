import path from 'node:path';
import { ManualClock } from '../../server/clock.js';
import { parseConfig } from '../../server/config.js';
import { openInMemoryDatabase } from '../../server/db/connection.js';
import { createApp } from '../../server/http/app.js';
import type { RunExecutor } from '../../server/runs/executor.js';
import { RunEventWriter } from '../../server/runs/events.js';
import { RunAbortRegistry } from '../../server/runs/registry.js';

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error('aborted'));
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

const executor: RunExecutor = {
  async execute(execution) {
    execution.signal.throwIfAborted();
    execution.setState('recalling');
    execution.setState('generating');
    execution.emitDelta('Answer: ');
    const waitMs = execution.question.originalText.toLowerCase().includes('slow') ? 1_500 : 160;
    await delay(waitMs, execution.signal);
    execution.signal.throwIfAborted();
    const answerText = `Answer: ${execution.question.originalText}`;
    execution.emitDelta(execution.question.originalText);
    execution.checkpoint(answerText);
    execution.complete({ answerText });
  },
};

const port = Number(process.env.PORT ?? 4173);
const config = parseConfig({ NODE_ENV: 'test', PORT: String(port) });
const database = openInMemoryDatabase();
const clock = new ManualClock();
const registry = new RunAbortRegistry();
const events = new RunEventWriter({ database, clock, deltaFlushMs: 1 });
const app = createApp({
  config,
  database,
  clock,
  registry,
  events,
  executor,
  namespace: 'demo',
  clientDir: path.resolve('dist/client'),
});
const server = app.listen(port, '127.0.0.1', () => {
  process.stdout.write(`E2E test server listening on http://127.0.0.1:${port}\n`);
});

function close(): void {
  server.close(() => {
    events.close();
    database.close();
    process.exit(0);
  });
  server.closeAllConnections();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
