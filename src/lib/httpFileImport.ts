import { suggestRequestName } from './curlImport';
import { emptyBody, newFolder, newRequest } from './factory';
import { importHeaders, importTextBody, importUrl } from './fileImportFields';
import { tr } from './translate';
import type { AppData, KV, RequestBody, Variable } from './types';
import { splitUrl } from './urlParams';
import { isCredentialKey, kv } from './util';

interface ParsedHttpRequest {
  name: string;
  method: string;
  url: string;
  headers: KV[];
  body: RequestBody;
}

export interface ParsedHttpFile {
  variables: Variable[];
  requests: ParsedHttpRequest[];
}

function requestLine(line: string) {
  const input = line.trim().replace(/\s+HTTP\/\d+(?:\.\d+)?$/i, '');
  const explicit = /^([A-Za-z][A-Za-z0-9-]*)[ \t]+(.+)$/.exec(input);
  const method = explicit?.[1] ?? 'GET';
  if (method !== method.toUpperCase() && !/^(get|head|post|put|patch|delete|options|connect|trace)$/i.test(method)) return;
  const url = explicit ? explicit[2] : input;
  const target = url.replace(/\{\{\s*[^{}\s]+\s*\}\}/g, '{{var}}');
  if (/\s/.test(target) || !/^(?:https?:\/\/|\/(?!\/)|\{\{|\[::1\]|localhost\b|[\w-]+(?:\.[\w-]+)+(?=[:/?#]|$))/i.test(target)) return;
  return { method: method.toUpperCase(), url };
}

function readBlock(block: string, name: string, file: ParsedHttpFile) {
  // Keep original line endings on the payload. Only HTTP syntax lines get trimmed.
  const lines = block.split(/(?<=\n)|(?<=\r)(?!\n)/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i++].trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const variable = /^@([\w.\-\u4e00-\u9fa5]+)\s*=\s*(.*)$/.exec(line);
    if (variable) {
      const [, key, value] = variable;
      const existing = file.variables.find(v => v.key === key);
      if (existing) existing.value = value;
      else file.variables.push({ ...kv(key, value), secret: isCredentialKey(key) });
      continue;
    }
    const start = requestLine(line);
    if (!start) return;
    while (i < lines.length && /^[?&]/.test(lines[i].trimStart())) {
      const { base, query, hash } = splitUrl(start.url);
      const prefix = query && !query.endsWith('&') ? query + '&' : query ?? '';
      start.url = base + '?' + prefix + lines[i++].trim().slice(1) + hash;
    }
    const headers: KV[] = [];
    while (i < lines.length && lines[i].trim()) {
      const header = /^([^:\s]+):[ \t]*(.*)$/.exec(lines[i++].replace(/[\r\n]+$/, ''));
      if (!header) return;
      headers.push(kv(header[1], header[2]));
    }
    const text = lines.slice(i + 1).join('');
    const contentType = headers.find(h => h.key.toLowerCase() === 'content-type')?.value;
    const body = text || (i < lines.length && contentType) ? importTextBody(text, contentType) : emptyBody();
    file.requests.push({ ...start, name, headers, body });
    return;
  }
}

export function parseHttpFile(text: string): ParsedHttpFile {
  const file: ParsedHttpFile = { variables: [], requests: [] };
  const blocks = text.replace(/^\uFEFF/, '').split(/(?:^|\r\n|\r|\n)[ \t]*###[ \t]*([^\r\n]*)/);
  readBlock(blocks[0], '', file);
  for (let i = 1; i < blocks.length; i += 2) readBlock(blocks[i + 1], blocks[i].trim(), file);
  return file;
}

export function looksLikeHttpFile(text: string): boolean {
  return parseHttpFile(text).requests.length > 0;
}

export function importHttpFile(data: AppData, workspaceId: string, text: string, folderName?: string) {
  const file = parseHttpFile(text);
  if (!file.requests.length) return { data, folderCount: 0, requestCount: 0 };
  const lang = data.settings.language;
  const folder = newFolder(workspaceId, null, {
    name: folderName?.trim() || tr(lang, 'HTTP 文件导入', 'HTTP File Import'),
    variables: file.variables,
  });
  const requests = file.requests.map((r, sortOrder) => newRequest(workspaceId, folder.id, {
    ...importHeaders(r.headers, folder.variables, true),
    ...importUrl(r.url, folder.variables, true),
    name: r.name || suggestRequestName(r.method, r.url, r.body.text, lang),
    method: r.method, body: r.body, sortOrder,
  }));
  return {
    data: { ...data, folders: [...data.folders, folder], requests: [...data.requests, ...requests] },
    folderCount: 1, requestCount: requests.length,
  };
}
