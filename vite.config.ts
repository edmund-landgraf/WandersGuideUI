/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { visualizer } from 'rollup-plugin-visualizer';
import { VitePWA, VitePWAOptions } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';

const manifestForPlugin: Partial<VitePWAOptions> = {
  registerType: 'prompt',
  includeAssets: ['apple-icon-180.png', 'maskable_icon.png'],
  workbox: {
    maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15 MiB
    navigateFallbackDenylist: [
      /^\/auth\//,
      /^\/rest\//,
      /^\/functions\//,
      /^\/storage\//,
      /^\/pg\//,
      /^\/help(\/|$)/,
      /^\/owlbear\/auth(\/|$)/,
      /^\/videos(\/|$)/,
    ],
  },
  manifest: {
    name: "Wanderer's Guide",
    short_name: "Wanderer's Guide",
    description: 'A character builder and digital toolbox for Pathfinder and Starfinder Second Edition.',
    icons: [
      {
        src: '/apple-icon-180.png',
        sizes: '180x180',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/maskable_icon.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/maskable_icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    theme_color: '#141517',
    background_color: '#141517',
    display: 'standalone',
    scope: '/',
    start_url: '/',
    orientation: 'portrait-primary',
  },
};

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'development' ? '/' : './',
  resolve: {
    alias: {
      '@assets': path.resolve(__dirname, './src/assets'),
      '@atoms': path.resolve(__dirname, './src/atoms'),
      '@common': path.resolve(__dirname, './src/common'),
      '@components': path.resolve(__dirname, './src/components'),
      '@drawers': path.resolve(__dirname, './src/drawers'),
      '@nav': path.resolve(__dirname, './src/nav'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@modals': path.resolve(__dirname, './src/modals'),
      '@constants': path.resolve(__dirname, './src/constants'),
      '@contexts': path.resolve(__dirname, './src/contexts'),
      '@utils': path.resolve(__dirname, './src/utils'),
      '@auth': path.resolve(__dirname, './src/auth'),
      '@schemas': path.resolve(__dirname, './src/schemas'),
      '@operations': path.resolve(__dirname, './src/process/operations'),
      '@variables': path.resolve(__dirname, './src/process/variables'),
      '@requests': path.resolve(__dirname, './src/request'),
      '@upload': path.resolve(__dirname, './src/process/upload'),
      '@content': path.resolve(__dirname, './src/process/content'),
      '@items': path.resolve(__dirname, './src/process/items'),
      '@specializations': path.resolve(__dirname, './src/process/specializations'),
      '@import': path.resolve(__dirname, './src/process/import'),
      '@export': path.resolve(__dirname, './src/process/export'),
      '@homebrew': path.resolve(__dirname, './src/process/homebrew'),
      '@conditions': path.resolve(__dirname, './src/process/conditions'),
      '@spells': path.resolve(__dirname, './src/process/spells'),
      '@css': path.resolve(__dirname, './src/css'),
      '@ai': path.resolve(__dirname, './src/ai'),
    },
  },
  plugins: [
    {
      name: 'serve-videos',
      configureServer(server) {
        const videosDir = path.resolve(__dirname, 'videos');
        const types: Record<string, string> = {
          '.mp4': 'video/mp4',
          '.webm': 'video/webm',
          '.mov': 'video/quicktime',
          '.m4v': 'video/x-m4v',
        };
        server.middlewares.use((req, res, next) => {
          const urlPath = decodeURIComponent(req.url?.split('?')[0] ?? '');
          if (urlPath !== '/videos' && !urlPath.startsWith('/videos/')) return next();
          const relative = urlPath.slice('/videos/'.length);
          const safe =
            relative.length > 0 &&
            !relative.endsWith('/') &&
            !relative.includes('/') &&
            !relative.includes('\\') &&
            !relative.includes('..');
          const file = safe ? path.resolve(videosDir, relative) : '';
          if (!safe || !file.startsWith(videosDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.end('Not Found');
            return;
          }
          const stat = fs.statSync(file);
          const ext = path.extname(file).toLowerCase();
          res.setHeader('Content-Type', types[ext] ?? 'application/octet-stream');
          res.setHeader('Accept-Ranges', 'bytes');
          const range = req.headers.range;
          if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match) {
              res.statusCode = 416;
              res.setHeader('Content-Range', `bytes */${stat.size}`);
              res.end();
              return;
            }
            const start = match[1] ? Number(match[1]) : 0;
            const end = match[2] ? Number(match[2]) : stat.size - 1;
            if (start > end || end >= stat.size) {
              res.statusCode = 416;
              res.setHeader('Content-Range', `bytes */${stat.size}`);
              res.end();
              return;
            }
            res.statusCode = 206;
            res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
            res.setHeader('Content-Length', end - start + 1);
            fs.createReadStream(file, { start, end }).pipe(res);
            return;
          }
          res.setHeader('Content-Length', stat.size);
          fs.createReadStream(file).pipe(res);
        });
      },
    },
    {
      name: 'serve-help-pages',
      configureServer(server) {
        const helpDir = path.resolve(__dirname, 'public/help');
        server.middlewares.use((req, res, next) => {
          const urlPath = req.url?.split('?')[0] ?? '';
          if (urlPath !== '/help' && !urlPath.startsWith('/help/')) return next();
          const relative = urlPath === '/help' || urlPath === '/help/' ? 'index.html' : urlPath.slice('/help/'.length);
          if (!relative || relative.includes('..')) return next();
          const file = path.resolve(helpDir, relative);
          if (!file.startsWith(helpDir) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
          const type = file.endsWith('.css') ? 'text/css' : 'text/html';
          res.setHeader('Content-Type', `${type}; charset=utf-8`);
          fs.createReadStream(file).pipe(res);
        });
      },
    },
    tailwindcss(),
    react(),
    visualizer({
      emitFile: true,
      filename: 'stats.html',
    }),
    ...(mode === 'development' ? [] : [VitePWA(manifestForPlugin)]),
  ],
  build: {
    // Was: a @babel/preset-env pass (targets ios15) running over the whole bundle on top
    // of esbuild - a redundant second transpile. esbuild lowers syntax to the same target
    // in a single pass; 'safari15' preserves the original iOS 15 support intent.
    target: ['es2020', 'safari15'],
  },
  server: {
    proxy: {
      // Same-origin stand-in for local Kong. Firefox rejects Kong's
      // Allow-Origin * + Allow-Credentials response; Chrome does not.
      // Docker publishes Kong on IPv6 localhost; 127.0.0.1 accepts the TCP
      // connection and then sends an empty reply.
      '/auth': { target: 'http://[::1]:8000', changeOrigin: true },
      '/rest': { target: 'http://[::1]:8000', changeOrigin: true },
      '/storage': { target: 'http://[::1]:8000', changeOrigin: true },
      '/functions': { target: 'http://[::1]:8000', changeOrigin: true },
      '/realtime': { target: 'http://[::1]:8000', changeOrigin: true, ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
}));
