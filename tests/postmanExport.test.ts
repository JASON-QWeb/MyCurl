import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { importPostmanCollection } from '../src/lib/collectionIO';
import { emptyBody, newEnvironment, newFolder, newRequest, newWorkspace } from '../src/lib/factory';
import { exportPostmanCollection } from '../src/lib/postmanExport';
import { prepareRequest } from '../src/lib/requestRunner';
import { kv } from '../src/lib/util';
import { importWorkspace } from './importWorkspace';

function tree() {
  const { ws, data } = importWorkspace();
  const secret = randomUUID() + '/private';
  const parent = newFolder(ws, null, { name: 'Service', description: 'Service docs',
    variables: [{ ...kv('credential', secret), secret: true }, kv('origin', 'https://localhost:8000')],
    auth: { type: 'bearer', token: '{{credential}}' }, headers: [kv('X-Trace', 'inherited'), kv('X-Public', 'hello')] });
  const group = newFolder(ws, parent.id, { name: 'Resources', description: 'Resource docs', variables: [kv('lang', 'en'), kv('off', '0', false)] });
  const sibling = newFolder(ws, null, { name: 'Sibling' });
  data.folders.push(parent, group, sibling);
  const main = newRequest(ws, group.id, { name: 'Update', method: 'PATCH', url: '{{origin}}/resource?p={{lang}}#top',
    params: [kv('p', '{{lang}}'), kv('off', '0', false)], headers: [kv('X-Trace', 'override'), kv('X-Trace', 'second'), kv('X-Old', 'old', false)],
    description: 'Request docs', body: { ...emptyBody(), type: 'json', text: '{"id":9007199254740993}' } });
  const anon = newRequest(ws, group.id, { name: 'Public', url: 'https://localhost:8000/health', auth: { type: 'none' } });
  data.requests.push(main, anon, newRequest(ws, null, { name: 'Workspace request', url: 'https://localhost:8000/root' }));
  const other = newWorkspace('Other');
  data.workspaces.push(other);
  data.requests.push(newRequest(other.id, null, { name: 'Do not include', url: 'https://localhost/other' }));
  return { ws, data, secret, parent, group, main };
}

it('exports the workspace as v2.1, preserves nested folders, descriptions, headers and executable auth on reimport', () => {
  const { ws, data, secret } = tree();
  const collection = JSON.parse(exportPostmanCollection(data, { workspaceId: ws, maskSecrets: false }));
  expect(collection.info).toMatchObject({ name: data.workspaces[0].name, schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' });
  expect(JSON.stringify(collection)).not.toContain('Do not include');
  const parent = collection.item.find((i: { name: string }) => i.name === 'Service');
  expect(parent.description).toBe('Service docs');
  expect(parent.auth).toMatchObject({ type: 'bearer', bearer: [{ key: 'token', value: '{{credential}}' }] });
  const group = parent.item[0];
  expect(group).not.toHaveProperty('auth');
  expect(group.item[0].request).not.toHaveProperty('auth');
  expect(group.item[1].request.auth).toEqual({ type: 'noauth' });
  const target = importWorkspace();
  const imported = importPostmanCollection(target.data, target.ws, collection).data;
  const [request, anon] = ['Update', 'Public'].map(n => imported.requests.find(r => r.name === n)!);
  expect(request.description).toBe('Request docs');
  expect(request.params.map(p => [p.key, p.enabled])).toEqual([['p', true], ['off', false]]);
  expect(imported.folders.find(f => f.name === 'Resources')).toMatchObject({ description: 'Resource docs',
    variables: [expect.objectContaining({ key: 'lang', value: 'en' }), expect.objectContaining({ key: 'off', enabled: false })] });
  const outgoing = prepareRequest(imported, request);
  expect(outgoing.url).toBe('https://localhost:8000/resource?p=en#top');
  expect(outgoing.headers).toEqual([['X-Public', 'hello'], ['X-Trace', 'override'], ['X-Trace', 'second'], ['Authorization', 'Bearer ' + secret]]);
  expect(outgoing.body).toMatchObject({ text: '{"id":9007199254740993}' });
  expect(prepareRequest(imported, anon).headers.some(([k]) => k === 'Authorization')).toBe(false);
});

it('exports a standalone subtree with inherited auth and variable dependencies, scoped to the chosen workspace', () => {
  const { ws, data, group, main, secret } = tree();
  data.environments[0].variables.push(kv('external', '{{nested}}'), kv('nested', 'base'), kv('unrelated', 'excluded'));
  const active = newEnvironment(ws, { variables: [kv('nested', 'active')] });
  data.environments.push(active, newEnvironment(ws, { variables: [kv('never', 'inactive')] }));
  data.settings.activeEnvironment[ws] = active.id;
  main.headers.push(kv('X-Env', '{{external}}'));
  const raw = exportPostmanCollection(data, { workspaceId: ws, folderId: group.id, maskSecrets: false });
  const collection = JSON.parse(raw);
  expect(collection.info).toMatchObject({ name: 'Resources', description: 'Resource docs' });
  expect(collection.item.map((i: { name: string }) => i.name)).toEqual(['Update', 'Public']);
  for (const unwanted of ['Sibling', 'excluded', 'inactive', 'Workspace request']) expect(raw).not.toContain(unwanted);
  const target = importWorkspace();
  const restored = importPostmanCollection(target.data, target.ws, collection).data;
  const outgoing = prepareRequest(restored, restored.requests[0]);
  expect(outgoing.headers).toContainEqual(['Authorization', 'Bearer ' + secret]);
  expect(outgoing.headers).toContainEqual(['X-Env', 'active']);
  expect(outgoing.url).toBe('https://localhost:8000/resource?p=en#top');
  expect(() => exportPostmanCollection(data, { workspaceId: data.workspaces[1].id, folderId: group.id })).toThrow();
});

it('masks credentials, encoded and literal copies by default, without touching live data or including embedded files in either mode', () => {
  const { ws, data, parent, main, secret } = tree();
  const [password, cookie, apiKey, embedded] = Array.from({ length: 4 }, () => randomUUID());
  const encoded = encodeURIComponent(secret);
  parent.description = 'Notes ' + secret + ' ' + encoded;
  main.auth = { type: 'basic', username: 'alice', password };
  main.headers.push(kv('Cookie', 'sid=' + cookie), kv('Copy-' + password, apiKey));
  main.url += cookie;
  main.body.text = JSON.stringify({ password, other: encoded, token: apiKey });
  const upload = newRequest(ws, parent.id, { name: 'Upload', url: 'https://localhost/upload', auth: { type: 'apikey', key: 'X-Access', value: apiKey, in: 'header' },
    body: { ...emptyBody(), type: 'multipart', multipart: [{ ...kv('file'), isFile: true,
      fileName: '/private/report.txt', fileData: embedded, contentType: 'text/plain' }] } });
  data.requests.push(upload);
  const before = JSON.stringify(data);
  for (const opts of [{ workspaceId: ws }, { workspaceId: ws, folderId: parent.id }]) {
    const masked = exportPostmanCollection(data, opts);
    for (const literal of [secret, encoded, password, cookie, apiKey, embedded, '/private/report.txt', 'fileData']) expect(masked).not.toContain(literal);
    expect(masked).toContain('••••');
    expect(masked).toContain('{{credential}}');
    const raw = exportPostmanCollection(data, { ...opts, maskSecrets: false });
    for (const literal of [secret, password, cookie, apiKey]) expect(raw).toContain(literal);
    expect(raw).not.toContain(embedded);
    expect(raw).toContain('"src": "report.txt"');
  }
  expect(JSON.stringify(data)).toBe(before);
});

it('round-trips raw, form, multipart and GraphQL bodies, API key locations, Basic auth and folder noauth', () => {
  const { data, ws } = importWorkspace();
  const folder = newFolder(ws, null, { name: 'Public', auth: { type: 'none' } });
  data.folders.push(folder);
  for (const type of ['json', 'text', 'xml', 'form', 'multipart', 'graphql', 'none'] as const) {
    const body = { ...emptyBody(), type };
    if (type === 'form') body.form = [kv('q', 'a'), kv('q', 'b', false)];
    if (type === 'multipart') body.multipart = [{ ...kv('doc'), isFile: true, fileName: 'a.txt', contentType: 'text/plain' }, kv('note', 'hi')];
    if (type === 'graphql') body.graphql = { query: 'query { version }', variables: '{}' };
    if (['json', 'text', 'xml'].includes(type)) body.text = { json: '{}', text: 'body\n', xml: '<body/>' }[type as 'json' | 'text' | 'xml'];
    data.requests.push(newRequest(ws, folder.id, { name: type, url: 'https://[::1]:8080/v1/search?q=a&q=b#top', body,
      auth: type === 'json' ? { type: 'basic', username: 'u', password: '{{pass}}' }
        : { type: 'apikey', key: 'k', value: '{{v}}', in: type === 'xml' ? 'query' : 'header' } }));
  }
  const collection = JSON.parse(exportPostmanCollection(data, { workspaceId: ws, folderId: folder.id }));
  expect(collection.auth).toEqual({ type: 'noauth' });
  expect(collection.item[0].request.url).toMatchObject({ protocol: 'https', host: '[::1]', port: '8080', path: ['v1', 'search'], hash: 'top',
    query: [{ key: 'q', value: 'a' }, { key: 'q', value: 'b' }] });
  const target = importWorkspace();
  const out = importPostmanCollection(target.data, target.ws, collection).data;
  expect(out.folders[0].auth).toEqual({ type: 'none' });
  for (const [i, req] of out.requests.entries()) {
    const original = data.requests[i];
    expect(req.auth).toEqual(original.auth);
    expect(req.body.type).toBe(original.body.type);
    expect(req.body.text).toBe(original.body.text);
    expect(req.body.graphql).toEqual(original.body.graphql);
    expect(req.body.form.map(f => [f.key, f.value, f.enabled])).toEqual(original.body.form.map(f => [f.key, f.value, f.enabled]));
    expect(req.body.multipart.map(f => [f.key, f.value, f.fileName, f.contentType])).toEqual(original.body.multipart.map(f => [f.key, f.value, f.fileName, f.contentType]));
  }
});

it.each(['Token', ''])('preserves the effective Authorization header for the custom Bearer prefix "%s"', prefix => {
  const { data, ws } = importWorkspace();
  const folder = newFolder(ws, null, { auth: { type: 'bearer', prefix, token: '{{credential}}' }, variables: [kv('credential', 'entered')] });
  data.folders.push(folder);
  data.requests.push(newRequest(ws, folder.id, { url: 'https://localhost' }));
  const collection = JSON.parse(exportPostmanCollection(data, { workspaceId: ws, folderId: folder.id, maskSecrets: false }));
  expect(collection.auth).toMatchObject({ type: 'apikey', apikey: [
    { key: 'key', value: 'Authorization' }, { key: 'value', value: prefix ? prefix + ' {{credential}}' : '{{credential}}' },
    { key: 'in', value: 'header' },
  ] });
  const target = importWorkspace();
  const imported = importPostmanCollection(target.data, target.ws, collection).data;
  expect(imported.folders[0].auth).toEqual(folder.auth);
  expect(prepareRequest(imported, imported.requests[0]).headers).toEqual([['Authorization', prefix ? prefix + ' entered' : 'entered']]);
});

it('keeps variable names usable when a short credential is a substring of its own name', () => {
  const { data, ws } = importWorkspace();
  const folder = newFolder(ws, null, { variables: [{ ...kv('password', 'pass'), secret: true }],
    auth: { type: 'basic', username: 'alice', password: '{{password}}' } });
  data.folders.push(folder);
  const out = JSON.parse(exportPostmanCollection(data, { workspaceId: ws, folderId: folder.id }));
  expect(out.variable[0]).toMatchObject({ key: 'password', value: '••••' });
  expect(out.auth.basic).toContainEqual({ key: 'password', value: '{{password}}', type: 'string' });
});
