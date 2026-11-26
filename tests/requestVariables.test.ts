import { expect, it } from 'vitest';
import { emptyBody, newFolder, newRequest, seedData } from '../src/lib/factory';
import { collectRequestVarNames, prepareRequest } from '../src/lib/requestRunner';
import { kv } from '../src/lib/util';

it('collects active URL, param, local and inherited header names, and nearest folder auth in order', () => {
  const data = seedData();
  const ws = data.workspaces[0].id;
  const parent = newFolder(ws, null, {
    headers: [kv('{{parentKey}}', '{{shadowed}}'), kv('X-Local', '{{overridden}}'), kv('X-Off', '{{off}}', false)],
    variables: [kv('parentKey', 'x-shared'), kv('base', '{{host}}/v1')],
    auth: { type: 'basic', username: '{{oldUser}}', password: '{{oldPass}}' },
  });
  const child = newFolder(ws, parent.id, {
    headers: [kv('{{sharedKey}}', '{{inheritedValue}}')],
    variables: [kv('sharedKey', 'X-Shared'), kv('localKey', 'x-local')],
    auth: { type: 'bearer', token: '{{api_token}}', prefix: '{{scheme}}', password: '{{inactive}}' },
  });
  data.folders.push(parent, child);
  const req = newRequest(ws, child.id, {
    url: '{{base}}/{{id}}?time={{$timestamp}}', params: [kv('{{param}}', '{{id}}-{{value}}'), kv('{{off}}', '{{off}}', false)],
    headers: [kv('{{localKey}}', '{{headerValue}}'), kv('X-Disabled', '{{off}}', false)],
    body: { ...emptyBody(), type: 'json', text: '{"trace":"{{$uuid}}","id":"{{id}}","model":"{{model}}"}' },
  });
  expect(collectRequestVarNames(data, req)).toEqual([
    'base', 'id', 'param', 'value', 'localKey', 'headerValue', 'sharedKey', 'inheritedValue',
    'api_token', 'scheme', 'model', 'host',
  ]);
  expect(prepareRequest(data, req).missingUrlVars).toEqual(['host', 'id']);
  req.auth = { type: 'basic', username: '{{user}}', password: '{{pass}}', token: '{{stale}}' };
  expect(collectRequestVarNames(data, req)).toEqual(expect.arrayContaining(['user', 'pass']));
  expect(collectRequestVarNames(data, req)).not.toContain('api_token');
  expect(collectRequestVarNames(data, req)).not.toContain('stale');
  req.auth = { type: 'apikey', key: '{{authName}}', value: '{{authValue}}' };
  expect(collectRequestVarNames(data, req)).toEqual(expect.arrayContaining(['authName', 'authValue']));
});

it('inspects only the active body, enabled rows and non-file multipart fields', () => {
  const data = seedData();
  const req = newRequest(data.workspaces[0].id, null);
  req.body = { ...emptyBody(), type: 'none', text: '{{text}}',
    form: [kv('{{field}}', '{{value}}'), kv('disabled', '{{off}}', false)],
    multipart: [kv('{{part}}', '{{content}}'), { ...kv('{{file}}', '{{ignored}}'), isFile: true }, kv('off', '{{off}}', false)],
    graphql: { query: 'query {{operation}}', variables: '{"key":"{{graphqlVar}}"}' },
  };
  for (const [type, names] of [
    ['none', []], ['json', ['text']], ['xml', ['text']], ['text', ['text']], ['form', ['field', 'value']],
    ['multipart', ['part', 'content']], ['graphql', ['operation', 'graphqlVar']],
  ] as const) {
    expect(collectRequestVarNames(data, { ...req, body: { ...req.body, type } })).toEqual(names);
  }
});

it('terminates for cyclic aliases and lists each variable only once', () => {
  const data = seedData();
  data.environments[0].variables = [kv('a', '{{b}}'), kv('b', '{{a}}')];
  const req = newRequest(data.workspaces[0].id, null, { url: '{{a}}/{{a}}' });
  expect(collectRequestVarNames(data, req)).toEqual(['a', 'b']);
});
