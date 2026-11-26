import { describe, expect, it } from 'vitest';
import { newEnvironment, newFolder, newWorkspace, seedData } from '../src/lib/factory';
import { inferVarNameFromFilter, resolveSaveTargetScope } from '../src/lib/responseExtract';

describe('response variable names', () => {
  it.each([
    ['.access_token', 'access_token'], ['.data.access_token', 'access_token'], ['$.data.access_token', 'access_token'],
    [' .choices[0].message.content // .error.message // . ', 'content'], ['.data[0].id', 'id'],
    ['$.data[*].name', 'name'], ['$.数据[0].条目-id', '条目-id'], [".data[\"x-api-key\"]", 'x-api-key'],
    ["$['data']['字段.1']", '字段.1'], ['.items | .[0].name?', 'name'], ['(.tags // .other)[0]', 'tags'],
    ['."header // value" // .fallback', 'header_value'], ['.["!"]', 'response_var'],
    ['', 'response_var'], ['.', 'response_var'], ['.[0]', 'response_var'], ['length', 'response_var'],
    ['.bad[', 'response_var'], ['. // .token', 'response_var'],
  ])('infers %s as %s', (expr, expected) => expect(inferVarNameFromFilter(expr)).toBe(expected));
});

describe('response variable destinations', () => {
  it('uses the request workspace and prefers its folder, active child environment, then base', () => {
    const data = seedData();
    const req = data.requests[0];
    const [base, env] = data.environments;
    const folder = data.folders[0];
    const other = newWorkspace();
    data.workspaces.push(other);
    data.settings.activeWorkspaceId = other.id;
    const otherFolder = newFolder(other.id, null);
    const otherEnv = newEnvironment(other.id);
    data.folders.push(otherFolder);
    data.environments.push(otherEnv);
    data.settings.activeEnvironment[other.id] = otherEnv.id;
    data.settings.activeEnvironment[req.workspaceId] = env.id;
    expect(resolveSaveTargetScope(data, req)).toEqual({ kind: 'folder', id: folder.id, name: folder.name });
    for (const folderId of [null, 'missing', otherFolder.id]) {
      expect(resolveSaveTargetScope(data, { ...req, folderId })).toEqual({ kind: 'env', id: env.id, name: env.name });
    }
    req.folderId = null;
    for (const active of [null, base.id, 'missing', otherEnv.id]) {
      data.settings.activeEnvironment[req.workspaceId] = active;
      expect(resolveSaveTargetScope(data, req)).toEqual({ kind: 'base', id: base.id, name: base.name });
    }
  });

  it('cannot write into another workspace when the original workspace was removed', () => {
    const data = seedData();
    expect(resolveSaveTargetScope(data, { workspaceId: 'removed', folderId: data.folders[0].id })).toBeNull();
  });
});
