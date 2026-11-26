import type { AppData, Auth, HttpRequest, KV } from './types';
import { parseQuery, splitUrl } from './urlParams';
import { isCredentialKey, maskSecret } from './util';

const template = /^\{\{\s*[$\w.\-\u4e00-\u9fa5]+\s*\}\}$/;
type Remember = (value: string | undefined) => void;

function decode(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
}

function inspectFields(fields: Pick<KV, 'key' | 'value'>[], remember: Remember, query = false) {
  for (const { key, value } of fields) {
    const name = decode(key).trim();
    if (!isCredentialKey(name, query)) continue;
    if (/^(?:proxy-)?authorization$/i.test(name)) {
      const credential = /^(?:Bearer|Basic)\s+(.+)$/i.exec(value.trim());
      remember(credential ? credential[1] : value);
    } else {
      if (/^(?:set-)?cookie$/i.test(name)) {
        const cookies = /^set-cookie$/i.test(name) ? value.split(';').slice(0, 1) : value.split(';');
        for (const cookie of cookies) {
          const equals = cookie.indexOf('=');
          if (equals >= 0) remember(cookie.slice(equals + 1).trim());
        }
      }
      remember(value);
      if (query) remember(decode(value.replace(/\+/g, ' ')));
    }
  }
}

function inspectUrl(url: string, remember: Remember) {
  const password = /^(?:[\w+.-]+:)?\/\/[^/@?#]*?:([^/@?#]+)@/.exec(url)?.[1];
  if (password) {
    remember(password);
    remember(decode(password));
  }
  const params = parseQuery(splitUrl(url).query);
  inspectFields(params, remember, true);
}

function inspectAuth(auth: Auth, remember: Remember) {
  remember(auth?.password);
  remember(auth?.token);
  remember(auth?.value);
}

function inspectJson(text: string | undefined, remember: Remember) {
  if (!text) return;
  try {
    JSON.parse(text);
    // A reviver would only see the last value of a repeated credential key.
    const strings = /("(?:\\.|[^"\\])*")(?:\s*:\s*("(?:\\.|[^"\\])*"))?/g;
    for (const [, key, value] of text.matchAll(strings)) {
      if (value && isCredentialKey(JSON.parse(key))) remember(JSON.parse(value));
    }
  } catch { /* Other body formats still receive literal substitutions. */ }
}

function removeSource(request: HttpRequest) {
  const raw = request.source?.raw;
  if (raw && request.description) {
    const heading = '### 原始命令（密钥已脱敏）\n\n';
    const block = '```bash\n' + raw + '\n```';
    request.description = request.description.replace(heading + block, '').split(raw).join('').trimEnd();
  }
  delete request.source;
}

function scrubBody(text: string, scrub: (value: string) => string) {
  try {
    JSON.parse(text);
    // Rewrite JSON strings in place to preserve integers beyond Number.MAX_SAFE_INTEGER and formatting.
    return text.replace(/"(?:\\[\s\S]|[^"\\])*"/g, (literal: string) => {
      const value: string = JSON.parse(literal);
      const masked = scrub(value);
      return masked === value ? literal : JSON.stringify(masked);
    });
  } catch { return scrub(text); }
}

const userTextFields = new Set([
  'value', 'token', 'password', 'username', 'prefix', 'url', 'host', 'proxy', 'description',
  'name', 'note', 'query', 'fileName', 'contentType', 'responseFilter', 'key',
]);

function inspectCredentials(data: AppData, remember: Remember) {
  for (const holder of [...data.folders, ...data.environments]) {
    inspectFields(holder.variables ?? [], remember);
    for (const v of holder.variables ?? []) if (v.secret) remember(v.value);
  }
  for (const folder of data.folders) {
    inspectAuth(folder.auth, remember);
    inspectFields(folder.headers ?? [], remember);
  }
  inspectUrl(data.settings.proxy ?? '', remember);
  for (const req of data.requests) {
    inspectAuth(req.auth, remember);
    inspectFields(req.headers ?? [], remember);
    inspectFields(req.params ?? [], remember, true);
    inspectUrl(req.url, remember);
    inspectFields([...(req.body?.form ?? []), ...(req.body?.multipart ?? [])], remember);
    inspectJson(req.body?.text, remember);
    inspectJson(req.body?.graphql?.variables, remember);
  }
}

export function hasMaskedSecrets(data: AppData): boolean {
  let masked = false;
  inspectCredentials(data, value => {
    if (value && (/•{4}/.test(value) || /^•+$/.test(value))) masked = true;
  });
  return masked;
}

export function maskedBackupJson(data: AppData): string {
  const copy: AppData = JSON.parse(JSON.stringify(data));
  const replacements = new Map<string, string>();
  const remember: Remember = (value) => {
    if (!value || template.test(value)) return;
    const mask = value.includes('{{') ? '••••' : maskSecret(value);
    replacements.set(value, mask);
    replacements.set(JSON.stringify(value).slice(1, -1), mask);
    // URLSearchParams supports both form encoding and strings containing an unpaired surrogate.
    const encoded = new URLSearchParams({ v: value }).toString().slice(2);
    replacements.set(encoded, mask);
    replacements.set(encoded.replace(/\+/g, '%20'), mask);
  };
  inspectCredentials(copy, remember);
  for (const req of copy.requests) {
    // Embedded files can contain arbitrary credentials. Keep field metadata for reattachment.
    for (const field of req.body?.multipart ?? []) delete field.fileData;
    removeSource(req);
  }
  const entries = [...replacements].sort(([a], [b]) => b.length - a.length);
  const scrub = (value: string, identifier = false) => {
    if (template.test(value)) return value;
    for (const [literal, masked] of entries) {
      if (!value.includes(literal)) continue;
      // A short password such as "pass" must not rename the variable "password".
      if (identifier && literal.length <= 8 && /^[a-z\d]+$/i.test(literal)) {
        value = value.replace(/[a-z\d]+/gi, part => part === literal ? masked : part);
      } else value = value.split(literal).join(masked);
    }
    return value;
  };
  for (const { body } of copy.requests) {
    if (body?.text) body.text = scrubBody(body.text, scrub);
    if (body?.graphql?.variables) body.graphql.variables = scrubBody(body.graphql.variables, scrub);
  }
  return JSON.stringify(copy, (key, value) =>
    typeof value === 'string' && userTextFields.has(key) ? scrub(value, key === 'key') : value, 2);
}
