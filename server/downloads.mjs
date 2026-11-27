import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';

function basename(filename) {
  const name = filename.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f<>:"|?*]/g, '').replace(/^[. ]+|[. ]+$/g, '');
  return !name || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name) ? 'download.txt' : name;
}

function contentBytes(payload) {
  if (typeof payload.content === 'string' && payload.contentBase64 == null) return Buffer.from(payload.content);
  if (typeof payload.contentBase64 === 'string' && payload.content == null) {
    const bytes = Buffer.from(payload.contentBase64, 'base64');
    if (bytes.toString('base64') === payload.contentBase64) return bytes;
  }
  throw Object.assign(new Error('Expected text or base64 content'), { status: 400 });
}

export function downloadsStore(dataDir, downloadDir, atomicWrite) {
  const history = path.join(dataDir, 'downloads.json');
  let pending = Promise.resolve();
  function mutate(fn) {
    const result = pending.then(fn);
    pending = result.catch(() => {});
    return result;
  }
  async function read() {
    try { return JSON.parse(await fs.readFile(history, 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return []; throw err; }
  }
  async function save(payload) {
    if (typeof payload?.filename !== 'string' || typeof payload.mimeType !== 'string' ||
        !['response', 'backup', 'postman', 'doc'].includes(payload.source) ||
        (payload.requestName != null && typeof payload.requestName !== 'string')) {
      throw Object.assign(new Error('Invalid download metadata'), { status: 400 });
    }
    const records = await read();
    const bytes = contentBytes(payload);
    await fs.mkdir(downloadDir, { recursive: true });
    const dir = await fs.realpath(downloadDir);
    const name = basename(payload.filename);
    const { name: stem, ext } = path.parse(name);
    for (let i = 0; ; i++) {
      const filename = i ? `${stem} (${i})${ext}` : name;
      const file = path.join(dir, filename);
      let handle;
      try { handle = await fs.open(file, 'wx', 0o600); }
      catch (err) { if (err.code === 'EEXIST') continue; throw err; }
      const record = { id: randomUUID(), filename, path: file, dir, size: bytes.length, mimeType: payload.mimeType,
        source: payload.source, requestName: payload.requestName, createdAt: Date.now(), exists: true };
      try {
        try { await handle.writeFile(bytes); } finally { await handle.close(); }
        await atomicWrite(history, JSON.stringify([record, ...records].slice(0, 100)));
      } catch (err) { await fs.unlink(file); throw err; }
      return record;
    }
  }
  async function reveal(input) {
    if (!path.isAbsolute(input)) throw new Error('Expected absolute path');
    if (input === downloadDir) await fs.mkdir(downloadDir, { recursive: true });
    let target;
    try { target = await fs.realpath(input); }
    catch (err) {
      if (err.code !== 'ENOENT' || await fs.lstat(input).catch(() => null)) throw err;
      target = path.join(await fs.realpath(path.dirname(input)), path.basename(input));
    }
    const root = await fs.realpath(downloadDir).catch(() => null);
    const relative = root && path.relative(root, target);
    const inside = root && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
    if (!inside && target !== await fs.realpath(dataDir) && !(await read()).some(r => r.path === target || r.dir === target)) {
      throw Object.assign(new Error('Path outside downloads'), { status: 403 });
    }
    const stat = await fs.stat(target).catch(() => null);
    const dir = stat?.isDirectory() ? target : path.dirname(target);
    const file = stat?.isFile();
    const [cmd, ...args] = process.platform === 'darwin' ? (file ? ['open', '-R', target] : ['open', dir])
      : process.platform === 'win32' ? ['explorer', file ? '/select,' + target : dir] : ['xdg-open', dir];
    await new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  }
  return {
    save: payload => mutate(() => save(payload)),
    list: async () => Promise.all((await read()).map(async r => ({ ...r, exists: await fs.stat(r.path).then(s => s.isFile(), () => false) }))),
    remove: id => mutate(async () => atomicWrite(history, JSON.stringify((await read()).filter(r => id != null && r.id !== id)))),
    reveal,
  };
}
