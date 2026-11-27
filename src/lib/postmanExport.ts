import { maskedBackupJson } from './maskedBackup';
import { resolveRequestHeaders } from './requestRunner';
import { findTemplateVars, folderChain } from './template';
import { tr } from './translate';
import type { AppData, Auth, Folder, HttpRequest, KV, RequestBody, Variable } from './types';
import { parseQuery, splitUrl, syncUrlFromParams } from './urlParams';
import { useAppStore } from '../store/useAppStore';

const schema = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
interface ExportOptions { workspaceId: string; folderId?: string; maskSecrets?: boolean }

function postmanAuth(auth?: Auth) {
  if (!auth || auth.type === 'inherit') return undefined;
  if (auth.type === 'none') return { type: 'noauth' };
  const attributes = (values: Record<string, string>) =>
    Object.entries(values).map(([key, value]) => ({ key, value, type: 'string' }));
  if (auth.type === 'bearer') {
    const token = auth.token ?? '';
    const prefix = auth.prefix?.trim() ?? 'Bearer';
    if (prefix === 'Bearer') return { type: 'bearer', bearer: attributes({ token }) };
    // Postman always prepends "Bearer" for bearer auth. A header API key can carry a custom prefix.
    return { type: 'apikey', apikey: attributes({ key: 'Authorization', value: prefix ? prefix + ' ' + token : token, in: 'header' }),
      'x-mycurl-bearer-prefix': prefix };
  }
  if (auth.type === 'basic') return { type: 'basic', basic: attributes({ username: auth.username ?? '', password: auth.password ?? '' }) };
  return { type: 'apikey', apikey: attributes({ key: auth.key ?? '', value: auth.value ?? '', in: auth.in ?? 'header' }) };
}

function postmanVariables(variables: Variable[]) {
  return variables.map(v => ({
    key: v.key, value: v.value, type: 'string', disabled: !v.enabled, description: v.note,
    // Collection v2.1 has no secret variable type. Keep that flag on a MyCurl round-trip.
    'x-mycurl-secret': v.secret || undefined,
  }));
}

function field(row: Pick<KV, 'key' | 'value'> & { enabled?: boolean }) {
  return { key: row.key, value: row.value, disabled: row.enabled === false };
}

function postmanBody(body: RequestBody) {
  switch (body.type) {
    case 'none': return undefined;
    case 'form': return { mode: 'urlencoded', urlencoded: body.form.map(field) };
    case 'multipart':
      return { mode: 'formdata', formdata: body.multipart.map(f => f.isFile
        ? { key: f.key, type: 'file', src: (f.fileName || '').split(/[/\\]/).pop(), disabled: !f.enabled, contentType: f.contentType }
        : { ...field(f), type: 'text', contentType: f.contentType }) };
    case 'graphql': return { mode: 'graphql', graphql: body.graphql ?? { query: '', variables: '' } };
    default: return { mode: 'raw', raw: body.text, options: { raw: { language: body.type } } };
  }
}

function postmanUrl(r: HttpRequest) {
  const { base, query, hash } = splitUrl(r.url);
  const rows = r.params.length ? r.params : parseQuery(query);
  const raw = query === null && r.params.some(p => p.enabled) ? syncUrlFromParams(r.url, r.params) : r.url;
  const protocol = /^([A-Za-z][\w+.-]*):\/\//.exec(base);
  const address = base.slice(protocol?.[0].length ?? 0);
  const slash = address.indexOf('/');
  const authority = slash < 0 ? address : address.slice(0, slash);
  const hostname = authority.replace(/^.*@/, '');
  const withPort = /^(\[[^\]]+\]|[^:]+):(\d+|\{\{[^{}]+\}\})$/.exec(hostname);
  return {
    raw, protocol: protocol?.[1], host: withPort?.[1] ?? hostname, port: withPort?.[2],
    path: slash < 0 ? undefined : address.slice(slash + 1).split('/'),
    query: rows.map(field), hash: hash ? hash.slice(1) : undefined,
  };
}

function postmanRequest(data: AppData, r: HttpRequest) {
  const { effective } = resolveRequestHeaders(data, r, key => key);
  return { name: r.name, request: {
    method: r.method, description: r.description, url: postmanUrl(r), auth: postmanAuth(r.auth),
    header: [...effective.map(h => field(h.header)), ...r.headers.map(field)], body: postmanBody(r.body),
  } };
}

interface ItemGroup {
  name: string;
  description?: string;
  auth?: ReturnType<typeof postmanAuth>;
  variable: ReturnType<typeof postmanVariables>;
  item: Item[];
}
type Item = ItemGroup | ReturnType<typeof postmanRequest>;

function collectionItems(data: AppData, workspaceId: string, root: string | null) {
  const byParent = new Map<string | null, (Folder | HttpRequest)[]>();
  for (const entry of [...data.folders, ...data.requests]) {
    if (entry.workspaceId !== workspaceId) continue;
    const parent = 'folderId' in entry ? entry.folderId : entry.parentId;
    const children = byParent.get(parent) ?? [];
    children.push(entry);
    byParent.set(parent, children);
  }
  const visited = new Set<string>();
  function children(id: string | null): Item[] {
    if (id !== null) {
      if (visited.has(id)) return [];
      visited.add(id);
    }
    return (byParent.get(id) ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map(entry => {
      if ('folderId' in entry) return postmanRequest(data, entry);
      return { name: entry.name, description: entry.description, auth: postmanAuth(entry.auth),
        variable: postmanVariables(entry.variables), item: children(entry.id) };
    });
  }
  return children(root);
}

function collectionVariables(data: AppData, workspaceId: string, chain: Folder[], item: Item[], auth?: Auth) {
  const envs = data.environments.filter(e => e.workspaceId === workspaceId);
  const active = envs.find(e => e.id === data.settings.activeEnvironment[workspaceId] && !e.isBase);
  const vars = new Map<string, Variable>();
  const merge = (v: Variable) => { if (v.enabled || !vars.has(v.key)) vars.set(v.key, v); };
  envs.find(e => e.isBase)?.variables.forEach(merge);
  active?.variables.forEach(merge);
  for (const f of chain.slice(0, -1)) f.variables.forEach(merge);
  const folder = chain.at(-1);
  if (folder) {
    // A standalone subtree needs its inherited dependencies, but unrelated environment values are private.
    const needed = new Set(findTemplateVars(JSON.stringify([item, auth, folder.variables])));
    for (const name of needed) for (const ref of findTemplateVars(vars.get(name)?.value ?? '')) needed.add(ref);
    for (const key of vars.keys()) if (!needed.has(key)) vars.delete(key);
    folder.variables.forEach(merge);
  }
  return postmanVariables([...vars.values()]);
}

export function exportPostmanCollection(data: AppData, opts: ExportOptions): string {
  const source: AppData = opts.maskSecrets === false ? data : JSON.parse(maskedBackupJson(data));
  const workspace = source.workspaces.find(w => w.id === opts.workspaceId);
  const folder = opts.folderId === undefined ? undefined : source.folders.find(f => f.workspaceId === opts.workspaceId && f.id === opts.folderId);
  if (!workspace || (opts.folderId !== undefined && !folder)) {
    throw new Error(tr(data.settings.language, '找不到要导出的工作区或文件夹', 'Workspace or folder not found'));
  }
  const chain = folderChain(source, folder?.id ?? null);
  const auth = [...chain].reverse().find(f => f.auth.type !== 'inherit')?.auth;
  const item = collectionItems(source, workspace.id, folder?.id ?? null);
  return JSON.stringify({
    info: { name: folder ? folder.name : workspace.name, description: folder ? folder.description : workspace.description, schema },
    auth: postmanAuth(auth), variable: collectionVariables(source, workspace.id, chain, item, auth), item,
  }, null, 2);
}

export function downloadPostmanCollection(data: AppData, workspaceId: string, folderId?: string) {
  return useAppStore.getState().saveAndRecordDownload({ text: exportPostmanCollection(data, { workspaceId, folderId }),
    filename: 'mycurl.postman_collection.json', mimeType: 'application/json', source: 'postman' });
}
