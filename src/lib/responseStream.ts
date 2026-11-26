import { isSseContent, parseSse, type SseEvent } from './sse';

export interface ResponseStream {
  format: 'SSE' | 'NDJSON';
  events: SseEvent[];
  assembledText: string;
  assembledReasoning: string;
  done: boolean;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function parseOllamaStream(body: string, receiving: boolean): ResponseStream | null {
  const stream: ResponseStream = { format: 'NDJSON', events: [], assembledText: '', assembledReasoning: '', done: false };
  const lines = body.split(/\r\n?|\n/);
  let identified = false;

  for (const [index, line] of lines.entries()) {
    const data = line.trim();
    if (!data) continue;
    let chunk: unknown;
    try {
      chunk = JSON.parse(data);
    } catch {
      // A transport chunk can end in the middle of a JSON object.
      if (receiving && index === lines.length - 1) break;
      return null;
    }
    if (!isRecord(chunk)) return null;
    if (typeof chunk.error === 'string' && (stream.events.length > 0 || Object.keys(chunk).length === 1)) {
      stream.events.push({ data, event: 'error' });
      stream.error = chunk.error.replace(/\r\n?/g, '\n');
      continue;
    }
    const finalUsage = chunk.done === true && (typeof chunk.prompt_eval_count === 'number' || typeof chunk.eval_count === 'number');
    if (typeof chunk.done !== 'boolean') return null;
    identified ||= typeof chunk.model === 'string' || finalUsage;
    const message = isRecord(chunk.message) ? chunk.message : null;
    const text = message ? message.content : chunk.response;
    const thinking = message ? message.thinking : chunk.thinking;
    if (!finalUsage && typeof text !== 'string' && typeof thinking !== 'string') return null;
    if (typeof text === 'string') stream.assembledText += text;
    if (typeof thinking === 'string') stream.assembledReasoning += thinking;
    stream.done ||= chunk.done;
    stream.events.push({ data, parsed: chunk });
  }
  if (!identified && stream.error === undefined) return null;
  stream.assembledText = stream.assembledText.replace(/\r\n?/g, '\n');
  stream.assembledReasoning = stream.assembledReasoning.replace(/\r\n?/g, '\n');
  return stream;
}

export function streamCopyText(stream: ResponseStream, raw: string, chatView: boolean): string {
  if (stream.format === 'SSE') return stream.assembledText || raw;
  if (!chatView) return raw;
  return stream.assembledText || stream.error || stream.assembledReasoning || raw;
}

export function parseResponseStream(contentType: string, body: string, receiving = false): ResponseStream | null {
  const mime = contentType.split(';', 1)[0].trim().toLowerCase();
  if (mime === 'application/x-ndjson' || mime === 'application/ndjson') {
    return parseOllamaStream(body, receiving);
  }
  return isSseContent(contentType, body) ? { format: 'SSE', ...parseSse(body) } : null;
}
