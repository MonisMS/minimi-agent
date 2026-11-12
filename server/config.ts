import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { z } from 'zod';

export interface RunLimits {
  maxModelCalls: number;
  maxSearchQueries: number;
  maxSearchBatches: number;
  searchConcurrency: number;
  maxRunMs: number;
  acquisitionCutoffMs: number;
  activeRunPerConversation: number;
  processActiveRuns: number;
}

export const DEFAULT_LIMITS: RunLimits = {
  maxModelCalls: 4,
  maxSearchQueries: 12,
  maxSearchBatches: 3,
  searchConcurrency: 3,
  maxRunMs: 120_000,
  acquisitionCutoffMs: 100_000,
  activeRunPerConversation: 1,
  processActiveRuns: 2,
};

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  dataDir: string;
  openaiApiKey: string | null;
  openaiModel: string | null;
  tavilyApiKey: string | null;
  limits: RunLimits;
}

export interface Readiness {
  ok: true;
  mode: 'live' | 'offline';
  model: string | null;
  configured: {
    openai: boolean;
    tavily: boolean;
  };
  capabilities: {
    liveGeneration: boolean;
    search: boolean;
  };
  notes: string[];
}

export interface ReadinessOptions {
  executorAvailable?: boolean;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATA_DIR: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  TAVILY_API_KEY: optionalString,
  MAX_MODEL_CALLS: z.coerce.number().int().positive().default(DEFAULT_LIMITS.maxModelCalls),
  MAX_SEARCH_QUERIES: z.coerce.number().int().positive().default(DEFAULT_LIMITS.maxSearchQueries),
  MAX_SEARCH_BATCHES: z.coerce.number().int().positive().default(DEFAULT_LIMITS.maxSearchBatches),
  SEARCH_CONCURRENCY: z.coerce.number().int().positive().default(DEFAULT_LIMITS.searchConcurrency),
  MAX_RUN_MS: z.coerce.number().int().positive().default(DEFAULT_LIMITS.maxRunMs),
  ACQUISITION_CUTOFF_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_LIMITS.acquisitionCutoffMs),
  ACTIVE_RUN_PER_CONVERSATION: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_LIMITS.activeRunPerConversation),
  PROCESS_ACTIVE_RUNS: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_LIMITS.processActiveRuns),
});

export function parseConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment configuration: ${details}`);
  }

  const value = parsed.data;
  const limits: RunLimits = {
    maxModelCalls: value.MAX_MODEL_CALLS,
    maxSearchQueries: value.MAX_SEARCH_QUERIES,
    maxSearchBatches: value.MAX_SEARCH_BATCHES,
    searchConcurrency: value.SEARCH_CONCURRENCY,
    maxRunMs: value.MAX_RUN_MS,
    acquisitionCutoffMs: value.ACQUISITION_CUTOFF_MS,
    activeRunPerConversation: value.ACTIVE_RUN_PER_CONVERSATION,
    processActiveRuns: value.PROCESS_ACTIVE_RUNS,
  };

  if (limits.acquisitionCutoffMs >= limits.maxRunMs) {
    throw new ConfigError('ACQUISITION_CUTOFF_MS must be smaller than MAX_RUN_MS');
  }

  return {
    nodeEnv: value.NODE_ENV,
    port: value.PORT,
    dataDir: path.resolve(process.cwd(), value.DATA_DIR ?? 'data'),
    openaiApiKey: value.OPENAI_API_KEY ?? null,
    openaiModel: value.OPENAI_MODEL ?? null,
    tavilyApiKey: value.TAVILY_API_KEY ?? null,
    limits,
  };
}

export function readinessFromConfig(
  config: AppConfig,
  options: ReadinessOptions = {},
): Readiness {
  const openaiConfigured = Boolean(config.openaiApiKey && config.openaiModel);
  const tavilyConfigured = Boolean(config.tavilyApiKey);
  const executorAvailable = options.executorAvailable ?? false;
  const liveGeneration = openaiConfigured && executorAvailable;
  const notes: string[] = [];

  if (!openaiConfigured) {
    notes.push('OPENAI_API_KEY and OPENAI_MODEL are required for live generation.');
  }
  if (!tavilyConfigured) {
    notes.push('TAVILY_API_KEY is required for web search.');
  }
  if (openaiConfigured && !executorAvailable) {
    notes.push('Live execution is not available in this checkpoint.');
  }
  if (!openaiConfigured && !tavilyConfigured) {
    notes.push('Saved history and the offline walkthrough remain available.');
  }

  return {
    ok: true,
    mode: liveGeneration ? 'live' : 'offline',
    model: config.openaiModel,
    configured: {
      openai: openaiConfigured,
      tavily: tavilyConfigured,
    },
    capabilities: {
      liveGeneration,
      search: tavilyConfigured,
    },
    notes,
  };
}

export function loadLocalEnv(file = path.resolve(process.cwd(), '.env')): void {
  if (existsSync(file)) {
    loadEnvFile(file);
  }
}
