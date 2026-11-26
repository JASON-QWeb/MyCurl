import { describe, expect, it } from 'vitest';
import { defaultSettings, emptyBody, newFolder, newRequest, newWorkspace } from '../src/lib/factory';
import { exportHttpFile } from '../src/lib/httpFileExport';
import type { AppData } from '../src/lib/types';
import { kv } from '../src/lib/util';

const ws = newWorkspace();
const folder = newFolder(ws.id, null, {
  variables: [kv('origin', 'https://api.github.com'), { ...kv('token', 'abcdef123456789'), secret: true }],
  auth: { type: 'bearer', token: '{{token}}' },
});
const data: AppData = { version: 1, settings: defaultSettings(), workspaces: [ws], folders: [folder], environments: [], requests: [] };
const req = newRequest(ws.id, folder.id, {
  method: 'PATCH', url: '{{origin}}/user', headers: [kv('X-Value', '1'), kv('X-Value', '2')],
  body: { ...emptyBody(), type: 'json', text: '{\n  "bio": "line"\n}\n' },
});

describe('HTTP Client export', () => {
  it('serializes the request line, ordered repeated headers and exact body including its trailing newline', () => {
    expect(exportHttpFile(data, req, { secretMode: 'resolve' }).text).toBe([
      'PATCH https://api.github.com/user', 'X-Value: 1', 'X-Value: 2', 'Authorization: Bearer abcdef123456789',
      'Content-Type: application/json', '', req.body.text,
    ].join('\n'));
  });

  it('masks credentials by default and keeps editable origin and secret placeholders in template mode', () => {
    expect(exportHttpFile(data, req).text).toContain('Authorization: ••••');
    expect(exportHttpFile(data, req).text).not.toContain('abcdef123456789');
    const text = exportHttpFile(data, req, { secretMode: 'template' }).text;
    expect(text).toContain('PATCH {{origin}}/user\n');
    expect(text).toContain('Authorization: Bearer {{token}}');
  });

  it('preserves an explicit content type and form and query placeholders', () => {
    const form = { ...req, url: 'https://api.github.com/user?a=1#section', headers: [kv('content-type', 'application/custom')],
      auth: { type: 'apikey' as const, key: 'key', value: '{{token}}', in: 'query' as const },
      body: { ...emptyBody(), type: 'form' as const, form: [kv('name', 'one two'), kv('auth', '{{token}}')] } };
    expect(exportHttpFile(data, form, { secretMode: 'template' }).text).toBe([
      'PATCH https://api.github.com/user?a=1&key={{token}}#section', 'content-type: application/custom', '', 'name=one%20two&auth={{token}}',
    ].join('\n'));
  });

  it('formats Basic auth placeholders and preserves explicit authorization headers', () => {
    const basic = { ...req, auth: { type: 'basic' as const, username: 'user', password: '{{token}}' }, headers: [] };
    expect(exportHttpFile(data, basic, { secretMode: 'template' }).text).toContain('Authorization: Basic user {{token}}');
    const override = { ...basic, headers: [kv('Authorization', 'Bearer {{token}}')] };
    expect(exportHttpFile(data, override, { secretMode: 'template' }).text).not.toContain('Basic');
  });

  it('keeps a request with no body free of a synthesized payload', () => {
    const get = newRequest(ws.id, null, { url: 'http://localhost/' });
    expect(exportHttpFile(data, get).text).toBe('GET http://localhost/');
  });

  it('declines multipart and content the client would interpret as .http syntax', () => {
    expect(exportHttpFile(data, { ...req, body: { ...emptyBody(), type: 'multipart' } }).error).toBe('multipart');
    expect(exportHttpFile(data, { ...req, headers: [kv('X-Value', 'one\ntwo')] }).error).toBe('syntax');
    for (const text of ['one\n###\ntwo', '< ./local-file', '> {% handler %}', '>> output']) {
      expect(exportHttpFile(data, { ...req, body: { ...emptyBody(), type: 'text', text } }).error).toBe('syntax');
    }
  });
});
