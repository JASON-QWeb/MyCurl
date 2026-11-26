import { describe, expect, it } from 'vitest';
import { exportAsFetch, exportAsPython } from '../src/lib/curlExport';
import { runInNewContext } from 'node:vm';
import { emptyBody, newRequest, seedData } from '../src/lib/factory';
import type { MultipartField } from '../src/lib/types';

function generate(fields: MultipartField[], exporter = exportAsPython) {
  const data = seedData();
  data.settings.language = 'en';
  const req = newRequest(data.workspaces[0].id, null, {
    method: 'POST',
    url: 'http://localhost/upload',
    headers: [
      { id: 'type', enabled: true, key: 'content-TYPE', value: 'multipart/form-data; boundary=stale' },
      { id: 'length', enabled: true, key: 'Content-Length', value: '1' },
      { id: 'accept', enabled: true, key: 'Accept', value: 'application/json' },
    ],
    body: { ...emptyBody(), type: 'multipart', multipart: fields },
  });
  return exporter(data, req);
}

describe('Python multipart export', () => {
  it('encodes enabled parts in order and keeps duplicate names', () => {
    const fields = [
      { id: '1', enabled: true, key: 'part', value: '你好\n"quoted"' },
      { id: '2', enabled: true, key: 'part', value: '', isFile: true, fileName: 'local/README.md', contentType: 'text/markdown', fileData: 'bm90LWZvcg==' },
      { id: '3', enabled: false, key: 'disabled', value: 'omit' },
      { id: '4', enabled: true, key: 'part', value: '' },
    ];

    const script = generate(fields);
    expect(script).toContain([
      'fields = [',
      '    ("part", "你好\\n\\"quoted\\""),',
      '    ("part", ("README.md", Path("README.md").read_bytes(), "text/markdown")),',
      '    ("part", ""),',
      ']',
    ].join('\n'));
    expect(script).toContain('from pathlib import Path');
    expect(script).toContain('payload, headers["Content-Type"] = encode_multipart_formdata(fields)');
    expect(script).toContain('resp = requests.request("POST", url, headers=headers, data=payload)');
    expect(script).toContain('"Accept": "application/json"');
    expect(script).not.toMatch(/disabled|bm90LWZvcg==|local\/README|boundary=stale|Content-Length/);
  });

  it('encodes even an empty multipart body without requiring a local file', () => {
    const script = generate([]);
    expect(script).toContain('fields = [\n]');
    expect(script).toContain('encode_multipart_formdata(fields)');
    expect(script).not.toContain('pathlib');
  });
});

describe('Fetch multipart export', () => {
  it('sends ordered FormData and lets fetch generate the multipart headers', async () => {
    const script = generate([
      { id: '1', enabled: true, key: 'part', value: 'first\n"你好"' },
      { id: '2', enabled: true, key: 'part', value: '', isFile: true, fileName: 'dir/README.md', contentType: 'text/markdown', fileData: 'eA==' },
      { id: '3', enabled: false, key: 'disabled', value: 'omit' },
      { id: '4', enabled: true, key: 'part', value: '' },
    ], exportAsFetch);
    expect(script).toContain('new Blob([/* local file: README.md */], { type: "text/markdown" })');
    expect(script).not.toMatch(/dir\/README|eA==|boundary=stale|content-type|content-length/i);
    const capture = { headers: {}, body: new FormData() };
    await runInNewContext(`(async () => { ${script} })()`, {
      FormData, Blob, console: { log() {} },
      fetch: (_url: string, init: RequestInit) => {
        Object.assign(capture, init);
        return { json: () => null };
      },
    });
    expect(capture.headers).toEqual({ Accept: 'application/json' });
    expect([...capture.body.keys()]).toEqual(['part', 'part', 'part']);
    expect(capture.body.getAll('part')).toEqual([
      'first\n"你好"', expect.objectContaining({ name: 'README.md', type: 'text/markdown' }), '',
    ]);
  });

  it('emits an empty FormData for an empty multipart request', () => {
    const script = generate([], exportAsFetch);
    expect(script).toContain('const form = new FormData();');
    expect(script).toContain('body: form,');
    expect(script).not.toContain('form.append');
  });
});
