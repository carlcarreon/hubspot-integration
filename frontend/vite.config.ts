import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // The root .env stays on the development server. Its dashboard token is
  // injected into the proxy request and is never exposed as a VITE_* value.
  const frontendRoot = dirname(fileURLToPath(import.meta.url));
  const projectRoot = resolve(frontendRoot, '..');
  const environment = loadEnv(mode, projectRoot, '');
  const dashboardApiToken = environment.DASHBOARD_API_TOKEN;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': resolve(frontendRoot, 'src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: environment.VITE_BACKEND_URL ?? 'http://localhost:3000',
          changeOrigin: true,
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyRequest) => {
              if (dashboardApiToken) {
                proxyRequest.setHeader('Authorization', `Bearer ${dashboardApiToken}`);
              }
            });
          },
        },
      },
    },
  };
});
