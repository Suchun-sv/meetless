import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Strict CSP for the packaged renderer. Not applied to the Vite dev server, whose
// React refresh preamble is an inline script. connect-src allows loopback for the dev bridge only.
const csp: Plugin = {
  name: 'meetless-csp',
  apply: 'build',
  transformIndexHtml: () => [
    {
      tag: 'meta',
      attrs: {
        'http-equiv': 'Content-Security-Policy',
        content:
          "default-src 'self'; script-src 'self' http://127.0.0.1:55435; frame-src http://127.0.0.1:55435; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*",
      },
      injectTo: 'head-prepend',
    },
  ],
};

// Renderer only. Electron main/preload are bundled by scripts/build-main.mjs.
export default defineConfig({
  root: 'src/renderer',
  base: './',
  plugins: [react(), csp],
  // Fonts always ship as files, never inlined. Vite inlines assets under 4 KB as data: URLs, and a few
  // Noto Sans SC slices are that small. The packaged CSP above has no font-src, so fonts fall back to
  // default-src 'self', which blocks data: URLs: an inlined slice would silently not load in Electron.
  // es2020 + safari15: the web build runs on older iPhones and Macs too; no newer syntax ships.
  build: { target: ['es2020', 'safari15'], outDir: '../../dist/renderer', emptyOutDir: true, assetsInlineLimit: (file: string) => (file.endsWith('.woff2') ? false : undefined) },
  server: { host: '127.0.0.1' },
});
