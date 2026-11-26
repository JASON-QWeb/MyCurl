import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MultipartTable } from '../src/components/MultipartTable';
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

it('shows the missing-file warning only on the attachment that still needs selection', () => {
  const attached = { ...file, id: 'selected', fileName: 'empty.txt', fileData: '' };
  const body = { ...req.body, multipart: [file, attached] };
  const html = renderToStaticMarkup(createElement(MultipartTable, { req: { ...req, body }, vars: new Map() }));
  const rows = html.split('</tr>');
  expect(rows[1]).toContain('README.md');
  expect(rows[1]).toContain('class="pill pill-warning"');
  expect(rows[2]).toContain('class="pill">empty.txt</span>');
  expect(rows[2]).not.toContain('pill-warning');
});
