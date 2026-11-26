import { parseResponseStream } from './responseStream';

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
}

function setCount(usage: AiUsage, key: keyof AiUsage, value: unknown) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) usage[key] = value;
}

function mergeUsage(usage: AiUsage, value: unknown, event?: string) {
  const obj = record(value);
  if (!obj) return false;
  const type = obj.type ?? event;
  const envelope = type === 'response.completed' ? record(obj.response) : type === 'message_start' ? record(obj.message) : obj;
  const counts = record(envelope?.usage);
  if (counts) {
    setCount(usage, 'inputTokens', counts.input_tokens ?? counts.prompt_tokens);
    setCount(usage, 'outputTokens', counts.output_tokens ?? counts.completion_tokens);
    setCount(usage, 'totalTokens', counts.total_tokens);
    const details = record(counts.output_tokens_details ?? counts.completion_tokens_details);
    setCount(usage, 'reasoningTokens', details?.reasoning_tokens);
  }
  const metadata = record(obj.usageMetadata);
  if (metadata) {
    setCount(usage, 'inputTokens', metadata.promptTokenCount);
    setCount(usage, 'outputTokens', metadata.candidatesTokenCount);
    setCount(usage, 'totalTokens', metadata.totalTokenCount);
    setCount(usage, 'reasoningTokens', metadata.thoughtsTokenCount);
  }
  setCount(usage, 'inputTokens', obj.prompt_eval_count);
  setCount(usage, 'outputTokens', obj.eval_count);
  // Gemini can include thought and tool tokens outside its candidate count.
  return !!counts || typeof obj.prompt_eval_count === 'number' || typeof obj.eval_count === 'number';
}

/** Stream usage fields are cumulative snapshots. Later fields replace earlier values. */
export function extractAiUsage(contentType: string, body: string, stream = parseResponseStream(contentType, body, true)): AiUsage | null {
  const usage: AiUsage = {};
  let canSumCounts = false;
  if (stream) {
    for (const event of stream.events) {
      if (mergeUsage(usage, event.parsed, event.event)) canSumCounts = true;
    }
  } else {
    if (!body.trimStart().startsWith('{')) return null;
    try {
      canSumCounts = mergeUsage(usage, JSON.parse(body));
    } catch {
      return null;
    }
  }
  if (canSumCounts && usage.totalTokens === undefined && usage.inputTokens !== undefined && usage.outputTokens !== undefined) {
    setCount(usage, 'totalTokens', usage.inputTokens + usage.outputTokens);
  }
  return Object.keys(usage).length ? usage : null;
}
