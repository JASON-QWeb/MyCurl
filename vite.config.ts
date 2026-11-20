import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error - 纯 JS 模块
import { createApi } from './server/api.mjs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'mycurl-api',
      configureServer(server: any) {
        if (process.env.VITEST) return;
        const api = createApi();
        server.middlewares.use((req: any, res: any, next: any) => api(req, res, next));
      },
      configurePreviewServer(server: any) {
        if (process.env.VITEST) return;
        const api = createApi();
        server.middlewares.use((req: any, res: any, next: any) => api(req, res, next));
      },
    },
  ],
  base: './',
  server: { port: 5898, host: '127.0.0.1' },
  build: { outDir: 'dist', chunkSizeWarningLimit: 2000 },
  test: { include: ['tests/**/*.test.ts'] },
} as any);
