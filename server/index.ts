import path from 'node:path';
import { loadLocalEnv, parseConfig } from './config.js';
import { closeDatabase, openDatabase } from './db/connection.js';
import { createApp } from './http/app.js';

loadLocalEnv();
const config = parseConfig();
const database = openDatabase({ filePath: path.join(config.dataDir, 'minimi.db') });
const app = createApp({ config });
const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`Minimi foundation listening on http://127.0.0.1:${config.port}`);
  console.log('Foundation/storage checkpoint: live generation is not implemented.');
});
let closing = false;
function shutdown(): void {
  if (closing) return;
  closing = true;
  server.close((error) => {
    try { closeDatabase(database); }
    catch { process.exitCode = 1; }
    if (error) process.exitCode = 1;
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
