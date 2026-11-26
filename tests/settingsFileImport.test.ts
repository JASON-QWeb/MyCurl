// @vitest-environment jsdom
import { act, createElement } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SettingsModal } from '../src/components/SettingsModal';
import { Sidebar } from '../src/components/Sidebar';
import { exportMyCurlJson } from '../src/lib/collectionIO';
import { newFolder, newRequest, newWorkspace } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import type { Language } from '../src/lib/types';
import { kv } from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';
import { importWorkspace } from './importWorkspace';
import { button, click, renderComponent } from './renderComponent';

beforeEach(() => { vi.spyOn(storage, 'saveAppData').mockResolvedValue(); });

function settings(lang: Language = 'en', data = importWorkspace(lang).data) {
  useAppStore.setState({ data, settingsModal: true, toasts: [] });
  const { container } = renderComponent(createElement(SettingsModal));
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  const choose = async (name: string, content: string) => {
    const file = new File([content], name);
    Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
    const picker = container.querySelector<HTMLInputElement>('input[type=file]')!;
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    await act(async () => { picker.dispatchEvent(new Event('change', { bubbles: true })); });
    return useAppStore.getState();
  };
  return { container, input, choose };
}

const spec = { info: { title: 'Routes' }, paths: { '/ready': { get: {} } } };
const har = { log: { entries: [{ request: { method: 'GET', url: 'https://localhost/status' } }] } };

it.each([
  ['openapi.json', JSON.stringify({ openapi: '3.1.0', ...spec }), 'Routes', 'GET /ready'],
  ['swagger.json', JSON.stringify({ swagger: '2.0', ...spec }), 'Routes', 'GET /ready'],
  ['capture.har', JSON.stringify(har), 'Local service · localhost', 'GET /status'],
  ['suite.http', '### Read\nGET https://localhost/r', 'suite', 'Read'],
  ['requests.rest', '### Update\nPATCH https://localhost/r', 'requests', 'Update'],
  ['postman.json', JSON.stringify({ info: { name: 'Collection' }, item: [{ name: 'Status', request: { url: 'https://localhost' } }] }), 'Collection', 'Status'],
  ['apifox.json', JSON.stringify({ info: { name: 'Project' }, apiCollection: [{ name: 'Status', api: { path: '/s' } }] }), 'Project', 'Status'],
])('imports %s through the single Settings file picker', async (name, content, folder, request) => {
  const { choose, container, input } = settings();
  expect(container.querySelectorAll('input[type=file]')).toHaveLength(1);
  expect(input.accept).toBe('.json,.har,.http,.rest,.txt,.sh,.curl');
  const open = vi.spyOn(input, 'click');
  await click(button(container, 'Import Collection / Backup / File'));
  expect(open).toHaveBeenCalledOnce();
  const state = await choose(name, content);
  expect(state.settingsModal).toBe(false);
  expect(state.data.folders[0].name).toBe(folder);
  expect(state.data.requests[0].name).toBe(request);
  expect(state.toasts.at(-1)?.kind).toBe('success');
  expect(storage.saveAppData).toHaveBeenCalledWith(state.data);
});

it('dispatches overlapping JSON formats in the documented priority and never treats an unknown JSON string as cURL', async () => {
  const { choose } = settings();
  const hybrid = { ...spec, openapi: '3.0.0', ...har, workspaces: [], requests: [],
    info: { name: 'Selected', title: 'Wrong format' }, item: [], _postman_variable_scope: 'environment', values: [], name: 'Environment' };
  let state = await choose('ambiguous.json', JSON.stringify({ ...hybrid, apiCollection: [{ name: 'Apifox request', api: { path: '/' } }] }));
  expect(state.data.requests[0].name).toBe('Apifox request');
  const reopen = () => act(() => useAppStore.getState().setSettingsModal(true));
  reopen();
  const submit = (obj: unknown) => choose('data.json', JSON.stringify(obj));
  state = await submit(hybrid);
  expect(state.data.environments.at(-1)?.name).toBe('Environment');
  reopen();
  state = await submit({ ...hybrid, _postman_variable_scope: undefined });
  expect(state.data.folders.at(-1)?.name).toBe('Selected');
  reopen();
  state = await submit({ ...hybrid, _postman_variable_scope: undefined, item: undefined });
  expect(state.data.folders.at(-1)?.name).toBe('Wrong format');
  reopen();
  state = await submit({ ...har, workspaces: [], requests: [] });
  expect(state.data.requests.at(-1)?.name).toBe('GET /status');
  reopen();
  const before = state.data;
  state = await submit('curl https://localhost');
  expect(state.data).toBe(before);
  expect(state.settingsModal).toBe(true);
  expect(state.toasts.at(-1)?.kind).toBe('error');
});

it('imports cURL files first and recognizes model hosts and endpoints from the unified picker', async () => {
  const { choose } = settings('zh');
  const paths = ['chat', 'generate', 'tags', 'embed', 'embeddings', 'pull', 'show'];
  const commands = paths.map(p => 'curl http://127.0.0.1:11434/api/' + p);
  const providers = ['localhost:1234', 'api.fireworks.ai', 'router.huggingface.co', 'api-inference.huggingface.co',
    'gateway.ai.cloudflare.com', 'api.replicate.com', 'api.cerebras.ai', 'api.sambanova.ai'];
  const state = await choose('commands.txt', ['GET https://localhost/http-fallback', ...commands, ...providers.map(h => 'curl http://' + h + '/v1/models')].join('\n'));
  expect(state.data.requests.slice(0, paths.length).map(r => r.name)).toEqual([
    'Ollama 对话', 'Ollama 文本生成', '本地模型列表', '向量嵌入', '向量嵌入', '拉取模型', '模型信息',
  ]);
  expect(state.data.folders.map(f => f.name.split(' · ')[0])).toEqual([
    'Ollama', 'LM Studio', 'Fireworks AI', 'Hugging Face', 'Hugging Face', 'Cloudflare AI Gateway', 'Replicate', 'Cerebras', 'SambaNova',
  ]);
  expect(state.data.requests).toHaveLength(paths.length + providers.length);
});

it.each(['en', 'zh'] as const)('confirms replacement and explains re-entry for masked backups in %s', async lang => {
  const { data, ws } = importWorkspace(lang);
  data.folders.push(newFolder(ws, null, { name: 'Restored', variables: [{ ...kv('custom', 'ab'), secret: true }] }));
  const { choose } = settings(lang);
  const before = useAppStore.getState().data;
  const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
  act(() => { useAppStore.setState({ confirm }); });
  await choose('full.json', exportMyCurlJson(data, false));
  const note = lang === 'en' ? 'must be re-entered' : '需要重新填写';
  expect(confirm.mock.calls[0][0].message).not.toContain(note);
  const masked = exportMyCurlJson(data, true);
  let state = await choose('masked.json', masked);
  expect(confirm.mock.calls[1][0]).toMatchObject({ danger: true, message: expect.stringContaining(note) });
  expect(state.data).toBe(before);
  state = await choose('masked.json', masked);
  expect(state.data.folders[0].name).toBe('Restored');
  expect(state.data.folders[0].variables[0].value).toBe('••');
  expect(state.settingsModal).toBe(false);
});

it('keeps the importer available after an unknown file or a capture without HTTP entries', async () => {
  const { choose } = settings();
  const previous = useAppStore.getState().data;
  for (const content of ['unrecognized text', JSON.stringify({ log: { entries: [] } })]) {
    const state = await choose('file.txt', content);
    expect(state.settingsModal).toBe(true);
    expect(state.data).toBe(previous);
    expect(state.toasts.at(-1)?.kind).toBe('error');
  }
});

function trackDownload() {
  let captured: Blob;
  const revoked = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL(blob: Blob) { captured = blob; return 'blob:collection'; }
    static revokeObjectURL = revoked;
  });
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  return async () => {
    expect(names.at(-1)).toMatch(/\.postman_collection\.json$/);
    expect(revoked).toHaveBeenCalledWith('blob:collection');
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsText(captured);
    });
  };
}

function exportData(language: Language) {
  const { data, ws } = importWorkspace(language);
  const folder = newFolder(ws, null, { name: 'Selected', variables: [{ ...kv('key', 'local-secret-value'), secret: true }] });
  const sibling = newFolder(ws, null, { name: 'Sibling' });
  data.folders.push(folder, sibling);
  data.requests.push(newRequest(ws, folder.id, { name: 'Inside', url: 'https://localhost', description: 'local-secret-value' }));
  const other = newWorkspace('Other workspace');
  data.workspaces.push(other);
  data.requests.push(newRequest(other.id, null, { name: 'Outside workspace' }));
  return { data, folder };
}

it.each(['en', 'zh'] as const)('exports a masked workspace from Settings and displays a single supported-formats hint in %s', async lang => {
  const captured = trackDownload();
  const { data } = exportData(lang);
  const { container } = settings(lang, data);
  expect(container.querySelector('.card:last-child small')?.textContent).toBe(lang === 'en'
    ? 'Supports OpenAPI, Postman, Apifox, HAR, .http, MyCurl Backup, cURL' : '支持 OpenAPI · Postman · Apifox · HAR · .http · MyCurl 备份 · cURL');
  await click(button(container, lang === 'en' ? 'Export Postman (Masked)' : '导出 Postman 集合（脱敏）'));
  const file = await captured();
  expect(JSON.parse(file).info.name).toBe(data.workspaces[0].name);
  expect(file).toContain('Sibling');
  expect(file).not.toContain('Outside workspace');
  expect(file).not.toContain('local-secret-value');
});

it.each(['en', 'zh'] as const)('exports only the right-clicked folder beneath Markdown in the %s Sidebar menu', async lang => {
  const captured = trackDownload();
  const { data, folder } = exportData(lang);
  useAppStore.setState({ data, settingsModal: false });
  const { container } = renderComponent(createElement(Sidebar, { width: 270 }));
  const label = lang === 'en' ? 'Export Postman Collection…' : '导出 Postman 集合…';
  expect(container.textContent).not.toContain(label);
  const row = container.querySelector('[data-drop-folder-id="' + folder.id + '"]')!;
  act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
  const action = button(container.querySelector('.ctx-menu')!, label);
  expect(action.previousElementSibling?.textContent).toBe(lang === 'en' ? 'Export Markdown Docs…' : '导出 Markdown 文档…');
  await click(action);
  expect(container.querySelector('.ctx-menu')).toBeNull();
  const file = await captured();
  const collection = JSON.parse(file);
  expect(collection.info.name).toBe('Selected');
  expect(collection.item).toHaveLength(1);
  expect(collection.item[0].name).toBe('Inside');
  for (const value of ['Sibling', 'Outside workspace', 'local-secret-value']) expect(file).not.toContain(value);
});
