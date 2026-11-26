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

export function filterWorkspaceRequests(data: AppData, workspaceId: string, query: ReturnType<typeof parseRequestSearch>) {
  const folderPaths = new Map<string, string>();
  return data.requests.filter((request) => {
    if (request.workspaceId !== workspaceId) return false;
    if (!request.name.toLowerCase().includes(query.text) && !request.url.toLowerCase().includes(query.text)) return false;
    if (query.methods.length && !query.methods.includes(request.method.toLowerCase())) return false;
    if (!query.folders.length) return true;
    if (!request.folderId) return false;
    let path = folderPaths.get(request.folderId);
    if (path === undefined) {
      path = folderChain(data, request.folderId)
        .filter((folder) => folder.workspaceId === workspaceId)
        .map((folder) => folder.name.toLowerCase()).join('/');
      folderPaths.set(request.folderId, path);
    }
    return query.folders.every((folder) => path.includes(folder));
  });
}
