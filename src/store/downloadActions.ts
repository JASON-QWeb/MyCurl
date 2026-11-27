import { fetchDownloads, removeDownloadRecord, revealDownloadPath, saveDownloadFile, type DownloadOptions } from '../lib/downloads';
import type { DownloadRecord } from '../lib/types';
import { formatBytes } from '../lib/util';
import { tr } from '../lib/translate';
import type { AppStore } from './useAppStore';

export interface DownloadState {
  downloads: DownloadRecord[];
  loadDownloads(): Promise<void>;
  saveAndRecordDownload(opts: DownloadOptions): Promise<DownloadRecord | null>;
  deleteDownloadRecord(id?: string): Promise<void>;
  revealInFolder(path: string): Promise<boolean>;
}

export function createDownloadActions(get: () => AppStore, set: (value: Partial<AppStore>) => void): DownloadState {
  const t = (zh: string, en: string) => tr(get().data.settings.language, zh, en);
  let pending = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T>) {
    const result = pending.then(fn);
    pending = result.then(() => {}, () => {});
    return result;
  }
  function report(err: unknown) {
    get().toast(String(err), 'error');
  }
  return {
    downloads: [],
    loadDownloads: () => enqueue(async () => {
      try { set({ downloads: await fetchDownloads() }); } catch (err) { report(err); }
    }),
    saveAndRecordDownload: opts => enqueue(async () => {
      try {
        const record = await saveDownloadFile(opts);
        set({ downloads: [record, ...get().downloads].slice(0, 100) });
        const label = record.path ? t('已保存', 'Saved') : t('已下载', 'Downloaded');
        const path = record.path;
        get().toast(`${label} ${record.filename} (${formatBytes(record.size)})`, 'success', path ? {
          action: { label: t('打开文件夹', 'Show in Folder'), onClick: () => { void get().revealInFolder(path); } },
        } : undefined);
        return record;
      } catch (err) { report(err); return null; }
    }),
    deleteDownloadRecord: id => enqueue(async () => {
      try {
        await removeDownloadRecord(id);
        set({ downloads: get().downloads.filter(r => id && r.id !== id) });
      } catch (err) { report(err); }
    }),
    revealInFolder: async path => {
      try { await revealDownloadPath(path); return true; } catch (err) { report(err); return false; }
    },
  };
}
