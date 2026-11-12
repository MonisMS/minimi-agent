import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';
import { readinessFromConfig, type AppConfig } from '../config.js';

export interface AppDependencies {
  config: AppConfig;
  clientDir?: string;
  executorAvailable?: boolean;
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.get('/api/readiness', (_req, res) => {
    res.json(readinessFromConfig(deps.config, {
      executorAvailable: deps.executorAvailable ?? false,
    }));
  });
  const clientDir = deps.clientDir ?? path.resolve(process.cwd(), 'dist/client');
  const clientIndex = path.join(clientDir, 'index.html');
  if (existsSync(clientIndex)) {
    app.use(express.static(clientDir, { index: false }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(clientIndex));
  } else {
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.type('html').send('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Minimi agent</title><h1>Minimi agent</h1><p>The client build is not present. Run npm run dev or npm run build.</p><p>No answer is generated in this checkpoint.</p></html>');
    });
  }
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: {
      code: 'not_found', userMessage: 'The requested resource was not found.',
      retryable: false, runId: null,
    } });
  });
  return app;
}
