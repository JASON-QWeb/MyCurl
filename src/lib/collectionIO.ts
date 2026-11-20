/**
 * 数据导出与导入（MyCurl JSON 备份 / Postman Collection v2.1）
 */
import type { AppData, Auth, Folder, HttpRequest, KV } from './types';
import { emptyBody, newFolder, newRequest, normalizeData } from './factory';
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

export function isMyCurlBackup(obj: any): boolean {
  return !!(obj && typeof obj === 'object' && Array.isArray(obj.workspaces) && Array.isArray(obj.requests));
}

function mapPostmanAuth(a: any): Auth {
  if (!a || !a.type || a.type === 'noauth') return { type: 'inherit' };
  const map = (arr: any[]) => Object.fromEntries((arr || []).map((x) => [x.key, x.value]));
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

export function importMyCurlBackup(raw: any): AppData {
  return normalizeData(raw);
}
