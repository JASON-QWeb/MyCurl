// @vitest-environment jsdom
import { act, createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { emptyBody, newFolder, newRequest } from '../src/lib/factory';
import * as storage from '../src/lib/storage';
import type { HttpRequest, Language, ResponseRecord } from '../src/lib/types';
import * as util from '../src/lib/util';
import { useAppStore } from '../src/store/useAppStore';
import { importWorkspace } from './importWorkspace';
import { button, click, renderComponent } from './renderComponent';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(storage, 'saveAppData').mockResolvedValue();
  vi.spyOn(storage, 'loadHistory').mockResolvedValue([]);
  vi.spyOn(storage, 'saveHistoryItem').mockResolvedValue();
  vi.spyOn(storage, 'deleteHistoryItem').mockResolvedValue();
});
afterEach(() => vi.useRealTimers());

function previous(req: HttpRequest): ResponseRecord {
  return { id: 'previous-' + req.id, requestId: req.id, method: req.method, url: req.url, status: 418, statusText: '',
    body: 'previous', size: 8, contentType: 'text/plain', headers: [], createdAt: Date.now() - 1000, timeMs: 75 };
}

function showFolder(language: Language = 'en') {
  const { data, ws } = importWorkspace(language);
  const folder = newFolder(ws, null, { name: 'Checks', variables: [{ ...util.kv('token', 'private-value'), secret: true }] });
  const sub = newFolder(ws, folder.id, { name: 'Nested' });
  const empty = newFolder(ws, null, { name: 'Empty' });
  const requests = ['ready', 'redirect', 'missing', 'broken'].map((name, sortOrder) =>
    newRequest(ws, folder.id, { name, url: 'https://localhost/' + name, sortOrder }));
  requests[1].responseFilter = '.';
  requests[1].body = { ...emptyBody(), type: 'json', text: '{}' };
  const nested = newRequest(ws, sub.id, { name: 'Nested request', url: 'https://localhost/nested' });
  data.folders = [folder, sub, empty];
  data.requests = [...requests].reverse().concat(nested, newRequest(ws, null, { name: 'Unrelated' }));
  useAppStore.setState({ data, loaded: true, selection: { kind: 'folder', id: folder.id },
    histories: { [requests[0].id]: [previous(requests[0])] }, init: vi.fn().mockResolvedValue(undefined) });
  const { container } = renderComponent(createElement(App));
  const rows = () => Array.from(container.querySelectorAll<HTMLButtonElement>('button.route-item'));
  return { container, folder, sub, empty, requests, rows };
}

interface Exchange {
  url: string;
  signal: AbortSignal;
  finish: (status: number, ms: number, error?: string) => Promise<void>;
}
function captureTransport() {
  const exchanges: Exchange[] = [];
  vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
    if (path !== '/api/send') throw new Error('Unexpected transport: ' + path);
    return new Promise<Response>(resolve => {
      exchanges.push({
        url: JSON.parse(init.body as string).url, signal: init.signal!,
        finish: async (status, ms, error) => {
          const events = [{ t: 'head', status, headers: [['Content-Type', 'text/plain']] },
            { t: 'data', b64: btoa('fresh response') }, error ? { t: 'error', message: error, time: ms } : { t: 'end', time: ms }];
          await act(async () => { resolve(new Response(events.map(e => JSON.stringify(e) + '\n').join(''))); });
        },
      });
    });
  }));
  return exchanges;
}

it('keeps Markdown and New Request prominent and closes the folder menu on outside click and Escape', async () => {
  const { container, folder } = showFolder();
  const hero = container.querySelector('.folder-hero')!;
  const more = button(hero, 'More folder actions');
  expect(Array.from(hero.querySelectorAll('button'), b => b.textContent)).toEqual(['Export Markdown', 'New Request', '']);
  expect(button(hero, 'New Request').classList.contains('btn-primary')).toBe(true);
  await click(more);
  expect(hero.querySelector('.menu-item.danger')?.textContent).toBe('Delete Folder');
  expect(hero.querySelector('.menu-sep + .danger')).toBeTruthy();
  await click(document.body);
  expect(hero.querySelector('.menu-pop')).toBeNull();
  await click(more);
  act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
  expect(more.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(more);
  await click(button(hero, 'Export Markdown'));
  expect(useAppStore.getState().docModal).toEqual({ scope: 'folder', folderId: folder.id });
  act(() => useAppStore.getState().setDocModal(null));
  await click(button(hero, 'New Request'));
  expect(useAppStore.getState().data.requests.at(-1)?.folderId).toBe(folder.id);
  expect(container.querySelector('.req-header')).toBeTruthy();
});

it.each(['zh', 'en'] as const)('exports only the masked subtree and creates a child from the %s corner menu', async lang => {
  const { container, folder } = showFolder(lang);
  const download = vi.spyOn(util, 'downloadJsonFile').mockImplementation(() => {});
  const more = button(container, lang === 'en' ? 'More folder actions' : '更多文件夹操作');
  await click(more);
  await click(button(container, lang === 'en' ? 'Export Postman Collection (Masked)' : '导出 Postman 集合（脱敏）'));
  const [json, filename] = download.mock.lastCall!;
  expect(filename).toMatch(/\.postman_collection\.json$/);
  expect(JSON.parse(json).info.name).toBe(folder.name);
  expect(json).toContain('Nested request');
  expect(json).not.toContain('Unrelated');
  expect(json).not.toContain('private-value');
  expect(more.getAttribute('aria-expanded')).toBe('false');
  await click(more);
  await click(button(container, lang === 'en' ? 'New Subfolder' : '新建子文件夹'));
  const child = useAppStore.getState().data.folders.at(-1)!;
  expect(child.parentId).toBe(folder.id);
  expect(useAppStore.getState().selection?.id).toBe(child.id);
  expect(container.querySelector('.folder-view')?.textContent).not.toContain(lang === 'en' ? 'Run All' : '运行全部');
});

it('honors both cancel and confirm before deleting a folder and its contents', async () => {
  const { container, folder, sub, empty } = showFolder();
  for (const confirmed of [false, true]) {
    await click(button(container, 'More folder actions'));
    await click(button(container, 'Delete Folder'));
    const dialog = container.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain(folder.name);
    await click(button(dialog, confirmed ? 'Delete' : 'Cancel'));
    const { data } = useAppStore.getState();
    expect(data.folders.some(f => f.id === folder.id)).toBe(!confirmed);
    expect(data.folders.some(f => f.id === sub.id)).toBe(!confirmed);
    expect(data.folders.some(f => f.id === empty.id)).toBe(true);
  }
  expect(useAppStore.getState().data.requests.map(req => req.name)).toEqual(['Unrelated']);
});

it('runs just the direct requests in display order and shows live progress, status, latency and totals', async () => {
  const { container, requests, rows } = showFolder();
  const exchanges = captureTransport();
  const earlier = previous(requests[1]);
  vi.mocked(storage.loadHistory).mockImplementation(async id => id === requests[1].id ? [earlier] : []);
  expect(rows()[0].textContent).toContain('41875 ms');
  expect(rows()[1].querySelector('.status-pill')).toBeNull();
  await click(button(container, 'Run All'));
  for (const [index, status] of [200, 399, 400, 200].entries()) {
    expect(exchanges.map(e => e.url)).toEqual(requests.slice(0, index + 1).map(req => req.url));
    expect(rows()[index].textContent).toContain('Running…');
    expect(rows()[index].querySelector('.status-pill')).toBeNull();
    expect(container.querySelector('[role=status]')?.textContent).toBe(index + '/4');
    if (index === 1) expect(rows()[0].textContent).toContain('20042 ms');
    await exchanges[index].finish(status, index === 1 ? 1250 : 42, index === 3 ? 'connection interrupted' : undefined);
  }
  expect(exchanges).toHaveLength(4);
  expect(rows().map(row => row.querySelector('.status-pill')?.textContent)).toEqual(['200', '399', '400', 'ERR']);
  expect(rows()[1].textContent).toContain('jqJSON3991.25 s');
  expect(container.querySelector('[role=status]')?.textContent).toBe('2 ok · 2 failed');
  expect(button(container, 'Run All')).toBeTruthy();
  const history = useAppStore.getState().histories[requests[1].id];
  expect(history.map(r => r.status)).toEqual([399, 418]);
  act(() => useAppStore.getState().selectResponse(requests[1].id, earlier.id));
  await click(rows()[1]);
  expect(container.querySelector<HTMLInputElement>('[data-url-input]')?.value).toBe(requests[1].url);
  expect(useAppStore.getState().activeResponseId[requests[1].id]).toBe(history[0].id);
  expect(container.querySelector('.workspace-panes .status-pill')?.textContent).toContain('399');
  expect(container.querySelector('.workspace-panes')?.textContent).toContain('fresh response');
});

it('stops in flight, counts only finished requests and isolates a restart from late callbacks', async () => {
  const { container, rows } = showFolder('zh');
  const exchanges = captureTransport();
  await click(button(container, '运行全部'));
  expect(rows()[0].textContent).toContain('运行中…');
  await exchanges[0].finish(304, 12);
  await click(button(container, '停止'));
  expect(exchanges[1].signal.aborted).toBe(true);
  expect(container.querySelector('[role=status]')?.textContent).toBe('1 成功 · 0 异常');
  await click(button(container, '运行全部'));
  expect(container.querySelector('[role=status]')?.textContent).toBe('0/4');
  await exchanges[1].finish(200, 30);
  expect(rows()[0].textContent).toContain('运行中…');
  expect(exchanges).toHaveLength(3);
  await click(button(container, '停止'));
  await exchanges[2].finish(200, 10);
  expect(container.querySelector('[role=status]')?.textContent).toBe('');
  expect(storage.saveHistoryItem).toHaveBeenCalledOnce();
  expect(exchanges).toHaveLength(3);
});

it.each(['folder', 'request'])('cancels the owned send when navigating to another %s', async destination => {
  const { container, empty, requests, rows } = showFolder();
  const exchanges = captureTransport();
  await click(button(container, 'Run All'));
  await exchanges[0].finish(204, 10);
  if (destination === 'folder') {
    act(() => useAppStore.getState().selectFolder(empty.id));
    expect(container.querySelector('.folder-view')?.textContent).toContain('No requests in this folder yet');
    expect(container.querySelector('[role=status]')?.textContent).toBe('');
  } else {
    await click(rows()[0]);
    expect(container.querySelector('.workspace-panes .status-pill')?.textContent).toContain('204');
  }
  expect(exchanges[1].signal.aborted).toBe(true);
  await exchanges[1].finish(200, 80);
  expect(exchanges).toHaveLength(2);
  expect(useAppStore.getState().histories[requests[1].id][0].cancelled).toBe(true);
  expect(useAppStore.getState().inFlight).toEqual({});
});

it('does not cancel a newer send of the same request started outside the folder run', async () => {
  const { container, requests } = showFolder();
  const exchanges = captureTransport();
  await click(button(container, 'Run All'));
  act(() => { void useAppStore.getState().sendRequest(requests[0].id); });
  expect(exchanges[0].signal.aborted).toBe(true);
  await click(button(container, 'Stop'));
  expect(exchanges[1].signal.aborted).toBe(false);
  await exchanges[0].finish(200, 1);
  await exchanges[1].finish(201, 2);
  expect(exchanges).toHaveLength(2);
  expect(useAppStore.getState().histories[requests[0].id][0].status).toBe(201);
});
