import { expect, it } from 'vitest';
import { friendlyHostName, importAll, suggestRequestName } from '../src/lib/curlImport';
import { parseCurlCommands } from '../src/lib/curlParser';
import { importWorkspace } from './importWorkspace';

it.each([
  ['localhost:11434', 'Ollama'], ['127.0.0.1:11434', 'Ollama'],
  ['localhost:1234', 'LM Studio'], ['127.0.0.1:1234', 'LM Studio'],
  ['api.fireworks.ai', 'Fireworks AI'], ['router.huggingface.co', 'Hugging Face'],
  ['api-inference.huggingface.co', 'Hugging Face'], ['gateway.ai.cloudflare.com', 'Cloudflare AI Gateway'],
  ['api.replicate.com', 'Replicate'], ['api.cerebras.ai', 'Cerebras'], ['api.sambanova.ai', 'SambaNova'],
])('recognizes %s when a cURL command is filed under its host', (host, service) => {
  const { data, ws } = importWorkspace();
  const parsed = parseCurlCommands('curl http://' + host + '/v1/models');
  const out = importAll(data, parsed, ws, data.settings.import).data;
  expect(out.folders[0]).toMatchObject({ name: service + ' · ' + host, host });
});

it.each([
  ['/api/chat', 'Ollama 对话', 'Ollama Chat'], ['/api/generate', 'Ollama 文本生成', 'Ollama Text Generation'],
  ['/api/tags', '本地模型列表', 'Local Models'], ['/api/embed', '向量嵌入', 'Embeddings'],
  ['/api/embeddings', '向量嵌入', 'Embeddings'], ['/api/pull', '拉取模型', 'Pull Model'], ['/api/show', '模型信息', 'Model Info'],
])('recognizes and localizes %s with a query string, trailing slash and model', (path, zh, en) => {
  for (const [lang, label] of [['zh', zh], ['en', en]] as const) {
    expect(suggestRequestName('POST', 'http://localhost:11434' + path + '/?x=1', '{"model":"local"}', lang)).toBe(label + ' · local');
  }
});

it('uses the generic local service for other ports and does not match unrelated domain suffixes', () => {
  expect(friendlyHostName('localhost:8000', 'en')).toBe('Local service · localhost:8000');
  expect(friendlyHostName('127.0.0.1:12345')).toBe('本地服务 · 127.0.0.1:12345');
  expect(friendlyHostName('api.fireworks.ai.example')).toBe('api.fireworks.ai.example');
  expect(suggestRequestName('GET', 'http://localhost/api/tags-old', '')).toBe('GET /api/tags-old');
});
