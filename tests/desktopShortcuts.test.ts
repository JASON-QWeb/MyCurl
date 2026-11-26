// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { emptyBody, newFolder, newRequest } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import type { Language } from '../src/lib/types';
import { useAppStore } from '../src/store/useAppStore';
import { importWorkspace } from './importWorkspace';
import { button, click, renderComponent, typeInput } from './renderComponent';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storage, 'saveAppData').mockResolvedValue();
  vi.spyOn(storage, 'loadHistory').mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

function showApp(language: Language = 'en') {
  const { data, ws } = importWorkspace(language);
  const folder = newFolder(ws, null);
  const req = newRequest(ws, folder.id, { name: 'Health', url: 'https://localhost/health',
    body: { ...emptyBody(), type: 'json', text: '{}' } });
  const next = newRequest(ws, null, { name: 'Ready', url: 'https://localhost/ready' });
  data.requests = [req, next];
  data.folders = [folder];
  useAppStore.setState({ data, loaded: true, init: vi.fn().mockResolvedValue(undefined),
    selection: { kind: 'request', id: req.id } });
  return { ...renderComponent(createElement(App)), req, next, folder };
}

async function press(key: string, modifier: 'ctrlKey' | 'metaKey' = 'metaKey', options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, [modifier]: true, ...options });
  await act(async () => { (document.activeElement ?? document.body).dispatchEvent(event); });
  return event.defaultPrevented;
}

it.each(['metaKey', 'ctrlKey'] as const)('selects the current URL and duplicates the selected request using %s', async mod => {
  const { container, next } = showApp(mod === 'metaKey' ? 'en' : 'zh');
  await act(async () => useAppStore.getState().selectRequest(next.id));
  expect(await press('l', mod)).toBe(true);
  const url = container.querySelector<HTMLInputElement>('input[data-url-input="true"]')!;
  expect(document.activeElement).toBe(url);
  expect(url.value.slice(url.selectionStart!, url.selectionEnd!)).toBe(next.url);
  expect(await press('d', mod)).toBe(false);
  act(() => url.blur());
  expect(await press('d', mod)).toBe(true);
  const state = useAppStore.getState();
  const clone = state.data.requests.at(-1)!;
  expect(state.data.requests).toHaveLength(3);
  expect(clone.id).not.toBe(next.id);
  expect(clone.url).toBe(next.url);
  expect(state.selection?.id).toBe(clone.id);
  expect(state.toasts.at(-1)).toMatchObject({ kind: 'success', message: mod === 'metaKey' ? 'Duplicated request' : '已复制请求副本' });
  expect(await press('d', mod, { repeat: true })).toBe(true);
  expect(useAppStore.getState().data.requests).toHaveLength(3);
});

it('leaves duplicate to inputs, textareas, contenteditable descendants and CodeMirror controls', async () => {
  const { container, req } = showApp();
  const content = document.body.appendChild(document.createElement('div'));
  content.setAttribute('contenteditable', 'true');
  const nested = content.appendChild(document.createElement('span'));
  nested.tabIndex = 0;
  const editor = container.querySelector<HTMLElement>('.cm-editor')!;
  const editorButton = editor.appendChild(document.createElement('button'));
  const fields = [container.querySelector<HTMLInputElement>('.req-name-input')!,
    document.body.appendChild(document.createElement('textarea')), nested, editorButton];
  for (const field of fields) {
    act(() => field.focus());
    expect(document.activeElement).toBe(field);
    expect(await press('d')).toBe(false);
  }
  expect(useAppStore.getState().selection?.id).toBe(req.id);
  expect(useAppStore.getState().data.requests).toHaveLength(2);
});

it('respects every open modal and dialog and has no request shortcuts on a folder', async () => {
  const { container, req, folder } = showApp();
  const trigger = container.querySelector<HTMLButtonElement>('.topbar-right button')!;
  const closed = { settingsModal: false, envModal: false, importModal: null, exportModal: null,
    docModal: null, commandPalette: false, dialog: null };
  for (const open of [{ settingsModal: true }, { envModal: true }, { importModal: { open: true } },
    { exportModal: { requestId: req.id } }, { docModal: { scope: 'workspace' } }, { commandPalette: true },
    { dialog: { kind: 'confirm', title: 'Confirm' } }] as const) {
    act(() => useAppStore.setState({ ...closed, ...open }));
    act(() => trigger.focus());
    expect(await press('l')).toBe(false);
    expect(await press('d')).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(useAppStore.getState().data.requests).toHaveLength(2);
  }
  act(() => {
    useAppStore.setState(closed);
    useAppStore.getState().selectFolder(folder.id);
  });
  expect(await press('l')).toBe(false);
  expect(await press('d')).toBe(false);
});

it.each(['en', 'zh'] as const)('flushes a pending edit from Settings and confirms the disk write in %s', async language => {
  const { container } = showApp(language);
  typeInput(container.querySelector('.req-name-input')!, 'Edited before saving');
  act(() => useAppStore.getState().setSettingsModal(true));
  const save = vi.mocked(storage.saveAppData);
  let finish!: () => void;
  save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  expect(save).not.toHaveBeenCalled();
  expect(await press('s', language === 'en' ? 'metaKey' : 'ctrlKey')).toBe(true);
  expect(save).toHaveBeenCalledOnce();
  expect(save.mock.calls[0][0].requests[0].name).toBe('Edited before saving');
  expect(useAppStore.getState().toasts).toHaveLength(0);
  await act(async () => finish());
  expect(useAppStore.getState().toasts.at(-1)?.message).toBe(language === 'en' ? 'Saved locally' : '已保存到本地');
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(save).toHaveBeenCalledOnce();
  expect(await press('s')).toBe(true);
  expect(save).toHaveBeenCalledTimes(2);
});

it('reports a failed save and never overwrites user data with the startup state', async () => {
  showApp();
  act(() => useAppStore.setState({ loaded: false }));
  expect(await press('s')).toBe(true);
  expect(storage.saveAppData).not.toHaveBeenCalled();
  act(() => useAppStore.setState({ loaded: true }));
  vi.mocked(storage.saveAppData).mockRejectedValueOnce(new Error('disk full'));
  await press('s');
  expect(useAppStore.getState().saveError).toBe('disk full');
  expect(useAppStore.getState().toasts.map(t => [t.kind, t.message])).toEqual([['error', 'Could not save locally']]);
});

it.each(['zh', 'en'] as const)('opens the collapsed two-column shortcuts reference at the bottom of Settings in %s', async language => {
  const { container } = showApp(language);
  const showSettings = () => click(button(container, language === 'zh' ? '设置与导入导出' : 'Settings & Data'));
  await showSettings();
  const details = container.querySelector<HTMLDetailsElement>('.modal-body > details:last-child')!;
  const summary = details.querySelector('summary')!;
  expect(summary.textContent).toBe(language === 'zh' ? '快捷键速查' : 'Keyboard Shortcuts');
  expect(details.open).toBe(false);
  await click(summary);
  expect(details.open).toBe(true);
  const rows = Array.from(details.querySelectorAll<HTMLTableRowElement>('tbody tr'));
  expect(rows.every(row => row.cells.length === 2)).toBe(true);
  expect(rows.map(row => row.cells[0].textContent)).toEqual(['⌘I / ⌘V / ⌘⇧V', '⌘K', '⌘↵', '⌘N', '⌘L', '⌘D', '⌘S']);
  expect(rows[6].cells[1].textContent).toBe(language === 'zh' ? '立即保存到本地' : 'Save locally now');
  await click(summary);
  expect(details.open).toBe(false);
  await click(summary);
  await click(button(container, language === 'zh' ? '完成' : 'Done'));
  await showSettings();
  expect(container.querySelector<HTMLDetailsElement>('details')!.open).toBe(false);
});
