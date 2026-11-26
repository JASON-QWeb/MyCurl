import { expect, it } from 'vitest';
import { responseTextDecoder } from '../src/lib/responseEncoding';

it('decodes a declared GBK character across transport chunks', () => {
  const decoder = responseTextDecoder('text/plain; name="a;charset=utf-8"; CHARSET="gbk"');
  expect(decoder.decode(Uint8Array.of(0xd6), { stream: true })).toBe('');
  expect(decoder.decode(Uint8Array.of(0xd0))).toBe('中');
});

it('supports unquoted charset labels and falls back to UTF-8 for unknown or missing labels', () => {
  expect(responseTextDecoder('text/html; charset=windows-1252').decode(Uint8Array.of(0x80))).toBe('€');
  for (const type of ['', 'text/plain', 'text/plain; charset=unknown', 'text/event-stream; charset=gbk']) {
    expect(responseTextDecoder(type).encoding).toBe('utf-8');
  }
});
