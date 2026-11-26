import { describe, expect, it } from 'vitest';
import { exportAsPython } from '../src/lib/curlExport';
import { emptyBody, newRequest, seedData } from '../src/lib/factory';
import type { MultipartField } from '../src/lib/types';

function generate(fields: MultipartField[]) {
  const data = seedData();
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
  return exportAsPython(data, req);
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
