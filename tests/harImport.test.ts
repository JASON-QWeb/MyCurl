import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { newFolder, newWorkspace } from '../src/lib/factory';
import { importHarArchive, isHarArchive } from '../src/lib/harImport';
import { prepareRequest } from '../src/lib/requestRunner';
import { kv } from '../src/lib/util';
import { importWorkspace } from './importWorkspace';

const entry = (url: string, type?: string, request: Record<string, unknown> = {}) => ({
  _resourceType: type, request: { method: 'GET', url, ...request },
});
const archive = (...entries: unknown[]) => ({ log: { entries } });

it('recognizes HAR archives and keeps API, fetch, XHR and document traffic even at asset URLs', () => {
  const { data, ws } = importWorkspace();
  expect(isHarArchive(archive())).toBe(true);
  for (const bad of [[], { log: [] }, { log: { entries: {} } }]) expect(isHarArchive(bad)).toBe(false);
  const api = { ...entry('https://localhost/manifest.js'), response: { content: { mimeType: 'application/json' } } };
  const result = importHarArchive(data, ws, archive(
    entry('https://localhost/api'), entry('https://localhost/fetch.png?v=1', 'fetch'),
    entry('https://localhost/xhr.js', 'xhr'), entry('https://localhost/page.css', 'document'), api,
    entry('https://localhost/asset', 'stylesheet'), entry('https://localhost/file.WOFF2?v=2'), entry('data:text/plain,hello'),
    entry('chrome-extension://id/page'), null, entry('not a URL'),
  ));
  expect(result).toMatchObject({ folderCount: 1, requestCount: 5 });
  expect(result.data.requests.map(r => r.url)).toEqual(['/api', '/fetch.png?v=1', '/xhr.js', '/page.css', '/manifest.js'].map(p => '{{base_url}}' + p));
});

it('falls back to real HTTP(S) entries if the entire capture is static', () => {
  const { data, ws } = importWorkspace();
  expect(importHarArchive(data, ws, archive(entry('https://localhost/icon.svg', 'image'), entry('data:image/png,bytes'))).requestCount).toBe(1);
  expect(importHarArchive(data, ws, archive(entry('chrome-extension://id'), entry('data:text/plain,a')))).toEqual({ data, folderCount: 0, requestCount: 0 });
});

it('removes pseudo and browser headers and reuses Bearer, query, API key and cookie secrets per host', () => {
  const { data, ws } = importWorkspace();
  const token = randomUUID(), cookie = 'sid=' + randomUUID();
  const headers = [':authority', ':method', ':path', ':scheme', 'Content-Length', 'Host', 'Connection', 'Accept-Encoding',
    'Sec-Ch-Ua-Mobile', 'Sec-Fetch-Mode', 'Upgrade-Insecure-Requests'].map(name => ({ name, value: 'discard' }));
  const result = importHarArchive(data, ws, archive(
    entry('http://localhost:11434/api/chat?token=' + token + '&q=a%26b&q=c#ref', 'xhr', {
      method: 'POST', headers: [...headers, { name: 'Authorization', value: 'Bearer ' + token },
        { name: 'x-api-key', value: token }, { name: 'Cookie', value: cookie }, { name: 'Accept', value: 'application/json' }],
      postData: { mimeType: 'application/json', text: '{"model":"local"}' },
    }),
    entry('http://localhost:11434/api/tags', 'fetch', { cookies: [{ name: 'sid', value: cookie.slice(4) }],
      headers: [{ name: 'Authorization', value: 'Bearer ' + token }] }),
    entry('https://api.fireworks.ai/v1/models', 'xhr', { headers: [{ name: 'Authorization', value: 'Bearer ' + token }] }),
  ));
  expect(result).toMatchObject({ folderCount: 2, requestCount: 3 });
  const [folder, other] = result.data.folders;
  expect(folder.name).toBe('Ollama · localhost:11434');
  expect(other.name).toContain('Fireworks AI');
  expect(folder.variables.map(v => [v.key, v.value, !!v.secret])).toEqual([
    ['base_url', 'http://localhost:11434', false], ['api_key', token, true], ['cookie', cookie, true],
  ]);
  const [r, r2, r3] = result.data.requests;
  expect(r.name).toBe('Ollama Chat · local');
  expect(r.headers.map(h => [h.key, h.value])).toEqual([['x-api-key', '{{api_key}}'], ['Cookie', '{{cookie}}'], ['Accept', 'application/json']]);
  expect(r.params.map(p => [p.key, p.value])).toEqual([['token', '{{api_key}}'], ['q', 'a%26b'], ['q', 'c']]);
  expect(r.auth).toEqual({ type: 'bearer', token: '{{api_key}}' });
  expect(r2.auth).toEqual(r.auth);
  expect(r2.headers[0].value).toBe('{{cookie}}');
  expect(r3.folderId).toBe(other.id);
  expect(JSON.stringify(result.data.requests)).not.toContain(token);
  expect(prepareRequest(result.data, r).url).toBe('http://localhost:11434/api/chat?token=' + token + '&q=a%26b&q=c#ref');
});

it('reuses workspace folders immutably, respecting existing base paths and scheme changes', () => {
  const { data, ws } = importWorkspace();
  const other = newWorkspace();
  data.workspaces.push(other);
  data.folders.push(newFolder(other.id, null, { host: 'localhost' }));
  const folder = newFolder(ws, null, { host: 'localhost', variables: [kv('base_url', 'https://localhost/v1')] });
  data.folders.push(folder);
  const result = importHarArchive(data, ws, archive(...['https://localhost/v1/items', 'http://localhost/v2', 'http://localhost/v3'].map(u => entry(u))));
  expect(result.folderCount).toBe(0);
  expect(result.data.requests.map(r => r.url)).toEqual(['{{base_url}}/items', '{{base_url_2}}/v2', '{{base_url_2}}/v3']);
  expect(result.data.requests.every(r => r.folderId === folder.id)).toBe(true);
  expect(folder.variables).toHaveLength(1);
});

it('imports Basic auth, decoded form fields, multipart metadata and text with optional host grouping and secret extraction', () => {
  const { data, ws } = importWorkspace();
  const password = randomUUID() + ':tail';
  const basic = 'Basic ' + btoa('alice:' + password);
  const capture = archive(entry('https://localhost/form', undefined, {
    headers: [{ name: 'Authorization', value: basic }], method: 'POST', queryString: [{ name: 'q', value: 'a & b' }],
    postData: { mimeType: 'application/x-www-form-urlencoded', text: 'field=one+two&field=x%2By' },
  }), entry('https://example.org/upload', undefined, { method: 'POST', postData: { mimeType: 'multipart/form-data', params: [
    { name: 'file', fileName: 'document.txt', contentType: 'text/plain', value: 'binary payload' }, { name: 'notes', value: 'ok' },
  ] } }), entry('https://example.org/text', undefined, { postData: { mimeType: 'text/plain', text: '{"keep":"text"}\n' } }));
  const out = importHarArchive(data, ws, capture, { groupByHost: false }).data;
  expect(out.folders).toHaveLength(1);
  expect(out.folders[0].variables).toMatchObject([{ key: 'password', value: password, secret: true }]);
  const [form, multi, text] = out.requests;
  expect(form.url).toBe('https://localhost/form?q=a+%26+b');
  expect(form.auth).toEqual({ type: 'basic', username: 'alice', password: '{{password}}' });
  expect(prepareRequest(out, form).headers).toContainEqual(['Authorization', basic]);
  expect(form.body.form.map(p => p.value)).toEqual(['one two', 'x+y']);
  expect(multi.body.multipart[0]).toMatchObject({ key: 'file', isFile: true, fileName: 'document.txt', value: '' });
  expect(multi.body.multipart[1].value).toBe('ok');
  expect(text.body).toMatchObject({ type: 'text', text: '{"keep":"text"}\n' });
  const raw = importHarArchive(data, ws, capture, { extractSecrets: false }).data;
  expect(raw.requests[0].auth.password).toBe(password);
  expect(raw.folders[0].variables.some(v => v.secret)).toBe(false);
});

it('reads multipart captures that supply only the raw wire body and drops the stale boundary header', () => {
  const { data, ws } = importWorkspace();
  const mime = 'multipart/form-data; boundary="example"';
  const text = ['--example', 'Content-Disposition: form-data; name="note"', '', 'two', 'lines',
    '--example', 'Content-Disposition: form-data; name="upload"; filename="report.txt"', 'Content-Type: text/plain',
    '', 'file payload', '--example--', ''].join('\r\n');
  const out = importHarArchive(data, ws, archive(entry('https://localhost', 'xhr', { method: 'POST',
    headers: [{ name: 'Content-Type', value: mime }], postData: { mimeType: mime, text } }))).data;
  expect(out.requests[0].headers).toEqual([]);
  expect(out.requests[0].body.multipart).toMatchObject([{ key: 'note', value: 'two\r\nlines' },
    { key: 'upload', isFile: true, fileName: 'report.txt', contentType: 'text/plain', value: '' }]);
  expect(JSON.stringify(out.requests)).not.toContain('file payload');
});

it('moves URL credentials to Basic auth and removes connection-specific headers before replay', () => {
  const { data, ws } = importWorkspace();
  const password = randomUUID() + '/secret';
  const result = importHarArchive(data, ws, archive(entry('https://alice:' + encodeURIComponent(password) + '@localhost/log', 'xhr', {
    headers: [{ name: 'Connection', value: 'Keep-Alive, X-Connection-Only' }, { name: 'X-Connection-Only', value: 'temporary' },
      { name: 'Proxy-Authorization', value: 'proxy only' }],
  })));
  const req = result.data.requests[0];
  expect(req).toMatchObject({ url: '{{base_url}}/log', auth: { type: 'basic', username: 'alice', password: '{{password}}' }, headers: [] });
  expect(prepareRequest(result.data, req).headers).toEqual([['Authorization', 'Basic ' + btoa('alice:' + password)]]);
});
