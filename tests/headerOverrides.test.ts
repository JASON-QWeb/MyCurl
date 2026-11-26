import { expect, it } from 'vitest';
import { newFolder, newRequest, seedData } from '../src/lib/factory';
import { prepareRequest } from '../src/lib/requestRunner';
import { kv } from '../src/lib/util';

it('overrides inherited headers by rendered case-insensitive name while preserving repeated request headers', () => {
  const data = seedData();
  const ws = data.workspaces[0].id;
  const parent = newFolder(ws, null, { headers: [kv('Accept', 'text/html'), kv('X-Mode', 'parent')] });
  const child = newFolder(ws, parent.id, {
    headers: [kv('ACCEPT', '{{unused}}'), kv('x-mode', 'child')],
    variables: [kv('name', 'accept')],
  });
  data.folders.push(parent, child);
  const req = newRequest(ws, child.id, {
    headers: [kv('{{name}}', 'application/json'), kv('Accept', 'text/plain'), kv('X-MODE', 'off', false)],
  });
  const result = prepareRequest(data, req);
  expect(result.headers).toEqual([['x-mode', 'child'], ['accept', 'application/json'], ['Accept', 'text/plain']]);
  expect(result.missingVars).toEqual([]);
});
