import path from 'node:path';
import { SystemClock } from './clock.js';
import { loadLocalEnv, parseConfig } from './config.js';
import { closeDatabase, openDatabase } from './db/connection.js';
import { createApp } from './http/app.js';
import { RunEventWriter } from './runs/events.js';
import { recoverInterruptedRuns } from './runs/lifecycle.js';
import { RunAbortRegistry } from './runs/registry.js';

loadLocalEnv();

const config = parseConfig();
const clock = new SystemClock();
const database = openDatabase({
  filePath: path.join(config.dataDir, 'minimi.db'),
});
const registry = new RunAbortRegistry();
const events = new RunEventWriter({ database, clock });
const interrupted = recoverInterruptedRuns(database, clock, registry);
if (interrupted > 0) {
  console.log(`Marked ${interrupted} active run(s) from a previous process as interrupted.`);
}

const app = createApp({
  config,
  database,
  clock,
  registry,
  events,
  executor: null,
});

const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Minimi agent listening on http://127.0.0.1:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  if (!config.openaiApiKey || !config.openaiModel) {
    console.log('OpenAI configuration is incomplete; live generation is unavailable.');
  }
  if (!config.tavilyApiKey) {
    console.log('Tavily configuration is incomplete; web search is unavailable.');
  }
});

let closing = false;
function shutdown(signal: string): void {
  if (closing) return;
  closing = true;
  registry.abortAll();
  console.log(`Received ${signal}; shutting down.`);
  server.close((error) => {
    if (error) {
      console.error('Shutdown failed:', error.message);
      process.exitCode = 1;
    }
    try {
      events.close();
    } catch (closeError) {
      console.error(
        'Event shutdown failed:',
        closeError instanceof Error ? closeError.message : 'unknown error',
      );
      process.exitCode = 1;
    }
    try {
      closeDatabase(database);
    } catch (closeError) {
      console.error(
        'Database shutdown failed:',
        closeError instanceof Error ? closeError.message : 'unknown error',
      );
      process.exitCode = 1;
    }
    process.exit();
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
