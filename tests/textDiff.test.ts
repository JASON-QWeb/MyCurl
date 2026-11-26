import { describe, expect, it } from 'vitest';
import { diffLines, isComparableResponse, responseComparableText } from '../src/lib/textDiff';
import type { ResponseRecord } from '../src/lib/types';

describe('line differences', () => {
  it('keeps context and the original one-based line numbers on either side', () => {
    expect(diffLines('head\nold\nkeep\ntail', 'head\nnew\nextra\nkeep\ntail')).toEqual({
      added: 2, removed: 1, lines: [
        { kind: 'same', text: 'head', oldLine: 1, newLine: 1 }, { kind: 'del', text: 'old', oldLine: 2 },
        { kind: 'add', text: 'new', newLine: 2 }, { kind: 'add', text: 'extra', newLine: 3 },
        { kind: 'same', text: 'keep', oldLine: 3, newLine: 4 }, { kind: 'same', text: 'tail', oldLine: 4, newLine: 5 },
      ],
    });
  });

  it('retains a common line inside the changed region when lines repeat', () => {
    const result = diffLines('a\nb\na\nc', 'b\na\na\nd');
    expect(result).toMatchObject({ added: 2, removed: 2 });
    expect(result.lines.filter(l => l.kind !== 'add').map(l => l.text)).toEqual(['a', 'b', 'a', 'c']);
    expect(result.lines.filter(l => l.kind !== 'del').map(l => l.text)).toEqual(['b', 'a', 'a', 'd']);
  });

  it('distinguishes empty inputs, add-only and delete-only bodies, and trailing newlines', () => {
    expect(diffLines('', '')).toEqual({ added: 0, removed: 0, lines: [] });
    expect(diffLines('', 'a')).toEqual({ added: 1, removed: 0, lines: [{ kind: 'add', text: 'a', newLine: 1 }] });
    expect(diffLines('a', '')).toEqual({ added: 0, removed: 1, lines: [{ kind: 'del', text: 'a', oldLine: 1 }] });
    expect(diffLines('a\n', 'a').lines.at(-1)).toEqual({ kind: 'del', text: '', oldLine: 2 });
  });

  it('returns unchanged context for identical text and recognizes CRLF line endings', () => {
    for (const after of ['a\r\n\r\nb', 'a\n\nb']) {
      const result = diffLines('a\r\n\r\nb', after);
      expect(result).toMatchObject({ added: 0, removed: 0 });
      expect(result.lines).toEqual(['a', '', 'b'].map((text, i) => ({ kind: 'same', text, oldLine: i + 1, newLine: i + 1 })));
    }
  });

  it('computes an exact edit in a long response after trimming common edges', () => {
    const context = Array.from({ length: 4500 }, (_, i) => String(i));
    const diff = diffLines([...context, 'old', ...context].join('\n'), [...context, 'new', ...context].join('\n'));
    expect(diff.truncated).toBeUndefined();
    expect(diff).toMatchObject({ added: 1, removed: 1 });
    expect(diff.lines.filter(l => l.kind !== 'same')).toEqual([
      { kind: 'del', text: 'old', oldLine: 4501 }, { kind: 'add', text: 'new', newLine: 4501 },
    ]);
  });

  it('counts an oversized changed region as a replacement with bounded excerpts and correct suffix coordinates', () => {
    const before = Array.from({ length: 2400 }, (_, i) => `old ${i}`);
    const after = Array.from({ length: 2300 }, (_, i) => `new ${i}`);
    const diff = diffLines(['start', ...before, 'end'].join('\n'), ['start', ...after, 'end'].join('\n'));
    expect(diff).toMatchObject({ truncated: true, removed: 2400, added: 2300 });
    expect(diff.lines.length).toBeLessThan(100);
    expect(diff.lines[0]).toEqual({ kind: 'same', text: 'start', oldLine: 1, newLine: 1 });
    expect(diff.lines.at(-1)).toEqual({ kind: 'same', text: 'end', oldLine: 2402, newLine: 2302 });
  });
});

function response(body: string, contentType = 'text/plain'): ResponseRecord {
  return { id: 'r', requestId: 'q', createdAt: 0, method: 'GET', url: '', status: 200, statusText: 'OK',
    headers: [], body, contentType, size: body.length, timeMs: 0 };
}

it('compares assembled SSE and Ollama answers independently of transport frames and metadata', () => {
  const sse = 'data: {"choices":[{"delta":{"content":"hel"}}]}\n\ndata: {"choices":[{"delta":{"content":"lo"}}]}\n\n';
  const ndjson = '{"model":"m","done":false,"response":"hel"}\n{"model":"m","done":true,"response":"lo"}';
  expect(responseComparableText(response(sse, 'text/event-stream'))).toBe('hello');
  expect(responseComparableText(response(ndjson, 'application/x-ndjson'))).toBe('hello');
});

it('keeps unrecognized streams and plain text intact and formats JSON without changing large integers', () => {
  const events = 'event: tick\ndata: 17\n\n';
  expect(responseComparableText(response(events, 'text/event-stream'))).toBe(events);
  expect(responseComparableText(response('  plain\ntext  '))).toBe('  plain\ntext  ');
  expect(responseComparableText(response('{"n":9876543210987654321}'))).toBe('{\n  "n": 9876543210987654321\n}');
});

it('excludes stored bytes and image/binary MIME types even without a saved base64 preview', () => {
  for (const mime of ['image/png', 'Image/SVG+xml', 'audio/mpeg', 'application/octet-stream', 'application/pdf']) {
    expect(isComparableResponse(response('', mime))).toBe(false);
  }
  expect(isComparableResponse({ ...response(''), bodyBase64: '' })).toBe(false);
  expect(isComparableResponse(response('', 'application/json'))).toBe(true);
});
