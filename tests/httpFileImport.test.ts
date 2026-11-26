import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { emptyBody, newFolder, newRequest } from '../src/lib/factory';
import { exportHttpFile } from '../src/lib/httpFileExport';
import { importHttpFile, looksLikeHttpFile, parseHttpFile } from '../src/lib/httpFileImport';
import { prepareRequest } from '../src/lib/requestRunner';
import { kv } from '../src/lib/util';
import { importWorkspace } from './importWorkspace';

it('recognizes requests independently of the filename and rejects unrelated text or variable-only files', () => {
  for (const text of ['GET https://example.org/a HTTP/1.1', 'https://example.org', '{{origin}}/path', '# note\n### Docs\nGET /status']) {
    expect(looksLikeHttpFile(text)).toBe(true);
  }
  for (const text of ['', 'just some text', '@origin = https://localhost', '# GET https://example.org\n// GET {{base}}', 'curl -X GET https://example.org']) {
    expect(looksLikeHttpFile(text)).toBe(false);
  }
});

it('reads file variables, titles, query continuations, repeated headers, JSON and form bodies', () => {
  const { data, ws } = importWorkspace();
  const token = randomUUID();
  const text = ['\uFEFF# file variables', '@origin = https://localhost:8443', '@token = ' + token,
    '### Create Chat', '// ignored', '# ignored too', 'POST {{origin}}/api/chat HTTP/1.1',
    '  ?stream=true', '  &id=one&id=two', 'X-Trace: one', 'X-Trace: two', 'Authorization: Bearer {{token}}',
    'Content-Type: application/json; charset=utf-8', '', '{', '  "model": "{{model}}"', '}',
    '### Submit', 'post https://example.org/form', 'Content-Type: application/x-www-form-urlencoded', '',
    'q=one+two&q={{token}}&q=x%2By', '###', 'https://example.org/check'].join('\r\n');
  const file = parseHttpFile(text);
  expect(file.requests.map(r => r.name)).toEqual(['Create Chat', 'Submit', '']);
  const result = importHttpFile(data, ws, text, 'REST operations');
  expect(result).toMatchObject({ folderCount: 1, requestCount: 3 });
  const folder = result.data.folders[0];
  expect(folder.name).toBe('REST operations');
  expect(folder.variables.map(v => [v.key, v.value, !!v.secret])).toEqual([['origin', 'https://localhost:8443', false], ['token', token, true]]);
  const [chat, form, bare] = result.data.requests;
  expect(chat).toMatchObject({ name: 'Create Chat', method: 'POST', url: '{{origin}}/api/chat?stream=true&id=one&id=two',
    auth: { type: 'bearer', token: '{{token}}' }, body: { type: 'json' } });
  expect(chat.headers.map(p => p.key)).toEqual(['X-Trace', 'X-Trace', 'Content-Type']);
  expect(chat.params.map(p => p.value)).toEqual(['true', 'one', 'two']);
  expect(JSON.parse(chat.body.text)).toEqual({ model: '{{model}}' });
  expect(form.body.form.map(p => p.value)).toEqual(['one two', '{{token}}', 'x+y']);
  expect(bare).toMatchObject({ method: 'GET', body: { type: 'none' } });
  expect(prepareRequest(result.data, chat).headers).toContainEqual(['Authorization', 'Bearer ' + token]);
});

it('protects inline Bearer values, reuses existing variables, and avoids collisions', () => {
  const { data, ws } = importWorkspace();
  const [first, second] = [randomUUID(), randomUUID()];
  const text = ['@api_key = ' + first, '###', 'GET {{origin}}/one', 'Authorization: Bearer ' + first,
    '###', 'GET {{origin}}/two?token=' + second, 'Authorization: Bearer ' + second,
    '###', 'GET {{origin}}/three', 'Authorization: Bearer ' + second].join('\n');
  const out = importHttpFile(data, ws, text).data;
  expect(out.folders[0].variables.map(v => v.key)).toEqual(['api_key', 'api_key_2']);
  expect(out.requests.map(r => r.auth.token)).toEqual(['{{api_key}}', '{{api_key_2}}', '{{api_key_2}}']);
  expect(out.requests[1].url).toBe('{{origin}}/two?token={{api_key_2}}');
  for (const secret of [first, second]) expect(JSON.stringify(out.requests)).not.toContain(secret);
});

it.each([
  ['<message/>', 'xml'], ['[1, 2]', 'json'], ['value=one%20two', 'form'], ['// literal body\n@not = a variable\n# still body', 'text'],
])('detects a headerless %s body as %s', (text, type) => {
  const file = parseHttpFile('POST /test\n\n' + text);
  expect(file.variables).toEqual([]);
  expect(file.requests[0].body.type).toBe(type);
  if (type !== 'form') expect(file.requests[0].body.text).toBe(text);
});

it.each(['json', 'form', 'xml', 'text'] as const)('round-trips a template-mode %s export including headers and query placeholders', type => {
  const { data, ws } = importWorkspace();
  const folder = newFolder(ws, null, { variables: [kv('origin', 'https://localhost'), { ...kv('token', randomUUID()), secret: true }],
    auth: { type: 'bearer', token: '{{token}}' } });
  data.folders.push(folder);
  const source = newRequest(ws, folder.id, { url: '{{origin}}/test?q={{id}}', method: 'PATCH', headers: [kv('X-Row', 'a'), kv('X-Row', 'b')],
    body: { ...emptyBody(), type, text: type === 'json' ? '{\n  "q": "{{value}}"\n}\n' : type === 'xml' ? '<q>{{value}}</q>\n' : 'text\n\n',
      form: [kv('q', 'x & y'), kv('q', '{{token}}')] } });
  const exported = exportHttpFile(data, source, { secretMode: 'template' }).text!;
  const out = importHttpFile(data, ws, exported).data;
  const restored = out.requests[0];
  expect(restored).toMatchObject({ method: 'PATCH', url: source.url, body: { type }, auth: folder.auth });
  const again = exportHttpFile(out, restored, { secretMode: 'template' }).text!;
  const [before, after] = [exported, again].map(text => parseHttpFile(text).requests[0]);
  expect(after.url).toBe(before.url);
  expect(after.body).toMatchObject({ type: before.body.type, text: before.body.text });
  expect(after.body.form.map(p => [p.key, p.value])).toEqual(before.body.form.map(p => [p.key, p.value]));
  expect(after.headers.map(h => h.key + ': ' + h.value).sort()).toEqual(before.headers.map(h => h.key + ': ' + h.value).sort());
  expect(after.headers.filter(h => h.key === 'X-Row').map(h => h.value)).toEqual(['a', 'b']);
});

it('keeps template-mode Basic credentials editable after import', () => {
  const { data, ws } = importWorkspace();
  const out = importHttpFile(data, ws, 'GET https://localhost\nAuthorization: Basic alice {{password}}').data;
  expect(out.requests[0].auth).toEqual({ type: 'basic', username: 'alice', password: '{{password}}' });
});

it('preserves raw CRLF payloads and merges query continuations before an existing fragment', () => {
  const { data, ws } = importWorkspace();
  const body = 'first\r\n\r\nsecond\r\n';
  const text = 'POST https://localhost/path#fragment\r\n &a=1\r\n ?a=2\r\nContent-Type: text/plain\r\n\r\n' + body;
  const out = importHttpFile(data, ws, text).data;
  expect(out.requests[0].url).toBe('https://localhost/path?a=1&a=2#fragment');
  expect(out.requests[0].body.text).toBe(body);
  expect(looksLikeHttpFile('curl https://localhost')).toBe(false);
});

it('preserves references embedded in header values, including an already encoded Basic variable', () => {
  const { data, ws } = importWorkspace();
  const text = '@session = value\n@credentials = dTpw\n###\nGET https://localhost\nCookie: sid={{session}}\nAuthorization: Basic {{ credentials }}';
  const out = importHttpFile(data, ws, text).data;
  expect(out.folders[0].variables).toMatchObject([{ key: 'session', secret: true }, { key: 'credentials', secret: true }]);
  expect(out.requests[0].headers.map(h => h.value)).toEqual(['sid={{session}}', 'Basic {{ credentials }}']);
});
