/**
 * cURL 命令解析器
 *
 * 支持：
 *  - bash / zsh 风格（反斜杠续行、单双引号、$'...' ANSI-C 字符串、$VAR / ${VAR} 环境变量引用）
 *  - Windows cmd 风格（^ 续行与转义，例如 Chrome「复制为 cURL (cmd)」）
 *  - PowerShell 反引号续行
 *  - 管道（| jq '...'）、export VAR=xxx 赋值、多条命令批量粘贴
 */
import type { Auth, BodyType } from './types';

export interface ParsedHeader {
  key: string;
  value: string;
}

export interface ParsedMultipart {
  key: string;
  value: string;
  isFile?: boolean;
  fileName?: string;
  contentType?: string;
}

export interface ParsedCurl {
  method: string;
  url: string;
  headers: ParsedHeader[];
  body: {
    type: BodyType;
    text: string;
    form: ParsedHeader[];
    multipart: ParsedMultipart[];
    graphql?: { query: string; variables: string };
  };
  auth: Auth | null;
  insecure: boolean;
  followRedirects: boolean;
  timeoutMs?: number;
  proxy?: string;
  /** 管道中 jq 的过滤表达式 */
  jqFilter?: string;
  /** 命令中引用的环境变量名（已被替换为 {{NAME}}） */
  envRefs: string[];
  /** 同一段粘贴内容中 export NAME=value 给出的值 */
  envValues: Record<string, string>;
  warnings: string[];
  /** 原始命令文本 */
  raw: string;
}

type Token = { type: 'word'; value: string } | { type: 'op'; value: string };

interface TokenizeCtx {
  envRefs: Set<string>;
  warnings: string[];
  cmdMode: boolean;
}

const VAR_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function readVar(input: string, i: number, ctx: TokenizeCtx): { text: string; end: number } | null {
  // input[i] === '$'
  const next = input[i + 1];
  if (next === '{') {
    const close = input.indexOf('}', i + 2);
    if (close === -1) return null;
    const inner = input.slice(i + 2, close);
    const name = inner.split(/[:\-=?+#%/]/)[0];
    if (!VAR_NAME.test(name)) return null;
    ctx.envRefs.add(name);
    return { text: `{{${name}}}`, end: close + 1 };
  }
  if (next && /[A-Za-z_]/.test(next)) {
    let j = i + 1;
    while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) j++;
    const name = input.slice(i + 1, j);
    ctx.envRefs.add(name);
    return { text: `{{${name}}}`, end: j };
  }
  if (next === '(') {
    // 命令替换 $(...)，保留原文
    let depth = 0;
    let j = i + 1;
    for (; j < input.length; j++) {
      if (input[j] === '(') depth++;
      else if (input[j] === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
    const text = input.slice(i, j + 1);
    ctx.warnings.push(`检测到命令替换 ${text}，已按原文保留，请手动替换为实际值`);
    return { text, end: j + 1 };
  }
  return null;
}

function readAnsiC(input: string, i: number): { text: string; end: number } {
  // input[i] === '$', input[i+1] === "'"
  let j = i + 2;
  let out = '';
  while (j < input.length && input[j] !== "'") {
    const c = input[j];
    if (c === '\\' && j + 1 < input.length) {
      const e = input[j + 1];
      j += 2;
      switch (e) {
        case 'n':
          out += '\n';
          break;
        case 't':
          out += '\t';
          break;
        case 'r':
          out += '\r';
          break;
        case '0':
          out += '\0';
          break;
        case 'a':
          out += '\x07';
          break;
        case 'b':
          out += '\b';
          break;
        case 'e':
        case 'E':
          out += '\x1b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'v':
          out += '\v';
          break;
        case 'x': {
          const m = /^[0-9a-fA-F]{1,2}/.exec(input.slice(j));
          if (m) {
            out += String.fromCharCode(parseInt(m[0], 16));
            j += m[0].length;
          } else out += '\\x';
          break;
        }
        case 'u':
        case 'U': {
          const m = (e === 'u' ? /^[0-9a-fA-F]{1,4}/ : /^[0-9a-fA-F]{1,8}/).exec(input.slice(j));
          if (m) {
            out += String.fromCodePoint(parseInt(m[0], 16));
            j += m[0].length;
          } else out += '\\' + e;
          break;
        }
        default:
          out += e;
      }
      continue;
    }
    out += c;
    j++;
  }
  return { text: out, end: j + 1 };
}

export function tokenize(input: string, ctx: TokenizeCtx): Token[] {
  const tokens: Token[] = [];
  const n = input.length;
  let i = 0;
  let cur = '';
  let inWord = false;
  const push = () => {
    if (inWord) {
      tokens.push({ type: 'word', value: cur });
      cur = '';
      inWord = false;
    }
  };

  while (i < n) {
    const c = input[i];

    // 反斜杠：续行或转义
    if (c === '\\' && !ctx.cmdMode) {
      const next = input[i + 1];
      if (next === '\n') {
        i += 2;
        continue;
      }
      if (next === '\r' && input[i + 2] === '\n') {
        i += 3;
        continue;
      }
      if (next === undefined) {
        i++;
        continue;
      }
      cur += next;
      inWord = true;
      i += 2;
      continue;
    }

    if (c === "'" && !ctx.cmdMode) {
      const end = input.indexOf("'", i + 1);
      inWord = true;
      if (end === -1) {
        cur += input.slice(i + 1);
        ctx.warnings.push('单引号未闭合，已按文本末尾处理');
        i = n;
      } else {
        cur += input.slice(i + 1, end);
        i = end + 1;
      }
      continue;
    }

    if (c === '$' && input[i + 1] === "'" && !ctx.cmdMode) {
      const r = readAnsiC(input, i);
      cur += r.text;
      inWord = true;
      i = r.end;
      continue;
    }

    if (c === '"') {
      i++;
      inWord = true;
      while (i < n && input[i] !== '"') {
        const d = input[i];
        if (d === '\\' && i + 1 < n) {
          const e = input[i + 1];
          if (ctx.cmdMode) {
            if (e === '"' || e === '\\') {
              cur += e;
              i += 2;
              continue;
            }
            cur += d;
            i++;
            continue;
          }
          if (e === '"' || e === '\\' || e === '$' || e === '`') {
            cur += e;
            i += 2;
            continue;
          }
          if (e === '\n') {
            i += 2;
            continue;
          }
          cur += d;
          i++;
          continue;
        }
        if (d === '$' && !ctx.cmdMode) {
          const r = readVar(input, i, ctx);
          if (r) {
            cur += r.text;
            i = r.end;
            continue;
          }
        }
        cur += d;
        i++;
      }
      if (i >= n) ctx.warnings.push('双引号未闭合，已按文本末尾处理');
      else i++;
      continue;
    }

    if (c === '$' && !ctx.cmdMode) {
      const r = readVar(input, i, ctx);
      if (r) {
        cur += r.text;
        inWord = true;
        i = r.end;
        continue;
      }
    }

    if (c === ' ' || c === '\t' || c === '\u00a0') {
      push();
      i++;
      continue;
    }
    if (c === '\r') {
      i++;
      continue;
    }
    if (c === '\n') {
      push();
      tokens.push({ type: 'op', value: '\n' });
      i++;
      continue;
    }
    if (c === '#' && !inWord) {
      while (i < n && input[i] !== '\n') i++;
      continue;
    }
    if (c === '|') {
      push();
      if (input[i + 1] === '|') {
        tokens.push({ type: 'op', value: '||' });
        i += 2;
      } else {
        tokens.push({ type: 'op', value: '|' });
        i++;
      }
      continue;
    }
    if (c === '&') {
      push();
      if (input[i + 1] === '&') {
        tokens.push({ type: 'op', value: '&&' });
        i += 2;
      } else {
        tokens.push({ type: 'op', value: '&' });
        i++;
      }
      continue;
    }
    if (c === ';') {
      push();
      tokens.push({ type: 'op', value: ';' });
      i++;
      continue;
    }
    if (c === '>' || c === '<') {
      // 处理 2>&1、>/dev/null、>> 等重定向
      if (inWord && (cur === '1' || cur === '2')) {
        cur = '';
        inWord = false;
      }
      push();
      let j = i + 1;
      if (input[j] === '>') j++;
      if (input[j] === '&') {
        j++;
        while (j < n && /[0-9-]/.test(input[j])) j++;
        i = j;
        continue;
      }
      tokens.push({ type: 'op', value: '>' });
      i = j;
      continue;
    }
    cur += c;
    inWord = true;
    i++;
  }
  push();
  return tokens;
}

/** 预处理：去除提示符、统一换行、处理 cmd / PowerShell 续行 */
function preprocess(raw: string): { text: string; cmdMode: boolean } {
  let text = raw.replace(/\r\n?/g, '\n');
  // 全角/不间断空格等
  text = text.replace(/[\u2028\u2029]/g, '\n');
  // AI 有时会给出 “智能引号”
  text = text.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // Markdown 代码块
  text = text.replace(/^\s*```[a-zA-Z]*\s*$/gm, '');
  // 行首的 $ 或 > 提示符
  text = text.replace(/^[ \t]*[$>][ \t]+(?=curl\b)/gm, '');
  let cmdMode = false;
  if (/\^\n/.test(text) || /\^"/.test(text)) {
    cmdMode = true;
    text = text.replace(/\^\n/g, ' ').replace(/\^(.)/g, '$1');
  }
  if (/`\n/.test(text)) {
    text = text.replace(/`\n/g, ' ');
  }
  return { text, cmdMode };
}

// 带参数的短选项
const SHORT_WITH_ARG = new Set('HdXuAbeFmoxTwKEcCrYyzUQPDt'.split(''));
// 带参数的长选项
const LONG_WITH_ARG = new Set([
  'header',
  'data',
  'data-raw',
  'data-binary',
  'data-ascii',
  'data-urlencode',
  'json',
  'request',
  'url',
  'url-query',
  'user',
  'user-agent',
  'cookie',
  'cookie-jar',
  'referer',
  'form',
  'form-string',
  'max-time',
  'connect-timeout',
  'output',
  'proxy',
  'proxy-user',
  'write-out',
  'upload-file',
  'cacert',
  'capath',
  'cert',
  'cert-type',
  'key',
  'key-type',
  'pass',
  'resolve',
  'connect-to',
  'retry',
  'retry-delay',
  'retry-max-time',
  'limit-rate',
  'oauth2-bearer',
  'aws-sigv4',
  'variable',
  'range',
  'config',
  'interface',
  'dns-servers',
  'max-redirs',
  'max-filesize',
  'speed-limit',
  'speed-time',
  'trace',
  'trace-ascii',
  'stderr',
  'dump-header',
  'expect100-timeout',
  'keepalive-time',
  'local-port',
  'noproxy',
  'preproxy',
  'proxy-header',
  'request-target',
  'unix-socket',
  'abstract-unix-socket',
  'socks5',
  'socks5-hostname',
  'socks4',
  'socks4a',
  'tls-max',
  'ciphers',
  'header-file',
  'happy-eyeballs-timeout-ms',
  'hostpubmd5',
  'netrc-file',
  'output-dir',
  'parallel-max',
  'ftp-port',
  'quote',
  'mail-from',
  'mail-rcpt',
  'telnet-option',
  'time-cond',
  'delegation',
  'krb',
  'login-options',
  'sasl-authzid',
  'service-name',
]);

const SHORT_ALIASES: Record<string, string> = {
  H: 'header',
  d: 'data',
  X: 'request',
  u: 'user',
  A: 'user-agent',
  b: 'cookie',
  c: 'cookie-jar',
  e: 'referer',
  F: 'form',
  m: 'max-time',
  o: 'output',
  x: 'proxy',
  T: 'upload-file',
  w: 'write-out',
  K: 'config',
  E: 'cert',
  G: 'get',
  I: 'head',
  k: 'insecure',
  L: 'location',
  s: 'silent',
  S: 'show-error',
  v: 'verbose',
  i: 'include',
  f: 'fail',
  N: 'no-buffer',
  Z: 'parallel',
  '0': 'http1.0',
};

function isCurlCommand(word: string): boolean {
  const base = word.split(/[\\/]/).pop()!.toLowerCase();
  return base === 'curl' || base === 'curl.exe';
}

function splitHeader(h: string): ParsedHeader | null {
  const idx = h.indexOf(':');
  if (idx === -1) {
    // "Header;" 表示空值头
    if (h.endsWith(';')) return { key: h.slice(0, -1).trim(), value: '' };
    return null;
  }
  const key = h.slice(0, idx).trim();
  const value = h.slice(idx + 1).trim();
  if (!key) return null;
  return { key, value };
}

function getHeader(headers: ParsedHeader[], name: string): string | undefined {
  const lower = name.toLowerCase();
  return headers.find((h) => h.key.toLowerCase() === lower)?.value;
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
}

/** 尽量把 JSON 格式化为 2 空格缩进；含大整数时只做去缩进，避免精度丢失 */
export function prettyJson(text: string): string | null {
  const t = text.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return null;
  try {
    const v = JSON.parse(t);
    if (/(?<![\w.])\d{16,}/.test(t)) return dedent(t);
    return JSON.stringify(v, null, 2);
  } catch {
    return null;
  }
}

function dedent(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 1) return text;
  const rest = lines.slice(1).filter((l) => l.trim());
  const min = Math.min(...rest.map((l) => /^\s*/.exec(l)![0].length));
  if (!isFinite(min) || min === 0) return text;
  return [lines[0], ...lines.slice(1).map((l) => l.slice(Math.min(min, /^\s*/.exec(l)![0].length)))].join('\n');
}

function looksLikeForm(text: string): boolean {
  return /^[^=&\s{}[\]"<>]+=[^&\s]*(&[^=&\s]+=[^&\s]*)*$/.test(text.trim());
}

interface CurlArgsResult {
  parsed: ParsedCurl;
}

function parseCurlArgs(args: string[], raw: string, envRefs: string[], envValues: Record<string, string>, warnings: string[]): CurlArgsResult {
  let method: string | null = null;
  let url: string | null = null;
  const urlQueries: string[] = [];
  const headers: ParsedHeader[] = [];
  const dataParts: string[] = [];
  let jsonMode = false;
  const multipart: ParsedMultipart[] = [];
  let getMode = false;
  let headMode = false;
  let uploadFile: string | null = null;
  let auth: Auth | null = null;
  let insecure = false;
  let followRedirects = false;
  let timeoutMs: number | undefined;
  let proxy: string | undefined;
  let dataFromFile = false;

  const handle = (name: string, value: string | undefined) => {
    switch (name) {
      case 'header': {
        const h = splitHeader(value ?? '');
        if (h) {
          // "Header:" 无值 = 删除该头
          if (h.value === '' && (value ?? '').trim().endsWith(':')) {
            const idx = headers.findIndex((x) => x.key.toLowerCase() === h.key.toLowerCase());
            if (idx >= 0) headers.splice(idx, 1);
          } else headers.push(h);
        }
        break;
      }
      case 'request':
        method = (value ?? '').toUpperCase();
        break;
      case 'url':
        url = value ?? '';
        break;
      case 'url-query':
        if (value) urlQueries.push(value);
        break;
      case 'data':
      case 'data-ascii':
      case 'data-binary':
      case 'data-raw': {
        let v = value ?? '';
        if (name !== 'data-raw' && v.startsWith('@')) {
          dataFromFile = true;
          warnings.push(`请求体引用了本地文件 ${v.slice(1)}，请在“请求体”中手动粘贴文件内容`);
        }
        if (name === 'data' || name === 'data-ascii') {
          // curl -d 会去掉文件内容中的换行；字面量保持原样
        }
        dataParts.push(v);
        break;
      }
      case 'data-urlencode': {
        const v = value ?? '';
        const eq = v.indexOf('=');
        const at = v.indexOf('@');
        if (eq > 0 && (at === -1 || eq < at)) {
          dataParts.push(v.slice(0, eq) + '=' + encodeURIComponent(v.slice(eq + 1)));
        } else if (eq === 0) {
          dataParts.push(encodeURIComponent(v.slice(1)));
        } else if (at > 0) {
          warnings.push(`--data-urlencode 引用了本地文件 ${v.slice(at + 1)}`);
          dataParts.push(v.slice(0, at) + '=');
        } else {
          dataParts.push(encodeURIComponent(v));
        }
        break;
      }
      case 'json':
        jsonMode = true;
        dataParts.push(value ?? '');
        break;
      case 'form':
      case 'form-string': {
        const v = value ?? '';
        const eq = v.indexOf('=');
        if (eq <= 0) break;
        const key = v.slice(0, eq);
        let val = v.slice(eq + 1);
        if (name === 'form' && (val.startsWith('@') || val.startsWith('<'))) {
          const parts = val.slice(1).split(';');
          const filePath = parts[0];
          let contentType: string | undefined;
          let fileName: string | undefined;
          for (const p of parts.slice(1)) {
            const [k, ...rest] = p.split('=');
            if (k.trim() === 'type') contentType = rest.join('=');
            if (k.trim() === 'filename') fileName = rest.join('=');
          }
          multipart.push({
            key,
            value: filePath,
            isFile: val.startsWith('@'),
            fileName: fileName ?? filePath.split(/[\\/]/).pop(),
            contentType,
          });
          warnings.push(`表单字段 ${key} 引用了本地文件 ${filePath}，请在“请求体”中重新选择文件`);
        } else {
          if (name === 'form') {
            // 去掉 ;type=xxx 后缀
            const semi = val.indexOf(';type=');
            if (semi >= 0) val = val.slice(0, semi);
          }
          multipart.push({ key, value: val });
        }
        break;
      }
      case 'get':
        getMode = true;
        break;
      case 'head':
        headMode = true;
        break;
      case 'upload-file':
        uploadFile = value ?? '';
        break;
      case 'user': {
        const v = value ?? '';
        const idx = v.indexOf(':');
        auth = {
          type: 'basic',
          username: idx >= 0 ? v.slice(0, idx) : v,
          password: idx >= 0 ? v.slice(idx + 1) : '',
        };
        break;
      }
      case 'oauth2-bearer':
        auth = { type: 'bearer', token: value ?? '', prefix: 'Bearer' };
        break;
      case 'user-agent':
        headers.push({ key: 'User-Agent', value: value ?? '' });
        break;
      case 'referer':
        headers.push({ key: 'Referer', value: value ?? '' });
        break;
      case 'cookie': {
        const v = value ?? '';
        if (v.includes('=')) headers.push({ key: 'Cookie', value: v });
        else warnings.push(`Cookie 文件 ${v} 无法导入`);
        break;
      }
      case 'insecure':
        insecure = true;
        break;
      case 'location':
      case 'location-trusted':
        followRedirects = true;
        break;
      case 'max-time': {
        const s = parseFloat(value ?? '');
        if (!isNaN(s)) timeoutMs = Math.round(s * 1000);
        break;
      }
      case 'proxy':
        proxy = value;
        break;
      case 'aws-sigv4':
        warnings.push('AWS SigV4 签名暂不支持，请手动配置');
        break;
      default:
        break;
    }
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--') && a.length > 2) {
      let name = a.slice(2);
      let value: string | undefined;
      const eq = name.indexOf('=');
      if (eq > 0 && LONG_WITH_ARG.has(name.slice(0, eq))) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      } else if (LONG_WITH_ARG.has(name)) {
        value = args[++i];
      }
      if (name.startsWith('no-')) continue;
      handle(name, value);
      continue;
    }
    if (a.startsWith('-') && a.length > 1 && a !== '-') {
      // 组合短选项，如 -sSL、-XPOST、-H'xxx'
      for (let j = 1; j < a.length; j++) {
        const ch = a[j];
        const name = SHORT_ALIASES[ch] ?? ch;
        if (SHORT_WITH_ARG.has(ch)) {
          let value = a.slice(j + 1);
          if (!value) value = args[++i];
          handle(name, value);
          break;
        }
        handle(name, undefined);
      }
      continue;
    }
    // 位置参数 = URL
    if (url === null) url = a;
    else warnings.push(`忽略多余的参数：${a.length > 60 ? a.slice(0, 60) + '…' : a}`);
  }

  if (url === null) {
    warnings.push('没有找到请求地址 URL');
    url = '';
  }
  let finalUrl: string = url;
  if (finalUrl && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(finalUrl) && !finalUrl.startsWith('{{')) {
    finalUrl = 'http://' + finalUrl;
  }
  if (urlQueries.length) {
    finalUrl += (finalUrl.includes('?') ? '&' : '?') + urlQueries.join('&');
  }

  let bodyText = dataParts.join(jsonMode ? '' : '&');
  let bodyType: BodyType = 'none';
  let form: ParsedHeader[] = [];
  let graphql: { query: string; variables: string } | undefined;

  if (getMode && dataParts.length) {
    finalUrl += (finalUrl.includes('?') ? '&' : '?') + bodyText;
    bodyText = '';
  } else if (multipart.length) {
    bodyType = 'multipart';
  } else if (dataParts.length) {
    const ct = (getHeader(headers, 'content-type') ?? '').toLowerCase();
    const pretty = prettyJson(bodyText);
    if (jsonMode || ct.includes('json') || (!ct && pretty !== null) || (pretty !== null && !ct.includes('form'))) {
      bodyType = 'json';
      if (pretty !== null) bodyText = pretty;
      if (jsonMode) {
        if (!getHeader(headers, 'content-type')) headers.push({ key: 'Content-Type', value: 'application/json' });
        if (!getHeader(headers, 'accept')) headers.push({ key: 'Accept', value: 'application/json' });
      }
      // GraphQL 识别
      try {
        const obj = JSON.parse(bodyText);
        if (obj && typeof obj === 'object' && typeof obj.query === 'string' && /graphql/i.test(finalUrl)) {
          bodyType = 'graphql';
          graphql = {
            query: obj.query,
            variables: obj.variables ? JSON.stringify(obj.variables, null, 2) : '',
          };
        }
      } catch {
        /* ignore */
      }
    } else if (!dataFromFile && (ct.includes('x-www-form-urlencoded') || (!ct && looksLikeForm(bodyText)))) {
      bodyType = 'form';
      form = bodyText
        .split('&')
        .filter(Boolean)
        .map((pair) => {
          const idx = pair.indexOf('=');
          return idx >= 0
            ? { key: safeDecode(pair.slice(0, idx)), value: safeDecode(pair.slice(idx + 1)) }
            : { key: safeDecode(pair), value: '' };
        });
    } else if (ct.includes('xml') || bodyText.trim().startsWith('<')) {
      bodyType = 'xml';
    } else {
      bodyType = 'text';
    }
  } else if (uploadFile) {
    bodyType = 'text';
    warnings.push(`上传文件 ${uploadFile} 无法自动导入`);
  }

  let finalMethod: string = method ?? '';
  if (!finalMethod) {
    if (headMode) finalMethod = 'HEAD';
    else if (getMode) finalMethod = 'GET';
    else if (uploadFile) finalMethod = 'PUT';
    else if (dataParts.length || multipart.length) finalMethod = 'POST';
    else finalMethod = 'GET';
  }

  return {
    parsed: {
      method: finalMethod,
      url: finalUrl,
      headers,
      body: { type: bodyType, text: bodyType === 'form' || bodyType === 'multipart' ? '' : bodyText, form, multipart, graphql },
      auth,
      insecure,
      followRedirects,
      timeoutMs,
      proxy,
      envRefs,
      envValues,
      warnings,
      raw,
    },
  };
}

function extractJqFilter(stage: string[]): string | undefined {
  // stage[0] === 'jq'
  const args = stage.slice(1);
  const withArg = new Set(['--arg', '--argjson', '--slurpfile', '--rawfile', '--indent', '-L', '--tab']);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--arg' || a === '--argjson' || a === '--slurpfile' || a === '--rawfile') {
      i += 2;
      continue;
    }
    if (withArg.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith('-') && a.length > 1) continue;
    return a;
  }
  return '.';
}

/** 粗略判断一段文本是否包含 cURL 命令 */
export function looksLikeCurl(text: string): boolean {
  if (!text) return false;
  return /(^|\n|\s|`|^\s*[$>]\s*)curl(\.exe)?\s+\S/i.test(text.trim().slice(0, 4000)) && /curl(\.exe)?\s/i.test(text);
}

/**
 * 解析粘贴内容中的所有 cURL 命令
 */
export function parseCurlCommands(input: string): ParsedCurl[] {
  const { text, cmdMode } = preprocess(input);
  const envRefsGlobal = new Set<string>();
  const globalWarnings: string[] = [];
  const tokens = tokenize(text, { envRefs: envRefsGlobal, warnings: globalWarnings, cmdMode });

  // 切分为命令；每条命令再按 | 切分为管道
  type Command = { stages: string[][] };
  const commands: Command[] = [];
  let curStages: string[][] = [[]];
  const flush = () => {
    const stages = curStages.filter((s) => s.length);
    if (stages.length) commands.push({ stages });
    curStages = [[]];
  };
  let skipNext = false;
  for (const t of tokens) {
    if (t.type === 'word') {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      curStages[curStages.length - 1].push(t.value);
      continue;
    }
    if (t.value === '|') {
      curStages.push([]);
    } else if (t.value === '>') {
      skipNext = true;
    } else {
      flush();
    }
  }
  flush();

  // 宽容处理：缺少续行符时，以 - 开头的行合并到上一条 curl 命令
  const merged: Command[] = [];
  for (const c of commands) {
    const first = c.stages[0][0] ?? '';
    const prev = merged[merged.length - 1];
    if (prev && isCurlCommand(prev.stages[0][0] ?? '') && prev.stages.length === 1 && (first.startsWith('-') || /^https?:\/\//.test(first))) {
      prev.stages[0].push(...c.stages[0]);
      prev.stages.push(...c.stages.slice(1));
      continue;
    }
    if (prev && isCurlCommand(prev.stages[0][0] ?? '') && first === 'jq' && prev.stages.length === 1) {
      prev.stages.push(...c.stages);
      continue;
    }
    merged.push(c);
  }

  // 收集 export NAME=value
  const envValues: Record<string, string> = {};
  for (const c of merged) {
    const words = c.stages[0];
    let start = 0;
    if (words[0] === 'export' || words[0] === 'set' || words[0] === 'setx') start = 1;
    for (let k = start; k < words.length; k++) {
      const m = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(words[k]);
      if (m && (start === 1 || k === 0)) envValues[m[1]] = m[2];
      else if (words[0] === 'setx' && k === 1 && words[2] !== undefined) envValues[words[1]] = words[2];
    }
  }

  const results: ParsedCurl[] = [];
  // 每条 curl 命令对应的原始文本：按 "curl" 出现位置粗略切分
  const rawPieces = splitRawCommands(input);
  let rawIdx = 0;
  for (const c of merged) {
    const words = c.stages[0];
    // 跳过开头的环境变量赋值、sudo 等
    let ci = 0;
    while (ci < words.length && !isCurlCommand(words[ci])) ci++;
    if (ci >= words.length) continue;
    const args = words.slice(ci + 1);
    // 只统计本条命令中用到的环境变量
    const used = new Set<string>();
    const scan = (s: string) => {
      for (const m of s.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)) if (envRefsGlobal.has(m[1])) used.add(m[1]);
    };
    args.forEach(scan);
    const warnings = [...globalWarnings];
    const raw = rawPieces[rawIdx++] ?? input.trim();
    const { parsed } = parseCurlArgs(args, raw, [...used], { ...envValues }, warnings);
    for (const stage of c.stages.slice(1)) {
      const cmd = (stage[0] ?? '').split(/[\\/]/).pop();
      if (cmd === 'jq' || cmd === 'jq.exe') {
        parsed.jqFilter = extractJqFilter(stage);
      }
    }
    results.push(parsed);
  }
  return results;
}

/** 按 curl 关键字粗略切分原文，用于保存“原始命令” */
function splitRawCommands(input: string): string[] {
  const text = input.replace(/\r\n?/g, '\n');
  const re = /(^|\n)[ \t]*(?:[$>][ \t]+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S*[ \t]+)*(?:sudo[ \t]+)?curl(?:\.exe)?(?=\s)/g;
  const starts: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    starts.push(m.index + (m[1] ? 1 : 0));
  }
  if (!starts.length) return [text.trim()];
  return starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length).trim());
}

export function parseCurl(input: string): ParsedCurl | null {
  return parseCurlCommands(input)[0] ?? null;
}
