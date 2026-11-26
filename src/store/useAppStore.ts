import { create } from 'zustand';
import type { AppData, Environment, Folder, HttpRequest, ResponseRecord, Settings, Workspace } from '../lib/types';
import { newEnvironment, newFolder, newRequest, newWorkspace, normalizeData, seedData } from '../lib/factory';
import { deleteHistoryItem, fetchServerInfo, loadAppData, loadHistory, saveAppData, saveHistoryItem, type ServerInfo } from '../lib/storage';
import { executeRequest } from '../lib/requestRunner';
import { applyImport, importAll, planImport, type ImportOptions, type ImportPlan } from '../lib/curlImport';
import { parseCurlCommands, type ParsedCurl } from '../lib/curlParser';
import { SECRET_NAME_RE } from '../lib/template';
import { kv, uid } from '../lib/util';
import { tr } from '../lib/translate';
import { readPostmanEnvironment } from '../lib/postmanEnvironment';

export interface ToastItem {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  message: string;
}

export interface DialogState {
  kind: 'confirm' | 'prompt';
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface InFlightState {
  controller: AbortController;
  startedAt: number;
  partial: ResponseRecord;
}

interface AppStore {
  data: AppData;
  loaded: boolean;
  saving: boolean;
  saveError: string | null;
  serverInfo: ServerInfo | null;

  /** 当前选中的对象：请求或文件夹（查看文件夹文档与变量） */
  selection: { kind: 'request'; id: string } | { kind: 'folder'; id: string; tab?: 'overview' | 'vars' | 'auth' | 'headers' } | null;
  expandedFolders: Record<string, boolean>;
  sidebarFilter: string;

  /** requestId -> 历史响应列表 */
  histories: Record<string, ResponseRecord[]>;
  /** requestId -> 当前展示的响应 id */
  activeResponseId: Record<string, string | null>;
  /** requestId -> 正在进行的请求 */
  inFlight: Record<string, InFlightState>;

  /** 剪贴板检测到的 cURL */
  clipboardCurl: string | null;
  dismissedClipboard: string | null;

  /** 弹窗状态 */
  importModal: { open: boolean; initialText?: string } | null;
  envModal: boolean;
  settingsModal: boolean;
  commandPalette: boolean;
  exportModal: { requestId: string } | null;
  docModal: { scope: 'workspace' | 'folder'; folderId?: string } | null;
  dialog: DialogState | null;

  toasts: ToastItem[];

  // 初始化与持久化
  init: () => Promise<void>;
  mutate: (fn: (draft: AppData) => AppData, immediate?: boolean) => void;
  replaceData: (next: AppData) => void;

  // 选择与导航
  selectRequest: (id: string) => void;
  selectFolder: (id: string, tab?: 'overview' | 'vars' | 'auth' | 'headers') => void;
  toggleFolder: (id: string, force?: boolean) => void;
  setSidebarFilter: (q: string) => void;

  // 工作区
  setActiveWorkspace: (id: string) => void;
  createWorkspace: (name: string) => Workspace;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;

  // 环境
  setActiveEnvironment: (envId: string | null) => void;
  createEnvironment: (name: string, color?: string) => Environment;
  importPostmanEnvironment: (doc: unknown, workspaceId: string) => Environment | null;
  updateEnvironment: (id: string, patch: Partial<Environment>) => void;
  deleteEnvironment: (id: string) => void;

  // 文件夹
  createFolder: (parentId: string | null, name?: string) => Folder;
  updateFolder: (id: string, patch: Partial<Folder>) => void;
  moveFolder: (id: string, parentId: string | null) => boolean;
  deleteFolder: (id: string) => void;

  // 请求
  createRequest: (folderId: string | null, partial?: Partial<HttpRequest>) => HttpRequest;
  updateRequest: (id: string, patch: Partial<HttpRequest>) => void;
  defineRequestVariable: (requestId: string, name: string) => Promise<void>;
  duplicateRequest: (id: string) => HttpRequest | null;
  moveRequest: (id: string, folderId: string | null) => void;
  deleteRequest: (id: string) => void;

  // 设置
  updateSettings: (patch: Partial<Settings>) => void;
  updateImportSettings: (patch: Partial<Settings['import']>) => void;

  // 导入 cURL
  importPastedCurl: (text: string) => void;
  applySingleImport: (plan: ImportPlan, autoSend?: boolean) => { requestId: string; folderId: string | null; created: boolean };
  applyBatchImport: (parsed: ParsedCurl[], opts?: Partial<ImportOptions>, autoSend?: boolean) => { count: number; lastRequestId: string | null };

  // 发送与历史
  sendRequest: (requestId: string) => Promise<void>;
  cancelRequest: (requestId: string) => void;
  selectResponse: (requestId: string, responseId: string) => void;
  deleteResponseHistory: (requestId: string, responseId?: string) => Promise<void>;

  // 剪贴板 & 弹窗 & Toast
  setClipboardCurl: (text: string | null) => void;
  dismissClipboardCurl: () => void;
  openImportModal: (initialText?: string) => void;
  closeImportModal: () => void;
  setEnvModal: (open: boolean) => void;
  setSettingsModal: (open: boolean) => void;
  setCommandPalette: (open: boolean) => void;
  setExportModal: (requestId: string | null) => void;
  setDocModal: (modal: { scope: 'workspace' | 'folder'; folderId?: string } | null) => void;
  confirm: (opts: { title: string; message?: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (opts: { title: string; message?: string; defaultValue?: string; placeholder?: string; confirmLabel?: string; cancelLabel?: string }) => Promise<string | null>;
  closeDialog: (result: boolean | string | null) => void;
  toast: (message: string, kind?: ToastItem['kind']) => void;
  removeToast: (id: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveData: AppData | null = null;
let dialogResolver: ((result: boolean | string | null) => void) | null = null;

function flushSave(set: (partial: Partial<AppStore>) => void) {
  if (!pendingSaveData) return;
  const toSave = pendingSaveData;
  pendingSaveData = null;
  set({ saving: true, saveError: null });
  saveAppData(toSave)
    .then(() => set({ saving: false }))
    .catch((err) => set({ saving: false, saveError: (err as Error).message }));
}

function scheduleSave(next: AppData, set: (partial: Partial<AppStore>) => void, immediate = false) {
  pendingSaveData = next;
  if (saveTimer) clearTimeout(saveTimer);
  if (immediate) {
    saveTimer = null;
    flushSave(set);
  } else {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      flushSave(set);
    }, 320);
  }
}

function activeWsId(data: AppData): string {
  return data.settings.activeWorkspaceId || data.workspaces[0].id;
}

function firstRequestInWs(data: AppData, wsId: string): HttpRequest | undefined {
  return data.requests.filter((r) => r.workspaceId === wsId).sort((a, b) => a.sortOrder - b.sortOrder)[0];
}

export const useAppStore = create<AppStore>((set, get) => ({
  data: seedData(),
  loaded: false,
  saving: false,
  saveError: null,
  serverInfo: null,
  selection: null,
  expandedFolders: {},
  sidebarFilter: '',
  histories: {},
  activeResponseId: {},
  inFlight: {},
  clipboardCurl: null,
  dismissedClipboard: null,
  importModal: null,
  envModal: false,
  settingsModal: false,
  commandPalette: false,
  exportModal: null,
  docModal: null,
  dialog: null,
  toasts: [],

  init: async () => {
    const [info, loaded] = await Promise.all([fetchServerInfo(), loadAppData()]);
    const data = normalizeData(loaded.data);
    const wsId = activeWsId(data);
    const expanded: Record<string, boolean> = {};
    for (const f of data.folders) if (f.workspaceId === wsId) expanded[f.id] = true;
    const firstReq = firstRequestInWs(data, wsId);
    set({
      data,
      loaded: true,
      serverInfo: info,
      expandedFolders: expanded,
      selection: firstReq ? { kind: 'request', id: firstReq.id } : null,
    });
    if (loaded.warning) get().toast(loaded.warning, 'warning');
    if (!loaded.data) scheduleSave(data, set, true);
    if (firstReq) {
      const items = await loadHistory(firstReq.id);
      if (items.length) {
        set((s) => ({
          histories: { ...s.histories, [firstReq.id]: items },
          activeResponseId: { ...s.activeResponseId, [firstReq.id]: items[0].id },
        }));
      }
    }
  },

  mutate: (fn, immediate = false) => {
    const next = fn(get().data);
    set({ data: next });
    scheduleSave(next, set, immediate);
  },

  replaceData: (next) => {
    const norm = normalizeData(next);
    const wsId = activeWsId(norm);
    const firstReq = firstRequestInWs(norm, wsId);
    const expanded: Record<string, boolean> = {};
    for (const f of norm.folders) if (f.workspaceId === wsId) expanded[f.id] = true;
    set({
      data: norm,
      expandedFolders: expanded,
      selection: firstReq ? { kind: 'request', id: firstReq.id } : null,
    });
    scheduleSave(norm, set, true);
  },

  selectRequest: (id) => {
    set({ selection: { kind: 'request', id } });
    // 确保父文件夹展开
    const { data, expandedFolders, histories } = get();
    const req = data.requests.find((r) => r.id === id);
    if (req?.folderId) {
      const nextExp = { ...expandedFolders };
      let fid: string | null = req.folderId;
      while (fid) {
        nextExp[fid] = true;
        fid = data.folders.find((f) => f.id === fid)?.parentId ?? null;
      }
      set({ expandedFolders: nextExp });
    }
    if (!histories[id]) {
      loadHistory(id).then((items) => {
        set((s) => ({
          histories: { ...s.histories, [id]: items },
          activeResponseId: { ...s.activeResponseId, [id]: s.activeResponseId[id] ?? items[0]?.id ?? null },
        }));
      });
    }
  },

  selectFolder: (id, tab) => {
    set((s) => ({
      selection: { kind: 'folder', id, tab },
      expandedFolders: { ...s.expandedFolders, [id]: true },
    }));
  },

  toggleFolder: (id, force) => {
    set((s) => ({
      expandedFolders: { ...s.expandedFolders, [id]: force ?? !s.expandedFolders[id] },
    }));
  },

  setSidebarFilter: (q) => set({ sidebarFilter: q }),

  setActiveWorkspace: (id) => {
    get().mutate((d) => ({
      ...d,
      settings: { ...d.settings, activeWorkspaceId: id },
    }));
    const d = get().data;
    const expanded: Record<string, boolean> = { ...get().expandedFolders };
    for (const f of d.folders) if (f.workspaceId === id) expanded[f.id] = true;
    const firstReq = firstRequestInWs(d, id);
    set({ expandedFolders: expanded, selection: firstReq ? { kind: 'request', id: firstReq.id } : null });
    if (firstReq) get().selectRequest(firstReq.id);
  },

  createWorkspace: (name) => {
    const lang = get().data.settings.language;
    const ws = newWorkspace(name.trim() || tr(lang, '新工作区', 'New Workspace'));
    const base = newEnvironment(ws.id, { name: tr(lang, '全局变量', 'Global Variables'), isBase: true });
    get().mutate(
      (d) => ({
        ...d,
        workspaces: [...d.workspaces, ws],
        environments: [...d.environments, base],
        settings: { ...d.settings, activeWorkspaceId: ws.id },
      }),
      true,
    );
    set({ selection: null });
    get().toast(tr(lang, `已创建工作区「${ws.name}」`, `Created workspace "${ws.name}"`), 'success');
    return ws;
  },

  renameWorkspace: (id, name) => {
    if (!name.trim()) return;
    get().mutate((d) => ({
      ...d,
      workspaces: d.workspaces.map((w) => (w.id === id ? { ...w, name: name.trim() } : w)),
    }));
  },

  deleteWorkspace: (id) => {
    const cur = get().data;
    const lang = cur.settings.language;
    if (cur.workspaces.length <= 1) {
      get().toast(tr(lang, '至少保留一个工作区', 'At least one workspace is required'), 'warning');
      return;
    }
    const remaining = cur.workspaces.filter((w) => w.id !== id);
    const nextWsId = cur.settings.activeWorkspaceId === id ? remaining[0].id : cur.settings.activeWorkspaceId!;
    get().mutate(
      (d) => ({
        ...d,
        workspaces: d.workspaces.filter((w) => w.id !== id),
        folders: d.folders.filter((f) => f.workspaceId !== id),
        requests: d.requests.filter((r) => r.workspaceId !== id),
        environments: d.environments.filter((e) => e.workspaceId !== id),
        settings: { ...d.settings, activeWorkspaceId: nextWsId },
      }),
      true,
    );
    const first = firstRequestInWs(get().data, nextWsId);
    set({ selection: first ? { kind: 'request', id: first.id } : null });
  },

  setActiveEnvironment: (envId) => {
    const wsId = activeWsId(get().data);
    get().mutate((d) => ({
      ...d,
      settings: {
        ...d.settings,
        activeEnvironment: { ...d.settings.activeEnvironment, [wsId]: envId },
      },
    }));
  },

  createEnvironment: (name, color = '#6366f1') => {
    const d = get().data;
    const wsId = activeWsId(d);
    const env = newEnvironment(wsId, { name: name.trim() || tr(d.settings.language, '新环境', 'New Environment'), color });
    get().mutate((cur) => ({ ...cur, environments: [...cur.environments, env] }));
    return env;
  },

  importPostmanEnvironment: (doc, workspaceId) => {
    const { data, mutate, toast } = get();
    const env = readPostmanEnvironment(doc, workspaceId);
    if (!env) {
      toast(tr(data.settings.language, 'Postman 环境文件格式无效，请检查环境名称与变量列表', 'Invalid Postman environment name or variable list'), 'error');
      return null;
    }
    mutate(current => ({ ...current, environments: [...current.environments, env] }), true);
    toast(tr(data.settings.language, `已导入环境「${env.name}」`, `Imported environment "${env.name}"`), 'success');
    return env;
  },

  updateEnvironment: (id, patch) => {
    get().mutate((d) => ({
      ...d,
      environments: d.environments.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));
  },

  deleteEnvironment: (id) => {
    const env = get().data.environments.find((e) => e.id === id);
    if (!env || env.isBase) return;
    get().mutate((d) => {
      const ae = { ...d.settings.activeEnvironment };
      if (ae[env.workspaceId] === id) ae[env.workspaceId] = null;
      return {
        ...d,
        environments: d.environments.filter((e) => e.id !== id),
        settings: { ...d.settings, activeEnvironment: ae },
      };
    });
  },

  createFolder: (parentId, name) => {
    const d = get().data;
    const wsId = activeWsId(d);
    const fld = newFolder(wsId, parentId, { name: name ?? tr(d.settings.language, '新文件夹', 'New Folder') });
    get().mutate((d) => ({ ...d, folders: [...d.folders, fld] }));
    set((s) => ({
      expandedFolders: { ...s.expandedFolders, [fld.id]: true, ...(parentId ? { [parentId]: true } : {}) },
      selection: { kind: 'folder', id: fld.id },
    }));
    return fld;
  },

  updateFolder: (id, patch) => {
    get().mutate((d) => ({
      ...d,
      folders: d.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    }));
  },

  moveFolder: (id, parentId) => {
    const d = get().data;
    const folder = d.folders.find((f) => f.id === id);
    if (!folder) return false;
    if (folder.parentId === parentId) return false;
    if (parentId === id) return false;
    // 防止把文件夹拖进自己的子孙目录造成循环嵌套
    if (parentId) {
      let cur: string | null = parentId;
      const seen = new Set<string>();
      while (cur && !seen.has(cur)) {
        if (cur === id) return false;
        seen.add(cur);
        cur = d.folders.find((f) => f.id === cur)?.parentId ?? null;
      }
    }
    get().mutate((cur) => ({
      ...cur,
      folders: cur.folders.map((f) => (f.id === id ? { ...f, parentId } : f)),
    }));
    if (parentId) {
      set((s) => ({ expandedFolders: { ...s.expandedFolders, [parentId]: true } }));
    }
    return true;
  },

  deleteFolder: (id) => {
    const d = get().data;
    const folder = d.folders.find((f) => f.id === id);
    const toRemove = new Set<string>([id]);
    let added = true;
    while (added) {
      added = false;
      for (const f of d.folders) {
        if (f.parentId && toRemove.has(f.parentId) && !toRemove.has(f.id)) {
          toRemove.add(f.id);
          added = true;
        }
      }
    }
    const removedReqIds = d.requests
      .filter((r) => r.folderId && toRemove.has(r.folderId))
      .map((r) => r.id);
    const sel = get().selection;
    const selRemoved =
      (sel?.kind === 'folder' && toRemove.has(sel.id)) ||
      (sel?.kind === 'request' && toRemove.has(d.requests.find((r) => r.id === sel.id)?.folderId ?? ''));
    get().mutate(
      (cur) => ({
        ...cur,
        folders: cur.folders.filter((f) => !toRemove.has(f.id)),
        requests: cur.requests.filter((r) => !r.folderId || !toRemove.has(r.folderId)),
      }),
      true,
    );
    for (const reqId of removedReqIds) deleteHistoryItem(reqId);
    if (selRemoved) {
      const next = firstRequestInWs(get().data, activeWsId(get().data));
      set({ selection: next ? { kind: 'request', id: next.id } : null });
    }
    if (folder) get().toast(tr(d.settings.language, `已删除文件夹「${folder.name}」`, `Deleted folder "${folder.name}"`), 'success');
  },

  createRequest: (folderId, partial = {}) => {
    const d = get().data;
    const wsId = activeWsId(d);
    const maxOrder = Math.max(0, ...d.requests.filter((r) => r.workspaceId === wsId && r.folderId === folderId).map((r) => r.sortOrder));
    const req = newRequest(wsId, folderId, { name: tr(d.settings.language, '新请求', 'New Request'), sortOrder: maxOrder + 1, ...partial });
    get().mutate((cur) => ({ ...cur, requests: [...cur.requests, req] }));
    if (folderId) {
      set((s) => ({ expandedFolders: { ...s.expandedFolders, [folderId]: true } }));
    }
    set({ selection: { kind: 'request', id: req.id } });
    return req;
  },

  updateRequest: (id, patch) => {
    get().mutate((d) => ({
      ...d,
      requests: d.requests.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)),
    }));
  },

  defineRequestVariable: async (requestId, name) => {
    const { data, prompt } = get();
    const req = data.requests.find(r => r.id === requestId);
    if (!req) return;
    const folder = data.folders.find(f => f.id === req.folderId);
    const scope = folder ?? data.environments.find(env => env.workspaceId === req.workspaceId && env.isBase);
    if (!scope) return;
    const lang = data.settings.language;
    const label = `{{${name}}}`;
    const target = folder ? tr(lang, `文件夹「${folder.name}」`, `folder "${folder.name}"`) : tr(lang, '全局变量', 'Global Variables');
    const value = await prompt({
      title: tr(lang, `设置 ${label} 的值`, `Set a value for ${label}`),
      message: tr(lang, `变量将保存到${target}。`, `This variable will be saved to ${target}.`),
      confirmLabel: tr(lang, '保存', 'Save'),
    });
    if (!value?.trim()) return;
    const holders = folder ? get().data.folders : get().data.environments;
    const current = holders.find(holder => holder.id === scope.id);
    if (!current) return;
    const existing = current.variables.find(v => v.key.trim() === name);
    const updated = { ...(existing ?? kv(name)), key: name, value, enabled: true, secret: !!existing?.secret || SECRET_NAME_RE.test(name) };
    const variables = existing
      ? current.variables.map(v => v === existing ? updated : v)
      : [...current.variables, updated];
    if (folder) get().updateFolder(scope.id, { variables });
    else get().updateEnvironment(scope.id, { variables });
    get().toast(tr(lang, `已将 ${label} 保存到${target}`, `Saved ${label} to ${target}`), 'success');
  },

  duplicateRequest: (id) => {
    const src = get().data.requests.find((r) => r.id === id);
    if (!src) return null;
    const lang = get().data.settings.language;
    const clone: HttpRequest = JSON.parse(JSON.stringify(src));
    clone.id = uid('req_');
    clone.name = tr(lang, `${src.name}（副本）`, `${src.name} (Copy)`);
    clone.sortOrder = src.sortOrder + 0.5;
    clone.createdAt = Date.now();
    clone.updatedAt = Date.now();
    get().mutate((d) => ({ ...d, requests: [...d.requests, clone] }));
    set({ selection: { kind: 'request', id: clone.id } });
    return clone;
  },

  moveRequest: (id, folderId) => {
    get().mutate((d) => ({
      ...d,
      requests: d.requests.map((r) => (r.id === id ? { ...r, folderId, updatedAt: Date.now() } : r)),
    }));
    if (folderId) set((s) => ({ expandedFolders: { ...s.expandedFolders, [folderId]: true } }));
  },

  deleteRequest: (id) => {
    const sel = get().selection;
    get().mutate((d) => ({
      ...d,
      requests: d.requests.filter((r) => r.id !== id),
    }));
    deleteHistoryItem(id);
    if (sel?.kind === 'request' && sel.id === id) {
      const next = firstRequestInWs(get().data, activeWsId(get().data));
      set({ selection: next ? { kind: 'request', id: next.id } : null });
    }
  },

  updateSettings: (patch) => {
    get().mutate((d) => ({ ...d, settings: { ...d.settings, ...patch } }));
  },

  updateImportSettings: (patch) => {
    get().mutate((d) => ({
      ...d,
      settings: { ...d.settings, import: { ...d.settings.import, ...patch } },
    }));
  },

  importPastedCurl: (text) => {
    const { data, openImportModal, applySingleImport, applyBatchImport } = get();
    const options = data.settings.import;
    if (options.skipPreview) {
      const parsed = parseCurlCommands(text, data.settings.language);
      if (parsed.length === 1) {
        applySingleImport(planImport(parsed[0], data, activeWsId(data), options), options.autoSend);
        return;
      }
      if (parsed.length > 1) {
        applyBatchImport(parsed, undefined, options.autoSend);
        return;
      }
    }
    openImportModal(text);
  },

  applySingleImport: (plan, autoSend = false) => {
    const res = applyImport(get().data, plan);
    set({ data: res.data });
    scheduleSave(res.data, set, true);
    if (res.folderId) {
      set((s) => ({ expandedFolders: { ...s.expandedFolders, [res.folderId!]: true } }));
    }
    get().selectRequest(res.requestId);
    const lang = res.data.settings.language;
    const varMsg = res.createdVars.length
      ? tr(lang, `，收纳变量 ${res.createdVars.map((k) => `{{${k}}}`).join('、')}`, `, extracted ${res.createdVars.map((k) => `{{${k}}}`).join(', ')}`)
      : '';
    get().toast(
      res.created
        ? tr(lang, `已归档至「${plan.folder.name}」${varMsg}`, `Imported to "${plan.folder.name}"${varMsg}`)
        : tr(lang, `已跳转到已有请求「${plan.duplicateOf?.name}」`, `Switched to existing request "${plan.duplicateOf?.name}"`),
      'success',
    );
    if (autoSend) {
      setTimeout(() => get().sendRequest(res.requestId), 50);
    }
    return { requestId: res.requestId, folderId: res.folderId, created: res.created };
  },

  applyBatchImport: (parsed, opts, autoSend = false) => {
    const cur = get().data;
    const wsId = activeWsId(cur);
    const finalOpts: ImportOptions = {
      extractSecrets: opts?.extractSecrets ?? cur.settings.import.extractSecrets,
      extractBaseUrl: opts?.extractBaseUrl ?? cur.settings.import.extractBaseUrl,
      groupByHost: opts?.groupByHost ?? cur.settings.import.groupByHost,
    };
    const { data: next, results } = importAll(cur, parsed, wsId, finalOpts);
    set({ data: next });
    scheduleSave(next, set, true);
    const exp = { ...get().expandedFolders };
    for (const r of results) if (r.folderId) exp[r.folderId] = true;
    set({ expandedFolders: exp });
    const lastId = results[results.length - 1]?.requestId ?? null;
    if (lastId) get().selectRequest(lastId);
    const createdCount = results.filter((r) => r.created).length;
    const lang = next.settings.language;
    const dupCount = results.length - createdCount;
    get().toast(
      tr(
        lang,
        `已批量归档 ${createdCount} 条请求${dupCount > 0 ? `（${dupCount} 条重复已跳过）` : ''}`,
        `Imported ${createdCount} request${createdCount === 1 ? '' : 's'}${dupCount > 0 ? ` (${dupCount} duplicate${dupCount === 1 ? '' : 's'} skipped)` : ''}`,
      ),
      'success',
    );
    if (autoSend && lastId) {
      setTimeout(() => get().sendRequest(lastId), 50);
    }
    return { count: results.length, lastRequestId: lastId };
  },

  sendRequest: async (requestId) => {
    const existing = get().inFlight[requestId];
    if (existing) existing.controller.abort();

    const data = get().data;
    const req = data.requests.find((r) => r.id === requestId);
    if (!req) return;

    const controller = new AbortController();
    const startedAt = Date.now();
    const initial: ResponseRecord = {
      id: uid('res_'),
      requestId,
      createdAt: startedAt,
      method: req.method,
      url: req.url,
      status: 0,
      statusText: '',
      headers: [],
      body: '',
      contentType: '',
      size: 0,
      timeMs: 0,
    };

    set((s) => ({
      inFlight: { ...s.inFlight, [requestId]: { controller, startedAt, partial: initial } },
    }));

    const result = await executeRequest(data, req, controller.signal, {
      onUpdate: (partial) => {
        set((s) => {
          const cur = s.inFlight[requestId];
          if (!cur || cur.controller !== controller) return s;
          return { inFlight: { ...s.inFlight, [requestId]: { ...cur, partial } } };
        });
      },
    });

    if (get().inFlight[requestId]?.controller !== controller) return;
    set((s) => {
      const nextInFlight = { ...s.inFlight };
      delete nextInFlight[requestId];
      const prevHist = s.histories[requestId] ?? [];
      const nextHist = [result, ...prevHist.filter((x) => x.id !== result.id)].slice(0, 30);
      return {
        inFlight: nextInFlight,
        histories: { ...s.histories, [requestId]: nextHist },
        activeResponseId: { ...s.activeResponseId, [requestId]: result.id },
      };
    });

    if (!result.cancelled) {
      saveHistoryItem(requestId, result);
    }
  },

  cancelRequest: (requestId) => {
    const inf = get().inFlight[requestId];
    if (inf) inf.controller.abort();
  },

  selectResponse: (requestId, responseId) => {
    set((s) => ({ activeResponseId: { ...s.activeResponseId, [requestId]: responseId } }));
  },

  deleteResponseHistory: async (requestId, responseId) => {
    await deleteHistoryItem(requestId, responseId);
    set((s) => {
      const next = responseId ? (s.histories[requestId] ?? []).filter((x) => x.id !== responseId) : [];
      return {
        histories: { ...s.histories, [requestId]: next },
        activeResponseId: { ...s.activeResponseId, [requestId]: next[0]?.id ?? null },
      };
    });
  },

  setClipboardCurl: (text) => {
    if (text && text === get().dismissedClipboard) return;
    set({ clipboardCurl: text });
  },

  dismissClipboardCurl: () => {
    set((s) => ({ dismissedClipboard: s.clipboardCurl, clipboardCurl: null }));
  },

  openImportModal: (initialText) => set({ importModal: { open: true, initialText } }),
  closeImportModal: () => set({ importModal: null }),
  setEnvModal: (open) => set({ envModal: open }),
  setSettingsModal: (open) => set({ settingsModal: open }),
  setCommandPalette: (open) => set({ commandPalette: open }),
  setExportModal: (requestId) => set({ exportModal: requestId ? { requestId } : null }),
  setDocModal: (modal) => set({ docModal: modal }),

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      if (dialogResolver) {
        const prev = dialogResolver;
        dialogResolver = null;
        prev(false);
      }
      dialogResolver = (val) => resolve(val === true);
      set({ dialog: { kind: 'confirm', ...opts } });
    }),

  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      if (dialogResolver) {
        const prev = dialogResolver;
        dialogResolver = null;
        prev(null);
      }
      dialogResolver = (val) => resolve(typeof val === 'string' ? val : null);
      set({ dialog: { kind: 'prompt', ...opts } });
    }),

  closeDialog: (result) => {
    const fn = dialogResolver;
    dialogResolver = null;
    set({ dialog: null });
    fn?.(result);
  },

  toast: (message, kind = 'info') => {
    const id = uid('toast_');
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, message }] }));
    setTimeout(() => get().removeToast(id), 3600);
  },

  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));
