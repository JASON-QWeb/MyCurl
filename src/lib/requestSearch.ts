import { folderChain } from './template';
import type { AppData } from './types';

export function parseRequestSearch(query: string) {
  const methods: string[] = [];
  const folders: string[] = [];
  const text = query.toLowerCase().replace(
    /(^|\s)(method|folder):(?:"([^"]+)"|([^\s"]+))(?=\s|$)/g,
    (_match, _space, key, quoted, unquoted) => {
      const value = quoted ?? unquoted;
      if (key === 'method') methods.push(value);
      else folders.push(value);
      return ' ';
    },
  ).trim();
  const filtered = methods.length > 0 || folders.length > 0;
  return { methods, folders, filtered, text: filtered ? text.replace(/\s+/g, ' ') : text };
}

type RequestSearch = ReturnType<typeof parseRequestSearch>;

function searchWorkspace(data: AppData, workspaceId: string, query: RequestSearch) {
  const folderMatches = new Map<string, boolean>();
  const matchesFolder = (id: string | null) => {
    if (!query.folders.length) return true;
    if (!id) return false;
    const cached = folderMatches.get(id);
    if (cached !== undefined) return cached;
    const path = folderChain(data, id).filter(f => f.workspaceId === workspaceId).map(f => f.name.toLowerCase()).join('/');
    const matches = query.folders.every(term => path.includes(term));
    folderMatches.set(id, matches);
    return matches;
  };
  const requests = data.requests.filter((request) => {
    if (request.workspaceId !== workspaceId) return false;
    if (!request.name.toLowerCase().includes(query.text) && !request.url.toLowerCase().includes(query.text)) return false;
    if (query.methods.length && !query.methods.includes(request.method.toLowerCase())) return false;
    return matchesFolder(request.folderId);
  });
  return { requests, matchesFolder };
}

export function filterWorkspaceRequests(data: AppData, workspaceId: string, query: RequestSearch) {
  return searchWorkspace(data, workspaceId, query).requests;
}

export function filterSidebarTree(data: AppData, workspaceId: string, query: RequestSearch) {
  const { requests, matchesFolder } = searchWorkspace(data, workspaceId, query);
  const requestIds = new Set(requests.map(r => r.id));
  const folders = new Map(data.folders.filter(f => f.workspaceId === workspaceId).map(f => [f.id, f]));
  const folderIds = new Set<string>();
  const showAncestors = (id: string | null) => {
    while (id && folders.has(id) && !folderIds.has(id)) {
      folderIds.add(id);
      id = folders.get(id)!.parentId;
    }
  };
  const folderOnly = query.folders.length > 0 && !query.methods.length && !query.text;
  for (const f of folders.values()) {
    if (folderOnly && matchesFolder(f.id)) showAncestors(f.id);
    if (!query.filtered && (f.name.toLowerCase().includes(query.text) || f.host?.toLowerCase().includes(query.text))) {
      showAncestors(f.id);
    }
  }
  for (const r of data.requests) {
    if (r.workspaceId !== workspaceId) continue;
    if (!query.filtered) {
      const parent = r.folderId ? folders.get(r.folderId) : undefined;
      if (parent?.name.toLowerCase().includes(query.text) || r.method.toLowerCase().includes(query.text)) requestIds.add(r.id);
    }
    if (requestIds.has(r.id)) showAncestors(r.folderId);
  }
  return { folderIds, requestIds };
}
