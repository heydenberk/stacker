import preact from '@preact/preset-vite';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { createRealDeps } from './server/deps';
import { handle } from './server/router';

// The crate editor: dev-server only (`npm run editor`), never built for production.
const editorDir = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const MAX_BODY = 5 * 1024 * 1024;

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Serves /api/* from editor/server/router.ts against the real repo. */
function editorApi(): Plugin {
  return {
    name: 'stacker-editor-api',
    configureServer(server) {
      const deps = createRealDeps(repoRoot);
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        void (async () => {
          let status = 500;
          let json: unknown;
          try {
            const body = await readBody(req);
            ({ status, json } = await handle(deps, { method: req.method ?? 'GET', url: req.url!, headers: req.headers, body }));
          } catch (e) {
            json = { error: (e as Error).message };
          }
          res.statusCode = status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(json));
        })();
      });
    },
  };
}

export default defineConfig({
  root: editorDir,
  plugins: [preact(), editorApi()],
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
});
