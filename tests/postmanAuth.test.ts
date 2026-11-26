import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { importApifoxCollection, importPostmanCollection } from '../src/lib/collectionIO';
import { defaultSettings, newWorkspace } from '../src/lib/factory';
import { prepareRequest } from '../src/lib/requestRunner';
import type { AppData } from '../src/lib/types';

function emptyWorkspace(): AppData {
  return { version: 1, workspaces: [newWorkspace()], folders: [], environments: [], requests: [], settings: defaultSettings() };
}

function authorizationByName(data: AppData) {
  return Object.fromEntries(data.requests.map((req) => [
    req.name, new Headers(prepareRequest(data, req).headers).get('Authorization'),
  ]));
}

it('preserves Postman noauth and inheritance in outgoing requests', () => {
  const base = emptyWorkspace();
  const token = randomUUID();
  const url = 'http://localhost/';
  const noAuth = { type: 'noauth' };
  const bearer = { type: 'bearer', bearer: [{ key: 'token', value: token }] };
  const collection = {
    info: { name: 'Authentication' },
    auth: bearer,
    item: [
      { name: 'Default', item: [
        { name: 'Inherited request', request: { url } },
        { name: 'Public request', request: { url, auth: noAuth } },
      ] },
      { name: 'Public folder', auth: noAuth, item: [
        { name: 'Nested folder', item: [{ name: 'Nested public request', request: { url } }] },
        { name: 'Opt in', request: { url, auth: bearer } },
      ] },
    ],
  };
  const { data } = importPostmanCollection(base, base.workspaces[0].id, collection);
  expect(authorizationByName(data)).toEqual({
    'Inherited request': `Bearer ${token}`,
    'Public request': null,
    'Nested public request': null,
    'Opt in': `Bearer ${token}`,
  });
});

it('retains prior Apifox inheritance for noauth', () => {
  const base = emptyWorkspace();
  const token = randomUUID();
  const { data } = importApifoxCollection(base, base.workspaces[0].id, {
    apiCollection: [{
      name: 'Parent', auth: { type: 'bearer', bearer: { token } }, items: [{
        name: 'Child', api: { path: 'http://localhost/', auth: { type: 'noauth' } },
      }],
    }],
  });
  expect(authorizationByName(data)).toEqual({ Child: `Bearer ${token}` });
});
