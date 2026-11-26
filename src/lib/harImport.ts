import { friendlyHostName, suggestRequestName } from './curlImport';
import { emptyBody, newFolder, newRequest } from './factory';
import { importBasicAuth, importHeaders, importTextBody, importUrl, storeImportVariable } from './fileImportFields';
import { tr } from './translate';
import type { AppData, Folder, KV, MultipartField, RequestBody } from './types';
import { isRecord, kv } from './util';

type HarObject = Record<string, unknown>;
interface Capture {
  entry: HarObject;
  request: HarObject;
  url: URL;
}
interface HarOptions { groupByHost?: boolean; extractSecrets?: boolean }

export function isHarArchive(obj: unknown): obj is { log: { entries: unknown[] } } {
  return isRecord(obj) && isRecord(obj.log) && Array.isArray(obj.log.entries);
}

function records(value: unknown): HarObject[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function readCapture(entry: unknown): Capture | undefined {
  if (!isRecord(entry) || !isRecord(entry.request) || typeof entry.request.url !== 'string') return;
  try {
    const url = new URL(entry.request.url);
    if (/^https?:$/.test(url.protocol)) return { entry, request: entry.request, url };
  } catch { /* HARs can include browser-internal or incomplete requests. */ }
}

function isStatic({ entry, request, url }: Capture): boolean {
  const type = String(entry._resourceType ?? '').toLowerCase();
  if (['xhr', 'fetch', 'document'].includes(type) || !/^(?:get|head)$/i.test(String(request.method ?? 'GET'))) return false;
  if (isRecord(entry.response) && isRecord(entry.response.content) && /[/+]json\b/i.test(String(entry.response.content.mimeType))) return false;
  return ['image', 'stylesheet', 'script', 'font', 'media'].includes(type)
    || /\.(?:png|jpe?g|gif|svg|ico|woff2?|ttf|css|js|map)$/i.test(url.pathname);
}

const noiseHeaders = ['content-length', 'host', 'connection', 'accept-encoding', 'upgrade-insecure-requests', 'keep-alive',
  'proxy-connection', 'proxy-authorization', 'proxy-authenticate', 'transfer-encoding', 'te', 'trailer', 'upgrade'];

function capturedHeaders(request: HarObject): KV[] {
  const rows = records(request.headers);
  const skip = new Set(noiseHeaders);
  for (const row of rows) {
    if (String(row.name).toLowerCase() === 'connection') {
      for (const key of String(row.value).toLowerCase().split(',')) skip.add(key.trim());
    }
  }
  const headers: KV[] = [];
  for (const { name, value } of rows) {
    if (typeof name !== 'string' || !name || /^(?::|sec-ch-ua|sec-fetch-)/i.test(name) || skip.has(name.toLowerCase())) continue;
    headers.push(kv(name, String(value ?? '')));
  }
  if (!headers.some(h => h.key.toLowerCase() === 'cookie')) {
    const cookies = records(request.cookies).filter(c => c.name).map(c => String(c.name) + '=' + String(c.value ?? ''));
    if (cookies.length) headers.push(kv('Cookie', cookies.join('; ')));
  }
  return headers;
}

function multipartText(text: string, mime: string): MultipartField[] {
  const match = /\bboundary=(?:"([^"]+)"|([^;\s]+))/i.exec(mime);
  const boundary = match?.[1] ?? match?.[2] ?? /^--([^\r\n]+)/.exec(text)?.[1];
  if (!boundary) return [];
  const fields: MultipartField[] = [];
  for (const part of text.split('--' + boundary).slice(1)) {
    if (part.startsWith('--')) break;
    const separator = /\r?\n\r?\n/.exec(part);
    if (!separator) continue;
    const headers = part.slice(0, separator.index);
    const disposition = /^content-disposition:\s*form-data;([^\r\n]*)/im.exec(headers)?.[1] ?? '';
    const name = /(?:^|;)\s*name="([^"]*)"/i.exec(disposition)?.[1];
    if (!name) continue;
    const fileName = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1];
    const value = part.slice(separator.index + separator[0].length).replace(/\r?\n$/, '');
    const contentType = /^content-type:\s*([^\r\n]+)/im.exec(headers)?.[1];
    fields.push({ ...kv(name, fileName === undefined ? value : ''), isFile: fileName !== undefined, fileName, contentType });
  }
  return fields;
}

function capturedBody(post: unknown, headerType: string): RequestBody {
  if (!isRecord(post)) return emptyBody();
  const mime = String(post.mimeType || headerType);
  const text = String(post.text ?? '');
  const fields = records(post.params).filter(p => typeof p.name === 'string');
  if (/^multipart\/form-data\b/i.test(mime)) {
    const multipart = fields.length ? fields.map(p => {
      const isFile = typeof p.fileName === 'string';
      return { ...kv(String(p.name), isFile ? '' : String(p.value ?? '')), isFile,
        fileName: isFile ? String(p.fileName) : undefined, contentType: typeof p.contentType === 'string' ? p.contentType : undefined };
    }) : multipartText(text, mime);
    return { ...emptyBody(), type: 'multipart', multipart };
  }
  if (fields.length && (!mime || /^application\/x-www-form-urlencoded\b/i.test(mime))) {
    return { ...emptyBody(), type: 'form', form: fields.map(p => kv(String(p.name), String(p.value ?? ''))) };
  }
  return importTextBody(text, mime);
}

function hostUrl(folder: Folder, url: URL) {
  const base = folder.variables.find(v => {
    if (!v.enabled || v.secret || !/^base_url(?:_\d+)?$/.test(v.key) || !/^https?:\/\//i.test(v.value)) return false;
    if (!url.href.startsWith(v.value)) return false;
    return v.value.endsWith('/') || /^[/#?]?$/.test(url.href.charAt(v.value.length));
  });
  const prefix = base ? '{{' + base.key + '}}' : storeImportVariable(folder.variables, 'base_url', url.origin, false);
  return prefix + url.href.slice((base?.value ?? url.origin).length);
}

function userInfo(value: string) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function capturedRequest(capture: Capture, folder: Folder, data: AppData, group: boolean, extract: boolean) {
  const { request, url } = capture;
  if (!url.search) {
    for (const p of records(request.queryString)) if (typeof p.name === 'string') url.searchParams.append(p.name, String(p.value ?? ''));
  }
  const headers = capturedHeaders(request);
  const body = capturedBody(request.postData, headers.find(h => h.key.toLowerCase() === 'content-type')?.value ?? '');
  // The request engine builds a new multipart boundary when it serializes structured fields.
  const retained = body.type === 'multipart' ? headers.filter(h => h.key.toLowerCase() !== 'content-type') : headers;
  const user = url.username || url.password ? { name: userInfo(url.username), password: userInfo(url.password) } : undefined;
  url.username = '';
  url.password = '';
  const target = group ? hostUrl(folder, url) : url.href;
  const credentials = importHeaders(retained, folder.variables, extract);
  if (user && credentials.auth.type === 'none' && !headers.some(h => h.key.toLowerCase() === 'authorization')) {
    credentials.auth = importBasicAuth(user.name, user.password, folder.variables, extract);
  }
  const method = String(request.method || 'GET').toUpperCase();
  return newRequest(folder.workspaceId, folder.id, {
    name: suggestRequestName(method, url.href, body.text, data.settings.language),
    method, body, ...credentials, ...importUrl(target, folder.variables, extract),
  });
}

export function importHarArchive(data: AppData, workspaceId: string, doc: unknown, opts: HarOptions = {}) {
  const captures = isHarArchive(doc) ? doc.log.entries.map(readCapture).filter((c): c is Capture => !!c) : [];
  const api = captures.filter(c => !isStatic(c));
  const selected = api.length ? api : captures;
  if (!selected.length) return { data, folderCount: 0, requestCount: 0 };
  const group = opts.groupByHost !== false;
  const folders = new Map<string, Folder>();
  const updated = new Map<string, Folder>();
  const created: Folder[] = [];
  const requests = selected.map(capture => {
    const host = group ? capture.url.host : '';
    let folder = folders.get(host);
    if (!folder) {
      const existing = group && data.folders.find(f => f.workspaceId === workspaceId && f.host === host);
      if (existing) {
        folder = { ...existing, variables: existing.variables.map(v => ({ ...v })) };
        updated.set(folder.id, folder);
      } else {
        const lang = data.settings.language;
        folder = newFolder(workspaceId, null, { name: group ? friendlyHostName(host, lang) : tr(lang, 'HAR 导入', 'HAR Import'), host: host || undefined });
        created.push(folder);
      }
      folders.set(host, folder);
    }
    return capturedRequest(capture, folder, data, group, opts.extractSecrets !== false);
  });
  return {
    data: { ...data, folders: [...data.folders.map(f => updated.get(f.id) ?? f), ...created], requests: [...data.requests, ...requests] },
    folderCount: created.length, requestCount: requests.length,
  };
}
