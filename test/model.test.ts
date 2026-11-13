import { describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import type { ResponseStreamEvent } from 'openai/resources/responses/responses.js';
import { createOpenAIClient, ModelTransportError, OpenAIModelTransport } from '../server/model/openai.js';
import { ManualClock } from '../server/clock.js';
import { DEFAULT_LIMITS } from '../server/config.js';
import { BudgetedModelTransport, BudgetExceededError, RunBudget } from '../server/runs/budget.js';
import type { ModelRequest } from '../shared/domain.js';

const basicRequest: ModelRequest = {
  model: 'caller-model-is-ignored',
  input: [{ role: 'system', content: 'Follow the app instructions.' }, { role: 'user', content: 'Question' }],
  tools: [],
  responseFormat: null,
  temperature: null,
};

function completed(output: unknown[], extra: Record<string, unknown> = {}) {
  return {
    type: 'response.completed',
    response: {
      id: 'resp_test',
      status: 'completed',
      output,
      usage: { input_tokens: 23, output_tokens: 9 },
      ...extra,
    },
  } as unknown as ResponseStreamEvent;
}

function fakeClient(streams: ResponseStreamEvent[][], onCreate?: (body: Record<string, unknown>, options: unknown) => void) {
  const create = vi.fn(async (body: Record<string, unknown>, options: unknown) => {
    onCreate?.(body, options);
    const events = streams.shift() ?? [];
    return (async function* () {
      for (const event of events) yield event;
    })();
  });
  return { client: { responses: { create } } as unknown as OpenAI, create };
}

describe('OpenAI Responses transport', () => {
  it('streams text, uses explicit model and storage policy, and keeps SDK retries disabled', async () => {
    const output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Hello.' }] }];
    const { client, create } = fakeClient([
      [
        { type: 'response.output_text.delta', delta: 'Hel' } as ResponseStreamEvent,
        { type: 'response.output_text.delta', delta: 'lo.' } as ResponseStreamEvent,
        completed(output),
      ],
    ]);
    const transport = new OpenAIModelTransport(client, 'configured-model');
    const result = await transport.respond(basicRequest, { signal: new AbortController().signal });

    expect(result).toMatchObject({
      status: 'completed', text: 'Hello.', usage: { inputTokens: 23, outputTokens: 9 },
    });
    expect(create).toHaveBeenCalledOnce();
    const body = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body).toMatchObject({ model: 'configured-model', store: false, stream: true });
    expect(body.instructions).toBe('Follow the app instructions.');
    expect((create.mock.calls[0]?.[1] as { signal: AbortSignal }).signal.aborted).toBe(false);
    expect(createOpenAIClient({ openaiApiKey: 'test-key' }).maxRetries).toBe(0);
  });

  it('preserves reasoning and function call output items, then matches tool output by call ID', async () => {
    const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' };
    const functionCall = {
      type: 'function_call', id: 'fc_1', call_id: 'call_search_1', name: 'web_search', arguments: '{"queries":[]}',
    };
    const toolResponse = { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Done.' }] };
    const { client, create } = fakeClient([
      [completed([reasoning, functionCall])],
      [completed([toolResponse])],
    ]);
    const transport = new OpenAIModelTransport(client, 'configured-model');
    const first = await transport.respond({
      ...basicRequest,
      tools: [{ name: 'web_search', description: 'Search public sources', parameters: { type: 'object' } }],
    }, { signal: new AbortController().signal });
    expect(first.toolCalls).toEqual([{ callId: 'call_search_1', name: 'web_search', arguments: { queries: [] } }]);
    expect(first.continuationItems).toEqual([reasoning, functionCall]);

    const second = await transport.respond({
      ...basicRequest,
      input: [
        { role: 'user', content: 'Question' },
        { role: 'tool', toolCallId: 'call_search_1', content: '{"results":[]}' },
      ],
      continuationItems: first.continuationItems,
    }, { signal: new AbortController().signal });
    expect(second.text).toBe('Done.');
    const continuation = create.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(continuation.input).toEqual([
      { role: 'user', content: 'Question' },
      reasoning,
      functionCall,
      { type: 'function_call_output', call_id: 'call_search_1', output: '{"results":[]}' },
    ]);
  });

  it('enables only the custom web_search function with strict arguments and strict JSON Schema output', async () => {
    const output = [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"ok":true}' }] }];
    const { client, create } = fakeClient([[completed([])], [completed(output)]]);
    const transport = new OpenAIModelTransport(client, 'configured-model');
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    await transport.respond({
      ...basicRequest,
      tools: [{ name: 'web_search', description: 'Search public sources', parameters: schema }],
    }, { signal: new AbortController().signal });
    await transport.respond({
      ...basicRequest,
      responseFormat: { name: 'Extraction', schema },
    }, { signal: new AbortController().signal });

    const toolBody = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(toolBody.tools).toEqual([{ type: 'function', name: 'web_search', description: 'Search public sources', parameters: schema, strict: true }]);
    expect(toolBody).not.toHaveProperty('text');
    const extractionBody = create.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(extractionBody.tools).toEqual([]);
    expect(extractionBody.text).toEqual({ format: { type: 'json_schema', name: 'Extraction', strict: true, schema } });
    expect(extractionBody).not.toHaveProperty('web_search');
  });

  it('keeps refusal and incomplete output distinct and rejects malformed or schema-invalid extraction', async () => {
    const refused = { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'Cannot help.' }] };
    const incomplete = { type: 'response.incomplete', response: { status: 'incomplete', output: [], incomplete_details: { reason: 'max_output_tokens' } } } as unknown as ResponseStreamEvent;
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
    const { client } = fakeClient([
      [completed([refused])],
      [incomplete],
      [completed([{ type: 'message', content: [{ type: 'output_text', text: '{"ok":' }] }])],
      [completed([{ type: 'message', content: [{ type: 'output_text', text: '{"ok":"yes"}' }] }])],
    ]);
    const transport = new OpenAIModelTransport(client, 'configured-model');
    const signal = { signal: new AbortController().signal };
    expect((await transport.respond(basicRequest, signal)).status).toBe('refused');
    expect(await transport.respond(basicRequest, signal)).toMatchObject({ status: 'incomplete', text: null, incompleteReason: 'max_output_tokens' });
    expect(await transport.respond({ ...basicRequest, responseFormat: { name: 'Extraction', schema } }, signal))
      .toMatchObject({ status: 'failed', text: null, errorCode: 'invalid_structured_json' });
    expect(await transport.respond({ ...basicRequest, responseFormat: { name: 'Extraction', schema } }, signal))
      .toMatchObject({ status: 'failed', errorCode: 'invalid_structured_schema' });
  });

  it('propagates cancellation and redacts access/provider errors', async () => {
    const cancelled = new AbortController();
    cancelled.abort();
    const { client, create } = fakeClient([]);
    const transport = new OpenAIModelTransport(client, 'configured-model');
    await expect(transport.respond(basicRequest, { signal: cancelled.signal })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();

    const midStreamAbort = new AbortController();
    const streamingClient = {
      responses: {
        create: async () => (async function* () {
          yield { type: 'response.output_text.delta', delta: 'partial' } as ResponseStreamEvent;
          midStreamAbort.abort();
          yield { type: 'response.output_text.delta', delta: 'must not be accepted' } as ResponseStreamEvent;
        })(),
      },
    } as unknown as OpenAI;
    await expect(new OpenAIModelTransport(streamingClient, 'configured-model')
      .respond(basicRequest, { signal: midStreamAbort.signal }))
      .rejects.toMatchObject({ code: 'aborted' });

    const failing = fakeClient([]);
    failing.create.mockRejectedValueOnce(Object.assign(new Error('secret provider body'), { status: 401 }));
    const accessTransport = new OpenAIModelTransport(failing.client, 'configured-model');
    await expect(accessTransport.respond(basicRequest, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'access_denied', message: 'Model request failed' });
    const providerFailure = fakeClient([]);
    providerFailure.create.mockRejectedValueOnce(Object.assign(new Error('private upstream response'), { status: 500 }));
    await expect(new OpenAIModelTransport(providerFailure.client, 'configured-model')
      .respond(basicRequest, { signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: 'provider_error', message: 'Model request failed' });
  });

  it('counts chat, search continuation and extraction through the same model-call budget', async () => {
    const events = [completed([]), completed([]), completed([])];
    const { client } = fakeClient(events.map((event) => [event]));
    const inner = new OpenAIModelTransport(client, 'configured-model');
    const budget = new RunBudget({
      limits: { ...DEFAULT_LIMITS, maxModelCalls: 2 },
      clock: new ManualClock(),
    });
    const transport = new BudgetedModelTransport(inner, budget);
    await transport.respond(basicRequest, { signal: new AbortController().signal });
    await transport.respond({ ...basicRequest, responseFormat: { name: 'Extraction', schema: { type: 'object' } } }, { signal: new AbortController().signal });
    await expect(transport.respond({ ...basicRequest, tools: [{ name: 'web_search', description: '', parameters: { type: 'object' } }] }, { signal: new AbortController().signal }))
      .rejects.toBeInstanceOf(BudgetExceededError);
    expect(budget.usage().modelCalls).toBe(2);
    expect(budget.remaining().modelCalls).toBe(0);
  });
});
