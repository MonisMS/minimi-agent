import path from 'node:path';
import { SystemClock } from './clock.js';
import { recoverInterruptedRuns } from './runs/lifecycle.js';
import { RunAbortRegistry } from './runs/registry.js';
import { loadLocalEnv, parseConfig } from './config.js';
import { closeDatabase, openDatabase } from './db/connection.js';
import { createApp } from './http/app.js';

loadLocalEnv();
const config = parseConfig();
const database = openDatabase({ filePath: path.join(config.dataDir, 'minimi.db') });
const clock = new SystemClock();
const registry = new RunAbortRegistry();
const interrupted = recoverInterruptedRuns(database, clock, registry);
if (interrupted > 0) console.log(`Marked ${interrupted} previous run(s) interrupted.`);
const app = createApp({ config });
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Minimi foundation listening on http://127.0.0.1:${config.port}`);
  console.log('Foundation/storage checkpoint: live generation is not implemented.');
});
let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  registry.abortAll();
  server.close((error) => {
    try { closeDatabase(database); }
    catch { process.exitCode = 1; }
    if (error) process.exitCode = 1;
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
