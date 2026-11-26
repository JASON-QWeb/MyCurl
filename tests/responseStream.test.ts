import { describe, expect, it } from 'vitest';
import { parseResponseStream, streamCopyText } from '../src/lib/responseStream';

const mime = 'application/x-ndjson; charset=utf-8';
const generateChunk = (response: string, done: boolean) => JSON.stringify({ model: 'gemma4', response, done });
const chatChunk = (content: string, thinking: string, done: boolean) =>
  JSON.stringify({ model: 'qwen3', message: { role: 'assistant', content, thinking }, done });

describe('Ollama response streams', () => {
  it('assembles generate chunks including text in the final record', () => {
    const lines = [generateChunk('That', false), generateChunk("'s", false), generateChunk(' a fantastic question!', true)];
    const stream = parseResponseStream(mime, lines.join('\r\n'));
    expect(stream).toMatchObject({ format: 'NDJSON', assembledText: "That's a fantastic question!", done: true });
    expect(stream?.events.map(event => event.data)).toEqual(lines);
  });

  it('separates chat thinking from the answer', () => {
    const lines = [chatChunk('', '17 × 23', false), chatChunk('391', '', true)];
    expect(parseResponseStream(mime, lines.join('\n'))).toMatchObject({
      assembledReasoning: '17 × 23', assembledText: '391', done: true,
    });
  });

  it('preserves completed records while the next one is arriving', () => {
    const first = generateChunk('That', false);
    const next = generateChunk("'s", true);
    expect(parseResponseStream(mime, first + '\n' + next.slice(0, -2), true)).toMatchObject({
      assembledText: 'That', events: [{ data: first }], done: false,
    });
    expect(parseResponseStream(mime, first + '\n' + next, true)?.assembledText).toBe("That's");
    expect(parseResponseStream(mime, first + '\n' + next.slice(0, -2))).toBeNull();
  });

  it('retains a midstream server error alongside partial output', () => {
    const error = 'an error was encountered while running the model';
    const stream = parseResponseStream(mime, generateChunk(' Yes', false) + '\n' + JSON.stringify({ error }));
    expect(stream).toMatchObject({ error, assembledText: ' Yes', done: false });
    expect(stream?.events[1].event).toBe('error');
  });

  it('copies chat text with normalized line endings and preserves raw NDJSON in other views', () => {
    const raw = [generateChunk('a\r', false), generateChunk('\nb\rc', true)].join('\r\n') + '\r\n';
    const stream = parseResponseStream(mime, raw)!;
    expect(streamCopyText(stream, raw, true)).toBe('a\nb\nc');
    expect(streamCopyText(stream, raw, false)).toBe(raw);
  });

  it('keeps error-only and reasoning-only streams readable and copyable', () => {
    const raw = '{"error":"model unavailable"}\r';
    const error = parseResponseStream(mime, raw)!;
    expect(error.events).toEqual([{ data: raw.trim(), event: 'error' }]);
    expect(streamCopyText(error, raw, true)).toBe('model unavailable');
    const thinking = chatChunk('', 'one\r\ntwo', false);
    expect(streamCopyText(parseResponseStream(mime, thinking)!, thinking, true)).toBe('one\ntwo');
  });

  it('leaves ordinary JSON, unrelated NDJSON and malformed records available in the regular viewer', () => {
    expect(parseResponseStream('application/json', generateChunk('That', true))).toBeNull();
    expect(parseResponseStream(mime, '{"status":"success"}\n')).toBeNull();
    expect(parseResponseStream(mime, '{"level":"warn","error":"unrelated log entry"}\n')).toBeNull();
    expect(parseResponseStream(mime, generateChunk('That', false) + '\n{broken}\n', true)).toBeNull();
  });

  it('preserves SSE detection and assembly', () => {
    const stream = parseResponseStream('text/event-stream', 'data: {"choices":[{"delta":{"content":"That"}}]}\n\ndata: [DONE]\n');
    expect(stream).toMatchObject({ format: 'SSE', assembledText: 'That', done: true });
  });
});
