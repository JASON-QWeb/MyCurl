/**
 * 导出请求为 cURL / JavaScript fetch / Python requests，以及生成文件夹与工作区 Markdown API 文档
 */
import type { AppData, CurlCopySecretMode, Folder, HttpRequest, Language } from './types';
import { prepareRequest, resolveEffectiveAuth, type PreparedRequest } from './requestRunner';
import { tr } from './translate';
import { parseLosslessJson, toPythonLiteral, type JsonValue } from './jsonLiteral';
import { folderChain, render, resolveVariables, type VarMap } from './template';
import { formatTime, isCredentialKey, maskSecret } from './util';
import { splitUrl } from './urlParams';

export interface CodeGenOptions {
  /** resolve = 替换为真实值；mask = 密钥遮罩；template = 保留 {{变量}} 占位符 */
  secretMode: 'resolve' | 'mask' | 'template';
  includeJq?: boolean;
}

export function buildVarMap(data: AppData, req: HttpRequest, mode: CodeGenOptions['secretMode']): VarMap {
  const real = resolveVariables(data, req.workspaceId, req.folderId);
  if (mode === 'resolve') return real;
  const next: VarMap = new Map();
  for (const [k, v] of real.entries()) {
    if (mode === 'template') {
      next.set(k, { ...v, value: `{{${k}}}` });
    } else {
      next.set(k, { ...v, value: v.secret ? (v.value.includes('{{') ? '••••' : maskSecret(v.value)) : v.value });
    }
  }
  return next;
}

function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function maskUrlCredentials(url: string, authQueryKey?: string) {
  const { base, query, hash } = splitUrl(url);
  const safeBase = base.replace(/^(\w[\w+.-]*:\/\/[^/@]*?:)[^/@]+@/, '$1••••@');
  if (query === null) return safeBase + hash;
  const safeQuery = query.split('&').map(pair => {
    const equals = pair.indexOf('=');
    if (equals < 0 || equals === pair.length - 1) return pair;
    let key = pair.slice(0, equals);
    try { key = decodeURIComponent(key); } catch { /* Keep malformed escapes as written. */ }
    return isCredentialKey(key, true) || key.toLowerCase() === authQueryKey ? pair.slice(0, equals + 1) + '••••' : pair;
  }).join('&');
  return safeBase + '?' + safeQuery + hash;
}

function prepareCurlCopy(data: AppData, req: HttpRequest, mode: CodeGenOptions['secretMode']) {
  const vars = buildVarMap(data, req, mode);
  if (mode !== 'mask') return prepareRequest(data, req, vars);
  const { auth } = resolveEffectiveAuth(data, req);
  // Resolve the API-key name once, including when an explicit header overrides it.
  const apiKey = auth.type === 'apikey' ? render(auth.key ?? '', vars).trim() : undefined;
  const prep = prepareRequest(data, apiKey === undefined ? req : { ...req, auth: { ...auth, key: apiKey } }, vars);
  const keyName = apiKey?.toLowerCase();
  prep.url = maskUrlCredentials(prep.url, auth.in === 'query' ? keyName : undefined);
  const masked = new Set([...vars.values()].filter(v => v.secret).map(v => v.value));
  prep.headers = prep.headers.map(([key, value]) => {
    const sensitive = isCredentialKey(key) || (auth.in !== 'query' && key.toLowerCase() === keyName);
    if (!value || !sensitive) return [key, value];
    const prefix = /^(?:Bearer|Basic)\s+/i.exec(value)?.[0] ?? '';
    return [key, masked.has(value.slice(prefix.length)) ? value : prefix + '••••'];
  });
  return prep;
}

export function exportResolvedUrl(data: AppData, req: HttpRequest, mode: CurlCopySecretMode): string {
  return prepareCurlCopy(data, req, mode).url;
}

export function exportAsCurl(data: AppData, req: HttpRequest, opts: CodeGenOptions = { secretMode: 'mask', includeJq: true }): string {
  const prep = prepareCurlCopy(data, req, opts.secretMode);
  const lines: string[] = [];
  const head = ['curl'];
  if (prep.options.verifySSL === false) head.push('-k');
  if (req.settings?.followRedirects === true) head.push('-L');
  const hasBody = prep.body.kind !== 'none';
  if (!(prep.method === 'GET' && !hasBody) && !(prep.method === 'POST' && hasBody)) {
    head.push(`-X ${prep.method}`);
  }
  head.push(sq(prep.url));
  lines.push(head.join(' '));

  const seenCT = prep.headers.some(([k]) => k.toLowerCase() === 'content-type');
  for (const [k, v] of prep.headers) {
    lines.push(`  -H ${sq(`${k}: ${v}`)}`);
  }
  if (prep.body.kind === 'text') {
    if (prep.body.contentType && !seenCT) {
      lines.push(`  -H ${sq(`Content-Type: ${prep.body.contentType}`)}`);
    }
    lines.push(`  --data-raw ${sq(prep.body.text)}`);
  } else if (prep.body.kind === 'multipart') {
    for (const f of prep.body.fields) {
      if (f.isFile) lines.push(`  -F ${sq(`${f.name}=@${f.fileName || 'file'}`)}`);
      else lines.push(`  -F ${sq(`${f.name}=${f.value ?? ''}`)}`);
    }
  }

  let cmd = lines.join(' \\\n');
  if (opts.includeJq !== false && req.responseFilter?.trim()) {
    cmd += ` | jq -r ${sq(req.responseFilter.trim())}`;
  }
  return cmd;
}

type MultipartBody = Extract<PreparedRequest['body'], { kind: 'multipart' }>;

function snippetHeaders(prep: PreparedRequest, defaultContentType?: string): Record<string, string> {
  const multipart = prep.body.kind === 'multipart';
  const headers = Object.fromEntries(prep.headers.filter(([key]) => !multipart || !/^(content-type|content-length)$/i.test(key)));
  if (defaultContentType && !prep.headers.some(([key]) => key.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = defaultContentType;
  }
  return headers;
}

function jsLiteral(value: JsonValue): string {
  // "__proto__" has special semantics in an object literal unless it is a computed key.
  return JSON.stringify(value, null, 2).replace(/^( *)"__proto__":/gm, '$1["__proto__"]:').replace(/\n/g, '\n  ');
}

function localFilename(fileName?: string): string {
  return fileName?.split(/[\\/]/).pop() || 'file';
}

function fetchMultipartBody(body: MultipartBody, lang: Language): string[] {
  const lines = ['const form = new FormData();'];
  if (body.fields.some(field => field.isFile)) {
    lines.push(tr(lang, '// 将 Blob 中的占位注释替换为本地文件内容。', '// Replace each Blob placeholder with the local file contents.'));
  }
  for (const field of body.fields) {
    const name = JSON.stringify(field.name);
    if (field.isFile) {
      const filename = localFilename(field.fileName);
      const commentName = filename.replace(/[\r\n\u2028\u2029]/g, ' ');
      const comment = tr(lang, `本地文件：${commentName}`, `local file: ${commentName}`);
      const mime = JSON.stringify(field.contentType || 'application/octet-stream');
      lines.push(`form.append(${name}, new Blob([/* ${comment} */], { type: ${mime} }), ${JSON.stringify(filename)});`);
    } else {
      lines.push(`form.append(${name}, ${JSON.stringify(field.value ?? '')});`);
    }
  }
  return [...lines, ''];
}

export function exportAsFetch(data: AppData, req: HttpRequest, opts: CodeGenOptions = { secretMode: 'mask' }): string {
  const vars = buildVarMap(data, req, opts.secretMode);
  const prep = prepareRequest(data, req, vars);
  const headersObj = snippetHeaders(prep, prep.body.kind === 'text' ? prep.body.contentType : undefined);
  const lines = prep.body.kind === 'multipart' ? fetchMultipartBody(prep.body, data.settings.language) : [];
  lines.push(`const res = await fetch(${JSON.stringify(prep.url)}, {`);
  lines.push(`  method: ${JSON.stringify(prep.method)},`);
  if (Object.keys(headersObj).length) {
    lines.push(`  headers: ${jsLiteral(headersObj)},`);
  }
  if (prep.body.kind === 'text') {
    const parsed = req.body.type === 'json' ? parseLosslessJson(prep.body.text) : undefined;
    const body = parsed === undefined ? JSON.stringify(prep.body.text) : `JSON.stringify(${jsLiteral(parsed)})`;
    lines.push(`  body: ${body},`);
  } else if (prep.body.kind === 'multipart') {
    lines.push('  body: form,');
  }
  lines.push(`});`);
  lines.push(`const data = await res.json();`);
  lines.push(`console.log(data);`);
  return lines.join('\n');
}

function pythonMultipartBody(body: MultipartBody, lang: Language): string[] {
  const lines: string[] = [];
  if (body.fields.some((field) => field.isFile)) {
    lines.push(tr(lang, '# 将每个 Path 指向要上传的本地文件。', '# Set each Path to the local file you want to upload.'));
  }
  lines.push('fields = [');
  for (const field of body.fields) {
    const name = JSON.stringify(field.name);
    if (field.isFile) {
      const filename = JSON.stringify(localFilename(field.fileName));
      const mime = JSON.stringify(field.contentType || 'application/octet-stream');
      lines.push(`    (${name}, (${filename}, Path(${filename}).read_bytes(), ${mime})),`);
    } else {
      lines.push(`    (${name}, ${JSON.stringify(field.value ?? '')}),`);
    }
  }
  lines.push(']', 'payload, headers["Content-Type"] = encode_multipart_formdata(fields)');
  return lines;
}

export function exportAsPython(data: AppData, req: HttpRequest, opts: CodeGenOptions = { secretMode: 'mask' }): string {
  const vars = buildVarMap(data, req, opts.secretMode);
  const prep = prepareRequest(data, req, vars);
  const isJson = req.body.type === 'json';
  const headersObj = snippetHeaders(prep, isJson ? 'application/json' : undefined);
  const multipart = prep.body.kind === 'multipart';

  const lines: string[] = [];
  if (prep.body.kind === 'multipart') {
    if (prep.body.fields.some((field) => field.isFile)) lines.push('from pathlib import Path');
    lines.push('from urllib3.filepost import encode_multipart_formdata');
  }
  lines.push('import requests', '');
  lines.push(`url = ${JSON.stringify(prep.url)}`);
  const hasHeaders = multipart || Object.keys(headersObj).length > 0;
  if (hasHeaders) {
    lines.push(`headers = ${JSON.stringify(headersObj, null, 4)}`);
  }
  let bodyArg = '';
  if (prep.body.kind === 'text') {
    const parsed = isJson ? parseLosslessJson(prep.body.text) : undefined;
    if (parsed !== undefined) {
      lines.push(`payload = ${toPythonLiteral(parsed)}`);
      // Requests treats json=None as an absent body, even for an explicit JSON null.
      bodyArg = parsed === null ? ', data=b"null", json=payload' : ', json=payload';
    } else {
      const encoding = isJson ? '.encode("utf-8")' : '';
      lines.push(`payload = ${JSON.stringify(prep.body.text)}${encoding}`);
      bodyArg = ', data=payload';
    }
  } else if (prep.body.kind === 'multipart') {
    lines.push(...pythonMultipartBody(prep.body, data.settings.language));
    bodyArg = ', data=payload';
  }
  const hArg = hasHeaders ? ', headers=headers' : '';
  lines.push('');
  lines.push(`resp = requests.request(${JSON.stringify(prep.method)}, url${hArg}${bodyArg})`);
  lines.push('print(resp.status_code)');
  lines.push('print(resp.text)');
  return lines.join('\n');
}

/** 生成单个请求的 Markdown 文档 */
export function generateRequestDoc(data: AppData, req: HttpRequest): string {
  const chain = folderChain(data, req.folderId);
  const { auth, inheritedFrom } = resolveEffectiveAuth(data, req);
  const lines: string[] = [];
  lines.push(`### ${req.name}`);
  lines.push('');
  lines.push(`- **接口**：\`${req.method.toUpperCase()} ${req.url}\``);
  if (chain.length) lines.push(`- **所属目录**：${chain.map((f) => f.name).join(' / ')}`);
  if (auth.type !== 'none') {
    const label =
      auth.type === 'bearer'
        ? `Bearer (\`${auth.token || ''}\`)`
        : auth.type === 'basic'
          ? `Basic (\`${auth.username || ''}\`)`
          : `API Key (\`${auth.key || ''}\`)`;
    lines.push(`- **认证**：${label}${inheritedFrom ? `（继承自 ${inheritedFrom}）` : ''}`);
  }
  if (req.responseFilter) lines.push(`- **响应筛选**：\`${req.responseFilter}\``);
  lines.push('');

  const enabledHeaders = req.headers.filter((h) => h.enabled && h.key.trim());
  if (enabledHeaders.length) {
    lines.push('#### 请求头');
    lines.push('');
    lines.push('| 名称 | 值 |');
    lines.push('| --- | --- |');
    for (const h of enabledHeaders) lines.push(`| \`${h.key}\` | \`${h.value}\` |`);
    lines.push('');
  }

  if (req.body.type !== 'none') {
    lines.push(`#### 请求体（${req.body.type.toUpperCase()}）`);
    lines.push('');
    if (req.body.type === 'form') {
      lines.push('| 字段 | 值 |');
      lines.push('| --- | --- |');
      for (const f of req.body.form.filter((x) => x.enabled)) lines.push(`| \`${f.key}\` | \`${f.value}\` |`);
    } else if (req.body.type === 'multipart') {
      lines.push('| 字段 | 类型 | 值 |');
      lines.push('| --- | --- |');
      for (const f of req.body.multipart.filter((x) => x.enabled)) {
        lines.push(`| \`${f.key}\` | ${f.isFile ? '文件' : '文本'} | \`${f.isFile ? f.fileName || '' : f.value}\` |`);
      }
    } else if (req.body.type === 'graphql') {
      lines.push('```graphql');
      lines.push(req.body.graphql?.query || '');
      lines.push('```');
    } else {
      lines.push(`\`\`\`${req.body.type === 'json' ? 'json' : req.body.type === 'xml' ? 'xml' : ''}`);
      lines.push(req.body.text || '');
      lines.push('```');
    }
    lines.push('');
  }

  lines.push('#### cURL 示例（密钥已脱敏）');
  lines.push('');
  lines.push('```bash');
  lines.push(exportAsCurl(data, req, { secretMode: 'mask', includeJq: true }));
  lines.push('```');
  return lines.join('\n');
}

/** 生成整个文件夹的归档 Markdown 文档 */
export function generateFolderDoc(data: AppData, folder: Folder): string {
  const lines: string[] = [];
  lines.push(`# ${folder.name}`);
  lines.push('');
  if (folder.host) lines.push(`> 归档域名：\`${folder.host}\` · 导出时间：${formatTime(Date.now())}`);
  else lines.push(`> 导出时间：${formatTime(Date.now())}`);
  lines.push('');
  if (folder.description?.trim()) {
    lines.push(folder.description.trim());
    lines.push('');
  }

  if (folder.variables.length) {
    lines.push('## 收纳的变量与密钥');
    lines.push('');
    lines.push('| 变量名 | 值（密钥已脱敏） | 类型 | 说明 |');
    lines.push('| --- | --- | --- | --- |');
    for (const v of folder.variables) {
      const val = v.secret ? maskSecret(v.value) : v.value;
      lines.push(`| \`{{${v.key}}}\` | \`${val}\` | ${v.secret ? '密钥' : '普通'} | ${v.note || ''} |`);
    }
    lines.push('');
  }

  const collectRequests = (fid: string): HttpRequest[] => {
    const direct = data.requests.filter((r) => r.folderId === fid).sort((a, b) => a.sortOrder - b.sortOrder);
    const children = data.folders.filter((f) => f.parentId === fid).sort((a, b) => a.sortOrder - b.sortOrder);
    return [...direct, ...children.flatMap((c) => collectRequests(c.id))];
  };

  const reqs = collectRequests(folder.id);
  lines.push(`## 接口列表（共 ${reqs.length} 个）`);
  lines.push('');
  for (const r of reqs) {
    lines.push(generateRequestDoc(data, r));
    lines.push('');
    lines.push('---');
    lines.push('');
  }
  return lines.join('\n');
}

/** 生成整个工作区的归档 Markdown 文档 */
export function generateWorkspaceDoc(data: AppData, workspaceId: string): string {
  const ws = data.workspaces.find((w) => w.id === workspaceId);
  const lines: string[] = [];
  lines.push(`# ${ws?.name || 'API 接口文档'}`);
  lines.push('');
  lines.push(`> 由 MyCurl 生成 · ${formatTime(Date.now())}`);
  lines.push('');

  const base = data.environments.find((e) => e.workspaceId === workspaceId && e.isBase);
  if (base && base.variables.length) {
    lines.push('## 全局变量');
    lines.push('');
    lines.push('| 变量名 | 值（密钥已脱敏） | 类型 |');
    lines.push('| --- | --- | --- |');
    for (const v of base.variables) {
      lines.push(`| \`{{${v.key}}}\` | \`${v.secret ? maskSecret(v.value) : v.value}\` | ${v.secret ? '密钥' : '普通'} |`);
    }
    lines.push('');
  }

  const topFolders = data.folders.filter((f) => f.workspaceId === workspaceId && !f.parentId).sort((a, b) => a.sortOrder - b.sortOrder);
  for (const f of topFolders) {
    lines.push(generateFolderDoc(data, f));
    lines.push('');
  }

  const rootReqs = data.requests.filter((r) => r.workspaceId === workspaceId && !r.folderId).sort((a, b) => a.sortOrder - b.sortOrder);
  if (rootReqs.length) {
    lines.push('## 未分类接口');
    lines.push('');
    for (const r of rootReqs) {
      lines.push(generateRequestDoc(data, r));
      lines.push('');
    }
  }
  return lines.join('\n');
}
