import type { DatabaseSync } from 'node:sqlite';
import {
  type ModelMessage,
  type ModelTransport,
  type SearchProvider,
} from '../../shared/domain.js';
import { parseWebSearchArguments, webSearchTool } from '../search/tool.js';
import { SearchScheduler } from '../search/scheduler.js';
import { BudgetedModelTransport, RunBudget } from '../runs/budget.js';
import type { Clock } from '../clock.js';
import type { AppConfig } from '../config.js';
import { recallHistory } from '../memory/recall.js';
import { buildConversationInput, classifyConversation } from './route.js';
import type { RunExecution, RunExecutor } from '../runs/executor.js';
import { createTavilyObservationRegistrar, TavilySearchProvider } from '../search/tavily.js';
import type { Scope } from '../db/conversations.js';
import { executeHistoricalRecheck } from './recheck.js';

export interface ChatExecutorOptions {
  database: DatabaseSync;
  clock: Clock;
  config: AppConfig;
  model: ModelTransport;
  searchProvider?: SearchProvider | null;
}

function formatToolResult(result: Awaited<ReturnType<SearchScheduler['search']>>): string {
  return JSON.stringify({
    searches: result.outcomes.map((outcome) => ({
      queryId: outcome.queryId,
      status: outcome.status,
      observationIds: outcome.observationIds,
      error: outcome.providerErrorCode,
    })),
    skippedQueryIds: result.skippedQueryIds,
    observations: result.observations.map((observation) => ({
      id: observation.id,
      title: observation.title,
      url: observation.safeCanonicalUrl,
      text: observation.exactEvidenceText,
      publishedAt: observation.publishedAt,
      effectiveAt: observation.effectiveAt,
    })),
  });
}

function modelFailure(code: string): Error {
  const error = new Error('The configured model did not complete this response.');
  Object.assign(error, { code });
  return error;
}

export function createChatExecutor(options: ChatExecutorOptions): RunExecutor {
  return {
    async execute(execution: RunExecution): Promise<void> {
      const { run, question, signal } = execution;
      const scope: Scope = { ownerId: run.ownerId, namespace: run.namespace };
      const budget = new RunBudget({ limits: options.config.limits, clock: options.clock });
      if (signal.aborted) return;
      execution.setState('recalling');
      const recall = recallHistory(options.database, {
        ...scope,
        conversationId: run.conversationId,
        questionText: question.originalText,
        reference: new Date(question.createdAt),
        timezone: question.timezone,
        currentQuestionId: question.id,
        currentRunId: run.id,
      });
      const route = classifyConversation(question.originalText);

      if (run.taskKind === 'recheck' || route.historicalRecheck) {
        await executeHistoricalRecheck({
          database: options.database, clock: options.clock, config: options.config,
          model: options.model, searchProvider: options.searchProvider,
        }, execution);
        return;
      }

      if (route.historicalRecall && recall.clarificationRequired) {
        const dates = recall.clarificationCandidates
          .map((candidate) => candidate.label)
          .join(' or ');
        execution.clarify(dates
          ? `I found more than one matching date (${dates}). Which conversation did you mean?`
          : 'Which calendar date or conversation should I look up?');
        return;
      }

      if (route.historicalRecall && recall.expanded.length === 0) {
        const answerText = recall.interpretation.candidates.length > 0
          ? 'I could not find saved messages for that date.'
          : 'I could not find matching saved messages in your conversation history.';
        execution.setState('generating');
        execution.emitDelta(answerText);
        execution.checkpoint(answerText);
        execution.complete({ answerText, usage: budget.usage() });
        return;
      }

      const turns = recall.expanded;
      const input: ModelMessage[] = buildConversationInput({
        question,
        turns,
        historicalRecall: route.historicalRecall,
      });
      const model = new BudgetedModelTransport(options.model, budget);
      const observations = new Map<string, { title: string; url: string }>();
      const searchProvider = options.searchProvider ?? (options.config.tavilyApiKey
        ? new TavilySearchProvider({
          apiKey: options.config.tavilyApiKey,
          clock: options.clock,
          registerObservation: createTavilyObservationRegistrar({
            database: options.database,
            clock: options.clock,
            scope,
            conversationId: run.conversationId,
            runId: run.id,
          }),
          concurrency: options.config.limits.searchConcurrency,
        })
        : null);
      const scheduler = searchProvider
        ? new SearchScheduler({ provider: searchProvider, budget, clock: options.clock })
        : null;
      let continuationItems: unknown[] = [];
      let finalText: string | null = null;

      for (let turn = 0; turn < options.config.limits.maxModelCalls; turn += 1) {
        signal.throwIfAborted();
        execution.setState('generating');
        let response;
        try {
          response = await model.respond({
            model: options.config.openaiModel ?? 'configured-model',
            input,
            continuationItems,
            tools: route.historicalRecall || !scheduler ? [] : [webSearchTool],
            responseFormat: null,
            temperature: null,
          }, { signal });
        } catch (error) {
          execution.recordUsage(budget.usage());
          throw error;
        }
        execution.recordUsage(budget.usage());
        continuationItems = response.continuationItems ?? [];

        if (response.status === 'refused') throw modelFailure('model_refused');
        if (response.status === 'incomplete') throw modelFailure('model_incomplete');
        if (response.status !== 'completed') throw modelFailure(response.errorCode ?? 'model_failed');

        if (response.toolCalls.length === 0) {
          finalText = response.text?.trim() || null;
          break;
        }

        execution.setState('researching');
        for (const call of response.toolCalls) {
          if (call.name !== 'web_search') {
            input.push({ role: 'tool', toolCallId: call.callId, content: JSON.stringify({ error: 'unsupported_tool' }) });
            continue;
          }
          try {
            const args = parseWebSearchArguments(call.arguments);
            if (!scheduler) {
              input.push({ role: 'tool', toolCallId: call.callId, content: JSON.stringify({ error: 'search_unavailable' }) });
              continue;
            }
            const result = await scheduler.search(args.queries, { signal });
            for (const observation of result.observations) {
              observations.set(observation.id, {
                title: observation.title,
                url: observation.safeCanonicalUrl,
              });
            }
            input.push({ role: 'tool', toolCallId: call.callId, content: formatToolResult(result) });
          } catch {
            input.push({ role: 'tool', toolCallId: call.callId, content: JSON.stringify({ error: 'search_failed_or_invalid_arguments' }) });
          }
          execution.recordUsage(budget.usage());
        }
      }

      signal.throwIfAborted();
      if (!finalText) throw modelFailure('model_empty_response');
      const observationIds = [...observations.keys()];
      const sourceList = observationIds.length
        ? `\n\nSources:\n${observationIds.map((id) => {
          const source = observations.get(id);
          return `- [${source?.title ?? 'Source'}](${source?.url ?? ''})`;
        }).join('\n')}`
        : '';
      const answerText = `${finalText}${sourceList}`;
      execution.emitDelta(answerText);
      execution.checkpoint(answerText);
      execution.complete({
        answerText,
        sourceObservationIds: observationIds,
        usage: budget.usage(),
      });
    },
  };
}
