/**
 * 数据导出与导入（MyCurl JSON 备份 / Postman Collection v2.1 / Apifox JSON）
 */
import type { AppData, Auth, Environment, Folder, HttpRequest, KV, Variable } from './types';
import { emptyBody, newEnvironment, newFolder, newRequest, normalizeData } from './factory';
import { maskSecret, uid } from './util';

export function exportMyCurlJson(data: AppData, maskSecrets: boolean): string {
  if (!maskSecrets) return JSON.stringify(data, null, 2);
  const copy: AppData = JSON.parse(JSON.stringify(data));
  for (const f of copy.folders) {
    for (const v of f.variables) {
      if (v.secret && v.value) v.value = maskSecret(v.value);
    }
  }
  for (const e of copy.environments) {
    for (const v of e.variables) {
      if (v.secret && v.value) v.value = maskSecret(v.value);
    }
  }
  return JSON.stringify(copy, null, 2);
}

export function isPostmanCollection(obj: any): boolean {
  return !!(obj && typeof obj === 'object' && obj.info && Array.isArray(obj.item));
}

export function isApifoxCollection(obj: any): boolean {
  return !!(obj && typeof obj === 'object' && (obj.apifoxProject || Array.isArray(obj.apiCollection)));
}

export function isMyCurlBackup(obj: any): boolean {
  return !!(obj && typeof obj === 'object' && Array.isArray(obj.workspaces) && Array.isArray(obj.requests));
}

function mapCollectionAuth(a: any): Auth {
  if (!a?.type) return { type: 'inherit' };
  const map = (val: any): Record<string, any> => {
    if (Array.isArray(val)) return Object.fromEntries(val.map((x) => [x.key, x.value]));
    if (val && typeof val === 'object') return val;
    return {};
  };
  if (a.type === 'bearer') {
    const m = map(a.bearer);
    return { type: 'bearer', token: String(m.token ?? ''), prefix: 'Bearer' };
  }
  if (a.type === 'basic') {
    const m = map(a.basic);
    return { type: 'basic', username: String(m.username ?? ''), password: String(m.password ?? '') };
  }
  if (a.type === 'apikey') {
    const m = map(a.apikey);
    return { type: 'apikey', key: String(m.key ?? ''), value: String(m.value ?? ''), in: m.in === 'query' ? 'query' : 'header' };
  }
  return { type: 'inherit' };
}

function mapPostmanAuth(a: any): Auth {
  return a?.type === 'noauth' ? { type: 'none' } : mapCollectionAuth(a);
}

/** 将 Postman v2.1 集合导入到指定工作区 */
export function importPostmanCollection(
  data: AppData,
  workspaceId: string,
  collection: any,
): { data: AppData; folderCount: number; requestCount: number } {
  const newFolders: Folder[] = [];
  const newRequests: HttpRequest[] = [];
  const rootName = collection.info?.name || 'Postman 导入';
  const rootFolder = newFolder(workspaceId, null, {
    name: rootName,
    description: typeof collection.info?.description === 'string' ? collection.info.description : collection.info?.description?.content || '',
    auth: mapPostmanAuth(collection.auth),
    variables: (collection.variable || []).map((v: any) => ({
      id: uid('kv_'),
      key: String(v.key ?? ''),
      value: String(v.value ?? ''),
      enabled: !v.disabled,
      secret: /key|token|secret|pass/i.test(String(v.key ?? '')),
    })),
  });
  newFolders.push(rootFolder);

  let order = 1;
  const walk = (items: any[], parentId: string) => {
    for (const item of items || []) {
      if (Array.isArray(item.item)) {
        const fld = newFolder(workspaceId, parentId, {
          name: item.name || '未命名文件夹',
          description: typeof item.description === 'string' ? item.description : item.description?.content || '',
          auth: mapPostmanAuth(item.auth),
          sortOrder: order++,
        });
        newFolders.push(fld);
        walk(item.item, fld.id);
      } else if (item.request) {
        const r = item.request;
        const rawUrl = typeof r.url === 'string' ? r.url : r.url?.raw || '';
        const params: KV[] = Array.isArray(r.url?.query)
          ? r.url.query.map((q: any) => ({ id: uid('kv_'), key: String(q.key ?? ''), value: String(q.value ?? ''), enabled: !q.disabled }))
          : [];
        const headers: KV[] = Array.isArray(r.header)
          ? r.header.map((h: any) => ({ id: uid('kv_'), key: String(h.key ?? ''), value: String(h.value ?? ''), enabled: !h.disabled }))
          : [];
        const body = emptyBody();
        if (r.body?.mode === 'raw') {
          const lang = r.body.options?.raw?.language;
          body.type = lang === 'json' ? 'json' : lang === 'xml' ? 'xml' : 'text';
          body.text = String(r.body.raw ?? '');
        } else if (r.body?.mode === 'urlencoded') {
          body.type = 'form';
          body.form = (r.body.urlencoded || []).map((f: any) => ({
            id: uid('kv_'),
            key: String(f.key ?? ''),
            value: String(f.value ?? ''),
            enabled: !f.disabled,
          }));
        } else if (r.body?.mode === 'formdata') {
          body.type = 'multipart';
          body.multipart = (r.body.formdata || []).map((f: any) => ({
            id: uid('kv_'),
            key: String(f.key ?? ''),
            value: String(f.value ?? ''),
            enabled: !f.disabled,
            isFile: f.type === 'file',
            fileName: f.type === 'file' ? String(f.src ?? '') : undefined,
          }));
        } else if (r.body?.mode === 'graphql') {
          body.type = 'graphql';
          body.graphql = {
            query: String(r.body.graphql?.query ?? ''),
            variables: String(r.body.graphql?.variables ?? ''),
          };
        }
        newRequests.push(
          newRequest(workspaceId, parentId, {
            name: item.name || '未命名请求',
            method: String(r.method || 'GET').toUpperCase(),
            url: rawUrl,
            params,
            headers,
            body,
            auth: mapPostmanAuth(r.auth),
            description: typeof r.description === 'string' ? r.description : r.description?.content || '',
            sortOrder: order++,
          }),
        );
      }
    }
  };

  walk(collection.item, rootFolder.id);
  return {
    data: {
      ...data,
      folders: [...data.folders, ...newFolders],
      requests: [...data.requests, ...newRequests],
    },
    folderCount: newFolders.length,
    requestCount: newRequests.length,
  };
}

/** 将 Apifox 导出的 JSON（apifoxProject / apiCollection）导入到指定工作区 */
export function importApifoxCollection(
  data: AppData,
  workspaceId: string,
  doc: any,
): { data: AppData; folderCount: number; requestCount: number; envCount: number } {
  const newFolders: Folder[] = [];
  const newRequests: HttpRequest[] = [];
  const newEnvs: Environment[] = [];

  // 导入环境（如存在）
  let defaultBaseUrl = '';
  if (Array.isArray(doc.environments)) {
    for (const env of doc.environments) {
      if (!env || typeof env !== 'object') continue;
      const vars: Variable[] = [];
      const baseUrl = String(env.baseUrl || env.baseUrls?.[0]?.url || '').trim();
      if (baseUrl) {
        if (!defaultBaseUrl) defaultBaseUrl = baseUrl;
        vars.push({ id: uid('kv_'), key: 'base_url', value: baseUrl, enabled: true });
      }
      for (const v of env.variables || []) {
        const key = String(v.name ?? v.key ?? '').trim();
        if (!key) continue;
        vars.push({
          id: uid('kv_'),
          key,
          value: String(v.value ?? v.remoteValue ?? ''),
          enabled: v.enable !== false && !v.disabled,
          secret: /key|token|secret|pass/i.test(key),
        });
      }
      if (env.name) {
        newEnvs.push(newEnvironment(workspaceId, { name: String(env.name), variables: vars }));
      }
    }
  }

  const rootVars: Variable[] = defaultBaseUrl
    ? [{ id: uid('kv_'), key: 'base_url', value: defaultBaseUrl, enabled: true }]
    : [];
  const rootName = doc.info?.name || 'Apifox 导入';
  const rootFolder = newFolder(workspaceId, null, {
    name: String(rootName),
    description: typeof doc.info?.description === 'string' ? doc.info.description : '',
    variables: rootVars,
  });
  newFolders.push(rootFolder);

  let order = 1;
  const mapParams = (arr: any[]): KV[] =>
    (arr || [])
      .filter((x) => x && (x.name || x.key))
      .map((x) => ({
        id: uid('kv_'),
        key: String(x.name ?? x.key ?? ''),
        value: String(x.example ?? x.value ?? ''),
        enabled: x.enable !== false && !x.disabled,
      }));

  const walk = (items: any[], parentId: string) => {
    for (const item of items || []) {
      if (!item || typeof item !== 'object') continue;
      if (item.api && typeof item.api === 'object') {
        const api = item.api;
        const rawPath = String(api.path ?? api.url ?? '').trim();
        const url =
          rawPath && !/^https?:\/\//i.test(rawPath) && !rawPath.startsWith('{{') && defaultBaseUrl
            ? `{{base_url}}${rawPath.startsWith('/') ? '' : '/'}${rawPath}`
            : rawPath;
        const params = mapParams(api.parameters?.query);
        const headers = mapParams(api.parameters?.header);
        const body = emptyBody();
        const rb = api.requestBody;
        if (rb && rb.type && rb.type !== 'none') {
          const t = String(rb.type).toLowerCase();
          if (t.includes('json')) {
            body.type = 'json';
            body.text = typeof rb.example === 'string' ? rb.example : rb.example ? JSON.stringify(rb.example, null, 2) : '';
          } else if (t.includes('x-www-form-urlencoded') || t === 'form') {
            body.type = 'form';
            body.form = mapParams(rb.parameters);
          } else if (t.includes('multipart') || t === 'form-data') {
            body.type = 'multipart';
            body.multipart = (rb.parameters || []).map((f: any) => ({
              id: uid('kv_'),
              key: String(f.name ?? f.key ?? ''),
              value: String(f.example ?? f.value ?? ''),
              enabled: f.enable !== false && !f.disabled,
              isFile: f.type === 'file',
              fileName: f.type === 'file' ? String(f.example ?? '') : undefined,
            }));
          } else if (t.includes('xml')) {
            body.type = 'xml';
            body.text = String(rb.example ?? '');
          } else {
            body.type = 'text';
            body.text = String(rb.example ?? '');
          }
        }
        newRequests.push(
          newRequest(workspaceId, parentId, {
            name: String(item.name || api.name || rawPath || '未命名请求'),
            method: String(api.method || 'GET').toUpperCase(),
            url,
            params,
            headers,
            body,
            auth: mapCollectionAuth(api.auth),
            description: typeof api.description === 'string' ? api.description : '',
            sortOrder: order++,
          }),
        );
      } else if (Array.isArray(item.items)) {
        const fld = newFolder(workspaceId, parentId, {
          name: String(item.name || '未命名文件夹'),
          description: typeof item.description === 'string' ? item.description : '',
          auth: mapCollectionAuth(item.auth),
          sortOrder: order++,
        });
        newFolders.push(fld);
        walk(item.items, fld.id);
      }
    }
  };

  const collections = Array.isArray(doc.apiCollection) ? doc.apiCollection : [];
  if (collections.length === 1 && Array.isArray(collections[0]?.items) && /^(root|根目录)$/i.test(String(collections[0].name ?? ''))) {
    walk(collections[0].items, rootFolder.id);
  } else {
    walk(collections, rootFolder.id);
  }

  return {
    data: {
      ...data,
      folders: [...data.folders, ...newFolders],
      requests: [...data.requests, ...newRequests],
      environments: [...data.environments, ...newEnvs],
    },
    folderCount: newFolders.length,
    requestCount: newRequests.length,
    envCount: newEnvs.length,
  };
}

export function importMyCurlBackup(raw: any): AppData {
  return normalizeData(raw);
}
