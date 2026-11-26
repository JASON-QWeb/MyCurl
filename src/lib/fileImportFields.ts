import { emptyBody } from './factory';
import { findTemplateVars } from './template';
import type { Auth, KV, RequestBody, Variable } from './types';
import { splitUrl, syncParamsFromUrl } from './urlParams';
import { isCredentialKey, kv } from './util';

const placeholder = /^\{\{\s*([$\w.\-\u4e00-\u9fa5]+)\s*\}\}$/;

/** The importer owns this variable list, including when extending an existing HAR folder. */
export function storeImportVariable(variables: Variable[], key: string, value: string, secret: boolean): string {
  const same = variables.find(v => v.enabled && v.value === value && (secret || v.key === key));
  if (same) {
    if (secret) same.secret = true;
    return '{{' + same.key + '}}';
  }
  let name = key;
  let suffix = 2;
  while (variables.some(v => v.key === name)) name = key + '_' + suffix++;
  variables.push({ ...kv(name, value), secret });
  return '{{' + name + '}}';
}

function protect(variables: Variable[], key: string, value: string, extract: boolean) {
  if (!extract || !value) return value;
  const refs = findTemplateVars(value);
  if (refs.length) {
    for (const variable of variables) if (refs.includes(variable.key)) variable.secret = true;
    return value;
  }
  return storeImportVariable(variables, key, value, true);
}

function variableName(key: string) {
  return key.toLowerCase().replace(/^x-/, '').replace(/[^a-z0-9_]+/g, '_');
}

function readBasic(value: string): [string, string] | undefined {
  if (placeholder.test(value)) return;
  // HTTP Client also accepts the unencoded "username password" syntax.
  const separate = /^(\S+)\s+(.+)$/.exec(value);
  if (separate) return [separate[1], separate[2]];
  try {
    const text = new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)));
    const colon = text.indexOf(':');
    if (colon >= 0) return [text.slice(0, colon), text.slice(colon + 1)];
  } catch { /* Keep an unrecognized Authorization header intact. */ }
}

export function importBasicAuth(username: string, password: string, variables: Variable[], extract: boolean): Auth {
  return { type: 'basic', username, password: protect(variables, 'password', password, extract) };
}

export function importHeaders(rows: KV[], variables: Variable[], extract: boolean) {
  let auth: Auth = { type: 'none' };
  const headers: KV[] = [];
  for (const row of rows) {
    const name = row.key.toLowerCase();
    if (name === 'authorization' && auth.type === 'none') {
      const bearer = /^Bearer\s+(.+)$/i.exec(row.value.trim());
      if (bearer) {
        auth = { type: 'bearer', token: protect(variables, 'api_key', bearer[1], extract) };
        continue;
      }
      const basic = /^Basic\s+(.+)$/i.exec(row.value.trim());
      const credentials = basic && readBasic(basic[1]);
      if (credentials) {
        auth = importBasicAuth(credentials[0], credentials[1], variables, extract);
        continue;
      }
    }
    const value = isCredentialKey(name) ? protect(variables, variableName(name), row.value, extract) : row.value;
    headers.push({ ...row, value });
  }
  return { auth, headers };
}

export function importUrl(raw: string, variables: Variable[], extract: boolean) {
  const { base, query, hash } = splitUrl(raw);
  let url = raw;
  if (query && extract) {
    const pairs = query.split('&').map(pair => {
      const at = pair.indexOf('=');
      if (at < 0) return pair;
      const key = pair.slice(0, at);
      let decoded = key;
      try { decoded = decodeURIComponent(key); } catch { /* Preserve the original URL spelling. */ }
      if (!isCredentialKey(decoded, true)) return pair;
      return key + '=' + protect(variables, variableName(decoded), pair.slice(at + 1), true);
    });
    url = base + '?' + pairs.join('&') + hash;
  }
  return { url, params: syncParamsFromUrl(url, []) };
}

export function importTextBody(text: string, contentType = ''): RequestBody {
  const body = emptyBody();
  const media = contentType.split(';')[0].trim().toLowerCase();
  if (media.endsWith('/json') || media.endsWith('+json')) body.type = 'json';
  else if (media.endsWith('/xml') || media.endsWith('+xml')) body.type = 'xml';
  else if (media === 'text/plain') body.type = 'text';
  else if (media === 'application/x-www-form-urlencoded') body.type = 'form';
  else if (/^(?:\{|\[)/.test(text.trimStart())) body.type = 'json';
  else if (text.trimStart().startsWith('<')) body.type = 'xml';
  else if (/^[^&=\s]+=[^\n]*$/.test(text)) body.type = 'form';
  else body.type = 'text';
  if (body.type === 'form') body.form = Array.from(new URLSearchParams(text), ([key, value]) => kv(key, value));
  else body.text = text;
  return body;
}
