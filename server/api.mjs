/**
 * MyCurl 本地服务：
 *  - /api/data      读写工作区数据（~/.mycurl/data.json）
 *  - /api/history   每个请求的响应历史
 *  - /api/send      代发 HTTP 请求（无 CORS 限制），以 NDJSON 流式返回
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { STATUS_CODES } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Agent, ProxyAgent, request as undiciRequest } from 'undici';

const VERSION = '0.1.0';
const MAX_HISTORY = 30;
const MAX_REDIRECTS = 10;

export function defaultDataDir() {
  return process.env.MYCURL_DATA_DIR || path.join(os.homedir(), '.mycurl');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

async function atomicWrite(file, content) {
  const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
  await fsp.writeFile(tmp, content);
  await fsp.rename(tmp, file);
}

function readBody(req, limit = 60 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// ---------------- 发送请求 ----------------

const dispatchers = new Map();
function getDispatcher(verifySSL, proxy) {
  const key = `${verifySSL ? 1 : 0}|${proxy || ''}`;
  if (dispatchers.has(key)) return dispatchers.get(key);
  const tls = { rejectUnauthorized: !!verifySSL };
  let d;
  if (proxy) {
    let uri = proxy.trim();
    if (!/^[a-z]+:\/\//i.test(uri)) uri = `http://${uri}`;
    d = new ProxyAgent({ uri, requestTls: tls, proxyTls: tls, connect: tls });
  } else {
    d = new Agent({ connect: tls, keepAliveTimeout: 10_000 });
  }
  dispatchers.set(key, d);
  return d;
}

const FORBIDDEN = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'expect', 'content-length', 'host']);

function buildMultipart(fields) {
  const boundary = `----MyCurlBoundary${randomBytes(12).toString('hex')}`;
  const parts = [];
  for (const f of fields) {
    const name = String(f.name ?? '').replace(/"/g, '%22');
    if (f.isFile) {
      const fileName = String(f.fileName || 'file').replace(/"/g, '%22');
      parts.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${fileName}"\r\nContent-Type: ${f.contentType || 'application/octet-stream'}\r\n\r\n`,
        ),
      );
      if (f.data) parts.push(Buffer.from(f.data, 'base64'));
      else if (f.path) parts.push(fs.readFileSync(f.path));
      parts.push(Buffer.from('\r\n'));
    } else {
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${f.value ?? ''}\r\n`));
    }
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { data: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

function friendlyError(err, timedOut) {
  if (timedOut) return '请求超时（可在设置或请求设置中调整超时时间）';
  const code = err?.code || err?.cause?.code || '';
  const msg = err?.message || String(err);
  const map = {
    ENOTFOUND: '无法解析域名，请检查地址或网络',
    EAI_AGAIN: 'DNS 解析失败，请检查网络',
    ECONNREFUSED: '连接被拒绝，目标服务可能未启动',
    ECONNRESET: '连接被重置',
    ETIMEDOUT: '连接超时',
    EHOSTUNREACH: '主机不可达',
    ENETUNREACH: '网络不可达',
    UND_ERR_CONNECT_TIMEOUT: '连接超时',
    UND_ERR_HEADERS_TIMEOUT: '等待响应头超时',
    UND_ERR_BODY_TIMEOUT: '读取响应体超时',
    UND_ERR_SOCKET: '网络连接异常断开',
    CERT_HAS_EXPIRED: '服务器证书已过期（可在设置中关闭 SSL 校验）',
    DEPTH_ZERO_SELF_SIGNED_CERT: '自签名证书（可在设置中关闭 SSL 校验）',
    SELF_SIGNED_CERT_IN_CHAIN: '证书链中包含自签名证书（可在设置中关闭 SSL 校验）',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: '无法验证服务器证书（可在设置中关闭 SSL 校验）',
    ERR_TLS_CERT_ALTNAME_INVALID: '证书域名不匹配（可在设置中关闭 SSL 校验）',
    ERR_INVALID_URL: '无效的 URL',
  };
  if (err?.name === 'AbortError' || code === 'UND_ERR_ABORTED' || code === 'ABORT_ERR') return '请求已取消';
  if (map[code]) return `${map[code]}（${code}）`;
  if (/Invalid URL/i.test(msg)) return `无效的 URL：${msg}`;
  return msg + (code ? `（${code}）` : '');
}

function decoderFor(encoding) {
  const enc = String(encoding || '').toLowerCase().trim();
  if (enc === 'gzip' || enc === 'x-gzip') return zlib.createGunzip();
  if (enc === 'deflate') return zlib.createInflate();
  if (enc === 'br') return zlib.createBrotliDecompress();
  if (enc === 'zstd' && typeof zlib.createZstdDecompress === 'function') return zlib.createZstdDecompress();
  return null;
}

function headerPairs(headers) {
  const out = [];
  for (const [k, v] of Object.entries(headers || {})) {
    if (Array.isArray(v)) for (const x of v) out.push([k, String(x)]);
    else if (v !== undefined) out.push([k, String(v)]);
  }
  return out;
}

async function handleSend(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req)).toString('utf8'));
  } catch (e) {
    return sendJson(res, 400, { error: '请求格式错误' });
  }
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
  });
  const write = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + '\n');
  };

  const controller = new AbortController();
  let finished = false;
  let timedOut = false;
  res.on('close', () => {
    if (!finished) controller.abort();
  });
  const timeoutMs = Number(payload.options?.timeoutMs) || 0;
  const timer = timeoutMs > 0 ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs) : null;

  const start = performance.now();
  try {
    const verifySSL = payload.options?.verifySSL !== false;
    const follow = payload.options?.followRedirects !== false;
    const dispatcher = getDispatcher(verifySSL, payload.options?.proxy);

    // 请求头
    const hdrs = [];
    const has = (name) => hdrs.some(([k]) => k.toLowerCase() === name);
    for (const [k, v] of payload.headers || []) {
      if (!k || FORBIDDEN.has(String(k).toLowerCase())) continue;
      hdrs.push([String(k), String(v ?? '')]);
    }
    // 请求体
    let bodyData = null;
    const b = payload.body || { kind: 'none' };
    if (b.kind === 'text' && b.text !== undefined && b.text !== '') {
      bodyData = Buffer.from(String(b.text), 'utf8');
      if (b.contentType && !has('content-type')) hdrs.push(['Content-Type', b.contentType]);
    } else if (b.kind === 'base64' && b.data) {
      bodyData = Buffer.from(b.data, 'base64');
      if (b.contentType && !has('content-type')) hdrs.push(['Content-Type', b.contentType]);
    } else if (b.kind === 'multipart') {
      const mp = buildMultipart(b.fields || []);
      bodyData = mp.data;
      const idx = hdrs.findIndex(([k]) => k.toLowerCase() === 'content-type');
      if (idx >= 0) hdrs.splice(idx, 1);
      hdrs.push(['Content-Type', mp.contentType]);
    }
    if (!has('user-agent')) hdrs.push(['User-Agent', `MyCurl/${VERSION}`]);
    if (!has('accept')) hdrs.push(['Accept', '*/*']);
    if (!has('accept-encoding')) hdrs.push(['Accept-Encoding', 'gzip, deflate, br']);

    let url = String(payload.url || '');
    let method = String(payload.method || 'GET').toUpperCase();
    const redirects = [];
    let resp;
    let ttfb = 0;
    for (let i = 0; ; i++) {
      const flat = hdrs.flatMap(([k, v]) => [k, v]);
      resp = await undiciRequest(url, {
        method,
        headers: flat,
        body: bodyData ?? undefined,
        dispatcher,
        signal: controller.signal,
        headersTimeout: timeoutMs || 300_000,
        bodyTimeout: timeoutMs || 300_000,
      });
      ttfb = performance.now() - start;
      const loc = resp.headers.location;
      if (follow && [301, 302, 303, 307, 308].includes(resp.statusCode) && loc && i < MAX_REDIRECTS) {
        await resp.body.dump().catch(() => {});
        const next = new URL(Array.isArray(loc) ? loc[0] : loc, url).toString();
        redirects.push(`${resp.statusCode} → ${next}`);
        if (resp.statusCode === 303 || ((resp.statusCode === 301 || resp.statusCode === 302) && method === 'POST')) {
          method = 'GET';
          bodyData = null;
          for (let j = hdrs.length - 1; j >= 0; j--) if (hdrs[j][0].toLowerCase() === 'content-type') hdrs.splice(j, 1);
        }
        // 跨域重定向时去掉认证头
        if (new URL(next).host !== new URL(url).host) {
          for (let j = hdrs.length - 1; j >= 0; j--) if (['authorization', 'cookie'].includes(hdrs[j][0].toLowerCase())) hdrs.splice(j, 1);
        }
        url = next;
        continue;
      }
      break;
    }

    write({
      t: 'head',
      status: resp.statusCode,
      statusText: STATUS_CODES[resp.statusCode] || '',
      headers: headerPairs(resp.headers),
      url,
      method,
      redirects,
      ttfb,
      requestHeaders: hdrs,
    });

    let wireSize = 0;
    let size = 0;
    const raw = resp.body;
    const decoder = method === 'HEAD' ? null : decoderFor(resp.headers['content-encoding']);
    raw.on('data', (c) => {
      wireSize += c.length;
    });
    const stream = decoder ? raw.pipe(decoder) : raw;
    await new Promise((resolve, reject) => {
      stream.on('data', (chunk) => {
        size += chunk.length;
        write({ t: 'data', b64: chunk.toString('base64') });
      });
      stream.on('end', resolve);
      stream.on('error', reject);
      raw.on('error', reject);
    });
    finished = true;
    write({ t: 'end', time: performance.now() - start, size, wireSize });
  } catch (err) {
    finished = true;
    write({ t: 'error', message: friendlyError(err, timedOut), code: err?.code || err?.cause?.code || '', time: performance.now() - start });
  } finally {
    if (timer) clearTimeout(timer);
    res.end();
  }
}

// ---------------- API 入口 ----------------

export function createApi({ dataDir = defaultDataDir(), allowedPorts = [] } = {}) {
  let activeDataDir = dataDir;
  try {
    ensureDir(activeDataDir);
  } catch {
    activeDataDir = path.resolve(process.cwd(), '.mycurl-data');
    ensureDir(activeDataDir);
  }
  const historyDir = path.join(activeDataDir, 'history');
  const backupDir = path.join(activeDataDir, 'backups');
  ensureDir(historyDir);
  ensureDir(backupDir);
  const dataFile = path.join(activeDataDir, 'data.json');
  let lastBackup = 0;

  async function backup() {
    if (Date.now() - lastBackup < 10 * 60 * 1000) return;
    if (!fs.existsSync(dataFile)) return;
    lastBackup = Date.now();
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    const name = `data-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
    await fsp.copyFile(dataFile, path.join(backupDir, name)).catch(() => {});
    const files = (await fsp.readdir(backupDir)).filter((f) => f.endsWith('.json')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - 30))) await fsp.unlink(path.join(backupDir, f)).catch(() => {});
  }

  function checkOrigin(req) {
    const host = req.headers.host || '';
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)) return false;
    const origin = req.headers.origin;
    if (!origin || origin === 'null') return !origin;
    try {
      const o = new URL(origin);
      if (o.protocol === 'file:' || o.protocol === 'app:') return true;
      return ['localhost', '127.0.0.1', '[::1]'].includes(o.hostname) && o.host === host;
    } catch {
      return false;
    }
  }

  return async function api(req, res, next) {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return next ? next() : sendJson(res, 404, { error: 'Not found' });
    if (!checkOrigin(req)) return sendJson(res, 403, { error: '禁止跨站访问' });
    try {
      const p = url.pathname;
      if (p === '/api/info' && req.method === 'GET') {
        return sendJson(res, 200, { version: VERSION, dataDir: activeDataDir, platform: process.platform, node: process.version });
      }
      if (p === '/api/data' && req.method === 'GET') {
        if (!fs.existsSync(dataFile)) return sendJson(res, 200, { data: null });
        const text = await fsp.readFile(dataFile, 'utf8');
        try {
          return sendJson(res, 200, { data: JSON.parse(text) });
        } catch {
          await fsp.copyFile(dataFile, path.join(backupDir, `corrupt-${Date.now()}.json`)).catch(() => {});
          return sendJson(res, 200, { data: null, warning: '数据文件损坏，已备份并重新初始化' });
        }
      }
      if (p === '/api/data' && req.method === 'PUT') {
        const body = await readBody(req);
        JSON.parse(body.toString('utf8')); // 校验
        await backup();
        await atomicWrite(dataFile, body);
        return sendJson(res, 200, { ok: true });
      }
      const hm = /^\/api\/history\/([A-Za-z0-9_-]+)$/.exec(p);
      if (hm) {
        const file = path.join(historyDir, `${hm[1]}.json`);
        if (req.method === 'GET') {
          if (!fs.existsSync(file)) return sendJson(res, 200, { items: [] });
          try {
            return sendJson(res, 200, { items: JSON.parse(await fsp.readFile(file, 'utf8')) });
          } catch {
            return sendJson(res, 200, { items: [] });
          }
        }
        if (req.method === 'POST') {
          const rec = JSON.parse((await readBody(req)).toString('utf8'));
          let items = [];
          if (fs.existsSync(file)) {
            try {
              items = JSON.parse(await fsp.readFile(file, 'utf8'));
            } catch {
              items = [];
            }
          }
          items = [rec, ...items.filter((x) => x.id !== rec.id)].slice(0, MAX_HISTORY);
          await atomicWrite(file, JSON.stringify(items));
          return sendJson(res, 200, { ok: true });
        }
        if (req.method === 'DELETE') {
          const id = url.searchParams.get('id');
          if (id && fs.existsSync(file)) {
            const items = JSON.parse(await fsp.readFile(file, 'utf8')).filter((x) => x.id !== id);
            await atomicWrite(file, JSON.stringify(items));
          } else await fsp.unlink(file).catch(() => {});
          return sendJson(res, 200, { ok: true });
        }
      }
      if (p === '/api/send' && req.method === 'POST') return handleSend(req, res);
      return sendJson(res, 404, { error: '接口不存在' });
    } catch (e) {
      if (!res.headersSent) return sendJson(res, 500, { error: e?.message || String(e) });
      res.end();
    }
  };
}
