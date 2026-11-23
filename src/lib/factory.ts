import type { AppData, Auth, Environment, Folder, HttpRequest, RequestBody, Settings, Workspace } from './types';
import { uid } from './util';

export function emptyBody(): RequestBody {
  return { type: 'none', text: '', form: [], multipart: [], graphql: { query: '', variables: '' } };
}

export function newRequest(workspaceId: string, folderId: string | null, partial: Partial<HttpRequest> = {}): HttpRequest {
  const now = Date.now();
  return {
    id: uid('req_'),
    workspaceId,
    folderId,
    name: '新请求',
    method: 'GET',
    url: '',
    params: [],
    headers: [],
    body: emptyBody(),
    auth: { type: 'inherit' },
    settings: {},
    sortOrder: now,
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
}

export function newFolder(workspaceId: string, parentId: string | null, partial: Partial<Folder> = {}): Folder {
  const now = Date.now();
  return {
    id: uid('fld_'),
    workspaceId,
    parentId,
    name: '新文件夹',
    variables: [],
    auth: { type: 'inherit' },
    headers: [],
    sortOrder: now,
    createdAt: now,
    ...partial,
  };
}

export function newEnvironment(workspaceId: string, partial: Partial<Environment> = {}): Environment {
  return {
    id: uid('env_'),
    workspaceId,
    name: '新环境',
    isBase: false,
    variables: [],
    ...partial,
  };
}

export function newWorkspace(name = '我的工作区'): Workspace {
  return { id: uid('ws_'), name, createdAt: Date.now() };
}

export function defaultSettings(): Settings {
  return {
    theme: 'dark',
    language: 'zh',
    activeWorkspaceId: null,
    activeEnvironment: {},
    timeoutMs: 120_000,
    verifySSL: true,
    followRedirects: true,
    proxy: '',
    import: {
      extractSecrets: true,
      extractBaseUrl: true,
      groupByHost: true,
      skipPreview: false,
      autoSend: false,
    },
    curlCopySecretMode: 'mask',
    editorFontSize: 13,
    sidebarWidth: 270,
    responsePaneRatio: 0.5,
    layout: 'horizontal',
  };
}

export const NONE_AUTH: Auth = { type: 'none' };

/** 首次启动时的示例数据 */
export function seedData(): AppData {
  const ws = newWorkspace('我的工作区');
  const base = newEnvironment(ws.id, { name: '全局变量', isBase: true, variables: [] });
  const dev = newEnvironment(ws.id, { name: '开发环境', color: '#22c55e', variables: [] });
  const demoFolder = newFolder(ws.id, null, {
    name: '示例 · httpbin',
    host: 'httpbin.org',
    description: '一些示例请求，可以随意删除。',
    variables: [{ id: uid('kv_'), key: 'base_url', value: 'https://httpbin.org', enabled: true }],
  });
  const r1 = newRequest(ws.id, demoFolder.id, {
    name: '获取 IP 信息',
    method: 'GET',
    url: '{{base_url}}/get?lang=zh',
    params: [{ id: uid('kv_'), key: 'lang', value: 'zh', enabled: true }],
    sortOrder: 1,
  });
  const r2 = newRequest(ws.id, demoFolder.id, {
    name: '提交 JSON',
    method: 'POST',
    url: '{{base_url}}/post',
    headers: [{ id: uid('kv_'), key: 'Content-Type', value: 'application/json', enabled: true }],
    body: { ...emptyBody(), type: 'json', text: '{\n  "hello": "世界",\n  "time": "{{$isoTimestamp}}"\n}' },
    sortOrder: 2,
  });
  const settings = defaultSettings();
  settings.activeWorkspaceId = ws.id;
  settings.activeEnvironment[ws.id] = null;
  return {
    version: 1,
    workspaces: [ws],
    folders: [demoFolder],
    requests: [r1, r2],
    environments: [base, dev],
    settings,
  };
}

/** 兼容旧数据 / 缺失字段 */
export function normalizeData(raw: Partial<AppData> | null | undefined): AppData {
  if (!raw || !raw.workspaces || !raw.workspaces.length) return seedData();
  const settings = { ...defaultSettings(), ...(raw.settings ?? {}) } as Settings;
  settings.import = { ...defaultSettings().import, ...(raw.settings?.import ?? {}) };
  settings.activeEnvironment = settings.activeEnvironment ?? {};
  const data: AppData = {
    version: 1,
    workspaces: raw.workspaces,
    folders: (raw.folders ?? []).map((f) => ({
      ...f,
      variables: f.variables ?? [],
      headers: f.headers ?? [],
      auth: f.auth ?? { type: 'inherit' as const },
    })),
    requests: (raw.requests ?? []).map((r) => ({
      ...r,
      params: r.params ?? [],
      headers: r.headers ?? [],
      settings: r.settings ?? {},
      auth: r.auth ?? { type: 'inherit' as const },
      body: { ...emptyBody(), ...(r.body ?? {}) },
    })),
    environments: raw.environments ?? [],
    settings,
  };
  if (!data.workspaces.find((w) => w.id === settings.activeWorkspaceId)) settings.activeWorkspaceId = data.workspaces[0].id;
  // 每个工作区保证有全局环境
  for (const ws of data.workspaces) {
    if (!data.environments.find((e) => e.workspaceId === ws.id && e.isBase)) {
      data.environments.push(newEnvironment(ws.id, { name: '全局变量', isBase: true }));
    }
  }
  return data;
}
