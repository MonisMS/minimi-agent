import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig, readinessFromConfig } from '../server/config.js';
import { createApp } from '../server/http/app.js';

const temporaryDirectories: string[] = [];

function makeTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'minimi-foundation-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

describe('configuration', () => {
  it('parses without credentials and reports an honest offline readiness', () => {
    const config = parseConfig({});

    expect(config.port).toBe(3000);
    expect(config.openaiApiKey).toBeNull();
    expect(config.openaiModel).toBeNull();
    expect(config.tavilyApiKey).toBeNull();

    const readiness = readinessFromConfig(config);
    expect(readiness.ok).toBe(true);
    expect(readiness.mode).toBe('offline');
    expect(readiness.capabilities.liveGeneration).toBe(false);
    expect(readiness.capabilities.search).toBe(false);
    expect(readiness.notes.length).toBeGreaterThan(0);
  });

  it('never returns secret values in readiness', () => {
    const openaiKey = 'sk-test-secret-value';
    const tavilyKey = 'tvly-test-secret-value';
    const config = parseConfig({
      OPENAI_API_KEY: openaiKey,
      OPENAI_MODEL: 'test-model',
      TAVILY_API_KEY: tavilyKey,
    });

    const readiness = readinessFromConfig(config, { executorAvailable: true });
    const serialized = JSON.stringify(readiness);

    expect(readiness.mode).toBe('live');
    expect(readiness.model).toBe('test-model');
    expect(readiness.capabilities.liveGeneration).toBe(true);
    expect(serialized).not.toContain(openaiKey);
    expect(serialized).not.toContain(tavilyKey);
  });

  it('rejects an acquisition cutoff that is not before the hard deadline', () => {
    expect(() =>
      parseConfig({ MAX_RUN_MS: '1000', ACQUISITION_CUTOFF_MS: '1000' }),
    ).toThrowError(/ACQUISITION_CUTOFF_MS/);
  });
});

describe('HTTP foundation', () => {
  it('serves readiness through the constructed app without a background server', async () => {
    const config = parseConfig({});
    const app = createApp({
      config,
      clientDir: path.join(makeTemporaryDirectory(), 'missing-client'),
    });
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no server address');
      const response = await fetch(`http://127.0.0.1:${address.port}/api/readiness`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { mode: string; ok: boolean };
      expect(body.ok).toBe(true);
      expect(body.mode).toBe('offline');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('serves an explicit static fallback instead of inventing chat output', async () => {
    const config = parseConfig({});
    const app = createApp({
      config,
      clientDir: path.join(makeTemporaryDirectory(), 'missing-client'),
    });
    const server = app.listen(0, '127.0.0.1');
    try {
      await new Promise<void>((resolve) => server.once('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no server address');
      const response = await fetch(`http://127.0.0.1:${address.port}/`);
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body).toContain('client build is not present');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe('runtime storage capability', () => {
  it('opens node:sqlite and uses FTS5 on the selected Node runtime', () => {
    const directory = makeTemporaryDirectory();
    const database = new DatabaseSync(path.join(directory, 'probe.db'));
    try {
      database.exec('CREATE VIRTUAL TABLE messages_fts USING fts5(body)');
      database.prepare('INSERT INTO messages_fts(body) VALUES (?)').run('hello durable world');
      const rows = database
        .prepare('SELECT body FROM messages_fts WHERE messages_fts MATCH ?')
        .all('durable') as Array<{ body: string }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.body).toContain('durable');
    } finally {
      database.close();
    }
  });
});
