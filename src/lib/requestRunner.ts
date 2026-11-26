/**
 * 请求构建与执行（通过本地 /api/send 流式代理）
 */
import type { AppData, Auth, Folder, HttpRequest, KV, Language, ResponseRecord } from './types';
import { findTemplateVars, folderChain, render, renderTemplate, resolveVariables, type VarMap } from './template';
import { uid } from './util';
import { tr } from './translate';
import { isBinaryContentType, responseTextDecoder } from './responseEncoding';
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

export function effectiveInheritedHeaders(headers: EffectiveHeader[], localHeaderNames: Set<string>, renderKey: (key: string) => string) {
  const inherited = new Map<string, { key: string; header: EffectiveHeader }>();
  for (const header of headers) {
    const key = renderKey(header.key.trim());
    const name = key.toLowerCase();
    if (!localHeaderNames.has(name)) inherited.set(name, { key, header });
  }
  return Array.from(inherited.values());
}

export function resolveRequestHeaders(data: AppData, req: HttpRequest, renderKey: (key: string) => string) {
  const local = req.headers.filter(h => h.enabled && h.key.trim())
    .map(header => ({ key: renderKey(header.key.trim()), header }));
  const localNames = new Set(local.map(({ key }) => key.toLowerCase()));
  const inherited = resolveInheritedHeaders(data, req.folderId);
  return { local, inherited, effective: effectiveInheritedHeaders(inherited, localNames, renderKey) };
}

export function collectRequestVarNames(data: AppData, req: HttpRequest, vars = resolveVariables(data, req.workspaceId, req.folderId)): string[] {
  const names = new Set<string>();
  const scan = (...fields: (string | undefined)[]) => {
    for (const field of fields) {
      for (const name of findTemplateVars(field ?? '')) {
        if (!name.startsWith('$')) names.add(name);
      }
    }
  };
  const scanRow = (row: Pick<KV, 'key' | 'value'>) => scan(row.key, row.value);
  scan(req.url);
  req.params.filter(p => p.enabled).forEach(scanRow);
  const { local, effective } = resolveRequestHeaders(data, req, key => render(key, vars));
  for (const { header } of [...local, ...effective]) scanRow(header);
  const { auth } = resolveEffectiveAuth(data, req);
  if (auth.type === 'bearer') scan(auth.token, auth.prefix);
  if (auth.type === 'basic') scan(auth.username, auth.password);
  if (auth.type === 'apikey') scan(auth.key, auth.value);
  const body = req.body;
  if (['json', 'xml', 'text'].includes(body.type)) scan(body.text);
  if (body.type === 'form') body.form.filter(row => row.enabled).forEach(scanRow);
  if (body.type === 'multipart') body.multipart.filter(row => row.enabled && !row.isFile && row.key.trim()).forEach(scanRow);
  if (body.type === 'graphql') scan(body.graphql?.query, body.graphql?.variables);
  // Variable values can themselves reference a missing variable. Keep its quick-fix reachable.
  for (const name of names) scan(vars.get(name)?.value);
  return [...names];
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
  missingUrlVars: string[];
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
  const missingUrl = new Set<string>();
  const r = (s: string, inUrl = false) => {
    const res = renderTemplate(s ?? '', vars);
    for (const name of res.missing) {
      missing.add(name);
      if (inUrl) missingUrl.add(name);
    }
    return res.text;
  };

  let url = r(req.url, true).trim();
  if (url && !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) {
    url = 'https://' + url;
  }

  // 请求头：文件夹继承 -> 请求自身（同名覆盖）
  const { local, effective } = resolveRequestHeaders(data, req, r);
  const hdrList: [string, string][] = [
    ...effective.map(({ key, header }): [string, string] => [key, r(header.value)]),
    ...local.map(({ key, header }): [string, string] => [key, r(header.value)]),
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
    const k = r(auth.key ?? '', auth.in === 'query').trim();
    const v = r(auth.value ?? '', !!k && auth.in === 'query');
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

  const { body, bodyPreview } = prepareBody(req.body, r, data.settings.language);
  const gs = data.settings;
  const rs = req.settings ?? {};
  return {
    method: req.method.toUpperCase(),
    url,
    headers: hdrList,
    body,
    bodyPreview,
    missingVars: [...missing],
    missingUrlVars: [...missingUrl],
    options: {
      verifySSL: rs.verifySSL ?? gs.verifySSL,
      followRedirects: rs.followRedirects ?? gs.followRedirects,
      timeoutMs: rs.timeoutMs ?? gs.timeoutMs,
      proxy: gs.proxy ?? '',
    },
  };
}

function prepareBody(rb: HttpRequest['body'], r: (input: string) => string, lang: Language) {
  let body: PreparedRequest['body'] = { kind: 'none' };
  let bodyPreview: string | undefined;
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
    bodyPreview = fields.map(f => `${f.name}=${f.isFile ? tr(lang, `[文件:${f.fileName}]`, `[File:${f.fileName}]`) : f.value}`).join('\n');
  }
  return { body, bodyPreview };
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

function markCancelled(record: ResponseRecord, lang: Language) {
  record.cancelled = true;
  record.error = tr(lang, '请求已取消', 'Request cancelled');
  record.timeMs = Date.now() - record.createdAt;
  return record;
}

function preflightError(prepared: PreparedRequest, lang: Language): string | undefined {
  if (prepared.missingUrlVars.length) {
    const names = prepared.missingUrlVars.map(name => `{{${name}}}`).join(tr(lang, '、', ', '));
    return tr(lang, `请求地址包含未定义变量：${names}。请点击上方红色变量标签填写。`,
      `Request URL contains undefined variable(s): ${names}. Click the red variable chip above to set a value.`);
  }
  if (prepared.body.kind === 'multipart') {
    const missingFiles = prepared.body.fields.filter((field) => field.isFile && field.data == null);
    if (missingFiles.length) {
      const fields = missingFiles.map((field) => field.name).join(', ');
      return tr(
        lang,
        `请先选择要上传的本地文件。缺少附件的表单字段：${fields}`,
        `Select a local file before sending. Multipart fields: ${fields}`,
      );
    }
  }

  if (!prepared.url) return tr(lang, '请输入请求 URL', 'Enter a request URL');
}

function createEventHandler(record: ResponseRecord, lang: Language, callbacks?: ExecuteCallbacks) {
  const startedAt = record.createdAt;
  let textDecoder = new TextDecoder();
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

  return (evt: any) => {
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
      if (!binary) textDecoder = responseTextDecoder(ct);
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
      if (evt.code === 'ABORT_ERR' || evt.code === 'UND_ERR_ABORTED') markCancelled(record, lang);
      else record.error = evt.message || tr(lang, '请求失败', 'Request failed');
      record.timeMs = evt.time ?? Date.now() - startedAt;
      emit(true);
    }
  };
}

type SendPayload = Pick<PreparedRequest, 'method' | 'url' | 'headers' | 'body' | 'options'>;

async function sendViaProxy(payload: SendPayload, signal: AbortSignal, handleEvent: ReturnType<typeof createEventHandler>, lang: Language) {
  let res: Response;
  try {
    res = await fetch('/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') throw err;
    const message = (err as Error).message;
    throw new Error(tr(lang, `无法连接到本地代理服务：${message}`, `Could not reach the local proxy: ${message}`));
  }

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '');
    throw new Error(errText || tr(lang, `代理请求失败（HTTP ${res.status}）`, `Proxy request failed (HTTP ${res.status})`));
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
  } finally {
    reader.releaseLock();
  }
}

export async function executeRequest(
  data: AppData,
  req: HttpRequest,
  signal: AbortSignal,
  callbacks?: ExecuteCallbacks,
): Promise<ResponseRecord> {
  const prepared = prepareRequest(data, req);
  const { method, url, headers, body, options } = prepared;
  const lang = data.settings.language;
  const record: ResponseRecord = {
    id: uid('res_'), requestId: req.id, createdAt: Date.now(), method, url,
    status: 0, statusText: '', headers: [], body: '', contentType: '', size: 0, timeMs: 0,
    requestHeaders: headers, requestBodyPreview: prepared.bodyPreview,
  };
  if (signal.aborted) return markCancelled(record, lang);
  const error = preflightError(prepared, lang);
  if (error) return { ...record, error };

  const payload = { method, url, headers, body, options };
  const handleEvent = createEventHandler(record, lang, callbacks);
  const native = isTauri();
  try {
    if (native) {
      // Each send needs its own cancellation handle when a previous send is still finishing.
      const requestId = record.id;
      const onAbort = () => { void tauriInvoke('cancel_request', { requestId }).catch(() => {}); };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
        await tauriInvoke('send_request', { payload: { ...payload, requestId }, onEvent: createTauriChannel(handleEvent) });
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
    } else {
      await sendViaProxy(payload, signal, handleEvent, lang);
    }
  } catch (err) {
    if (signal.aborted || (err as Error)?.name === 'AbortError') return markCancelled(record, lang);
    record.error ||= native
      ? tr(lang, `Rust 引擎调用失败：${String(err)}`, `Rust engine call failed: ${String(err)}`)
      : (err as Error)?.message || String(err);
    record.timeMs = Date.now() - record.createdAt;
  }
  return signal.aborted ? markCancelled(record, lang) : record;
}
