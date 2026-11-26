import { describe, expect, it } from 'vitest';
import { exportAsFetch, exportAsPython } from '../src/lib/curlExport';
import { emptyBody, newRequest, seedData } from '../src/lib/factory';

describe('JSON request code export', () => {
  const data = seedData();
  const folder = data.folders[0];
  const body = '{\r\n "id": 9223372036854775807, "id": -0, "number": 1.00e+03,\r\n "null": "true false null 🐈", "origin": "{{base_url}}"\r\n}\n';
  const req = newRequest(folder.workspaceId, folder.id, {
    method: 'POST',
    url: 'http://localhost',
    body: { ...emptyBody(), type: 'json', text: body },
  });

  it('sends the exact prepared text, including duplicate keys, number spelling and whitespace', () => {
    const literal = JSON.stringify(body.replace('{{base_url}}', folder.variables[0].value));
    const js = exportAsFetch(data, req);
    const py = exportAsPython(data, req);
    expect(js).toContain('  body: ' + literal + ',');
    expect(py).toContain('payload = ' + literal + '.encode("utf-8")');
    expect(py).toContain('headers=headers, data=payload');
    for (const script of [js, py]) expect(script).toContain('"Content-Type": "application/json"');
  });

  it('preserves explicit media types and incomplete JSON used to exercise error responses', () => {
    const custom = {
      ...req,
      headers: [{ id: 'ct', key: 'content-TYPE', value: 'application/merge-patch+json', enabled: true }],
      body: { ...req.body, text: '{"value":' },
    };
    for (const script of [exportAsFetch(data, custom), exportAsPython(data, custom)]) {
      expect(script).toContain('"content-TYPE": "application/merge-patch+json"');
      expect(script).not.toContain('"Content-Type":');
      expect(script).toContain(JSON.stringify(custom.body.text));
    }
  });
});
