import { isTauri, tauriInvoke } from './bridge';
import type { DownloadRecord, DownloadSource } from './types';
import { downloadJsonFile, uid } from './util';
import { useAppStore } from '../store/useAppStore';

export interface DownloadOptions {
  filename: string;
  text?: string;
  base64?: string;
  mimeType: string;
  source: DownloadSource;
  requestName?: string;
}

const browserKey = 'mycurl_download_history';
function browserHistory(): DownloadRecord[] {
  try { return JSON.parse(localStorage.getItem(browserKey) || '[]'); } catch { return []; }
}

async function readResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return response.json();
}

function post(url: string, payload: unknown) {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

function browserDownload(opts: DownloadOptions): DownloadRecord {
  const blob = new Blob([opts.base64 === undefined ? opts.text ?? '' : Uint8Array.from(atob(opts.base64), c => c.charCodeAt(0))], { type: opts.mimeType });
  if (opts.source === 'postman' || opts.source === 'backup') {
    downloadJsonFile(opts.text ?? '', opts.filename);
  } else {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = opts.filename;
    try { a.click(); } finally { setTimeout(() => URL.revokeObjectURL(a.href), 0); }
  }
  const { filename, mimeType, requestName, source } = opts;
  const record = { id: uid('dl_'), filename, mimeType, requestName, source, createdAt: Date.now(), size: blob.size, browserFallback: true };
  try { localStorage.setItem(browserKey, JSON.stringify([record, ...browserHistory()].slice(0, 100))); } catch { /* Store still holds the session history. */ }
  return record;
}

export async function saveDownloadFile(opts: DownloadOptions): Promise<DownloadRecord> {
  const { text: content, base64: contentBase64, ...meta } = opts;
  const payload = { ...meta, content, contentBase64 };
  if (isTauri()) return tauriInvoke('save_download', { payload });
  if (useAppStore.getState().serverInfo) {
    let response;
    try { response = await post('/api/downloads', payload); } catch { return browserDownload(opts); }
    return readResponse(response);
  }
  return browserDownload(opts);
}

export async function fetchDownloads(): Promise<DownloadRecord[]> {
  const native = isTauri() ? await tauriInvoke<DownloadRecord[]>('list_downloads')
    : useAppStore.getState().serverInfo ? await readResponse<DownloadRecord[]>(await fetch('/api/downloads')) : [];
  return [...native, ...browserHistory()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 100);
}

export async function removeDownloadRecord(id?: string) {
  const local = browserHistory();
  if (!id || !local.some(r => r.id === id)) {
    if (isTauri()) await tauriInvoke('delete_download', { id: id ?? null });
    else if (useAppStore.getState().serverInfo) await readResponse(await fetch('/api/downloads' + (id ? '?id=' + encodeURIComponent(id) : ''), { method: 'DELETE' }));
  }
  localStorage.setItem(browserKey, JSON.stringify(local.filter(r => id && r.id !== id)));
}

export async function revealDownloadPath(path: string) {
  if (isTauri()) await tauriInvoke('reveal_in_folder', { path });
  else await readResponse(await post('/api/downloads/reveal', { path }));
}
