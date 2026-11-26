import { compileFilter } from './jq';
import type { AppData, HttpRequest } from './types';

export interface SaveTargetScope {
  kind: 'folder' | 'env' | 'base';
  id: string;
  name: string;
}

export const VARIABLE_NAME = /^[A-Za-z0-9_.\-\u4e00-\u9fa5]+$/;

export function inferVarNameFromFilter(expr: string): string {
  // Simple JSONPath names can include unquoted hyphens and Chinese characters.
  const primary = expr.split('//', 1)[0].trim();
  const path = primary.match(/^\$?(?:\.[\w\-\u4e00-\u9fa5]+|\[(?:\d+|\*)?\])*\.([\w\-\u4e00-\u9fa5]+)(?:\[(?:\d+|\*)?\])*$/);
  if (path) return path[1];
  let name = '';
  try {
    let node = compileFilter(expr);
    // Follow the primary alternative and the output side of a pipe.
    while (true) {
      if (node.k === 'alt') node = node.left;
      else if (node.k === 'pipe') node = node.right;
      else if (node.k === 'try') node = node.body;
      else if (node.k === 'index' && node.index.k === 'literal' && typeof node.index.value === 'string') {
        name = node.index.value;
        break;
      } else if (node.k === 'index' || node.k === 'iterate' || node.k === 'slice') node = node.target;
      else {
        if (node.k === 'field') name = node.name;
        break;
      }
    }
  } catch {
    return 'response_var';
  }
  return /[A-Za-z0-9_.\-\u4e00-\u9fa5]/.test(name)
    ? name.trim().replace(/[^A-Za-z0-9_.\-\u4e00-\u9fa5]+/g, '_') : 'response_var';
}

export function resolveSaveTargetScope(data: AppData, req: Pick<HttpRequest, 'workspaceId' | 'folderId'>): SaveTargetScope | null {
  const folder = data.folders.find(f => f.id === req.folderId && f.workspaceId === req.workspaceId);
  if (folder) return { kind: 'folder', id: folder.id, name: folder.name };
  const envs = data.environments.filter(env => env.workspaceId === req.workspaceId);
  const active = envs.find(env => !env.isBase && env.id === data.settings.activeEnvironment[req.workspaceId]);
  if (active) return { kind: 'env', id: active.id, name: active.name };
  const base = envs.find(env => env.isBase);
  return base ? { kind: 'base', id: base.id, name: base.name } : null;
}
