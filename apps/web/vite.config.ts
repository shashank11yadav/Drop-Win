import { staticPageCsp, webSecurityHeaders } from '@drop-win/contract';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/**
 * Writes dist/_headers, which Cloudflare (Workers assets or Pages) applies to
 * every static response. Hashed assets can be cached forever.
 */
function headersFile(apiBase: string): Plugin {
  const apiOrigin = apiBase ? new URL(apiBase).origin : undefined;
  return {
    name: 'drop-win-headers-file',
    apply: 'build',
    generateBundle() {
      const lines = ['/*'];
      for (const [name, value] of Object.entries(webSecurityHeaders(apiOrigin))) {
        lines.push(`  ${name}: ${value}`);
      }
      lines.push('', '/assets/*', '  Cache-Control: public, max-age=31536000, immutable', '');
      this.emitFile({ type: 'asset', fileName: '_headers', source: lines.join('\n') });
    },
  };
}

/**
 * GitHub Pages cannot send headers, so the static build carries its CSP and
 * referrer policy in meta tags. Build only: the dev server injects an inline
 * script for hot reload, which this policy would block.
 */
function metaPolicies(): Plugin {
  const charset = '<meta charset="UTF-8" />';
  const policies = [
    `<meta http-equiv="Content-Security-Policy" content="${staticPageCsp()}" />`,
    '<meta name="referrer" content="no-referrer" />',
  ];
  return {
    name: 'drop-win-meta-policies',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      // Right after the charset and before every script, so nothing loads unchecked.
      handler(html) {
        if (!html.includes(charset)) throw new Error('index.html is missing its charset meta tag');
        return html.replace(charset, [charset, ...policies].join('\n    '));
      },
    },
  };
}

/**
 * Modes:
 * - default: the API is the house (npm run dev, the Worker deploy).
 * - browser: the house runs in a Web Worker in the page, with no server.
 * - pages: browser mode built for https://<user>.github.io/Drop-Win/.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', ['VITE_', 'WEB_PORT', 'API_PORT']);
  const pages = mode === 'pages';
  const browser = pages || mode === 'browser' || env['VITE_BACKEND'] === 'browser';
  const apiBase = browser ? '' : (env['VITE_API_BASE'] ?? '');
  // Unset, empty and non-numeric all fall back to the default port.
  const port = Number(env['WEB_PORT']) || (browser ? 5310 : 5300);
  const apiPort = Number(env['API_PORT']) || 5301;
  return {
    base: pages ? '/Drop-Win/' : '/',
    envDir: '../..',
    define: {
      'import.meta.env.VITE_BACKEND': JSON.stringify(browser ? 'browser' : 'server'),
      'import.meta.env.VITE_API_BASE': JSON.stringify(apiBase),
    },
    plugins: [react(), browser ? metaPolicies() : headersFile(apiBase)],
    server: {
      port,
      strictPort: true,
      ...(browser
        ? {}
        : {
            proxy: {
              // Keep the browser's Host header. The string shorthand rewrites it
              // to the target, and the API's same-origin check then rejects
              // every POST because Origin and Host no longer match.
              '/api': { target: `http://127.0.0.1:${String(apiPort)}`, changeOrigin: false },
            },
          }),
    },
    preview: { port, strictPort: true },
    worker: { format: 'es' },
    build: { target: 'es2022', sourcemap: true, outDir: pages ? 'dist-pages' : 'dist' },
  };
});
