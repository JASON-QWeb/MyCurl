import { describe, expect, it } from 'vitest';
import { defaultSettings, newWorkspace } from '../src/lib/factory';
import { readPostmanEnvironment } from '../src/lib/postmanEnvironment';
import { resolveVariables } from '../src/lib/template';
import type { AppData } from '../src/lib/types';

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
});
