import { tr } from './translate';
import type { Language } from './types';

export interface JqPreset {
  label: string;
  expr: string;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasTextBlock(value: unknown) {
  return Array.isArray(value) && value.some(block => object(block) && typeof block.text === 'string');
}

function hasToken(value: unknown) {
  return object(value) && (typeof value.access_token === 'string' || typeof value.token === 'string');
}

const definitions: { zh: string; en: string; expr: string; matches: (obj: JsonObject) => boolean }[] = [
  { zh: 'AI 回复', en: 'AI Reply', expr: '.choices[0].message.content // .error.message // .',
    matches: obj => Array.isArray(obj.choices) && (obj.object === 'chat.completion' || obj.choices.some(c => object(c) && object(c.message))) },
  { zh: '模型列表', en: 'Models', expr: '.data[].id',
    matches: obj => Array.isArray(obj.data) && (obj.object === 'list' || obj.data.some(model => object(model) && model.id != null)) },
  { zh: 'Responses', en: 'Responses', expr: '.output[0].content[0].text // .error.message // .',
    matches: obj => Array.isArray(obj.output) && (obj.object === 'response' || obj.output.some(o => object(o) && hasTextBlock(o.content))) },
  { zh: 'Claude', en: 'Claude', expr: '.content[0].text // .error.message // .',
    matches: obj => hasTextBlock(obj.content) || (obj.type === 'message' && Array.isArray(obj.content)) },
  { zh: 'Gemini', en: 'Gemini', expr: '.candidates[0].content.parts[0].text // .error.message // .',
    matches: obj => Array.isArray(obj.candidates) && obj.candidates.some(c => object(c) && object(c.content) && Array.isArray(c.content.parts)) },
  { zh: 'Ollama', en: 'Ollama', expr: '.message.content // .response // .error // .',
    matches: obj => typeof obj.response === 'string' || (object(obj.message) && typeof obj.message.content === 'string') },
  { zh: '令牌', en: 'Token', expr: '.access_token // .token // .data.access_token // .data.token',
    matches: obj => hasToken(obj) || hasToken(obj.data) },
];

function responseObject(body: string | undefined): JsonObject | undefined {
  if (!body?.trimStart().startsWith('{')) return;
  try {
    const parsed: unknown = JSON.parse(body);
    if (object(parsed)) return parsed;
  } catch {
    // A partial response can still be receiving JSON.
  }
}

export function rankJqPresets(body: string | undefined, lang: Language): { quick: JqPreset[]; all: JqPreset[] } {
  const obj = responseObject(body);
  const matches: JqPreset[] = [];
  const all = definitions.map(def => {
    const preset = { label: tr(lang, def.zh, def.en), expr: def.expr };
    if (obj && def.matches(obj)) matches.push(preset);
    return preset;
  });
  return { quick: [...new Set([...matches, ...all])].slice(0, 2), all };
}
