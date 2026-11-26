import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { exportMyCurlJson } from '../src/lib/collectionIO';
import { importAll } from '../src/lib/curlImport';
import { parseCurlCommands } from '../src/lib/curlParser';
import { defaultSettings, newEnvironment, newWorkspace } from '../src/lib/factory';
import type { AppData } from '../src/lib/types';

function importCommand(command: string, extractSecrets = true) {
  const ws = newWorkspace();
  const data: AppData = {
    version: 1, workspaces: [ws], settings: defaultSettings(), requests: [], folders: [],
    environments: [newEnvironment(ws.id, { isBase: true })],
  };
  return importAll(data, parseCurlCommands(command), ws.id, {
    extractSecrets, extractBaseUrl: true, groupByHost: true,
  }).data;
}

it('redacts extracted credentials wherever copied, including encoded URLs and body text', () => {
  const token = randomUUID() + '/part';
  const encoded = encodeURIComponent(token);
  const data = importCommand(`curl 'http://localhost/path?note=${encoded}' -H 'Authorization: Bearer ${token}' --json '{"nested":["${token}"],"visible":"readable","id":9007199254740993}'`);
  const req = data.requests[0];
  req.description += '\nKeep these notes';
  const full = exportMyCurlJson(data, false);
  const masked = exportMyCurlJson(data, true);
  expect(masked).not.toContain(token);
  expect(masked).not.toContain(encoded);
  const backup = JSON.parse(masked) as AppData;
  expect(backup.requests[0].source).toBeUndefined();
  expect(backup.requests[0].description).not.toContain('curl ');
  expect(backup.requests[0].description).toContain('Keep these notes');
  expect(backup.requests[0].auth.token).toBe(req.auth.token);
  expect(backup.requests[0].body.text).toMatch(/"id":\s*9007199254740993\b/);
  expect(JSON.parse(backup.requests[0].body.text).visible).toBe('readable');
  expect(full).toContain(token);
  expect(JSON.parse(full)).toEqual(JSON.parse(JSON.stringify(data)));
});

it('also redacts literal auth, sensitive headers, query, body fields and the proxy password', () => {
  const [pass, cookie, query, json, proxy] = Array.from({ length: 5 }, () => randomUUID());
  const data = importCommand(`curl -u 'user:${pass}' -H 'Cookie: sid=${cookie}' 'http://localhost/?api_key=${query}' --json '{"password":"${json}","label":"visible"}'`, false);
  data.settings.proxy = `http://proxyuser:${proxy}@localhost:3128`;
  const masked = exportMyCurlJson(data, true);
  for (const secret of [pass, cookie, query, json, proxy]) expect(masked).not.toContain(secret);
  expect(masked).toContain('visible');
  expect(masked).toContain('proxyuser');
});

it('omits embedded multipart bytes while keeping metadata and the complete backup', () => {
  const data = importCommand("curl -F 'attachment=@attachment.txt' http://localhost/");
  const field = data.requests[0].body.multipart[0];
  field.fileData = btoa(randomUUID());
  const masked = JSON.parse(exportMyCurlJson(data, true)) as AppData;
  expect(masked.requests[0].body.multipart[0]).toEqual({ ...field, fileData: undefined });
  expect(exportMyCurlJson(data, true)).not.toContain(field.fileData);
  expect(exportMyCurlJson(data, false)).toContain(field.fileData);
});
