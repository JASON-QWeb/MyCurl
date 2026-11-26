import { describe, expect, it } from 'vitest';
import { extractAiUsage } from '../src/lib/aiUsage';

const json = (value: unknown) => extractAiUsage('application/json; charset=utf-8', JSON.stringify(value));
const sse = (...events: unknown[]) => extractAiUsage('text/event-stream',
  events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n');
const chat = { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16, completion_tokens_details: { reasoning_tokens: 2 } };
const responses = { input_tokens: 12, output_tokens: 4, total_tokens: 16, output_tokens_details: { reasoning_tokens: 2 } };
const gemini = { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 2, totalTokenCount: 18 };
const expected = { inputTokens: 12, outputTokens: 4, totalTokens: 16, reasoningTokens: 2 };

describe('AI token usage', () => {
  it('reads OpenAI Chat Completions JSON and the include_usage stream event', () => {
    expect(json({ usage: chat })).toStrictEqual(expected);
    expect(sse({ choices: [{ delta: { content: 'Hi' } }], usage: null }, { choices: [], usage: chat })).toStrictEqual(expected);
  });

  it('reads Responses JSON and the response.completed envelope', () => {
    expect(json({ object: 'response', usage: responses })).toStrictEqual(expected);
    expect(sse({ type: 'response.output_text.delta', delta: 'Hi' },
      { type: 'response.completed', response: { usage: responses } })).toStrictEqual(expected);
  });

  it('computes the Anthropic total after merging cumulative start and delta counts', () => {
    const counts = { inputTokens: 12, outputTokens: 4, totalTokens: 16 };
    expect(json({ type: 'message', usage: { input_tokens: 12, output_tokens: 4 } })).toStrictEqual(counts);
    expect(sse({ type: 'message_start', message: { usage: { input_tokens: 12, output_tokens: 1 } } },
      { type: 'message_delta', usage: { output_tokens: 3 } },
      { type: 'message_delta', usage: { output_tokens: 4 } }, { type: 'message_stop' })).toStrictEqual(counts);
  });

  it('preserves Gemini totals that include thoughts separately from candidate tokens', () => {
    const counts = { ...expected, totalTokens: 18 };
    expect(json({ usageMetadata: gemini })).toStrictEqual(counts);
    expect(sse({ usageMetadata: { promptTokenCount: 12 } }, { usageMetadata: gemini })).toStrictEqual(counts);
    expect(json({ usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, thoughtsTokenCount: 2 } }))
      .toStrictEqual({ inputTokens: 12, outputTokens: 4, reasoningTokens: 2 });
  });

  it('reads Ollama JSON and a terminal NDJSON record without text', () => {
    const counts = { inputTokens: 12, outputTokens: 4, totalTokens: 16 };
    const final = { done: true, prompt_eval_count: 12, eval_count: 4 };
    expect(json({ model: 'llama3', response: 'Hi', ...final })).toStrictEqual(counts);
    const body = [{ model: 'llama3', done: false, response: 'Hi' }, final].map(x => JSON.stringify(x)).join('\n');
    expect(extractAiUsage('application/x-ndjson', body)).toStrictEqual(counts);
    const chat = JSON.stringify({ message: { content: 'Hi' }, done: false }) + '\n' + JSON.stringify(final);
    expect(extractAiUsage('application/ndjson', chat)).toStrictEqual(counts);
  });

  it('preserves zero and partial usage without inventing missing fields', () => {
    expect(json({ usage: { total_tokens: 0 } })).toStrictEqual({ totalTokens: 0 });
    expect(sse({ type: 'message_delta', usage: { output_tokens: 0 } })).toStrictEqual({ outputTokens: 0 });
    expect(json({ usage: { completion_tokens_details: { reasoning_tokens: 0 } } })).toStrictEqual({ reasoningTokens: 0 });
  });

  it('ignores non-AI JSON, generic events, invalid counts and incomplete input', () => {
    expect(json({ usage: { cpu: 12 }, total_tokens: 4 })).toBeNull();
    expect(json({ usage: { input_tokens: -1, output_tokens: '4', total_tokens: 0.5 } })).toBeNull();
    expect(sse({ choices: [{ delta: { content: 'Hi' } }] })).toBeNull();
    expect(extractAiUsage('application/json', '{"usage":')).toBeNull();
    expect(extractAiUsage('text/plain', 'OK')).toBeNull();
  });
});
