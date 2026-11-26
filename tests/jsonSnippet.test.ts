import { describe, expect, it } from 'vitest';
import { exportAsFetch, exportAsPython } from '../src/lib/curlExport';
import { emptyBody, newRequest, seedData } from '../src/lib/factory';
import { parseCurl, prettyJson } from '../src/lib/curlParser';
import { runInNewContext } from 'node:vm';

describe('JSON request code export', () => {
  const data = seedData();
  const folder = data.folders[0];
  const body = '{\r\n "id": 9223372036854775807, "id": -0, "number": 1.00e+03,\r\n "null": "true false null 🐈", "origin": "{{base_url}}"\r\n}\n';
  const req = newRequest(folder.workspaceId, folder.id, {
    method: 'POST',
    url: 'http://localhost',
    body: { ...emptyBody(), type: 'json', text: body },
  });

  function snippets(text: string) {
    const request = { ...req, body: { ...req.body, text } };
    return { js: exportAsFetch(data, request), py: exportAsPython(data, request) };
  }

  async function fetchBody(script: string): Promise<string> {
    let body = '';
    await runInNewContext(`(async () => { ${script} })()`, {
      fetch: (_url: string, init: RequestInit) => {
        body = String(init.body);
        return { json: () => null };
      },
      console: { log() {} },
    });
    return body;
  }

  it('exports readable nested JSON and translates only Python literal values', async () => {
    const value = {
      true: 'true false null\n"null" 🐈',
      flags: [true, false, null, {}, []],
      rows: [{ id: 9007199254740991 }, { id: 1.25 }],
      note: '{"id":9007199254740993,"id":null}',
      ['__proto__']: { nested: true },
    };
    const { js, py } = snippets(JSON.stringify(value));
    expect(js).toContain('body: JSON.stringify({\n    "true":');
    expect(JSON.parse(await fetchBody(js))).toEqual(value);
    expect(py).toContain('"true": "true false null\\n\\"null\\" 🐈"');
    expect(py).toContain('"flags": [\n        True,\n        False,\n        None,\n        {},\n        []\n    ]');
    expect(py).toContain('json=payload');
  });

  it.each([
    '{"id":9007199254740993}', '{"id":9007199254740992}', '[-9007199254740993]',
    '{"a":[{"b":1,"\\u0062":2}]}', '[-0]', '[1.00e+03]', '[0.123456789012345678901]',
    '[1e400]', '[1e-400]', '{"value":{{unresolved}}}', '{"invalid":',
  ])('preserves the exact UTF-8 body for %s', async (source) => {
    const raw = ' \r\n' + source + '\t\n';
    const { js, py } = snippets(raw);
    expect(await fetchBody(js)).toBe(raw);
    expect(py).toContain(`payload = ${JSON.stringify(raw)}.encode("utf-8")`);
    expect(py).toContain('headers=headers, data=payload');
    for (const script of [js, py]) expect(script).toContain('"Content-Type": "application/json"');
  });

  it('sends a top-level null body through requests and fetch', async () => {
    const { js, py } = snippets('null');
    expect(await fetchBody(js)).toBe('null');
    expect(py).toContain('payload = None');
    expect(py).toContain('data=b"null", json=payload');
  });

  it('keeps duplicate keys intact from cURL import through snippet export', async () => {
    const raw = '{ "query": "query Q { n }", "variables": {"n":1, "n":2} }';
    const parsed = parseCurl(`curl --json '${raw}' 'http://localhost/graphql'`)!;
    expect(parsed.body.type).toBe('json');
    expect(await fetchBody(snippets(parsed.body.text).js)).toBe(raw);
  });

  it('keeps duplicate keys and decimal precision when formatting in the request editor', async () => {
    const formatted = prettyJson('{"a":1.0000000000000000001,"a":2}')!;
    expect(formatted).toBe('{\n  "a": 1.0000000000000000001,\n  "a": 2\n}');
    expect(await fetchBody(snippets(formatted).js)).toBe(formatted);
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
