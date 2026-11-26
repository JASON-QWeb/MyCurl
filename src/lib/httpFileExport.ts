import { buildVarMap, type CodeGenOptions } from './curlExport';
import { prepareRequest, resolveEffectiveAuth } from './requestRunner';
import { render, resolveVariables } from './template';
import type { AppData, HttpRequest } from './types';

type HttpFileResult = { text: string; error?: never } | { text?: never; error: 'multipart' | 'syntax' };

function restoreVariables(encoded: string): string {
  return encoded.replace(/%7B%7B([\w.%-]+)%7D%7D/gi, match => {
    try {
      return decodeURIComponent(match);
    } catch {
      return match;
    }
  });
}

export function exportHttpFile(data: AppData, req: HttpRequest, opts: CodeGenOptions = { secretMode: 'mask' }): HttpFileResult {
  if (req.body.type === 'multipart') return { error: 'multipart' };
  const vars = buildVarMap(data, req, opts.secretMode);
  const { auth } = resolveEffectiveAuth(data, req);
  const template = opts.secretMode === 'template';
  const mask = opts.secretMode === 'mask';
  const basicTemplate = template && auth.type === 'basic' && /\{\{/.test((auth.username || '') + (auth.password || ''));
  const exportAuth = basicTemplate ? { type: 'none' as const } : mask && auth.type === 'apikey' && auth.value
    ? { ...auth, value: '••••' } : auth;
  const prep = prepareRequest(data, { ...req, auth: exportAuth }, vars);
  let url = prep.url;
  if (template && req.url.trimStart().startsWith('{{')) {
    const resolved = render(req.url, resolveVariables(data, req.workspaceId, req.folderId));
    if (/^https?:\/\//i.test(resolved.trim())) url = url.replace(/^https:\/\/(?=\{\{)/, '');
  }
  if (template && auth.type === 'apikey' && auth.in === 'query') {
    const hashAt = url.indexOf('#');
    const beforeHash = hashAt < 0 ? url : url.slice(0, hashAt);
    const lastParam = Math.max(beforeHash.indexOf('?'), beforeHash.lastIndexOf('&')) + 1;
    url = beforeHash.slice(0, lastParam) + restoreVariables(beforeHash.slice(lastParam)) + url.slice(beforeHash.length);
  }

  const headers = prep.headers;
  if (basicTemplate && !headers.some(([key]) => key.toLowerCase() === 'authorization')) {
    headers.push(['Authorization', `Basic ${render(auth.username ?? '', vars)} ${render(auth.password ?? '', vars)}`]);
  }
  if (prep.body.kind === 'text' && prep.body.contentType && !headers.some(([key]) => key.toLowerCase() === 'content-type')) {
    headers.push(['Content-Type', prep.body.contentType]);
  }

  const token = /^[a-z0-9!#$%&'*+.^_`|~-]+$/i;
  if (!token.test(prep.method) || !url || /[\r\n]/.test(url)) return { error: 'syntax' };
  const lines = [`${prep.method} ${url}`];
  for (const [key, value] of headers) {
    if (!token.test(key) || /[\r\n]/.test(value)) return { error: 'syntax' };
    const sensitive = /authorization|api[-_]?key|token|cookie|secret/i.test(key);
    lines.push(`${key}: ${mask && sensitive && value ? '••••' : value}`);
  }
  if (prep.body.kind === 'text') {
    const text = template && req.body.type === 'form' ? restoreVariables(prep.body.text) : prep.body.text;
    // In a .http file these lines are executable directives or request boundaries.
    if (/^[ \t]*(?:###|[<>](?:[ \t]|>|\{%))/m.test(text)) return { error: 'syntax' };
    lines.push('', text);
  }
  return { text: lines.join('\n') };
}
