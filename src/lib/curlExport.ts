/**
 * 导出请求为 cURL / JavaScript fetch / Python requests，以及生成文件夹与工作区 Markdown API 文档
 */
import type { AppData, Folder, HttpRequest } from './types';
import { prepareRequest, resolveEffectiveAuth, type PreparedRequest } from './requestRunner';
import { folderChain, resolveVariables, type VarMap } from './template';
import { formatTime, maskSecret } from './util';

export interface CodeGenOptions {
  /** resolve = 替换为真实值；mask = 密钥遮罩；template = 保留 {{变量}} 占位符 */
  secretMode: 'resolve' | 'mask' | 'template';
  includeJq?: boolean;
}

function buildVarMap(data: AppData, req: HttpRequest, mode: CodeGenOptions['secretMode']): VarMap {
  const real = resolveVariables(data, req.workspaceId, req.folderId);
  if (mode === 'resolve') return real;
  const next: VarMap = new Map();
  for (const [k, v] of real.entries()) {
    if (mode === 'template') {
      next.set(k, { ...v, value: `{{${k}}}` });
    } else {
      next.set(k, { ...v, value: v.secret ? maskSecret(v.value) : v.value });
    }
  }
  return next;
}

function sq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function exportAsCurl(data: AppData, req: HttpRequest, opts: CodeGenOptions = { secretMode: 'mask', includeJq: true }): string {
  const vars = buildVarMap(data, req, opts.secretMode);
  const prep = prepareRequest(data, req, vars);
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

export function exportAsFetch(data: AppData, req: HttpRequest, opts: CodeGenOptions = { secretMode: 'mask' }): string {
  const vars = buildVarMap(data, req, opts.secretMode);
  const prep = prepareRequest(data, req, vars);
  const headersObj: Record<string, string> = {};
  for (const [k, v] of prep.headers) headersObj[k] = v;
  if (prep.body.kind === 'text' && prep.body.contentType && !Object.keys(headersObj).some((k) => k.toLowerCase() === 'content-type')) {
    headersObj['Content-Type'] = prep.body.contentType;
  }

  const lines: string[] = [];
  lines.push(`const res = await fetch(${JSON.stringify(prep.url)}, {`);
  lines.push(`  method: ${JSON.stringify(prep.method)},`);
  if (Object.keys(headersObj).length) {
    lines.push(`  headers: ${JSON.stringify(headersObj, null, 2).replace(/\n/g, '\n  ')},`);
  }
  if (prep.body.kind === 'text') {
    if (req.body.type === 'json') {
      try {
        const parsed = JSON.parse(prep.body.text);
        lines.push(`  body: JSON.stringify(${JSON.stringify(parsed, null, 2).replace(/\n/g, '\n  ')}),`);
      } catch {
        lines.push(`  body: ${JSON.stringify(prep.body.text)},`);
      }
    } else {
      lines.push(`  body: ${JSON.stringify(prep.body.text)},`);
    }
  }
  lines.push(`});`);
  lines.push(`const data = await res.json();`);
  lines.push(`console.log(data);`);
  return lines.join('\n');
}

function pythonMultipartBody(body: Extract<PreparedRequest['body'], { kind: 'multipart' }>): string[] {
  const lines: string[] = [];
  if (body.fields.some((field) => field.isFile)) {
    lines.push('# Set each Path to the local file you want to upload.');
  }
  lines.push('fields = [');
  for (const field of body.fields) {
    const name = JSON.stringify(field.name);
    if (field.isFile) {
      const filename = JSON.stringify(field.fileName?.split(/[\\/]/).pop() || 'file');
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
  const headersObj: Record<string, string> = {};
  const multipart = prep.body.kind === 'multipart';
  for (const [k, v] of prep.headers) {
    if (multipart && /^(content-type|content-length)$/i.test(k)) continue;
    headersObj[k] = v;
  }

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
    if (req.body.type === 'json') {
      try {
        const parsed = JSON.parse(prep.body.text);
        const pyJson = JSON.stringify(parsed, null, 4)
          .replace(/\btrue\b/g, 'True')
          .replace(/\bfalse\b/g, 'False')
          .replace(/\bnull\b/g, 'None');
        lines.push(`payload = ${pyJson}`);
        bodyArg = ', json=payload';
      } catch {
        lines.push(`payload = ${JSON.stringify(prep.body.text)}`);
        bodyArg = ', data=payload';
      }
    } else {
      lines.push(`payload = ${JSON.stringify(prep.body.text)}`);
      bodyArg = ', data=payload';
    }
  }
  if (prep.body.kind === 'multipart') {
    lines.push(...pythonMultipartBody(prep.body));
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
