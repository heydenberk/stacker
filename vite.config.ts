import preact from '@preact/preset-vite';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  // Load .env from the repo root. Only SPOTIFY_CLIENT_ID (public) reaches the bundle; the secret never does.
  const env = loadEnv(mode, repoRoot, '');
  if (mode === 'production' && !env.SPOTIFY_CLIENT_ID) {
    throw new Error('SPOTIFY_CLIENT_ID must be set to build Stacker for production');
  }
  return {
    root: 'web',
    base: '/stacker/',
    plugins: [preact()],
    define: { __SPOTIFY_CLIENT_ID__: JSON.stringify(env.SPOTIFY_CLIENT_ID ?? '') },
    // Spotify only accepts loopback redirect URIs on 127.0.0.1, not "localhost".
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    preview: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { outDir: '../dist', emptyOutDir: true },
  };
});
