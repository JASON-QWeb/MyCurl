// @vitest-environment jsdom
import { act, createElement } from 'react';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RequestPane } from '../src/components/RequestPane';
import { emptyBody, newRequest, newWorkspace, seedData } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import * as util from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';
import { button, click, renderComponent } from './renderComponent';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storage, 'saveAppData').mockResolvedValue();
  vi.spyOn(storage, 'deleteHistoryItem').mockResolvedValue();
});
afterEach(() => vi.useRealTimers());

it('fills a missing folder secret in place and refreshes decorations without replacing the editor or cursor', async () => {
  const data = seedData();
  data.settings.language = 'en';
  const folder = data.folders[0];
  const disabled = { ...util.kv('access_token', '', false), note: 'existing row' };
  folder.variables = [disabled];
  const req = newRequest(folder.workspaceId, folder.id, { url: 'https://example.org',
    body: { ...emptyBody(), type: 'text', text: '{{access_token}}' } });
  data.requests = [req];
  useAppStore.setState({ data });
  const { container } = renderComponent(createElement(RequestPane, { req, dark: true }));
  const editor = container.querySelector<HTMLElement>('.cm-editor')!;
  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ selection: { anchor: 3 } }));
  expect(editor.querySelector('.cm-tpl-missing')?.textContent).toBe('{{access_token}}');

  await click(container.querySelector<HTMLButtonElement>('.var-chip.missing')!);
  const state = useAppStore.getState();
  expect(state.dialog).toMatchObject({ title: 'Set a value for {{access_token}}', message: expect.stringContaining(folder.name) });
  const other = util.kv('other', 'edited while dialog is open');
  act(() => state.updateFolder(folder.id, { variables: [disabled, other] }));
  await act(async () => state.closeDialog('private-input'));

  const saved = useAppStore.getState().data.folders[0].variables;
  expect(saved).toEqual([{ ...disabled, value: 'private-input', enabled: true, secret: true }, other]);
  expect(container.querySelector('.var-chip.secret')?.textContent).not.toContain('private-input');
  expect(editor.querySelector('.cm-tpl-secret')).toBeTruthy();
  expect(useAppStore.getState().toasts.at(-1)?.message).toContain('Saved {{access_token}}');
  act(() => state.updateFolder(folder.id, { variables: [{ ...saved[0], secret: false }, other] }));
  expect(editor.querySelector('.cm-tpl-ok')).toBeTruthy();
  expect(EditorView.findFromDOM(container.querySelector<HTMLElement>('.cm-editor')!)).toBe(view);
  expect(view.state.selection.main.anchor).toBe(3);
  await act(async () => { await vi.advanceTimersByTimeAsync(320); });
  expect(storage.saveAppData).toHaveBeenCalledWith(useAppStore.getState().data);
});

it('offers the workspace base environment for a root variable and respects cancellation', async () => {
  const data = seedData();
  const ws = data.workspaces[0];
  data.workspaces.push(newWorkspace());
  data.settings.activeWorkspaceId = data.workspaces[1].id;
  const req = newRequest(ws.id, null, { url: '{{domain}}/v1' });
  data.requests = [req];
  useAppStore.setState({ data });
  const { container } = renderComponent(createElement(RequestPane, { req, dark: true }));
  const chip = container.querySelector<HTMLButtonElement>('.var-chip.missing')!;
  await click(chip);
  expect(useAppStore.getState().dialog?.message).toContain('全局变量');
  await act(async () => useAppStore.getState().closeDialog(null));
  expect(useAppStore.getState().data).toBe(data);
  await click(chip);
  await act(async () => useAppStore.getState().closeDialog('example.org'));
  expect(useAppStore.getState().data.environments.find(e => e.workspaceId === ws.id && e.isBase)?.variables)
    .toEqual([expect.objectContaining({ key: 'domain', value: 'example.org', enabled: true, secret: false })]);
  expect(container.querySelector('.var-chip.ok')?.textContent).toContain('example.org');
  expect(useAppStore.getState().toasts.at(-1)?.message).toContain('已将 {{domain}} 保存到全局变量');
});

it('keeps copy and code prominent and closes the request actions on outside click and Escape', async () => {
  const data = seedData();
  data.settings.language = 'en';
  const req = data.requests[0];
  req.url = 'https://example.org/?key=private';
  useAppStore.setState({ data });
  const copy = vi.spyOn(util, 'copyText').mockResolvedValue();
  const { container } = renderComponent(createElement(RequestPane, { req, dark: true }));
  const more = button(container, 'More request actions');
  expect(container.querySelector('.req-header .menu-pop')).toBeNull();
  expect(container.querySelectorAll('.req-header button[title*="cURL"]')).toHaveLength(2);
  await click(more);
  await click(document.body);
  expect(more.getAttribute('aria-expanded')).toBe('false');
  await click(more);
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(document.activeElement).toBe(more);
  expect(more.getAttribute('aria-expanded')).toBe('false');
  for (const mode of ['mask', 'resolve'] as const) {
    act(() => useAppStore.getState().updateSettings({ curlCopySecretMode: mode }));
    await click(more);
    await click(button(container, mode === 'mask' ? 'Copy cURL (raw secrets)' : 'Copy cURL (secrets masked)'));
    expect(copy.mock.lastCall?.[0]).toContain(mode === 'mask' ? 'key=private' : 'key=••••');
    await click(more);
    await click(button(container, 'Copy Resolved URL'));
    expect(copy.mock.lastCall?.[0]).toBe(mode === 'mask' ? 'https://example.org/?key=••••' : req.url);
  }
  await click(more);
  await click(button(container, 'Duplicate Request'));
  expect(useAppStore.getState().data.requests.at(-1)?.name).toBe(req.name + ' (Copy)');
  for (const confirmed of [false, true]) {
    await click(more);
    await click(button(container, 'Delete Request'));
    expect(useAppStore.getState().dialog).toMatchObject({ kind: 'confirm', danger: true });
    await act(async () => useAppStore.getState().closeDialog(confirmed));
    expect(useAppStore.getState().data.requests.some(r => r.id === req.id)).toBe(!confirmed);
  }
  expect(storage.deleteHistoryItem).toHaveBeenCalledOnce();
});
