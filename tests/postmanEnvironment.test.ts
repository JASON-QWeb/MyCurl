import { describe, expect, it, vi } from 'vitest';
import { defaultSettings, newWorkspace } from '../src/lib/factory';
import { readPostmanEnvironment } from '../src/lib/postmanEnvironment';
import { resolveVariables } from '../src/lib/template';
import type { AppData } from '../src/lib/types';
import { useAppStore } from '../src/store/useAppStore';
import * as storage from '../src/lib/storage';

const exported = { _postman_variable_scope: 'environment', name: 'Local', values: [] };

describe('Postman environment file import', () => {
  it('adds a selectable workspace environment and preserves disabled and secret variables', () => {
    const workspace = newWorkspace();
    const env = readPostmanEnvironment({
      ...exported,
      values: [
        { key: 'credential', value: '', type: 'secret', enabled: true },
        { key: 'attempts', value: 0, enabled: false },
        { key: 'feature', value: false },
      ],
    }, workspace.id)!;
    expect(env).toMatchObject({ name: exported.name, workspaceId: workspace.id, isBase: false });
    expect(env.variables[1]).toMatchObject({ key: 'attempts', value: '0', enabled: false });
    const data: AppData = {
      version: 1, workspaces: [workspace], environments: [env], requests: [], folders: [], settings: defaultSettings(),
    };
    expect(resolveVariables(data, workspace.id, null).size).toBe(0);
    data.settings.activeEnvironment[workspace.id] = env.id;
    const vars = resolveVariables(data, workspace.id, null);
    expect(vars.get('credential')).toMatchObject({ secret: true, value: '' });
    expect(vars.get('feature')?.value).toBe('false');
    expect(vars.has('attempts')).toBe(false);
  });

  it('accepts empty environments and assigns local IDs for independent imports', () => {
    const first = readPostmanEnvironment(exported, 'ws')!;
    expect(first.variables).toEqual([]);
    expect(readPostmanEnvironment(exported, 'ws')?.id).not.toBe(first.id);
  });

  it('rejects other scopes and incomplete files without importing partial variables', () => {
    expect(readPostmanEnvironment({ ...exported, _postman_variable_scope: 'globals' }, 'ws')).toBeNull();
    expect(readPostmanEnvironment({ ...exported, values: [{ key: 'first' }, null] }, 'ws')).toBeNull();
  });

  it.each(['zh', 'en'] as const)('persists an import in the target workspace with %s feedback', lang => {
    const saved = vi.spyOn(storage, 'saveAppData').mockResolvedValue();
    const original = useAppStore.getState();
    try {
      const other = newWorkspace();
      const data = { ...original.data, workspaces: [...original.data.workspaces, other],
        settings: { ...original.data.settings, language: lang, activeWorkspaceId: other.id } };
      useAppStore.setState({ data, toasts: [] });
      const env = original.importPostmanEnvironment(exported, other.id)!;
      const state = useAppStore.getState();
      expect(state.data.environments).toEqual([...data.environments, env]);
      expect(env.workspaceId).toBe(other.id);
      expect(state.data.settings.activeEnvironment).toEqual(data.settings.activeEnvironment);
      expect(saved).toHaveBeenCalledWith(state.data);
      expect(state.toasts.at(-1)).toMatchObject({ kind: 'success', message: expect.stringContaining(lang === 'en' ? 'Imported' : '已导入') });
      expect(original.importPostmanEnvironment({}, other.id)).toBeNull();
      expect(useAppStore.getState().data).toBe(state.data);
      expect(useAppStore.getState().toasts.at(-1)?.kind).toBe('error');
    } finally {
      useAppStore.setState(original);
      saved.mockRestore();
    }
  });
});
