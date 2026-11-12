import { spawn } from 'node:child_process';

const children = [];
let shuttingDown = false;

function run(command, args) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  children.push(child);
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    if (signal) {
      shutdown(1);
      return;
    }
    shutdown(code ?? 0);
  });
  child.on('error', (error) => {
    console.error(`failed to start ${command}:`, error.message);
    shutdown(1);
  });
  return child;
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  process.exit(code);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

run('tsx', ['watch', 'server/index.ts']);
run('vite', []);
