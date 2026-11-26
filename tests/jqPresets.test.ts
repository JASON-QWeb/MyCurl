import { expect, it } from 'vitest';
import { applyFilterToText } from '../src/lib/jq';
import { rankJqPresets } from '../src/lib/jqPresets';

it.each([
  ['AI Reply', { choices: [{ message: { content: 'reply' } }] }, 'reply'],
  ['Responses', { output: [{ content: [{ text: 'response' }] }] }, 'response'],
  ['Claude', { type: 'message', content: [{ type: 'text', text: 'claude' }] }, 'claude'],
  ['Gemini', { candidates: [{ content: { parts: [{ text: 'gemini' }] } }] }, 'gemini'],
  ['Ollama', { model: 'local', message: { content: 'chat' } }, 'chat'],
  ['Ollama', { response: 'generated' }, 'generated'],
  ['Models', { data: [{ id: 'first' }, { id: 'second' }] }, 'first\nsecond'],
  ['Token', { access_token: 'access', token: 'fallback' }, 'access'],
  ['Token', { token: 'direct' }, 'direct'],
  ['Token', { data: { access_token: 'nested access' } }, 'nested access'],
  ['Token', { data: { token: 'nested' } }, 'nested'],
] as const)('ranks %s first and applies its expression to the matching payload', (label, payload, output) => {
  const body = JSON.stringify(payload);
  const { quick, all } = rankJqPresets(body, 'en');
  expect(quick).toHaveLength(2);
  expect(quick[0].label).toBe(label);
  expect(quick[1].expr).not.toBe(quick[0].expr);
  expect(applyFilterToText(quick[0].expr, body)).toEqual({ ok: true, output });
  expect(all).toHaveLength(7);
  expect(new Set(all.map(p => p.expr)).size).toBe(7);
});

it.each([undefined, '', '{', '[]', 'null', '"plain text"', 'data: {}', '{}',
  '{"data":[null],"output":[null],"content":"text","choices":{},"candidates":[{}],"response":{},"token":{}}',
])('keeps the two original shortcuts for a generic or incomplete response (%s)', body => {
  expect(rankJqPresets(body, 'en').quick.map(p => p.label)).toEqual(['AI Reply', 'Models']);
  expect(rankJqPresets(body, 'zh').quick.map(p => p.label)).toEqual(['AI 回复', '模型列表']);
});

it('prioritizes multiple matching presets and keeps the full localized menu in a stable order', () => {
  const result = rankJqPresets('{"data":[{"id":"model"}],"access_token":"value"}', 'zh');
  expect(result.quick.map(p => p.label)).toEqual(['模型列表', '令牌']);
  expect(result.all).toEqual(rankJqPresets(undefined, 'zh').all);
  expect(rankJqPresets('{"object":"list","data":[]}', 'en').quick[0].label).toBe('Models');
});
