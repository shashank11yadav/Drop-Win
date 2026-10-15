import { webSecurityHeaders } from '@drop-win/contract';
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '../..', 'VITE_');
  const apiBase = env['VITE_API_BASE'] ?? '';
  return {
    envDir: '../..',
    plugins: [react(), headersFile(apiBase)],
    server: {
      port: 5300,
      strictPort: true,
      proxy: { '/api': 'http://127.0.0.1:5301' },
    },
    preview: { port: 5300, strictPort: true },
    build: { target: 'es2022', sourcemap: true },
  };
});
