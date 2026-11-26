import { prettyJson } from './curlParser';
import { isBinaryContentType } from './responseEncoding';
import { parseResponseStream } from './responseStream';
import type { ResponseRecord } from './types';

export interface DiffLine {
  kind: 'same' | 'add' | 'del';
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffResult {
  lines: DiffLine[];
  added: number;
  removed: number;
  truncated?: boolean;
}

const MAX_WINDOW_LINES = 4000;

function diffWindow(before: string[], after: string[], offset: number): DiffResult {
  const removed = before.length;
  const added = after.length;
  if (removed + added > MAX_WINDOW_LINES) {
    const deletions = before.slice(0, 32).map((text, i): DiffLine => ({ kind: 'del', text, oldLine: offset + i + 1 }));
    const additions = after.slice(0, 32).map((text, i): DiffLine => ({ kind: 'add', text, newLine: offset + i + 1 }));
    return { lines: [...deletions, ...additions], removed, added, truncated: true };
  }

  // Each cell stores the LCS length for the two sequences starting at i and j.
  const width = added + 1;
  const lcs = new Uint16Array((removed + 1) * width);
  for (let i = removed - 1; i >= 0; i--) {
    for (let j = added - 1; j >= 0; j--) {
      const cell = i * width + j;
      lcs[cell] = before[i] === after[j] ? 1 + lcs[cell + width + 1] : Math.max(lcs[cell + width], lcs[cell + 1]);
    }
  }

  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < removed || j < added) {
    const cell = i * width + j;
    if (i < removed && j < added && before[i] === after[j]) {
      lines.push({ kind: 'same', text: before[i], oldLine: offset + i + 1, newLine: offset + j + 1 });
      i++;
      j++;
    } else if (j === added || (i < removed && lcs[cell + width] >= lcs[cell + 1])) {
      lines.push({ kind: 'del', text: before[i], oldLine: offset + i + 1 });
      i++;
    } else {
      lines.push({ kind: 'add', text: after[j], newLine: offset + j + 1 });
      j++;
    }
  }
  return { lines, added: added - lcs[0], removed: removed - lcs[0] };
}

export function diffLines(oldText: string, newText: string, contextLines = Infinity): DiffResult {
  const before = oldText ? oldText.split(/\r\n?|\n/) : [];
  const after = newText ? newText.split(/\r\n?|\n/) : [];
  let start = 0;
  let oldEnd = before.length;
  let newEnd = after.length;
  while (start < oldEnd && start < newEnd && before[start] === after[start]) start++;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  const diff = diffWindow(before.slice(start, oldEnd), after.slice(start, newEnd), start);
  const context = diff.truncated ? Math.min(3, contextLines) : contextLines;
  const prefixStart = Math.max(0, start - context);
  const prefix = before.slice(prefixStart, start).map((text, i): DiffLine =>
    ({ kind: 'same', text, oldLine: prefixStart + i + 1, newLine: prefixStart + i + 1 }));
  const suffix = before.slice(oldEnd, oldEnd + context).map((text, i): DiffLine =>
    ({ kind: 'same', text, oldLine: oldEnd + i + 1, newLine: newEnd + i + 1 }));
  return { ...diff, lines: prefix.concat(diff.lines, suffix) };
}

export function responseComparableText(resp: ResponseRecord): string {
  const stream = parseResponseStream(resp.contentType, resp.body);
  return stream?.assembledText || stream?.assembledReasoning || (prettyJson(resp.body) ?? resp.body);
}

export function isComparableResponse(resp: ResponseRecord): boolean {
  return resp.bodyBase64 == null && !/^image\//i.test(resp.contentType.trim()) && !isBinaryContentType(resp.contentType);
}
