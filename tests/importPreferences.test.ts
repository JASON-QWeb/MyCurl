// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { SettingsModal } from '../src/components/SettingsModal';
import { seedData } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import { useAppStore } from '../src/store/useAppStore';
import { button, click, renderComponent } from './renderComponent';

const command = 'curl https://example.org/version';
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storage, 'saveAppData').mockResolvedValue();
  vi.spyOn(storage, 'loadHistory').mockResolvedValue([]);
});
afterEach(() => vi.useRealTimers());

function showApp(skipPreview: boolean, autoSend: boolean) {
  const data = seedData();
  data.settings.language = 'en';
  data.settings.import = { ...data.settings.import, skipPreview, autoSend };
  const send = vi.fn().mockResolvedValue(undefined);
  useAppStore.setState({ data, loaded: true, selection: { kind: 'request', id: data.requests[0].id },
    init: vi.fn().mockResolvedValue(undefined), sendRequest: send, clipboardCurl: command });
  return { ...renderComponent(createElement(App)), send, originalCount: data.requests.length };
}

async function paste(target: EventTarget, text = command) {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: () => text } });
  await act(async () => { target.dispatchEvent(event); });
}

it.each(['page', 'URL', 'clipboard chip'])('uses direct import settings at the %s entry point', async entry => {
  const { container, originalCount, send } = showApp(true, true);
  if (entry === 'clipboard chip') await click(button(container, 'Import clipboard cURL and send the selected request'));
  else await paste(entry === 'URL' ? container.querySelector('.url-box .tpl-input')! : document.body);
  const state = useAppStore.getState();
  expect(state.importModal).toBeNull();
  expect(state.data.requests).toHaveLength(originalCount + 1);
  expect(state.selection).toEqual({ kind: 'request', id: state.data.requests.at(-1)!.id });
  act(() => { vi.advanceTimersByTime(50); });
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(state.selection!.id);
});

it('reuses a duplicate, batches pasted commands and sends only the last selected request when enabled', async () => {
  const { originalCount, send } = showApp(true, false);
  await paste(document.body);
  const firstSelection = useAppStore.getState().selection;
  await paste(document.body);
  expect(useAppStore.getState().data.requests).toHaveLength(originalCount + 1);
  expect(useAppStore.getState().selection).toEqual(firstSelection);
  expect(useAppStore.getState().toasts.at(-1)?.message).toContain('Switched to existing request');
  act(() => { vi.advanceTimersByTime(50); });
  expect(send).not.toHaveBeenCalled();
  act(() => useAppStore.getState().updateImportSettings({ autoSend: true }));
  await paste(document.body, command + '\ncurl https://example.org/status');
  const state = useAppStore.getState();
  expect(state.data.requests).toHaveLength(originalCount + 2);
  act(() => { vi.advanceTimersByTime(50); });
  expect(send).toHaveBeenCalledOnce();
  expect(send).toHaveBeenCalledWith(state.data.requests.at(-1)!.id);
});

it('opens preview from the clipboard chip when configured and falls back to preview for unparseable text', async () => {
  const { container, originalCount, send } = showApp(false, true);
  await click(button(container, 'Import cURL from clipboard'));
  expect(useAppStore.getState().importModal).toMatchObject({ open: true, initialText: command });
  act(() => {
    const state = useAppStore.getState();
    state.closeImportModal();
    state.updateImportSettings({ skipPreview: true });
    state.importPastedCurl('no command');
  });
  expect(useAppStore.getState().importModal?.initialText).toBe('no command');
  expect(useAppStore.getState().data.requests).toHaveLength(originalCount);
  expect(send).not.toHaveBeenCalled();
});

it.each([
  [false, 'shortcut', false], [true, 'shortcut', true], [true, 'Import & Open', false],
  [false, 'Import & Send', true], [true, 'primary', true],
] as const)('honors auto-send=%s and the explicit modal action %s', async (autoSend, action, shouldSend) => {
  const { container, send, originalCount } = showApp(false, autoSend);
  await paste(document.body);
  const modal = container.querySelector('.modal-lg')!;
  expect(useAppStore.getState().data.requests).toHaveLength(originalCount);
  const primary = modal.querySelector<HTMLButtonElement>('.modal-foot .btn-primary')!;
  expect(primary.textContent).toContain(autoSend ? 'Import & Send' : 'Import & Open');
  expect(primary.textContent).toContain('⌘↵');
  if (action === 'shortcut') {
    await act(async () => {
      modal.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
    });
  } else {
    await click(action === 'primary' ? primary : button(modal, action));
  }
  expect(useAppStore.getState().importModal).toBeNull();
  expect(useAppStore.getState().data.requests).toHaveLength(originalCount + 1);
  act(() => { vi.advanceTimersByTime(60); });
  expect(send).toHaveBeenCalledTimes(shouldSend ? 1 : 0);
});

it.each(['zh', 'en'] as const)('saves the two import settings independently from their %s controls', async language => {
  const data = seedData();
  data.settings.language = language;
  useAppStore.setState({ data, settingsModal: true });
  const { container } = renderComponent(createElement(SettingsModal));
  const rows = Array.from(container.querySelectorAll('label.switch-row'));
  const getSwitch = (label: string) => rows.find(row => row.textContent === label)!.querySelector('input')!;
  await click(getSwitch(language === 'zh' ? '直接粘贴 cURL 时跳过预览弹窗' : 'Skip preview modal on direct paste'));
  expect(useAppStore.getState().data.settings.import).toMatchObject({ skipPreview: true, autoSend: false });
  await click(getSwitch(language === 'zh' ? '归档后自动发送请求' : 'Auto-send request after import'));
  expect(useAppStore.getState().data.settings.import).toMatchObject({ skipPreview: true, autoSend: true });
});
