import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type RequestListener, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
// @ts-expect-error -- the Node API is a JavaScript module.
import { createApi } from '../server/api.mjs';

it('keeps credentials on same-origin redirects and strips them on the wire when the origin changes', async () => {
  const servers: Server[] = [];
  const listen = async (handler: RequestListener) => {
    const server = createServer(handler);
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const credentials = [
    'Authorization', 'Proxy-Authorization', 'Cookie', 'X-aPi-KeY', 'API-Key', 'ApiKey',
    'X-Auth-Token', 'X-Auth-Key', 'X-Goog-Api-Key', 'Ocp-Apim-Subscription-Key',
    'Private-Token', 'X-Access-Token', 'Access-Token',
  ];
  const dataDir = await mkdtemp(join(tmpdir(), 'mycurl-redirect-'));
  try {
    const received: IncomingHttpHeaders[] = [];
    const destination = await listen((req, res) => {
      received.push(req.headers);
      res.end('ok');
    });
    const origin = await listen((req, res) => {
      received.push(req.headers);
      res.writeHead(302, { Location: req.url === '/start' ? '/same-origin' : destination + '/final' }).end();
    });
    const api = await listen(createApi({ dataDir }));
    const response = await fetch(api + '/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ method: 'GET', url: origin + '/start', options: { timeoutMs: 3000 },
        headers: [...credentials.map(name => [name, 'test-value']), ['X-Trace-Id', 'redirect-trace']] }),
    });
    const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
    expect(events[0]).toMatchObject({ t: 'head', status: 200, url: destination + '/final',
      redirects: ['302 → ' + origin + '/same-origin', '302 → ' + destination + '/final'] });
    expect(events.at(-1)?.t).toBe('end');
    expect(received).toHaveLength(3);
    for (const name of credentials.map(name => name.toLowerCase())) {
      expect(received[0][name], name).toBe('test-value');
      expect(received[1][name], name).toBe('test-value');
      expect(received[2][name], name).toBeUndefined();
    }
    expect(received.map(headers => headers['x-trace-id'])).toEqual(Array(3).fill('redirect-trace'));
  } finally {
    await Promise.all(servers.map(server => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    })));
    await rm(dataDir, { recursive: true, force: true });
  }
});
