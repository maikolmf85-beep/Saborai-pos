import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

function apiDevPlugin(): Plugin {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        const cleanPath = url.split('?')[0];
        let targetModule = '';
        if (cleanPath === '/api/hacienda') {
          targetModule = '/api/hacienda.ts';
        } else if (cleanPath === '/api/parse-menu') {
          targetModule = '/api/parse-menu.ts';
        } else if (cleanPath === '/api/ai/chat') {
          targetModule = '/api/ai/chat.ts';
        } else if (cleanPath === '/api/email/send-invoice') {
          targetModule = '/api/email/send-invoice.ts';
        } else if (cleanPath === '/api/auth' || cleanPath.startsWith('/api/auth/') || cleanPath === '/api/demo/register') {
          targetModule = '/api/auth.ts';
        } else if (cleanPath === '/api/tilopay' || cleanPath.includes('/webhooks/tilopay')) {
          targetModule = '/api/tilopay.ts';
        } else if (cleanPath === '/api/tenant/onboarding') {
          targetModule = '/api/tenant/onboarding.ts';
        } else if (cleanPath === '/api/admin/metrics') {
          targetModule = '/api/admin/metrics.ts';
        } else if (cleanPath === '/api/offline/sync') {
          targetModule = '/api/offline/sync.ts';
        } else if (cleanPath === '/api/whatsapp/webhook') {
          targetModule = '/api/whatsapp/webhook.ts';
        }

        if (targetModule) {
          const requestUrl = new URL(req.url || '/', 'http://localhost');
          (req as any).query = Object.fromEntries(requestUrl.searchParams.entries());

          if (req.method === 'OPTIONS') {
            res.statusCode = 200;
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
            res.end();
            return;
          }

          let rawBody = '';
          req.on('data', chunk => { rawBody += chunk; });
          req.on('end', async () => {
            (req as any).rawBody = Buffer.from(rawBody);
            try {
              (req as any).body = rawBody ? JSON.parse(rawBody) : {};
            } catch {
              (req as any).body = {};
            }

            try {
              const module = await server.ssrLoadModule(targetModule);
              const handler = module.default;
              const resAdapter: any = {
                setHeader: (name: string, val: string) => res.setHeader(name, val),
                status: (code: number) => {
                  res.statusCode = code;
                  return resAdapter;
                },
                json: (data: any) => {
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify(data));
                  return resAdapter;
                },
                send: (data: any) => res.end(data),
                end: (data?: any) => res.end(data)
              };

              await handler(req as any, resAdapter);
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: `Error ejecutando ${targetModule} local`, details: err.message }));
            }
          });
          return;
        }
        next();
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    apiDevPlugin(),
    VitePWA({
      registerType: 'prompt',
      filename: 'sw.js',
      manifestFilename: 'manifest.json',
      includeAssets: ['favicon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable.png', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Saborai POS - Gastronomía Inteligente',
        short_name: 'Saborai POS',
        description: 'Punto de venta gastronómico inteligente para restaurantes.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        background_color: '#fcfeff',
        theme_color: '#3b3733',
        lang: 'es-CR',
        categories: ['business', 'food', 'productivity'],
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'saborai-fonts',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly'
          }
        ]
      },
      devOptions: { enabled: false }
    })
  ],
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react/') || id.includes('react-dom/')) {
              return 'vendor-react';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('node-forge') || id.includes('haciendacostarica-signer')) {
              return 'vendor-crypto';
            }
            if (id.includes('react-markdown')) {
              return 'vendor-markdown';
            }
          }
        }
      }
    }
  },
  server: {
    proxy: {
      '/api/notion': {
        target: 'https://api.notion.com/v1',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/notion/, ''),
      },
    },
  },
})
