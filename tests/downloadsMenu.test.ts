// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { useAppStore } from '../src/store/useAppStore';
import { fetchDownloads, saveDownloadFile } from '../src/lib/downloads';
import * as bridge from '../src/lib/bridge';
import * as util from '../src/lib/util';
import { button, click, renderComponent } from './renderComponent';
import { importWorkspace } from './importWorkspace';

afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

it('saves via the server, reveals from the toast and manages refreshed missing files in history', async () => {
  vi.useFakeTimers();
  const opts = { filename: 'result.json', text: '{}', mimeType: 'application/json', source: 'response' as const };
  const record = { filename: opts.filename, mimeType: opts.mimeType, source: opts.source, id: 'saved', dir: '/Downloads',
    path: '/Downloads/result.json', size: 2, createdAt: Date.now(), exists: true };
  let items = [{ ...record, exists: false }];
  const fetch = vi.fn(async (url: string, req?: RequestInit) => {
    if (req?.method === 'DELETE') { items = []; return Response.json({ ok: true }); }
    return Response.json(url.endsWith('/reveal') ? { ok: true } : req?.method === 'POST' ? record : items);
  });
  vi.stubGlobal('fetch', fetch);
  useAppStore.setState({ data: importWorkspace().data, loaded: true, init: vi.fn(), serverInfo: {
    version: '1', dataDir: '/state', downloadDir: record.dir, platform: 'test' } });
  const { container } = renderComponent(createElement(App));
  await act(async () => { await useAppStore.getState().saveAndRecordDownload(opts); });
  const toast = container.querySelector('.toast-success')!;
  expect(toast.textContent).toContain('Saved result.json (2 B)');
  await click(button(toast, 'Show in Folder'));
  expect(toast.isConnected).toBe(true);
  expect(fetch).toHaveBeenLastCalledWith('/api/downloads/reveal', expect.objectContaining({ body: JSON.stringify({ path: record.path }) }));
  act(() => vi.advanceTimersByTime(5999));
  expect(toast.isConnected).toBe(true);
  act(() => vi.advanceTimersByTime(1));
  expect(toast.isConnected).toBe(false);
  await click(button(container, 'Downloads'));
  const menu = container.querySelector('.downloads-menu')!;
  expect(menu.textContent).toContain('File missing');
  expect(menu.querySelector('[title="/Downloads/result.json"]')).toBeTruthy();
  await click(button(menu, 'Show in Folder'));
  expect(fetch).toHaveBeenLastCalledWith('/api/downloads/reveal', expect.objectContaining({ body: JSON.stringify({ path: record.path }) }));
  await click(button(menu, 'Open Folder'));
  expect(fetch).toHaveBeenLastCalledWith('/api/downloads/reveal', expect.objectContaining({ body: JSON.stringify({ path: record.dir }) }));
  const copy = vi.spyOn(util, 'copyText').mockResolvedValue();
  await click(button(menu, 'Copy path'));
  expect(copy).toHaveBeenCalledWith(record.path);
  await click(button(menu, 'Remove'));
  expect(menu.textContent).toContain('No downloads yet');
  expect(fetch).toHaveBeenCalledWith('/api/downloads?id=saved', { method: 'DELETE' });
  await act(async () => { await useAppStore.getState().saveAndRecordDownload(opts); });
  await click(button(menu, 'Clear'));
  expect(fetch).toHaveBeenLastCalledWith('/api/downloads', { method: 'DELETE' });
  expect(menu.textContent).toContain('No downloads yet');
});
it('retains browser fallback history without guessing a saved path or requesting a server', async () => {
  vi.useFakeTimers();
  const fetch = vi.fn().mockRejectedValue(new TypeError('offline'));
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:file', revokeObjectURL: vi.fn() });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const opts = { filename: 'pic.png', base64: '/wA=', mimeType: 'image/png', source: 'response' as const };
  const first = await saveDownloadFile(opts);
  expect(first).toMatchObject({ size: 2, browserFallback: true });
  expect(first.path).toBeUndefined();
  expect(await fetchDownloads()).toEqual([first]);
  expect(fetch).not.toHaveBeenCalled();
  useAppStore.setState({ serverInfo: { platform: 'test', version: '1', dataDir: '/data' } });
  expect((await saveDownloadFile(opts)).browserFallback).toBe(true);
  expect(click).toHaveBeenCalledTimes(2);
  fetch.mockResolvedValue(Response.json({ error: 'disk full' }, { status: 500 }));
  expect(await useAppStore.getState().saveAndRecordDownload(opts)).toBeNull();
  expect(useAppStore.getState().toasts.at(-1)).toMatchObject({ kind: 'error', message: expect.stringContaining('disk full') });
  expect(click).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(0);
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});
it('passes binary content through the native bridge', async () => {
  vi.spyOn(bridge, 'isTauri').mockReturnValue(true);
  const invoke = vi.spyOn(bridge, 'tauriInvoke').mockResolvedValue({});
  await saveDownloadFile({ filename: 'x.png', base64: '/wA=', mimeType: 'image/png', source: 'response' });
  expect(invoke).toHaveBeenCalledWith('save_download', { payload: expect.objectContaining({ contentBase64: '/wA=', content: undefined }) });
});
