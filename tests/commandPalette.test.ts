// @vitest-environment jsdom
import { act, createElement, Fragment } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommandPalette } from '../src/components/CommandPalette';
import { ExportModal } from '../src/components/ExportModal';
import { newEnvironment, newFolder, newRequest, newWorkspace } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import type { Language } from '../src/lib/types';
import * as util from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';
import { importWorkspace } from './importWorkspace';
import { click, renderComponent, typeInput } from './renderComponent';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storage, 'saveAppData').mockResolvedValue();
  vi.spyOn(storage, 'loadHistory').mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

function palette(language: Language = 'en') {
  const { data, ws } = importWorkspace(language);
  const folder = newFolder(ws, null, { name: 'Billing Ops' });
  const active = newRequest(ws, folder.id, { name: 'Invoice', method: 'POST', url: 'https://localhost/pay?key=private', responseFilter: '.id' });
  const other = newWorkspace('Support');
  const env = newEnvironment(ws, { name: 'Staging' });
  data.folders = [folder];
  data.requests = [active, newRequest(ws, null, { name: 'Health', url: 'https://localhost/health' }),
    newRequest(other.id, null, { name: 'Other project', method: 'POST' })];
  data.workspaces.push(other);
  data.environments.push(env, newEnvironment(other.id, { name: 'Other base', isBase: true }));
  useAppStore.setState({ data, commandPalette: true, selection: { kind: 'request', id: active.id } });
  const { container } = renderComponent(createElement(Fragment, null, createElement(CommandPalette), createElement(ExportModal)));
  const items = () => Array.from(container.querySelectorAll<HTMLElement>('.cmd-item'));
  const search = (text: string) => {
    act(() => useAppStore.getState().setCommandPalette(true));
    typeInput(container.querySelector('.cmd-box input')!, text);
    return items();
  };
  const execute = async (query: string) => {
    const matches = search(query);
    expect(matches).toHaveLength(1);
    await click(matches[0]);
    expect(useAppStore.getState().commandPalette).toBe(false);
  };
  return { data, ws, env, other, active, folder, container, items, search, execute };
}

it('prioritizes key actions and opens the active request in the sender and code exporter', async () => {
  const { active, container, items, search, execute } = palette();
  const labels = items().map(item => item.textContent!);
  expect(labels[0]).toContain('Paste cURL to Import');
  expect(labels[1]).toBe('Send Active Request' + active.name);
  const requestIndex = labels.indexOf('POST' + active.name + active.url);
  expect(requestIndex).toBeGreaterThan(labels.indexOf('New Folder'));
  expect(requestIndex).toBeLessThan(labels.indexOf('Open Settings & Data'));
  expect(labels.findIndex(l => l.startsWith('Switch Environment'))).toBeGreaterThan(requestIndex);
  const send = vi.fn().mockResolvedValue(undefined);
  act(() => useAppStore.setState({ sendRequest: send }));
  expect(search('发送当前请求')[0].textContent).toBe('Send Active Request' + active.name);
  await act(async () => {
    container.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(active.id);
  expect(useAppStore.getState().commandPalette).toBe(false);
  await execute('导出当前请求代码 / 文档');
  expect(container.querySelector('.modal-head h2')?.textContent).toBe('Code & Docs · ' + active.name);
});

it.each(['zh', 'en'] as const)('copies the effective cURL using the saved mode and reports clipboard errors in %s', async lang => {
  const { execute } = palette(lang);
  const copy = vi.spyOn(util, 'copyText').mockResolvedValue();
  const query = lang === 'zh' ? 'copy active request as curl' : '复制当前请求为 curl';
  for (const mode of ['mask', 'resolve'] as const) {
    act(() => useAppStore.getState().updateSettings({ curlCopySecretMode: mode }));
    await execute(query);
    const command = copy.mock.lastCall![0];
    expect(command).toContain(mode === 'mask' ? 'key=••••' : 'key=private');
    if (mode === 'mask') expect(command).not.toContain('private');
    expect(command).toContain("| jq -r '.id'");
    const message = lang === 'en' ? (mode === 'mask' ? 'secrets masked' : 'raw secrets included')
      : (mode === 'mask' ? '密钥已脱敏' : '含明文密钥');
    expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ kind: 'success', message: expect.stringContaining(message) });
  }
  copy.mockRejectedValueOnce(new Error('denied'));
  await execute(query);
  expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ kind: 'error',
    message: lang === 'en' ? 'Could not copy to clipboard' : '无法复制到剪贴板' });
});

it('finds commands by partial words in either language and lets an IME finish before executing', async () => {
  const { container, search } = palette();
  for (const query of ['copy curl', '复制 curl']) {
    expect(search(query).map(row => row.textContent)).toEqual(['Copy Active Request as cURL']);
  }
  const send = vi.fn().mockResolvedValue(undefined);
  act(() => useAppStore.setState({ sendRequest: send }));
  search('发送当前请求');
  const input = container.querySelector('[role=combobox]')!;
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, isComposing: true })); });
  expect(send).not.toHaveBeenCalled();
  expect(useAppStore.getState().commandPalette).toBe(true);
  act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  expect(send).toHaveBeenCalledOnce();
});

it('duplicates the selection and hides all four context actions for folders, missing requests and an empty selection', async () => {
  const { active, folder, execute, search } = palette('zh');
  await execute('Duplicate Active Request');
  const state = useAppStore.getState();
  const clone = state.data.requests.at(-1)!;
  expect(clone).toMatchObject({ name: active.name + '（副本）', folderId: active.folderId, url: active.url });
  expect(state.selection).toEqual({ kind: 'request', id: clone.id });
  for (const selection of [{ kind: 'folder', id: folder.id }, { kind: 'request', id: 'removed' }, null] as const) {
    act(() => useAppStore.setState({ selection }));
    expect(search('active request')).toHaveLength(0);
  }
});

it('marks current destinations, switches environments and workspaces and omits unavailable switchers', async () => {
  const { data, ws, env, other, search, execute } = palette();
  expect(search('切换环境：仅全局变量')[0].textContent).toBe('Switch Environment: Global Only(Active)');
  await execute('切换环境：Staging');
  expect(useAppStore.getState().data.settings.activeEnvironment[ws]).toBe(env.id);
  expect(search('Switch Environment: Staging')[0].textContent).toContain('(Active)');
  expect(search('Global Only')[0].textContent).not.toContain('(Active)');
  await execute('Global Only');
  expect(useAppStore.getState().data.settings.activeEnvironment[ws]).toBeNull();
  expect(search('Switch Workspace: API workspace')[0].textContent).toContain('(Active)');
  await execute('切换工作区：Support');
  expect(useAppStore.getState().data.settings.activeWorkspaceId).toBe(other.id);
  expect(useAppStore.getState().selection?.id).toBe(data.requests[2].id);
  expect(search('Switch Workspace: Support')[0].textContent).toContain('(Active)');
  expect(search('Switch Environment')).toHaveLength(0);
  act(() => useAppStore.getState().mutate(d => ({ ...d, workspaces: [other] })));
  expect(search('Switch Workspace')).toHaveLength(0);
});

it.each([true, false])('toggles the effective system theme (dark=%s) and the layout in both directions', async dark => {
  const { execute } = palette('zh');
  vi.stubGlobal('matchMedia', () => ({ matches: dark }));
  act(() => useAppStore.getState().updateSettings({ theme: 'system', layout: 'horizontal' }));
  await execute('Toggle Dark / Light Theme');
  expect(useAppStore.getState().data.settings.theme).toBe(dark ? 'light' : 'dark');
  await execute('切换深色 / 浅色主题');
  expect(useAppStore.getState().data.settings.theme).toBe(dark ? 'dark' : 'light');
  await execute('Toggle Horizontal / Vertical Layout');
  expect(useAppStore.getState().data.settings.layout).toBe('vertical');
  await execute('切换左右 / 上下布局');
  expect(useAppStore.getState().data.settings.layout).toBe('horizontal');
});

it('restricts method and folder filters to matching workspace requests and keeps the 24-result ceiling', () => {
  const { active, ws, folder, search } = palette();
  for (const query of ['METHOD:post', 'folder:"BILLING OPS"', 'method:POST folder:"Billing Ops" /pay']) {
    const rows = search(query);
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('POST' + active.name + active.url);
  }
  expect(search('folder:"Billing Ops" method:GET')).toHaveLength(0);
  const many = Array.from({ length: 30 }, (_, i) => newRequest(ws, folder.id, { name: 'Request ' + i, method: 'GET' }));
  act(() => useAppStore.getState().mutate(d => ({ ...d, requests: [...d.requests, ...many] })));
  const rows = search('folder:"Billing Ops" method:get');
  expect(rows).toHaveLength(24);
  expect(rows.at(-1)?.textContent).toBe('GETRequest 23');
});
