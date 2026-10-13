import react from '@vitejs/plugin-react'
import { defineConfig, Plugin } from 'vite'

function apiDevPlugin(): Plugin {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url || '';
        let targetModule = '';
        if (url === '/api/hacienda' || url.startsWith('/api/hacienda?')) {
          targetModule = '/api/hacienda.ts';
        } else if (url === '/api/parse-menu' || url.startsWith('/api/parse-menu?')) {
          targetModule = '/api/parse-menu.ts';
        }

        if (targetModule) {
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
  plugins: [react(), apiDevPlugin()],
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


