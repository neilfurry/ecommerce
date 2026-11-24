/**
 * Shared Vite + Vitest configuration for the three frontends.
 * Each app's vite.config.ts calls createAppConfig({ port }).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, loadEnv, type UserConfig } from 'vite';
import type { InlineConfig } from 'vitest/node';

const repoRoot = path.dirname(fileURLToPath(import.meta.url));

export function createAppConfig({ port, mode }: { port: number; mode: string }): UserConfig & {
  test: InlineConfig;
} {
  // All apps read the single repository-root .env (only VITE_* reach the browser).
  const env = loadEnv(mode, repoRoot, 'VITE_');
  const apiProxy = {
    '/api': { target: env.VITE_API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false },
  };

  return {
    envDir: repoRoot,
    plugins: [react(), tailwindcss()],
    resolve: {
      // Load workspace packages from their TypeScript sources (see "source" export condition).
      conditions: ['source', ...defaultClientConditions],
    },
    server: { port, strictPort: true, proxy: apiProxy },
    preview: { port: port + 1000, strictPort: true, proxy: apiProxy },
    build: {
      sourcemap: true,
      rolldownOptions: {
        output: {
          // Long-lived vendor chunks are cached by browsers across app deployments.
          codeSplitting: {
            groups: [
              {
                name: 'react',
                test: /node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/,
              },
              { name: 'data', test: /node_modules[\\/](@tanstack|zod)[\\/]/ },
              { name: 'vendor', test: /node_modules[\\/]/ },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: [path.join(repoRoot, 'vitest.setup.ts')],
      css: false,
    },
  };
}
