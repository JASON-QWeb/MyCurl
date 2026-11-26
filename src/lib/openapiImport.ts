import { emptyBody, newFolder, newRequest } from './factory';
import { mediaExample, resolveSpecObject, type SpecObject } from './openapiSchema';
import { tr } from './translate';
import type { AppData, Auth, Folder, HttpRequest, RequestBody } from './types';
import { syncUrlFromParams } from './urlParams';
import { isRecord, kv } from './util';

type OpenApiDoc = SpecObject & { paths: SpecObject };
const methods = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

export function isOpenApiDocument(obj: unknown): obj is OpenApiDoc {
  return isRecord(obj) && isRecord(obj.paths)
    && ((typeof obj.openapi === 'string' && obj.openapi.startsWith('3.')) || obj.swagger === '2.0');
}

function baseUrl(doc: OpenApiDoc): string {
  if (doc.swagger === '2.0') {
    if (!doc.host) return '';
    const schemes = Array.isArray(doc.schemes) ? doc.schemes : [];
    const scheme = schemes.includes('https') ? 'https' : schemes[0] || 'https';
    return (scheme + '://' + doc.host + (doc.basePath || '')).replace(/\/+$/, '');
  }
  const server = Array.isArray(doc.servers) ? doc.servers[0] : undefined;
  if (!isRecord(server) || typeof server.url !== 'string') return '';
  const variables = isRecord(server.variables) ? server.variables : {};
  const url = server.url.trim().replace(/\{([^{}]+)\}/g, (match, key: string) => {
    const v = variables[key];
    return isRecord(v) && v.default !== undefined ? String(v.default) : match;
  });
  return url === '/' ? url : url.replace(/\/+$/, '');
}

function securityAuth(doc: OpenApiDoc, security: unknown, root: Folder): Auth {
  if (!Array.isArray(security)) return { type: 'inherit' };
  const schemes = isRecord(doc.components) ? doc.components.securitySchemes : doc.securityDefinitions;
  for (const requirement of security) {
    if (!isRecord(requirement)) continue;
    if (!Object.keys(requirement).length) return { type: 'none' };
    for (const key of Object.keys(requirement)) {
      const s = isRecord(schemes) && resolveSpecObject(doc, schemes[key]);
      if (!s) continue;
      const http = s.type === 'http' ? String(s.scheme).toLowerCase() : s.type;
      if (http === 'basic') return { type: 'basic' };
      const token = '{{api_key}}';
      let auth: Auth;
      if (http === 'bearer') auth = { type: 'bearer', token };
      else if (s.type === 'apiKey' && typeof s.name === 'string' && (s.in === 'header' || s.in === 'query')) {
        auth = { type: 'apikey', key: s.name, value: token, in: s.in };
      } else continue;
      if (!root.variables.some(v => v.key === 'api_key')) root.variables.push({ ...kv('api_key'), secret: true });
      return auth;
    }
  }
  return { type: 'none' };
}

function parameters(doc: OpenApiDoc, path: SpecObject, op: SpecObject) {
  const result = new Map<string, SpecObject>();
  for (const list of [path.parameters, op.parameters]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const p = resolveSpecObject(doc, entry);
      if (p && typeof p.name === 'string') result.set(p.in + ':' + (p.in === 'header' ? p.name.toLowerCase() : p.name), p);
    }
  }
  return [...result.values()];
}

function asText(value: unknown): string {
  if (value === undefined || value === null) return '';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function parameterRow(doc: OpenApiDoc, p: SpecObject) {
  const schema = resolveSpecObject(doc, p.schema);
  const value = p.example ?? schema?.example ?? schema?.default ?? p.default ?? p['x-example'];
  return kv(String(p.name), asText(value), !!p.required || value != null);
}

function bodyType(mime: string): RequestBody['type'] {
  const type = mime.split(';')[0].trim().toLowerCase();
  if (type === 'application/json' || type.endsWith('+json')) return 'json';
  if (type === 'application/x-www-form-urlencoded') return 'form';
  if (type === 'multipart/form-data') return 'multipart';
  if (type.endsWith('/xml') || type.endsWith('+xml')) return 'xml';
  if (type === 'text/plain') return 'text';
  return 'none';
}

function mediaBody(doc: OpenApiDoc, mime: string, media: SpecObject): RequestBody {
  const type = bodyType(mime);
  const body = { ...emptyBody(), type };
  const sample = mediaExample(doc, media);
  if (type === 'form' || type === 'multipart') {
    const schema = resolveSpecObject(doc, media.schema);
    const props = isRecord(schema?.properties) ? schema.properties : {};
    const values = isRecord(sample) ? sample : {};
    const names = new Set([...Object.keys(props), ...Object.keys(values)]);
    for (const key of names) {
      const property = resolveSpecObject(doc, props[key]);
      if (property?.readOnly) continue;
      const field = kv(key, asText(values[key]));
      if (type === 'form') body.form.push(field);
      else body.multipart.push(property?.format === 'binary' || property?.type === 'file'
        ? { ...field, value: '', isFile: true, fileName: field.value } : field);
    }
  } else if (type === 'json') {
    body.text = sample === undefined ? '' : JSON.stringify(sample, null, 2);
  } else if (type !== 'none' && typeof sample !== 'object') body.text = asText(sample);
  return body;
}

function operationBody(doc: OpenApiDoc, op: SpecObject, params: SpecObject[]) {
  const content = resolveSpecObject(doc, op.requestBody)?.content;
  if (isRecord(content)) {
    const mime = Object.keys(content).find(k => bodyType(k) === 'json') ?? Object.keys(content).find(k => bodyType(k) !== 'none');
    if (mime && isRecord(content[mime])) return { mime, body: mediaBody(doc, mime, content[mime]) };
  }
  const consumes = op.consumes ?? doc.consumes;
  const types: string[] = Array.isArray(consumes) ? consumes.filter((x): x is string => typeof x === 'string') : [];
  const fields = params.filter(p => p.in === 'formData');
  if (fields.length) {
    const multipart = types.includes('multipart/form-data') || fields.some(p => p.type === 'file');
    const body = emptyBody();
    body.type = multipart ? 'multipart' : 'form';
    for (const p of fields) {
      const row = parameterRow(doc, p);
      if (multipart) body.multipart.push(p.type === 'file' ? { ...row, value: '', isFile: true, fileName: row.value } : row);
      else body.form.push(row);
    }
    return { body };
  }
  const param = params.find(p => p.in === 'body');
  if (param) {
    const mime = types.find(k => bodyType(k) === 'json') ?? types.find(k => bodyType(k) !== 'none') ?? 'application/json';
    return { mime, body: mediaBody(doc, mime, param) };
  }
  return { body: emptyBody() };
}

function operation(doc: OpenApiDoc, root: Folder, folder: Folder, path: SpecObject, key: string, op: SpecObject, method: string, base: string) {
  const params = parameters(doc, path, op);
  // MyCurl's query editor stores wire values, so a later edit must also preserve literal '&' and '#'.
  const encode = (s: string) => s.split(/(\{\{[^{}]+\}\})/).map(part => part.startsWith('{{') ? part : encodeURIComponent(part)).join('');
  const query = params.filter(p => p.in === 'query').map(p => {
    const row = parameterRow(doc, p);
    return { ...row, key: encode(row.key), value: encode(row.value) };
  });
  const headers = params.filter(p => p.in === 'header').map(p => parameterRow(doc, p));
  const { mime, body } = operationBody(doc, op, params);
  if (mime && body.type !== 'multipart' && !headers.some(h => h.key.toLowerCase() === 'content-type')) headers.push(kv('Content-Type', mime));
  const route = key.replace(/(?<!\{)\{([^{}\/]+)\}(?!\})/g, '{{$1}}');
  const url = base ? '{{base_url}}' + (base === '/' ? route.slice(1) : route) : route;
  return newRequest(root.workspaceId, folder.id, {
    name: String(op.summary || op.operationId || (method + ' ' + key)),
    method, url: syncUrlFromParams(url, query),
    params: query, headers, body, auth: securityAuth(doc, op.security, root),
    description: typeof op.description === 'string' ? op.description : '',
  });
}

export function importOpenApiDocument(data: AppData, workspaceId: string, doc: unknown) {
  if (!isOpenApiDocument(doc)) return { data, folderCount: 0, requestCount: 0 };
  const info = isRecord(doc.info) ? doc.info : {};
  const base = baseUrl(doc);
  const root = newFolder(workspaceId, null, {
    name: String(info.title || tr(data.settings.language, 'OpenAPI 导入', 'OpenAPI Import')),
    description: typeof info.description === 'string' ? info.description : '',
    variables: base ? [kv('base_url', base)] : [],
  });
  try {
    const url = new URL(base);
    if (/^https?:$/.test(url.protocol) && !/[{}]/.test(url.host)) root.host = url.host;
  } catch { /* Relative server URLs are valid in OpenAPI. */ }
  root.auth = securityAuth(doc, doc.security, root);
  const tags = new Map<string, Folder>();
  const requests: HttpRequest[] = [];
  for (const [key, item] of Object.entries(doc.paths)) {
    const path = resolveSpecObject(doc, item);
    if (!key.startsWith('/') || !path) continue;
    for (const method of methods) {
      const op = path[method];
      if (!isRecord(op)) continue;
      const tag = Array.isArray(op.tags) && typeof op.tags[0] === 'string' ? op.tags[0] : '';
      if (tag && !tags.has(tag)) tags.set(tag, newFolder(workspaceId, root.id, { name: tag }));
      requests.push(operation(doc, root, tags.get(tag) ?? root, path, key, op, method.toUpperCase(), base));
    }
  }
  return {
    data: { ...data, folders: [...data.folders, root, ...tags.values()], requests: [...data.requests, ...requests] },
    folderCount: 1 + tags.size, requestCount: requests.length,
  };
}
