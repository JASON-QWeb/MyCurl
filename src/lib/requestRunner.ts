/**
 * 请求构建与执行（通过本地 /api/send 流式代理）
 */
import type { AppData, Auth, Folder, HttpRequest, KV, ResponseRecord } from './types';
import { folderChain, renderTemplate, resolveVariables, type VarMap } from './template';
import { uid } from './util';
import { splitUrl } from './urlParams';
import { createTauriChannel, isTauri, tauriInvoke } from './bridge';

export interface EffectiveAuth {
  auth: Auth;
  inheritedFrom?: string;
}

export interface EffectiveHeader {
  key: string;
  value: string;
  enabled: boolean;
  inheritedFrom?: string;
}

/** 计算最终生效的认证（支持沿文件夹链继承） */
export function resolveEffectiveAuth(data: AppData, req: HttpRequest): EffectiveAuth {
  if (req.auth && req.auth.type !== 'inherit') return { auth: req.auth };
  const chain = folderChain(data, req.folderId);
  for (let i = chain.length - 1; i >= 0; i--) {
    const f = chain[i];
    if (f.auth && f.auth.type !== 'inherit') {
      return { auth: f.auth, inheritedFrom: f.name };
    }
  }
  return { auth: { type: 'none' } };
}

/** 计算继承自文件夹链的公共请求头 */
export function resolveInheritedHeaders(data: AppData, folderId: string | null): EffectiveHeader[] {
  const chain: Folder[] = folderChain(data, folderId);
  const out: EffectiveHeader[] = [];
  for (const f of chain) {
    for (const h of f.headers ?? []) {
      if (!h.enabled || !h.key.trim()) continue;
      out.push({ key: h.key, value: h.value, enabled: true, inheritedFrom: f.name });
    }
  }
  return out;
}

export interface PreparedRequest {
  method: string;
  url: string;
  headers: [string, string][];
  body:
    | { kind: 'none' }
    | { kind: 'text'; text: string; contentType?: string }
    | {
        kind: 'multipart';
        fields: { name: string; value?: string; isFile?: boolean; fileName?: string; data?: string; contentType?: string }[];
      };
  bodyPreview?: string;
  missingVars: string[];
  options: {
    verifySSL: boolean;
    followRedirects: boolean;
    timeoutMs: number;
    proxy: string;
  };
}

function encodeBasic(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

/** 将模板变量、继承的认证与请求头解析为可直接发送的请求 */
export function prepareRequest(data: AppData, req: HttpRequest, varsOverride?: VarMap): PreparedRequest {
  const vars = varsOverride ?? resolveVariables(data, req.workspaceId, req.folderId);
  const missing = new Set<string>();
  const r = (s: string) => {
    const res = renderTemplate(s ?? '', vars);
    res.missing.forEach((m) => missing.add(m));
    return res.text;
  };

  let url = r(req.url).trim();
  if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    url = 'https://' + url;
  }

  // 请求头：文件夹继承 -> 请求自身（同名覆盖）
  const localHeaders = req.headers
    .filter((h) => h.enabled && h.key.trim())
    .map((h): [string, string] => [r(h.key.trim()), r(h.value)]);
  const localNames = new Set(localHeaders.map(([key]) => key.toLowerCase()));
  const inherited = new Map<string, [string, string]>();
  for (const h of resolveInheritedHeaders(data, req.folderId)) {
    const key = r(h.key.trim());
    if (!localNames.has(key.toLowerCase())) inherited.set(key.toLowerCase(), [key, h.value]);
  }
  const hdrList: [string, string][] = [
    ...Array.from(inherited.values(), ([key, value]): [string, string] => [key, r(value)]),
    ...localHeaders,
  ];
  const hasHeader = (k: string) => hdrList.some(([hk]) => hk.toLowerCase() === k.toLowerCase());

  // 认证
  const { auth } = resolveEffectiveAuth(data, req);
  if (auth.type === 'bearer') {
    const token = r(auth.token ?? '');
    const prefix = r(auth.prefix ?? 'Bearer').trim();
    if (token && !hasHeader('authorization')) {
      hdrList.push(['Authorization', prefix ? `${prefix} ${token}` : token]);
    }
  } else if (auth.type === 'basic') {
    const u = r(auth.username ?? '');
    const p = r(auth.password ?? '');
    if ((u || p) && !hasHeader('authorization')) {
      hdrList.push(['Authorization', `Basic ${encodeBasic(u, p)}`]);
    }
  } else if (auth.type === 'apikey') {
    const k = r(auth.key ?? '').trim();
    const v = r(auth.value ?? '');
    if (k) {
      if (auth.in === 'query') {
        const { base, query, hash } = splitUrl(url);
        const pair = `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
        url = `${base}?${query ? `${query}&${pair}` : pair}${hash}`;
      } else if (!hasHeader(k)) {
        hdrList.push([k, v]);
      }
    }
  }

  // 请求体
  let body: PreparedRequest['body'] = { kind: 'none' };
  let bodyPreview: string | undefined;
  const method = req.method.toUpperCase();
  const rb = req.body;
  if (rb.type === 'json') {
    const text = r(rb.text);
    body = { kind: 'text', text, contentType: 'application/json' };
    bodyPreview = text;
  } else if (rb.type === 'xml') {
    const text = r(rb.text);
    body = { kind: 'text', text, contentType: 'application/xml' };
    bodyPreview = text;
  } else if (rb.type === 'text') {
    const text = r(rb.text);
    body = { kind: 'text', text, contentType: 'text/plain' };
    bodyPreview = text;
  } else if (rb.type === 'graphql') {
    const query = r(rb.graphql?.query ?? '');
    const varsStr = r(rb.graphql?.variables ?? '').trim();
    let variables: unknown = undefined;
    if (varsStr) {
      try {
        variables = JSON.parse(varsStr);
      } catch {
        variables = varsStr;
      }
    }
    const text = JSON.stringify(variables !== undefined ? { query, variables } : { query });
    body = { kind: 'text', text, contentType: 'application/json' };
    bodyPreview = text;
  } else if (rb.type === 'form') {
    const pairs = (rb.form as KV[])
      .filter((f) => f.enabled && (f.key || f.value))
      .map((f) => `${encodeURIComponent(r(f.key))}=${encodeURIComponent(r(f.value))}`)
      .join('&');
    body = { kind: 'text', text: pairs, contentType: 'application/x-www-form-urlencoded' };
    bodyPreview = pairs;
  } else if (rb.type === 'multipart') {
    const fields = rb.multipart
      .filter((f) => f.enabled && f.key.trim())
      .map((f) =>
        f.isFile
          ? { name: r(f.key), isFile: true, fileName: f.fileName || 'file', data: f.fileData, contentType: f.contentType }
          : { name: r(f.key), value: r(f.value) },
      );
    body = { kind: 'multipart', fields };
    bodyPreview = fields.map((f) => `${f.name}=${f.isFile ? `[文件:${f.fileName}]` : f.value}`).join('\n');
  }

  const gs = data.settings;
  const rs = req.settings ?? {};
  return {
    method,
    url,
    headers: hdrList,
    body,
    bodyPreview,
    missingVars: [...missing],
    options: {
      verifySSL: rs.verifySSL ?? gs.verifySSL,
      followRedirects: rs.followRedirects ?? gs.followRedirects,
      timeoutMs: rs.timeoutMs ?? gs.timeoutMs,
      proxy: gs.proxy ?? '',
    },
  };
}

function isBinaryContentType(ct: string): boolean {
  const lower = ct.toLowerCase();
  if (!lower) return false;
  if (/text\/|json|xml|javascript|ecmascript|x-www-form-urlencoded|event-stream|graphql|yaml|csv|svg\+xml/.test(lower)) return false;
  return /image\/|audio\/|video\/|application\/octet-stream|application\/pdf|application\/zip|application\/gzip|font\//.test(lower);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

const MAX_TEXT_PREVIEW = 5 * 1024 * 1024;
const MAX_BIN_STORE = 3 * 1024 * 1024;

export interface ExecuteCallbacks {
  onUpdate: (partial: ResponseRecord) => void;
}

export async function executeRequest(
  data: AppData,
  req: HttpRequest,
  signal: AbortSignal,
  callbacks?: ExecuteCallbacks,
): Promise<ResponseRecord> {
  const prepared = prepareRequest(data, req);
  const id = uid('res_');
  const startedAt = Date.now();
  const record: ResponseRecord = {
    id,
    requestId: req.id,
    createdAt: startedAt,
    method: prepared.method,
    url: prepared.url,
    status: 0,
    statusText: '',
    headers: [],
    body: '',
    contentType: '',
    size: 0,
    timeMs: 0,
    requestHeaders: prepared.headers,
    requestBodyPreview: prepared.bodyPreview,
  };

  if (!prepared.url) {
    return { ...record, error: '请输入请求 URL' };
  }

  const textDecoder = new TextDecoder('utf-8', { fatal: false });
  const binChunks: Uint8Array[] = [];
  let binSize = 0;
  let binary = false;
  let lastEmit = 0;

  const emit = (force = false) => {
    if (!callbacks) return;
    const now = performance.now();
    if (!force && now - lastEmit < 60) return;
    lastEmit = now;
    callbacks.onUpdate({ ...record, timeMs: record.timeMs || Date.now() - startedAt });
  };

  const handleEvent = (evt: any) => {
    if (evt.t === 'head') {
      record.status = evt.status;
      record.statusText = evt.statusText || '';
      record.headers = evt.headers || [];
      record.url = evt.url || record.url;
      record.method = evt.method || record.method;
      record.redirects = evt.redirects?.length ? evt.redirects : undefined;
      record.ttfbMs = evt.ttfb;
      if (evt.requestHeaders) record.requestHeaders = evt.requestHeaders;
      const ct = record.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '';
      record.contentType = ct;
      binary = isBinaryContentType(ct);
      emit(true);
    } else if (evt.t === 'data') {
      const bytes = base64ToBytes(evt.b64);
      record.size += bytes.length;
      if (binary) {
        if (binSize + bytes.length <= MAX_BIN_STORE) {
          binChunks.push(bytes);
          binSize += bytes.length;
        } else {
          record.bodyTruncated = true;
        }
      } else {
        if (record.body.length < MAX_TEXT_PREVIEW) {
          record.body += textDecoder.decode(bytes, { stream: true });
        } else {
          record.bodyTruncated = true;
        }
      }
      emit(false);
    } else if (evt.t === 'end') {
      if (!binary) record.body += textDecoder.decode();
      record.timeMs = evt.time ?? Date.now() - startedAt;
      record.size = evt.size ?? record.size;
      if (binary && binChunks.length) {
        const merged = new Uint8Array(binSize);
        let off = 0;
        for (const c of binChunks) {
          merged.set(c, off);
          off += c.length;
        }
        record.bodyBase64 = bytesToBase64(merged);
      }
      emit(true);
    } else if (evt.t === 'error') {
      record.error = evt.message || '请求失败';
      record.timeMs = evt.time ?? Date.now() - startedAt;
      emit(true);
    }
  };

  // Tauri 桌面端：直接走 Rust reqwest 流式引擎
  if (isTauri()) {
    const onAbort = () => {
      tauriInvoke('cancel_request', { requestId: req.id }).catch(() => {});
    };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      const channel = createTauriChannel<any>(handleEvent);
      await tauriInvoke('send_request', {
        payload: {
          requestId: req.id,
          method: prepared.method,
          url: prepared.url,
          headers: prepared.headers,
          body: prepared.body,
          options: prepared.options,
        },
        onEvent: channel,
      });
    } catch (err) {
      if (!record.error) {
        record.error = signal.aborted ? '请求已取消' : `Rust 引擎调用失败：${String(err)}`;
        record.timeMs = Date.now() - startedAt;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
    return record;
  }

  // Web 开发模式：走本地 /api/send 代理
  let res: Response;
  try {
    res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: prepared.method,
        url: prepared.url,
        headers: prepared.headers,
        body: prepared.body,
        options: prepared.options,
      }),
      signal,
    });
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError';
    return {
      ...record,
      timeMs: Date.now() - startedAt,
      error: aborted ? '请求已取消' : `无法连接到本地代理服务：${(err as Error).message}`,
    };
  }

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    return { ...record, timeMs: Date.now() - startedAt, error: errText || `代理请求失败（HTTP ${res.status}）` };
  }

  const reader = res.body.getReader();
  const lineDecoder = new TextDecoder();
  let lineBuf = '';

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      lineBuf += lineDecoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = lineBuf.indexOf('\n')) >= 0) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (!line) continue;
        try {
          handleEvent(JSON.parse(line));
        } catch {
          continue;
        }
      }
    }
  } catch (err) {
    const aborted = (err as Error)?.name === 'AbortError' || signal.aborted;
    record.error = aborted ? '请求已取消' : (err as Error).message;
    record.timeMs = Date.now() - startedAt;
  }

  return record;
}
