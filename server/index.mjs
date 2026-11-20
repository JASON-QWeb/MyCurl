#!/usr/bin/env node
/**
 * 生产模式入口：提供 dist/ 静态文件 + /api
 *   node server/index.mjs [--port 5899] [--open]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createApi, defaultDataDir } from './api.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

export function startServer({ port = 5899, host = '127.0.0.1', dataDir = defaultDataDir() } = {}) {
  const api = createApi({ dataDir });
  const server = http.createServer((req, res) => {
    api(req, res, () => {
      const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://x').pathname);
      let file = path.join(distDir, urlPath);
      if (!file.startsWith(distDir)) {
        res.writeHead(403);
        return res.end();
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html');
      if (!fs.existsSync(file)) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('未找到前端构建产物，请先运行 npm run build');
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable',
      });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    const tryListen = (p, attempts) => {
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempts > 0) tryListen(p + 1, attempts - 1);
        else reject(err);
      });
      server.listen(p, host, () => resolve({ server, port: p, url: `http://localhost:${p}` }));
    };
    tryListen(port, 20);
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const pi = args.indexOf('--port');
  const port = pi >= 0 ? Number(args[pi + 1]) : Number(process.env.PORT) || 5899;
  if (!fs.existsSync(path.join(distDir, 'index.html'))) {
    console.log('首次运行，正在构建前端…');
    await new Promise((resolve, reject) => {
      const p = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'build'], { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
      p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('构建失败'))));
    });
  }
  const { url } = await startServer({ port });
  console.log(`\n  MyCurl 已启动：${url}\n  数据目录：${defaultDataDir()}\n`);
  if (args.includes('--open')) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const cmdArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(cmd, cmdArgs, { stdio: 'ignore', detached: true }).unref();
  }
}
