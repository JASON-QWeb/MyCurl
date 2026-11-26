import { describe, expect, it } from 'vitest';
import { importOpenApiDocument, isOpenApiDocument } from '../src/lib/openapiImport';
import { prepareRequest, resolveEffectiveAuth } from '../src/lib/requestRunner';
import { kv } from '../src/lib/util';
import { importWorkspace } from './importWorkspace';

describe('OpenAPI file import', () => {
  it('requires a supported version and a paths object', () => {
    for (const doc of [null, [], { openapi: 3, paths: {} }, { openapi: '4.0', paths: {} },
      { openapi: '3.0' }, { swagger: '2.0', paths: [] }]) expect(isOpenApiDocument(doc)).toBe(false);
    for (const version of [{ openapi: '3.0.3' }, { openapi: '3.1.1' }, { swagger: '2.0' }]) {
      expect(isOpenApiDocument({ ...version, paths: {} })).toBe(true);
    }
  });

  it('resolves server defaults, reuses first-tag folders and imports executable parameters with operation overrides', () => {
    const { data, ws } = importWorkspace();
    const result = importOpenApiDocument(data, ws, {
      openapi: '3.1.0', info: { title: 'Catalog', description: 'Catalog reference' },
      servers: [{ url: 'https://{host}:{port}/{version}/', variables: {
        host: { default: 'localhost' }, port: { default: '8443' }, version: { default: 'v2' },
      } }],
      components: { parameters: { page: { in: 'query', name: 'page', schema: { default: 8 } } } },
      paths: { '/things/{id}': {
        parameters: [{ $ref: '#/components/parameters/page' }, { in: 'path', name: 'id' }],
        get: { tags: ['Things', 'Ignored'], summary: 'Find', operationId: 'findThing', description: 'Lookup by id', parameters: [
          { in: 'query', name: 'page', example: 0 }, { in: 'query', name: 'q', schema: { example: 'a&b' } },
          { in: 'query', name: 'optional' }, { in: 'query', name: 'required', required: true },
          { in: 'header', name: 'X-Debug', schema: { default: false } },
        ] },
        patch: { tags: ['Things'], operationId: 'changeThing' }, trace: {},
      }, '/status': { head: {}, options: {} } },
    });
    expect(result).toMatchObject({ folderCount: 2, requestCount: 4 });
    expect(data.folders).toEqual([]);
    const [root, group] = result.data.folders;
    expect(root).toMatchObject({ name: 'Catalog', description: 'Catalog reference', host: 'localhost:8443',
      variables: [expect.objectContaining({ key: 'base_url', value: 'https://localhost:8443/v2' })] });
    expect(group).toMatchObject({ name: 'Things', parentId: root.id });
    const [get, patch, head, options] = result.data.requests;
    expect(get).toMatchObject({ folderId: group.id, name: 'Find', description: 'Lookup by id',
      headers: [expect.objectContaining({ key: 'X-Debug', value: 'false', enabled: true })] });
    expect(get.params.map(p => [p.key, p.value, p.enabled])).toEqual([
      ['page', '0', true], ['q', 'a%26b', true], ['optional', '', false], ['required', '', true],
    ]);
    root.variables.push(kv('id', '42'));
    expect(prepareRequest(result.data, get).url).toBe('https://localhost:8443/v2/things/42?page=0&q=a%26b&required');
    expect(patch).toMatchObject({ folderId: group.id, name: 'changeThing' });
    expect(head).toMatchObject({ folderId: root.id, name: 'HEAD /status' });
    expect(options.method).toBe('OPTIONS');
  });

  it('synthesizes nested JSON through reusable local references, stops cycles and skips read-only fields', () => {
    const { data, ws } = importWorkspace();
    const ref = { $ref: '#/components/schemas/Tree~1Node' };
    const { data: out } = importOpenApiDocument(data, ws, {
      openapi: '3.0.3', components: { schemas: {
        'Tree/Node': { type: 'object', properties: {
          name: { type: 'string', example: 'root' }, children: { type: 'array', items: ref },
          rank: { type: 'integer', default: 0 }, readonly: { type: 'string', readOnly: true },
        } }, loop: { $ref: '#/components/schemas/loop' },
      }, requestBodies: { tree: { content: { 'application/json': { schema: { properties: {
        left: ref, right: ref, cycle: { $ref: '#/components/schemas/loop' },
        external: { $ref: './external.json#/schema' },
      } } } } } } },
      paths: { '/tree/{parent}/{{existing}}': { put: { requestBody: { $ref: '#/components/requestBodies/tree' } } } },
    });
    const req = out.requests[0];
    expect(req.url).toBe('/tree/{{parent}}/{{existing}}');
    const tree = { name: 'root', children: [], rank: 0 };
    expect(JSON.parse(req.body.text)).toEqual({ left: tree, right: tree });
  });

  it('chooses JSON media examples before schema values and preserves false, zero and null', () => {
    const { data, ws } = importWorkspace();
    const cases = [{ example: false }, { examples: { sample: { $ref: '#/components/examples/zero' } } }, { example: null }];
    for (const [index, media] of cases.entries()) {
      const { data: out } = importOpenApiDocument(data, ws, { openapi: '3.1.0',
        components: { examples: { zero: { value: 0 } } }, paths: { '/': { post: { requestBody: { content: {
          'text/plain': { example: 'fallback' }, 'application/json': { schema: { default: 'schema' }, ...media },
        } } } } } });
      expect(JSON.parse(out.requests[0].body.text)).toEqual([false, 0, null][index]);
    }
  });

  it.each([
    ['application/x-www-form-urlencoded', 'form'], ['multipart/form-data', 'multipart'],
    ['application/xml', 'xml'], ['text/plain', 'text'],
  ])('imports %s media into %s bodies', (mime, type) => {
    const { data, ws } = importWorkspace();
    const fields = { schema: { properties: { count: { default: 2 }, upload: { type: 'string', format: 'binary' } } } };
    const media = type === 'xml' ? { example: '<hello/>' } : type === 'text' ? { example: 'hello' } : fields;
    const { data: out } = importOpenApiDocument(data, ws, { openapi: '3.0.0',
      paths: { '/': { post: { requestBody: { content: { [mime]: media } } } } } });
    const body = out.requests[0].body;
    expect(body.type).toBe(type);
    if (type === 'form') expect(body.form[0]).toMatchObject({ key: 'count', value: '2' });
    else if (type === 'multipart') expect(body.multipart[1]).toMatchObject({ key: 'upload', isFile: true });
    else expect(body.text).toBe(type === 'xml' ? '<hello/>' : 'hello');
  });

  it('maps global auth, operation overrides and an explicit anonymous operation', () => {
    const { data, ws } = importWorkspace();
    const { data: out } = importOpenApiDocument(data, ws, { openapi: '3.0.1', security: [{ bearer: [] }],
      components: { securitySchemes: { bearer: { type: 'http', scheme: 'Bearer' }, basic: { type: 'http', scheme: 'basic' },
        header: { type: 'apiKey', in: 'header', name: 'X-Access' }, query: { type: 'apiKey', in: 'query', name: 'access' } } },
      paths: { '/': { get: {}, post: { security: [] }, put: { security: [{ basic: [] }] },
        patch: { security: [{ header: [] }] }, delete: { security: [{ query: [] }] } } },
    });
    expect(out.folders[0].variables).toMatchObject([{ key: 'api_key', secret: true, value: '' }]);
    const [get, post, put, patch, del] = out.requests;
    expect(resolveEffectiveAuth(out, get).auth).toEqual({ type: 'bearer', token: '{{api_key}}' });
    expect(post.auth).toEqual({ type: 'none' });
    expect(put.auth).toEqual({ type: 'basic' });
    expect(patch.auth).toEqual({ type: 'apikey', key: 'X-Access', in: 'header', value: '{{api_key}}' });
    expect(del.auth).toEqual({ type: 'apikey', key: 'access', in: 'query', value: '{{api_key}}' });
    out.folders[0].variables[0].value = 'entered';
    expect(prepareRequest(out, get).headers).toContainEqual(['Authorization', 'Bearer entered']);
    expect(prepareRequest(out, post).headers).toEqual([]);
  });

  it('imports Swagger definitions, body and formData parameters, schemes and securityDefinitions', () => {
    const { data, ws } = importWorkspace();
    const { data: out } = importOpenApiDocument(data, ws, { swagger: '2.0', host: 'localhost:8080', basePath: '/v1/',
      schemes: ['http', 'https'], securityDefinitions: { basic: { type: 'basic' } }, security: [{ basic: [] }],
      definitions: { Payload: { properties: { enabled: { type: 'boolean' } } } },
      paths: { '/save': { post: { parameters: [{ in: 'body', name: 'body', schema: { $ref: '#/definitions/Payload' } }] } },
        '/form': { post: { consumes: ['application/x-www-form-urlencoded'], parameters: [{ in: 'formData', name: 'q', default: 0 }] } },
        '/upload': { post: { consumes: ['multipart/form-data'], parameters: [{ in: 'formData', name: 'upload', type: 'file', required: true }] } } },
    });
    expect(out.folders[0]).toMatchObject({ name: 'OpenAPI Import', auth: { type: 'basic' }, host: 'localhost:8080' });
    expect(out.folders[0].variables[0].value).toBe('https://localhost:8080/v1');
    expect(JSON.parse(out.requests[0].body.text)).toEqual({ enabled: false });
    expect(out.requests[1].body.form[0]).toMatchObject({ key: 'q', value: '0', enabled: true });
    expect(out.requests[2].body.multipart[0]).toMatchObject({ key: 'upload', isFile: true, enabled: true });
  });
});
