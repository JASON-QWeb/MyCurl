import { once, EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, realpath, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
// @ts-expect-error JavaScript middleware
import { createApi } from '../server/api.mjs';

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<object>(), spawn }));

it('saves concurrent binary downloads without collisions, validates reveal targets and refreshes file existence', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'mycurl-download-test-')));
  const dir = join(root, 'out');
  vi.stubEnv('MYCURL_DOWNLOAD_DIR', dir);
  const server = createServer(createApi({ dataDir: join(root, 'state') }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const api = 'http://127.0.0.1:' + (server.address() as AddressInfo).port + '/api/';
  const post = (endpoint: string, payload: object) => fetch(api + endpoint, { method: 'POST', body: JSON.stringify(payload) });
  const reveal = (path: string) => post('downloads/reveal', { path });
  spawn.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  });
  try {
    expect((await (await fetch(api + 'info')).json()).downloadDir).toBe(dir);
    expect((await fetch(api + 'downloads', { headers: { Origin: 'https://example.org' } })).status).toBe(403);
    const options = { filename: '..\\...foo.json', contentBase64: 'AAE=', mimeType: 'application/octet-stream', source: 'response' };
    const records = await Promise.all(Array.from({ length: 2 }, () => post('downloads', options).then(r => r.json())));
    expect(records.map(r => r.filename).sort()).toEqual(['foo (1).json', 'foo.json']);
    for (const record of records) expect(await readFile(record.path)).toEqual(Buffer.from([0, 1]));
    const [a, b] = records;
    expect((await reveal(a.path)).ok).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect((await reveal(join(root, 'state'))).ok).toBe(true);
    await writeFile(join(root, 'private'), 'private');
    await symlink(join(root, 'private'), join(dir, 'link'));
    expect((await reveal(join(dir, 'link'))).status).toBe(403);
    expect((await reveal(join(root, 'private'))).status).toBe(403);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect((await post('downloads', { ...options, contentBase64: '!' })).status).toBe(400);
    await rm(a.path);
    const list = await (await fetch(api + 'downloads')).json();
    expect(list.find((r: { id: string }) => r.id === a.id).exists).toBe(false);
    expect((await reveal(a.path)).ok).toBe(true);
    await fetch(api + 'downloads?id=' + a.id, { method: 'DELETE' });
    expect(await (await fetch(api + 'downloads')).json()).toEqual([b]);
    await fetch(api + 'downloads', { method: 'DELETE' });
    expect(JSON.parse(await readFile(join(root, 'state', 'downloads.json'), 'utf8'))).toEqual([]);
    expect(await readFile(b.path)).toEqual(Buffer.from([0, 1]));
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
