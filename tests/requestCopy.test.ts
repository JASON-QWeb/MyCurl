import { expect, it } from 'vitest';
import { exportAsCurl, exportResolvedUrl } from '../src/lib/curlExport';
import { newFolder, newRequest, seedData } from '../src/lib/factory';
import { kv, maskSecret } from '../src/lib/util';

it('copies the effective URL with the selected secret mode and preserves the original query encoding', () => {
  const data = seedData();
  const ws = data.workspaces[0].id;
  const folder = newFolder(ws, null, { variables: [kv('host', 'example.org'), { ...kv('secret', 'abcdef1234567890'), secret: true }],
    auth: { type: 'apikey', in: 'query', key: 'custom', value: 'inline-credential' } });
  data.folders.push(folder);
  const req = newRequest(ws, folder.id, {
    url: 'https://user:password@{{host}}/{{secret}}?q=a+b%2F&%61pi_key=literal&token=second&custom=first&flag#here',
  });
  const masked = exportResolvedUrl(data, req, 'mask');
  expect(masked).toBe(`https://user:••••@example.org/${maskSecret('abcdef1234567890')}?q=a+b%2F&%61pi_key=••••&token=••••&custom=••••&flag&custom=••••#here`);
  const resolved = 'https://user:password@example.org/abcdef1234567890?q=a+b%2F&%61pi_key=literal&token=second&custom=first&flag&custom=inline-credential#here';
  expect(exportResolvedUrl(data, req, 'resolve')).toBe(resolved);
  expect(exportAsCurl(data, req, { secretMode: 'mask' })).toContain(masked);
  expect(exportAsCurl(data, req, { secretMode: 'resolve' })).toContain(resolved);
});

it('masks literal credential headers and secrets composed from ordinary variables', () => {
  const data = seedData();
  const ws = data.workspaces[0].id;
  data.environments[0].variables = [kv('name', 'private-value'), { ...kv('path', '{{name}}'), secret: true }];
  const req = newRequest(ws, null, { url: 'https://example.org/{{path}}', headers: [kv('Authorization', 'Bearer private-value')] });
  const masked = exportAsCurl(data, req, { secretMode: 'mask' });
  expect(masked).not.toContain('private-value');
  expect(masked).toContain('Authorization: Bearer ••••');
  expect(exportAsCurl(data, req, { secretMode: 'resolve' })).toContain('Authorization: Bearer private-value');
  expect(exportAsCurl(data, req, { secretMode: 'template' })).toContain('{{path}}');
  req.auth = { type: 'apikey', key: 'Custom', value: 'inherited' };
  req.headers = [kv('custom', 'override')];
  expect(exportAsCurl(data, req, { secretMode: 'mask' })).toContain('custom: ••••');
});
