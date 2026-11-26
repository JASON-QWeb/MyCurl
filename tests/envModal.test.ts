// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EnvModal } from '../src/components/EnvModal';
import { newEnvironment, newFolder, newWorkspace } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import { kv } from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';
import { importWorkspace } from './importWorkspace';
import { button, click, renderComponent, typeInput } from './renderComponent';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storage, 'saveAppData').mockResolvedValue();
});
afterEach(() => vi.useRealTimers());

function openModal(data = importWorkspace().data) {
  useAppStore.setState({ data, envModal: true, toasts: [] });
  return renderComponent(createElement(EnvModal)).container;
}

async function chooseFile(input: HTMLInputElement, name: string, content: string) {
  const file = new File([content], name);
  Object.defineProperty(file, 'text', { value: () => Promise.resolve(content) });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  return useAppStore.getState();
}

it('imports dotenv and Postman content through the same picker and opens each imported environment', async () => {
  const { data, ws } = importWorkspace();
  const container = openModal(data);
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  expect(input.accept).toBe('.json,.env,.txt,application/json,text/plain');
  const open = vi.spyOn(input, 'click');
  await click(button(container, 'Import Env'));
  expect(open).toHaveBeenCalledOnce();

  let state = await chooseFile(input, '.env.staging', 'export API_KEY=abc\nPORT=8000');
  expect(state.data.environments.at(-1)).toMatchObject({ workspaceId: ws, name: 'staging',
    variables: [{ key: 'API_KEY', secret: true }, { key: 'PORT', secret: false }] });
  expect(container.querySelector('.menu-item.active')?.textContent).toContain('staging');
  expect(container.querySelector<HTMLInputElement>('input[type=password]')?.value).toBe('abc');

  const postman = { _postman_variable_scope: 'environment', name: 'From Postman', values: [
    { key: 'disabled', value: 'v', enabled: false },
  ] };
  state = await chooseFile(input, 'variables.txt', '\uFEFF' + JSON.stringify(postman));
  expect(state.data.environments.at(-1)).toMatchObject({ name: postman.name, variables: [{ key: 'disabled', enabled: false }] });
  expect(container.querySelector('.menu-item.active')?.textContent).toContain(postman.name);
  expect(state.data.settings.activeEnvironment).toEqual(data.settings.activeEnvironment);
  expect(state.toasts.map(t => t.kind)).toEqual(['success', 'success']);
  expect(storage.saveAppData).toHaveBeenCalledWith(state.data);
});

it.each(['zh', 'en'] as const)('reports a single format error per unrecognized file in %s', async lang => {
  const { data } = importWorkspace(lang);
  const container = openModal(data);
  const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
  const message = lang === 'zh' ? '未识别的环境文件（支持 Postman 环境 JSON 或 .env 文件）'
    : 'Unrecognized environment file (supports Postman Environment JSON or .env)';
  for (const content of ['# no assignments', '{"_postman_variable_scope":"environment","values":{}}']) {
    const before = useAppStore.getState().toasts.length;
    const state = await chooseFile(input, 'unknown.txt', content);
    expect(state.toasts).toHaveLength(before + 1);
    expect(state.toasts.at(-1)).toMatchObject({ kind: 'error', message });
    expect(state.data).toBe(data);
  }
  expect(storage.saveAppData).not.toHaveBeenCalled();
});

it.each(['zh', 'en'] as const)('duplicates and selects a non-base environment with independent variables in %s', async lang => {
  const { data, ws } = importWorkspace(lang);
  const source = newEnvironment(ws, { name: 'Local', color: '#6366f1', variables: [
    { ...kv('token', 'value', false), secret: true, note: 'rotation' }, kv('HOST', 'localhost'),
  ] });
  data.environments.push(source);
  data.settings.activeEnvironment[ws] = source.id;
  const container = openModal(data);
  const label = lang === 'zh' ? '复制环境' : 'Duplicate environment';
  const actions = container.querySelectorAll<HTMLButtonElement>(`button[title="${label}"]`);
  expect(actions).toHaveLength(1);
  expect(actions[0].nextElementSibling?.getAttribute('title')).toBe(lang === 'zh' ? '删除环境' : 'Delete environment');
  const store = useAppStore.getState();
  expect(store.duplicateEnvironment(data.environments[0].id)).toBeNull();
  expect(store.duplicateEnvironment('missing')).toBeNull();
  expect(useAppStore.getState().data).toBe(data);
  await click(actions[0]);

  const state = useAppStore.getState();
  const copy = state.data.environments.at(-1)!;
  expect(copy.name).toBe(lang === 'zh' ? 'Local（副本）' : 'Local (Copy)');
  expect(copy).toMatchObject({ workspaceId: ws, color: source.color, isBase: false });
  expect(copy.id).not.toBe(source.id);
  expect(container.querySelector('.menu-item.active')?.textContent).toContain(copy.name);
  expect(state.data.settings.activeEnvironment[ws]).toBe(source.id);
  for (const [index, variable] of copy.variables.entries()) {
    expect(variable).toEqual({ ...source.variables[index], id: expect.any(String) });
  }
  expect(new Set([...copy.variables, ...source.variables].map(v => v.id)).size).toBe(4);
  typeInput(container.querySelector<HTMLInputElement>('input[type=password]')!, 'edited copy');
  expect(useAppStore.getState().data.environments.at(-1)?.variables[0].value).toBe('edited copy');
  expect(source.variables[0].value).toBe('value');
});

it.each(['zh', 'en'] as const)('filters workspace secrets by key, scope and note in %s', lang => {
  const { data, ws } = importWorkspace(lang);
  const container = openModal(data);
  expect(container.querySelector('input[type=search]')).toBeNull();
  const global = { ...kv('GLOBAL_TOKEN', 'private-value'), secret: true, note: 'Rotation policy' };
  const folder = newFolder(ws, null, { name: 'Billing', variables: [
    { ...kv('API_KEY', 'folder-private'), secret: true }, kv('PUBLIC', 'visible'),
  ] });
  const elsewhere = newWorkspace('Other');
  const outside = newEnvironment(elsewhere.id, { variables: [{ ...kv('OTHER_KEY', 'external'), secret: true }] });
  act(() => useAppStore.setState({ data: { ...data, workspaces: [...data.workspaces, elsewhere], folders: [folder],
    environments: [{ ...data.environments[0], variables: [global] }, outside] } }));
  const input = container.querySelector<HTMLInputElement>('input[type=search]')!;
  expect(input.placeholder).toBe(lang === 'zh' ? '筛选密钥名或来源…' : 'Filter secrets or scopes…');
  const keys = () => Array.from(container.querySelectorAll('tbody tr td:first-child'), cell => cell.textContent);
  expect(keys()).toEqual(['{{GLOBAL_TOKEN}}', '{{API_KEY}}']);
  for (const [query, key] of [['  ToKeN ', 'GLOBAL_TOKEN'], ['BILLING', 'API_KEY'], ['rotation', 'GLOBAL_TOKEN']]) {
    typeInput(input, query);
    expect(keys()).toEqual([`{{${key}}}`]);
  }
  typeInput(input, global.value);
  expect(keys()).toEqual([]);
  expect(container.textContent).toContain(lang === 'zh' ? '没有匹配的密钥' : 'No matching secrets');
  expect(container.textContent).not.toContain(global.value);
  typeInput(input, '');
  expect(keys()).toEqual(['{{GLOBAL_TOKEN}}', '{{API_KEY}}']);
});
