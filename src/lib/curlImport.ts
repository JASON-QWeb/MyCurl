/**
 * 智能导入：把解析后的 cURL 归档到工作区
 *  - 按域名自动归档到文件夹
 *  - 把 Base URL 提取为文件夹变量 {{base_url}}
 *  - 把 Bearer Token / API Key / 查询参数中的 key 提取为文件夹密钥变量（相同密钥自动复用）
 *  - $OPENAI_API_KEY 之类的环境变量引用 → 全局变量（若粘贴内容中有 export 则自动填值）
 *  - | jq '...' → 响应筛选表达式
 *  - 自动生成请求名称与文档（原始命令已脱敏）
 */
import type { ParsedCurl } from './curlParser';
import type { AppData, Auth, Folder, HttpRequest, KV, Variable } from './types';
import { emptyBody, newFolder, newRequest } from './factory';
import { folderChain, SECRET_NAME_RE } from './template';
import { formatTime, maskSecret, uid } from './util';
import { parseQuery, splitUrl } from './urlParams';

export interface ImportOptions {
  extractSecrets: boolean;
  extractBaseUrl: boolean;
  groupByHost: boolean;
}

export interface ImportOverrides {
  /** 目标：'__auto__' | '__root__' | '__new__' | 文件夹 id */
  target?: string;
  newFolderName?: string;
  name?: string;
  varNames?: Record<string, string>;
  varDisabled?: Record<string, boolean>;
  createDuplicate?: boolean;
}

export interface PlannedVar {
  slot: string;
  /** 来源描述 */
  label: string;
  key: string;
  value: string;
  secret: boolean;
  scope: 'folder' | 'base';
  /** new=新建；reuse=复用已有同值变量；fill=填充已有空变量 */
  status: 'new' | 'reuse' | 'fill';
  enabled: boolean;
  needsValue?: boolean;
}

export interface ImportPlan {
  parsed: ParsedCurl;
  workspaceId: string;
  folder: { kind: 'existing' | 'new' | 'root'; id?: string; name: string; host?: string; path: string };
  request: HttpRequest;
  vars: PlannedVar[];
  duplicateOf?: { id: string; name: string };
  createDuplicate: boolean;
  notes: string[];
}

// ---------- 识别规则 ----------

const SECRET_HEADER_RE =
  /^(x-)?(api[-_]?key|apikey|api[-_]?token|access[-_]?token|auth[-_]?token|token|secret|secret[-_]?key|client[-_]?secret|goog-api-key|subscription-key)$|^ocp-apim-subscription-key$|^x-goog-api-key$|^x-auth-key$|^private-token$/i;
const SECRET_QUERY_RE = /^(key|api[-_]?key|apikey|access[-_]?token|token|secret|client[-_]?secret|auth|sig|signature|private[-_]?token)$/i;

const KNOWN_HOSTS: [RegExp, string][] = [
  [/(^|\.)openai\.com$/, 'OpenAI'],
  [/(^|\.)anthropic\.com$/, 'Anthropic Claude'],
  [/^generativelanguage\.googleapis\.com$/, 'Google Gemini'],
  [/aiplatform\.googleapis\.com$/, 'Vertex AI'],
  [/(^|\.)deepseek\.com$/, 'DeepSeek'],
  [/^dashscope(-intl)?\.aliyuncs\.com$/, '通义千问 DashScope'],
  [/^open\.bigmodel\.cn$/, '智谱 GLM'],
  [/(^|\.)moonshot\.(cn|ai)$/, 'Moonshot Kimi'],
  [/volces\.com$/, '火山方舟 豆包'],
  [/(^|\.)siliconflow\.(cn|com)$/, '硅基流动'],
  [/^openrouter\.ai$/, 'OpenRouter'],
  [/(^|\.)groq\.com$/, 'Groq'],
  [/(^|\.)mistral\.ai$/, 'Mistral'],
  [/(^|\.)x\.ai$/, 'xAI Grok'],
  [/(^|\.)minimax(i)?\.(chat|com|io)$/, 'MiniMax'],
  [/(^|\.)baichuan-ai\.com$/, '百川'],
  [/(^|\.)lingyiwanwu\.com$/, '零一万物'],
  [/^qianfan\.baidubce\.com$|^aip\.baidubce\.com$/, '百度千帆'],
  [/hunyuan\.(tencentcloudapi|cloud\.tencent)\.com$/, '腾讯混元'],
  [/openai\.azure\.com$/, 'Azure OpenAI'],
  [/(^|\.)cohere\.(ai|com)$/, 'Cohere'],
  [/(^|\.)together\.(xyz|ai)$/, 'Together AI'],
  [/(^|\.)perplexity\.ai$/, 'Perplexity'],
  [/(^|\.)github\.com$/, 'GitHub'],
  [/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/, '本地服务'],
];

export function friendlyHostName(host: string): string {
  const h = host.toLowerCase();
  for (const [re, name] of KNOWN_HOSTS) if (re.test(h)) return `${name} · ${host}`;
  return host;
}

const ENDPOINT_NAMES: [RegExp, string][] = [
  [/\/chat\/completions\/?$/, '对话补全'],
  [/\/completions\/?$/, '文本补全'],
  [/\/embeddings\/?$/, '向量嵌入'],
  [/\/images\/generations\/?$/, '图像生成'],
  [/\/images\/edits\/?$/, '图像编辑'],
  [/\/images\/variations\/?$/, '图像变体'],
  [/\/audio\/speech\/?$/, '语音合成'],
  [/\/audio\/transcriptions\/?$/, '语音转写'],
  [/\/audio\/translations\/?$/, '语音翻译'],
  [/\/moderations\/?$/, '内容审核'],
  [/\/rerank\/?$/, '重排序'],
  [/\/responses\/?$/, 'Responses 接口'],
  [/\/messages\/count_tokens\/?$/, 'Token 计数'],
  [/\/messages\/?$/, '消息对话'],
  [/:streamGenerateContent$/, '流式生成内容'],
  [/:generateContent$/, '生成内容'],
  [/:embedContent$/, '向量嵌入'],
  [/:countTokens$/, 'Token 计数'],
  [/\/models\/?$/, '模型列表'],
  [/\/files\/?$/, '文件列表'],
  [/\/batches\/?$/, '批处理'],
  [/\/fine[_-]?tuning\/jobs\/?$/, '微调任务'],
  [/\/(user\/)?balance\/?$/, '余额查询'],
  [/\/dashboard\/billing\/(subscription|usage)\/?$/, '账单查询'],
  [/\/videos?\/generations?\/?$/, '视频生成'],
  [/\/graphql\/?$/, 'GraphQL 查询'],
];

function truncate(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
}

export function suggestRequestName(method: string, url: string, bodyText: string): string {
  let path = '';
  try {
    path = new URL(url.replace(/\{\{[^}]+\}\}/g, 'x')).pathname;
  } catch {
    path = splitUrl(url).base.replace(/^\w+:\/\/[^/]+/, '');
  }
  path = decodeURIComponentSafe(path);
  let name = '';
  for (const [re, n] of ENDPOINT_NAMES) {
    if (re.test(path)) {
      name = n;
      break;
    }
  }
  const parts: string[] = [];
  let body: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed;
  } catch {
    /* ignore */
  }
  // Gemini: /models/gemini-pro:generateContent
  const gm = /\/models\/([^/:]+):/.exec(path);
  const model = (body?.model as string) || gm?.[1];
  if (!name) {
    const segs = path.split('/').filter(Boolean).filter((s) => !/^v\d+[a-z]*$/i.test(s));
    const tail = segs.slice(-2).join('/');
    name = `${method.toUpperCase()} /${tail || ''}`.trim();
  }
  parts.push(name);
  if (typeof model === 'string' && model) parts.push(model);
  // 对话的最后一条用户消息
  const msgs = body?.messages ?? body?.contents ?? body?.input;
  let snippet = '';
  if (Array.isArray(msgs)) {
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i] as Record<string, unknown>;
      if (!m || (m.role && m.role !== 'user')) continue;
      snippet = extractText(m.content ?? m.parts ?? m.text);
      if (snippet) break;
    }
  } else if (typeof msgs === 'string') snippet = msgs;
  else if (typeof body?.prompt === 'string') snippet = body.prompt as string;
  if (snippet) parts.push(truncate(snippet, 16));
  let result = parts.join(' · ');
  if (body?.stream === true) result += '（流式）';
  return result;
}

function extractText(c: unknown): string {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    for (const p of c) {
      const t = extractText((p as Record<string, unknown>)?.text ?? p);
      if (t) return t;
    }
  }
  if (c && typeof c === 'object' && typeof (c as Record<string, unknown>).text === 'string') return (c as Record<string, string>).text;
  return '';
}

function decodeURIComponentSafe(s: string) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function secretHint(kind: 'bearer' | 'header' | 'query' | 'password', name: string, value: string): string {
  if (kind === 'password') return 'password';
  if (kind === 'bearer') return value.startsWith('eyJ') ? 'token' : 'api_key';
  const n = name.toLowerCase();
  if (/access[-_]?token/.test(n)) return 'access_token';
  if (/secret/.test(n)) return 'secret';
  if (/token/.test(n)) return 'token';
  if (/sig/.test(n)) return 'signature';
  return 'api_key';
}

function versionPrefix(pathname: string): string {
  const m = /^((?:\/api)?(?:\/openai|\/compatible-mode|\/anthropic)?\/v\d+(?:beta|alpha)?\d*)(?=\/|$)/i.exec(pathname);
  return m ? m[1] : '';
}

function folderPath(data: AppData, folderId: string | null): string {
  return folderChain(data, folderId)
    .map((f) => f.name)
    .join(' / ');
}

function cloneKV(list: { key: string; value: string }[]): KV[] {
  return list.map((h) => ({ id: uid('kv_'), key: h.key, value: h.value, enabled: true }));
}

/** 生成导入计划（纯函数，可随用户在预览中的修改反复调用） */
export function planImport(
  parsed: ParsedCurl,
  data: AppData,
  workspaceId: string,
  opts: ImportOptions,
  ov: ImportOverrides = {},
): ImportPlan {
  const notes: string[] = [];
  let urlObj: URL | null = null;
  try {
    if (/^https?:\/\//i.test(parsed.url)) urlObj = new URL(parsed.url);
  } catch {
    urlObj = null;
  }
  const host = urlObj?.host ?? '';

  // ---------- 1. 目标文件夹 ----------
  const wsFolders = data.folders.filter((f) => f.workspaceId === workspaceId);
  let folder: ImportPlan['folder'];
  const target = ov.target ?? '__auto__';
  if (target === '__root__') {
    folder = { kind: 'root', name: '（根目录）', path: '（根目录）' };
  } else if (target === '__new__') {
    const name = ov.newFolderName?.trim() || (host ? friendlyHostName(host) : '新文件夹');
    folder = { kind: 'new', name, host: host || undefined, path: name };
  } else if (target !== '__auto__') {
    const f = wsFolders.find((x) => x.id === target);
    folder = f
      ? { kind: 'existing', id: f.id, name: f.name, host: f.host, path: folderPath(data, f.id) }
      : { kind: 'root', name: '（根目录）', path: '（根目录）' };
  } else if (opts.groupByHost && host) {
    const existing =
      wsFolders.find((f) => f.parentId === null && f.host === host) ??
      wsFolders.find((f) => f.host === host) ??
      wsFolders.find((f) => f.name === host || f.name === friendlyHostName(host));
    if (existing) folder = { kind: 'existing', id: existing.id, name: existing.name, host: existing.host, path: folderPath(data, existing.id) };
    else {
      const name = friendlyHostName(host);
      folder = { kind: 'new', name, host, path: name };
    }
  } else {
    folder = { kind: 'root', name: '（根目录）', path: '（根目录）' };
  }

  // ---------- 2. 已有变量上下文 ----------
  const base = data.environments.find((e) => e.workspaceId === workspaceId && e.isBase);
  const chain: Folder[] = folder.kind === 'existing' ? folderChain(data, folder.id!) : [];
  const targetFolder = folder.kind === 'existing' ? chain[chain.length - 1] : undefined;
  // 从内到外查找
  const lookup: { v: Variable; scope: 'folder' | 'base' }[] = [
    ...[...chain].reverse().flatMap((f) => f.variables.map((v) => ({ v, scope: 'folder' as const }))),
    ...(base?.variables ?? []).map((v) => ({ v, scope: 'base' as const })),
  ].filter((x) => x.v.enabled !== false && x.v.key);

  const takenFolder = new Set((targetFolder?.variables ?? []).map((v) => v.key));
  const takenBase = new Set((base?.variables ?? []).map((v) => v.key));
  const planVars: PlannedVar[] = [];
  const newScope: 'folder' | 'base' = folder.kind === 'root' ? 'base' : 'folder';

  const uniqueName = (hint: string, scope: 'folder' | 'base') => {
    const taken = scope === 'folder' ? takenFolder : takenBase;
    const planned = new Set(planVars.filter((p) => p.status === 'new' && p.scope === scope).map((p) => p.key));
    let name = hint;
    let i = 2;
    while (taken.has(name) || planned.has(name)) name = `${hint}_${i++}`;
    return name;
  };

  /** 为一个密钥值分配变量，返回模板文本；被禁用时返回原值 */
  const secretVar = (slot: string, label: string, value: string, hint: string): string => {
    if (!value || value.includes('{{')) return value;
    const disabled = !opts.extractSecrets || ov.varDisabled?.[slot];
    // 同一值已在本次计划中
    const samePlan = planVars.find((p) => p.value === value && p.enabled);
    if (samePlan && !disabled) {
      return `{{${samePlan.key}}}`;
    }
    const existing = lookup.find((x) => x.v.value === value);
    let pv: PlannedVar;
    if (existing) {
      pv = { slot, label, key: existing.v.key, value, secret: true, scope: existing.scope, status: 'reuse', enabled: !disabled };
    } else {
      const want = ov.varNames?.[slot]?.trim();
      const key = want || uniqueName(hint, newScope);
      pv = { slot, label, key, value, secret: true, scope: newScope, status: 'new', enabled: !disabled };
    }
    planVars.push(pv);
    return pv.enabled ? `{{${pv.key}}}` : value;
  };

  // ---------- 3. URL / Base URL ----------
  let url = parsed.url;
  if (opts.extractBaseUrl && urlObj && !ov.varDisabled?.['base_url']) {
    const slot = 'base_url';
    const cleanUrl = parsed.url;
    // 已有变量中寻找最长前缀
    let best: { v: Variable; scope: 'folder' | 'base' } | null = null;
    for (const x of lookup) {
      const val = x.v.value.replace(/\/+$/, '');
      if (!/^https?:\/\//i.test(val)) continue;
      if (cleanUrl.startsWith(val) && /^($|[/?#])/.test(cleanUrl.slice(val.length))) {
        if (!best || val.length > best.v.value.replace(/\/+$/, '').length) best = x;
      }
    }
    if (best && !ov.varNames?.[slot]) {
      const val = best.v.value.replace(/\/+$/, '');
      planVars.push({ slot, label: '接口地址前缀', key: best.v.key, value: best.v.value, secret: false, scope: best.scope, status: 'reuse', enabled: true });
      url = `{{${best.v.key}}}` + cleanUrl.slice(val.length);
    } else {
      const prefix = urlObj.origin + versionPrefix(urlObj.pathname);
      const want = ov.varNames?.[slot]?.trim();
      const key = want || uniqueName('base_url', newScope);
      planVars.push({ slot, label: '接口地址前缀', key, value: prefix, secret: false, scope: newScope, status: 'new', enabled: true });
      url = `{{${key}}}` + cleanUrl.slice(prefix.length);
    }
  } else if (opts.extractBaseUrl && urlObj) {
    planVars.push({ slot: 'base_url', label: '接口地址前缀', key: 'base_url', value: urlObj.origin, secret: false, scope: newScope, status: 'new', enabled: false });
  }

  // ---------- 4. 认证 ----------
  let auth: Auth = { type: 'none' };
  const headers = parsed.headers.map((h) => ({ ...h }));
  if (parsed.auth?.type === 'basic') {
    auth = {
      type: 'basic',
      username: parsed.auth.username ?? '',
      password: secretVar('basic:password', 'Basic 认证密码', parsed.auth.password ?? '', 'password'),
    };
  } else if (parsed.auth?.type === 'bearer') {
    auth = { type: 'bearer', prefix: 'Bearer', token: secretVar('auth:bearer', 'Bearer 令牌', parsed.auth.token ?? '', secretHint('bearer', '', parsed.auth.token ?? '')) };
  }
  const authIdx = headers.findIndex((h) => h.key.toLowerCase() === 'authorization');
  if (authIdx >= 0 && auth.type === 'none') {
    const value = headers[authIdx].value;
    const bearer = /^(Bearer|Token|JWT)\s+(.+)$/i.exec(value);
    const basic = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(value);
    if (bearer && bearer[1].toLowerCase() === 'bearer') {
      auth = { type: 'bearer', prefix: 'Bearer', token: secretVar('auth:bearer', 'Authorization: Bearer 令牌', bearer[2].trim(), secretHint('bearer', '', bearer[2])) };
      headers.splice(authIdx, 1);
    } else if (basic) {
      let decoded = '';
      try {
        decoded = typeof atob === 'function' ? decodeURIComponentSafe(escape(atob(basic[1]))) : Buffer.from(basic[1], 'base64').toString('utf8');
      } catch {
        decoded = '';
      }
      const idx = decoded.indexOf(':');
      if (idx >= 0) {
        auth = { type: 'basic', username: decoded.slice(0, idx), password: secretVar('basic:password', 'Basic 认证密码', decoded.slice(idx + 1), 'password') };
        headers.splice(authIdx, 1);
      } else {
        headers[authIdx].value = secretVar('header:authorization', 'Authorization 请求头', value, 'token');
      }
    } else if (bearer) {
      headers[authIdx].value = `${bearer[1]} ${secretVar('header:authorization', `Authorization: ${bearer[1]}`, bearer[2].trim(), 'token')}`;
    } else if (value && !value.includes('{{')) {
      headers[authIdx].value = secretVar('header:authorization', 'Authorization 请求头', value, 'api_key');
    }
  }

  // ---------- 5. 密钥类请求头 ----------
  for (const h of headers) {
    if (h.key.toLowerCase() === 'authorization') continue;
    if (SECRET_HEADER_RE.test(h.key) && h.value) {
      h.value = secretVar(`header:${h.key.toLowerCase()}`, `${h.key} 请求头`, h.value, secretHint('header', h.key, h.value));
    }
  }

  // ---------- 6. 密钥类查询参数 ----------
  {
    const { base: b, query, hash } = splitUrl(url);
    if (query) {
      const pairs = query.split('&').map((pair) => {
        const idx = pair.indexOf('=');
        if (idx < 0) return pair;
        const k = pair.slice(0, idx);
        const v = pair.slice(idx + 1);
        if (SECRET_QUERY_RE.test(k) && v && !v.includes('{{')) {
          return `${k}=${secretVar(`query:${k}`, `查询参数 ${k}`, decodeURIComponentSafe(v), secretHint('query', k, v))}`;
        }
        return pair;
      });
      url = `${b}?${pairs.join('&')}${hash}`;
    }
  }

  // ---------- 7. 环境变量引用 ($OPENAI_API_KEY) ----------
  const renames: Record<string, string> = {};
  for (const name of parsed.envRefs) {
    const slot = `env:${name}`;
    const want = ov.varNames?.[slot]?.trim();
    const key = want || name;
    if (key !== name) renames[name] = key;
    const known = parsed.envValues[name];
    const existing = lookup.find((x) => x.v.key === key);
    const secret = SECRET_NAME_RE.test(key);
    if (existing) {
      if (!existing.v.value && known) {
        planVars.push({ slot, label: `环境变量 $${name}`, key, value: known, secret, scope: existing.scope, status: 'fill', enabled: !ov.varDisabled?.[slot] });
      } else {
        planVars.push({ slot, label: `环境变量 $${name}`, key, value: existing.v.value, secret, scope: existing.scope, status: 'reuse', enabled: true });
      }
    } else {
      planVars.push({
        slot,
        label: `环境变量 $${name}`,
        key,
        value: known ?? '',
        secret,
        scope: 'base',
        status: 'new',
        enabled: !ov.varDisabled?.[slot],
        needsValue: !known,
      });
      if (!known) notes.push(`命令中引用了环境变量 $${name}，已创建同名全局变量，请填写它的值`);
    }
  }
  const applyRenames = (s: string) => {
    let out = s;
    for (const [from, to] of Object.entries(renames)) out = out.split(`{{${from}}}`).join(`{{${to}}}`);
    return out;
  };

  // ---------- 8. 组装请求 ----------
  url = applyRenames(url);
  const finalHeaders = cloneKV(headers.map((h) => ({ key: h.key, value: applyRenames(h.value) })));
  if (auth.token) auth.token = applyRenames(auth.token);
  if (auth.password) auth.password = applyRenames(auth.password);
  const params: KV[] = parseQuery(splitUrl(url).query).map((p) => ({ id: uid('kv_'), key: p.key, value: p.value, enabled: true }));
  const body = emptyBody();
  body.type = parsed.body.type;
  body.text = applyRenames(parsed.body.text);
  body.form = cloneKV(parsed.body.form.map((f) => ({ key: f.key, value: applyRenames(f.value) })));
  body.multipart = parsed.body.multipart.map((m) => ({
    id: uid('kv_'),
    key: m.key,
    value: m.isFile ? '' : applyRenames(m.value),
    enabled: true,
    isFile: m.isFile,
    fileName: m.isFile ? m.fileName : undefined,
    contentType: m.contentType,
  }));
  if (parsed.body.graphql) body.graphql = { ...parsed.body.graphql };

  const name = ov.name?.trim() || suggestRequestName(parsed.method, parsed.url, parsed.body.text);

  // 原始命令脱敏
  let masked = parsed.raw;
  const secrets = planVars.filter((p) => p.secret && p.value).map((p) => p.value);
  if (parsed.auth?.password) secrets.push(parsed.auth.password);
  for (const s of [...new Set(secrets)].sort((a, b) => b.length - a.length)) {
    if (s.length >= 4) masked = masked.split(s).join(maskSecret(s));
  }
  // Basic 认证的 base64 也要脱敏
  masked = masked.replace(/(Basic\s+)([A-Za-z0-9+/=]{8,})/g, (_, p, v) => p + maskSecret(v));

  const usedVars = planVars.filter((p) => p.enabled);
  const desc = [
    `## ${name}`,
    '',
    `- **来源**：从 cURL 导入（${formatTime(Date.now())}）`,
    `- **接口**：\`${parsed.method} ${maskUrlSecrets(parsed.url, secrets)}\``,
    folder.kind !== 'root' ? `- **归档位置**：${folder.path}` : '',
    usedVars.length
      ? `- **使用的变量**：${usedVars.map((v) => `\`{{${v.key}}}\`${v.secret ? '（密钥）' : ''}`).join('、')}`
      : '',
    parsed.jqFilter ? `- **响应筛选**：\`${parsed.jqFilter}\`` : '',
    parsed.warnings.length ? `- **注意**：${parsed.warnings.join('；')}` : '',
    '',
    '### 原始命令（密钥已脱敏）',
    '',
    '```bash',
    masked,
    '```',
  ]
    .filter((l, i, arr) => l !== '' || arr[i - 1] !== '')
    .join('\n');

  const request = newRequest(workspaceId, folder.id ?? null, {
    name,
    method: parsed.method,
    url,
    params,
    headers: finalHeaders,
    body,
    auth,
    settings: {
      ...(parsed.insecure ? { verifySSL: false } : {}),
      ...(parsed.followRedirects ? { followRedirects: true } : {}),
      ...(parsed.timeoutMs ? { timeoutMs: parsed.timeoutMs } : {}),
    },
    responseFilter: parsed.jqFilter && parsed.jqFilter !== '.' ? parsed.jqFilter : undefined,
    description: desc,
    source: { kind: 'curl', raw: masked, importedAt: Date.now() },
  });

  // ---------- 9. 查重 ----------
  let duplicateOf: ImportPlan['duplicateOf'];
  const siblings = data.requests.filter(
    (r) => r.workspaceId === workspaceId && r.folderId === (folder.kind === 'existing' ? folder.id : folder.kind === 'root' ? null : '__none__'),
  );
  const norm = (s: string) => (s ?? '').replace(/\s+/g, '');
  const dup = siblings.find(
    (r) =>
      r.method.toUpperCase() === request.method.toUpperCase() &&
      r.url === request.url &&
      r.body.type === request.body.type &&
      norm(r.body.text) === norm(request.body.text) &&
      JSON.stringify(r.body.form.map((f) => [f.key, f.value])) === JSON.stringify(request.body.form.map((f) => [f.key, f.value])),
  );
  if (dup) {
    duplicateOf = { id: dup.id, name: dup.name };
    notes.push(`已存在完全相同的请求「${dup.name}」`);
  }

  if (parsed.followRedirects === false) {
    /* curl 默认不跟随重定向，这里沿用全局设置 */
  }

  return {
    parsed,
    workspaceId,
    folder,
    request,
    vars: planVars,
    duplicateOf,
    createDuplicate: !!ov.createDuplicate,
    notes: [...notes, ...parsed.warnings],
  };
}

function maskUrlSecrets(url: string, secrets: string[]) {
  let out = url;
  for (const s of secrets) if (s.length >= 4) out = out.split(s).join(maskSecret(s)).split(encodeURIComponent(s)).join(maskSecret(s));
  return out;
}

export interface ApplyResult {
  data: AppData;
  requestId: string;
  folderId: string | null;
  created: boolean;
  createdVars: string[];
}

/** 执行导入计划，返回新的数据（不修改入参） */
export function applyImport(data: AppData, plan: ImportPlan): ApplyResult {
  const folders = data.folders.map((f) => ({ ...f, variables: [...f.variables] }));
  const environments = data.environments.map((e) => ({ ...e, variables: [...e.variables] }));
  const requests = [...data.requests];
  const createdVars: string[] = [];

  let folderId: string | null = null;
  if (plan.folder.kind === 'existing') folderId = plan.folder.id!;
  else if (plan.folder.kind === 'new') {
    const host = plan.folder.host;
    const f = newFolder(plan.workspaceId, null, {
      name: plan.folder.name,
      host,
      description: host
        ? `## ${plan.folder.name}\n\n站点 \`${host}\` 的接口集合，由 cURL 导入自动归档。\n\n文件夹变量中保存了该站点的接口地址与密钥，文件夹内的请求会自动继承这些变量。`
        : '',
    });
    folders.push(f);
    folderId = f.id;
  }

  const base = environments.find((e) => e.workspaceId === plan.workspaceId && e.isBase);
  const targetFolder = folders.find((f) => f.id === folderId);

  for (const v of plan.vars) {
    if (!v.enabled) continue;
    if (v.status === 'new') {
      const variable: Variable = {
        id: uid('kv_'),
        key: v.key,
        value: v.value,
        enabled: true,
        secret: v.secret,
        note: `从 cURL 导入 · ${v.label}`,
      };
      if (v.scope === 'folder' && targetFolder) {
        if (!targetFolder.variables.some((x) => x.key === v.key)) targetFolder.variables.push(variable);
      } else if (base) {
        if (!base.variables.some((x) => x.key === v.key)) base.variables.push(variable);
      }
      createdVars.push(v.key);
    } else if (v.status === 'fill') {
      const holder = v.scope === 'folder' ? [...folders] : base ? [base] : [];
      for (const h of holder) {
        const idx = h.variables.findIndex((x) => x.key === v.key && !x.value);
        if (idx >= 0) {
          h.variables[idx] = { ...h.variables[idx], value: v.value };
          break;
        }
      }
    }
  }

  if (plan.duplicateOf && !plan.createDuplicate) {
    // 更新已有请求的筛选表达式等补充信息
    const idx = requests.findIndex((r) => r.id === plan.duplicateOf!.id);
    if (idx >= 0 && plan.request.responseFilter && !requests[idx].responseFilter) {
      requests[idx] = { ...requests[idx], responseFilter: plan.request.responseFilter, updatedAt: Date.now() };
    }
    return { data: { ...data, folders, environments, requests }, requestId: plan.duplicateOf.id, folderId, created: false, createdVars };
  }

  const maxOrder = Math.max(0, ...requests.filter((r) => r.folderId === folderId && r.workspaceId === plan.workspaceId).map((r) => r.sortOrder));
  const req: HttpRequest = { ...plan.request, id: uid('req_'), folderId, workspaceId: plan.workspaceId, sortOrder: maxOrder + 1 };
  requests.push(req);
  return { data: { ...data, folders, environments, requests }, requestId: req.id, folderId, created: true, createdVars };
}

/** 批量导入：依次规划并应用（后面的命令可复用前面创建的文件夹与变量） */
export function importAll(data: AppData, parsedList: ParsedCurl[], workspaceId: string, opts: ImportOptions): { data: AppData; results: ApplyResult[]; plans: ImportPlan[] } {
  let cur = data;
  const results: ApplyResult[] = [];
  const plans: ImportPlan[] = [];
  for (const p of parsedList) {
    const plan = planImport(p, cur, workspaceId, opts);
    const r = applyImport(cur, plan);
    cur = r.data;
    results.push(r);
    plans.push(plan);
  }
  return { data: cur, results, plans };
}
