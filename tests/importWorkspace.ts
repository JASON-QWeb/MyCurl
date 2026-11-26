import { defaultSettings, newEnvironment, newWorkspace } from '../src/lib/factory';
import type { AppData, Language } from '../src/lib/types';

export function importWorkspace(language: Language = 'en') {
  const workspace = newWorkspace('API workspace');
  const ws = workspace.id;
  const data: AppData = { version: 1, workspaces: [workspace], requests: [], folders: [],
    environments: [newEnvironment(ws, { isBase: true })],
    settings: { ...defaultSettings(), activeWorkspaceId: ws, language } };
  return { data, ws };
}
