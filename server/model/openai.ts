import OpenAI from 'openai';
import type {
  ResponseInputItem,
  ResponseStreamEvent,
} from 'openai/resources/responses/responses.js';
import type { AppConfig } from '../config.js';
import type { ModelRequest, ModelResponse, ModelTransport } from '../../shared/domain.js';

export class ModelTransportError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code === 'aborted' ? 'Model request aborted' : 'Model request failed');
    this.name = 'ModelTransportError';
    this.code = code;
  }
}

export function createOpenAIClient(config: Pick<AppConfig, 'openaiApiKey'>): OpenAI {
  if (!config.openaiApiKey) throw new ModelTransportError('missing_configuration');
  return new OpenAI({ apiKey: config.openaiApiKey, maxRetries: 0 });
}

type ResponsesClient = Pick<OpenAI, 'responses'>;

export class OpenAIModelTransport implements ModelTransport {
  private readonly client: ResponsesClient;
  private readonly model: string;

  constructor(client: ResponsesClient, model: string) {
    if (!model.trim()) throw new ModelTransportError('missing_configuration');
    this.client = client;
    this.model = model;
  }

  async respond(request: ModelRequest, options: { signal: AbortSignal }): Promise<ModelResponse> {
    options.signal.throwIfAborted();
    const invalidTool = request.tools.find((tool) => tool.name !== 'web_search');
    if (invalidTool) throw new ModelTransportError('unsupported_tool');
    if (request.tools.length > 1 || (request.tools.length > 0 && request.responseFormat !== null)) {
      throw new ModelTransportError('invalid_task_configuration');
    }

    const instructions = request.input
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const input: unknown[] = [];
    const toolOutputs: unknown[] = [];
    for (const message of request.input) {
      if (message.role === 'system') continue;
      if (message.role === 'tool') {
        if (!message.toolCallId) throw new ModelTransportError('invalid_tool_output');
        toolOutputs.push({ type: 'function_call_output', call_id: message.toolCallId, output: message.content });
      } else {
        input.push({ role: message.role, content: message.content });
      }
    }
    // Keep prior application messages before the previous response items, then
    // pair each function_call_output with the call ID from those items.
    input.push(...(request.continuationItems ?? []), ...toolOutputs);

    const body: Record<string, unknown> = {
      model: this.model,
      instructions: instructions || undefined,
      input: input as ResponseInputItem[],
      store: false,
      stream: true,
      tools: request.tools.map((tool) => ({
        type: 'function',
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: true,
      })),
    };
    if (request.responseFormat) {
      body.text = {
        format: {
          type: 'json_schema',
          name: request.responseFormat.name,
          strict: true,
          schema: request.responseFormat.schema,
        },
      };
    }
    if (request.temperature !== null) body.temperature = request.temperature;

    let stream: AsyncIterable<ResponseStreamEvent>;
    try {
      stream = await this.client.responses.create(body as never, { signal: options.signal }) as
        unknown as AsyncIterable<ResponseStreamEvent>;
    } catch (error) {
      if (options.signal.aborted) throw new ModelTransportError('aborted');
      throw new ModelTransportError(classifyProviderError(error));
    }

    let text = '';
    let refusal = '';
    let terminal: Record<string, unknown> | null = null;
    const items = new Map<number, unknown>();
    try {
      for await (const event of stream) {
        options.signal.throwIfAborted();
        if (event.type === 'response.output_text.delta') text += event.delta;
        else if (event.type === 'response.refusal.delta') refusal += event.delta;
        else if (event.type === 'response.output_item.done') items.set(event.output_index, event.item);
        else if (
          event.type === 'response.completed' ||
          event.type === 'response.incomplete' ||
          event.type === 'response.failed'
        ) {
          terminal = event.response as unknown as Record<string, unknown>;
        } else if (event.type === 'error') {
          throw new ModelTransportError('provider_error');
        }
      }
    } catch (error) {
      if (error instanceof ModelTransportError) throw error;
      if (options.signal.aborted) throw new ModelTransportError('aborted');
      throw new ModelTransportError(classifyProviderError(error));
    }

    const output = Array.isArray(terminal?.output)
      ? terminal.output
      : [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
    if (refusal.length === 0) refusal = refusalFromOutput(output);
    const usage = readUsage(terminal?.usage);
    const continuationItems = output;

    if (refusal) {
      return response('refused', { refusal, usage, continuationItems });
    }
    const status = terminal?.status;
    if (status === 'incomplete' || status === 'failed' || terminal === null) {
      const reason = readIncompleteReason(terminal);
      return response(status === 'failed' || terminal === null ? 'failed' : 'incomplete', {
        text: null,
        usage,
        continuationItems,
        incompleteReason: reason,
        errorCode: status === 'failed' ? 'provider_error' : null,
      });
    }

    const calls = functionCalls(output);
    if (!calls.ok) return response('failed', { usage, continuationItems, errorCode: calls.error });
    const allowedTools = new Set(request.tools.map((tool) => tool.name));
    if (calls.calls.some((call) => call.name !== 'web_search' || !allowedTools.has(call.name))) {
      return response('failed', { usage, continuationItems, errorCode: 'unsupported_tool_call' });
    }
    const completedText = text || textFromOutput(output);
    if (request.responseFormat && calls.calls.length === 0) {
      const validationError = validateStructuredText(completedText, request.responseFormat.schema);
      if (validationError) {
        return response('failed', {
          usage,
          continuationItems,
          errorCode: validationError,
        });
      }
    }
    return response('completed', {
      text: completedText,
      toolCalls: calls.calls,
      usage,
      continuationItems,
    });
  }
}

export function createConfiguredModelTransport(
  config: Pick<AppConfig, 'openaiApiKey' | 'openaiModel'>,
  client?: ResponsesClient,
): OpenAIModelTransport {
  if (!config.openaiModel) throw new ModelTransportError('missing_configuration');
  return new OpenAIModelTransport(client ?? createOpenAIClient(config), config.openaiModel);
}

function response(
  status: ModelResponse['status'],
  options: Partial<ModelResponse> = {},
): ModelResponse {
  return {
    status,
    text: options.text ?? null,
    toolCalls: options.toolCalls ?? [],
    usage: options.usage ?? { inputTokens: null, outputTokens: null },
    refusal: options.refusal ?? null,
    incompleteReason: options.incompleteReason ?? null,
    errorCode: options.errorCode ?? null,
    continuationItems: options.continuationItems ?? [],
  };
}

function classifyProviderError(error: unknown): string {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : 0;
  if (status === 401 || status === 403) return 'access_denied';
  if (status === 429) return 'rate_limited';
  if (status === 400) return 'invalid_request';
  return 'provider_error';
}

function readUsage(value: unknown): ModelResponse['usage'] {
  if (typeof value !== 'object' || value === null) {
    return { inputTokens: null, outputTokens: null };
  }
  const usage = value as { input_tokens?: unknown; output_tokens?: unknown };
  return {
    inputTokens: Number.isSafeInteger(usage.input_tokens) && Number(usage.input_tokens) >= 0
      ? Number(usage.input_tokens)
      : null,
    outputTokens: Number.isSafeInteger(usage.output_tokens) && Number(usage.output_tokens) >= 0
      ? Number(usage.output_tokens)
      : null,
  };
}

function readIncompleteReason(value: Record<string, unknown> | null): string | null {
  const details = value?.incomplete_details;
  if (typeof details === 'object' && details !== null && 'reason' in details) {
    const reason = (details as { reason?: unknown }).reason;
    return typeof reason === 'string' ? reason.slice(0, 120) : null;
  }
  return null;
}

function functionCalls(output: unknown[]):
  | { ok: true; calls: ModelResponse['toolCalls'] }
  | { ok: false; error: string } {
  const calls: ModelResponse['toolCalls'] = [];
  for (const item of output) {
    if (typeof item !== 'object' || item === null || !('type' in item) || item.type !== 'function_call') continue;
    const call = item as { call_id?: unknown; name?: unknown; arguments?: unknown };
    if (
      typeof call.call_id !== 'string' ||
      typeof call.name !== 'string' ||
      typeof call.arguments !== 'string'
    ) return { ok: false, error: 'invalid_tool_call' };
    let args: unknown;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      return { ok: false, error: 'invalid_tool_arguments' };
    }
    if (!isRecord(args)) return { ok: false, error: 'invalid_tool_arguments' };
    calls.push({ callId: call.call_id, name: call.name, arguments: args });
  }
  return { ok: true, calls };
}

function refusalFromOutput(output: unknown[]): string {
  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === 'refusal' && typeof part.refusal === 'string') return part.refusal;
    }
  }
  return '';
}

function textFromOutput(output: unknown[]): string {
  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') parts.push(part.text);
    }
  }
  return parts.join('');
}

function validateStructuredText(text: string, schema: Record<string, unknown>): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'invalid_structured_json';
  }
  return conformsToSchema(parsed, schema) ? null : 'invalid_structured_schema';
}

function conformsToSchema(value: unknown, schema: Record<string, unknown>): boolean {
  const type = schema.type;
  if (typeof type === 'string' && !matchesType(value, type)) return false;
  if (Array.isArray(type) && !type.some((candidate) => typeof candidate === 'string' && matchesType(value, candidate))) {
    return false;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) {
    return false;
  }
  const properties = schema.properties;
  if (isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    if (required.some((key) => typeof key !== 'string' || !(key in value))) return false;
    if (schema.additionalProperties === false && (!isRecord(properties) || Object.keys(value).some((key) => !(key in properties)))) {
      return false;
    }
    if (isRecord(properties)) {
      for (const [key, child] of Object.entries(properties)) {
        if (key in value && isRecord(child) && !conformsToSchema(value[key], child)) return false;
      }
    }
  }
  if (Array.isArray(value) && isRecord(schema.items) && value.some((item) => !conformsToSchema(item, schema.items as Record<string, unknown>))) {
    return false;
  }
  return true;
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return isRecord(value);
    case 'array': return Array.isArray(value);
    case 'string': return typeof value === 'string';
    case 'integer': return Number.isSafeInteger(value);
    case 'number': return typeof value === 'number' && Number.isFinite(value);
    case 'boolean': return typeof value === 'boolean';
    case 'null': return value === null;
    default: return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
