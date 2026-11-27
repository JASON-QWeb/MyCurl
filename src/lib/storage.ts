import type { AppData, ResponseRecord } from './types';
import { isTauri, tauriInvoke } from './bridge';

export interface ServerInfo {
  version: string;
  dataDir: string;
  downloadDir?: string;
  platform: string;
  node?: string;
  arch?: string;
  runtime?: string;
}

const LS_KEY = 'mycurl_backup_v1';

export async function fetchServerInfo(): Promise<ServerInfo | null> {
  if (isTauri()) {
    try {
      return await tauriInvoke<ServerInfo>('app_info');
    } catch {
      return null;
    }
  }
  try {
    const res = await fetch('/api/info');
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadAppData(): Promise<{ data: Partial<AppData> | null; warning?: string; localOnly?: boolean }> {
  if (isTauri()) {
    try {
      const res = await tauriInvoke<{ data: Partial<AppData> | null; warning?: string }>('load_data');
      return { data: res.data ?? null, warning: res.warning };
    } catch {
      /* fallback */
    }
  }
  try {
    const res = await fetch('/api/data');
    if (res.ok) {
      const json = await res.json();
      return { data: json.data ?? null, warning: json.warning };
    }
  } catch {
    /* fallback to localStorage */
  }
  try {
    const raw = localStorage.getItem(LS_KEY);
    return { data: raw ? JSON.parse(raw) : null, localOnly: true };
  } catch {
    return { data: null, localOnly: true };
  }
}

export async function saveAppData(data: AppData): Promise<void> {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota errors */
  }
  if (isTauri()) {
    await tauriInvoke<void>('save_data', { data });
    return;
  }
  const res = await fetch('/api/data', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`保存失败（HTTP ${res.status}）`);
}

export async function loadHistory(requestId: string): Promise<ResponseRecord[]> {
  if (isTauri()) {
    try {
      const items = await tauriInvoke<ResponseRecord[]>('load_history', { requestId });
      return Array.isArray(items) ? items : [];
    } catch {
      return [];
    }
  }
  try {
    const res = await fetch(`/api/history/${encodeURIComponent(requestId)}`);
    if (!res.ok) return [];
    const json = await res.json();
    return Array.isArray(json.items) ? json.items : [];
  } catch {
    return [];
  }
}

export async function saveHistoryItem(requestId: string, item: ResponseRecord): Promise<void> {
  if (isTauri()) {
    try {
      await tauriInvoke<void>('save_history', { requestId, record: item });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    await fetch(`/api/history/${encodeURIComponent(requestId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item),
    });
  } catch {
    /* ignore */
  }
}

export async function deleteHistoryItem(requestId: string, itemId?: string): Promise<void> {
  if (isTauri()) {
    try {
      await tauriInvoke<void>('delete_history', { requestId, itemId: itemId ?? null });
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const q = itemId ? `?id=${encodeURIComponent(itemId)}` : '';
    await fetch(`/api/history/${encodeURIComponent(requestId)}${q}`, { method: 'DELETE' });
  } catch {
    /* ignore */
  }
}
