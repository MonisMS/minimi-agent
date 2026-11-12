import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import express, { type Express } from 'express';
import { readinessFromConfig, type AppConfig } from '../config.js';
import type { Clock } from '../clock.js';
import type { RunEventWriter } from '../runs/events.js';
import type { RunExecutor } from '../runs/executor.js';
import type { RunAbortRegistry } from '../runs/registry.js';
import { apiErrorHandler, createApiRouter } from './routes.js';

export interface AppDependencies {
  config: AppConfig;
  clientDir?: string;
  executorAvailable?: boolean;
  database?: DatabaseSync;
  clock?: Clock;
  registry?: RunAbortRegistry;
  events?: RunEventWriter;
  executor?: RunExecutor | null;
}

const FALLBACK_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Minimi agent</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 3rem auto; max-width: 42rem; padding: 0 1rem; color: #1f2933; }
      code { background: #eef2f7; padding: 0.15rem 0.35rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <h1>Minimi agent</h1>
    <p>The client build is not present. Run <code>npm run dev</code> for development or <code>npm run build</code> for a production build.</p>
    <p>Readiness is available at <code>/api/readiness</code>. Live answers require server-side provider configuration.</p>
  </body>
</html>`;

export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/api/readiness', (_req, res) => {
    res.json(
      readinessFromConfig(deps.config, {
        executorAvailable: deps.executorAvailable ?? Boolean(deps.executor),
      }),
    );
  });

  const { database, clock, registry, events } = deps;
  if (database && clock && registry && events) {
    app.use(
      '/api',
      createApiRouter({
        config: deps.config,
        database,
        clock,
        registry,
        events,
        executor: deps.executor ?? null,
      }),
    );
  }

  const clientDir = deps.clientDir ?? path.resolve(process.cwd(), 'dist/client');
  const clientIndex = path.join(clientDir, 'index.html');
  if (existsSync(clientIndex)) {
    app.use(express.static(clientDir, { index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(clientIndex);
    });
  } else {
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.type('html').send(FALLBACK_HTML);
    });
  }

  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: {
        code: 'not_found',
        userMessage: 'The requested resource was not found.',
        retryable: false,
        runId: null,
      },
    });
  });

  app.use(apiErrorHandler);

  return app;
}
