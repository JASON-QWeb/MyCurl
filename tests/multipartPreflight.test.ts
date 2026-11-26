import { afterEach, expect, it, vi } from 'vitest';
import { emptyBody, newRequest, seedData } from '../src/lib/factory';
import { executeRequest } from '../src/lib/requestRunner';
import { kv } from '../src/lib/util';

const data = seedData();
data.settings.language = 'en';
const file = { ...kv('document', ''), isFile: true, fileName: 'README.md' };
const req = newRequest(data.workspaces[0].id, null, {
  method: 'POST', url: 'http://localhost/upload',
  body: { ...emptyBody(), type: 'multipart', multipart: [file] },
});

afterEach(() => vi.unstubAllGlobals());

it('reports unselected multipart attachments before opening the transport', async () => {
  const transport = vi.fn();
  vi.stubGlobal('fetch', transport);
  const result = await executeRequest(data, req, new AbortController().signal);
  expect(result.error).toContain('document');
  expect(transport).not.toHaveBeenCalled();
});

it('allows an explicitly selected zero-byte file and ignores disabled missing files', async () => {
  const transport = vi.fn(() => Promise.resolve(new Response('{"t":"end"}\n')));
  vi.stubGlobal('fetch', transport);
  const body = { ...req.body, multipart: [{ ...file, fileData: '' }, { ...file, enabled: false }] };
  const result = await executeRequest(data, { ...req, body }, new AbortController().signal);
  expect(result.error).toBeUndefined();
  expect(transport).toHaveBeenCalledOnce();
});
