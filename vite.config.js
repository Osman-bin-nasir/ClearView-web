import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import adminSession from './api/admin/session.js';

/**
 * Serve `api/admin/session.js` from `npm run dev` and `npm run preview`.
 *
 * On Vercel the file in `api/` is deployed as a function and this plugin does
 * nothing at all there — the build output is still a plain static bundle. It
 * exists so the two local commands behave like the deployment: without it, the
 * admin screen answers its own "Sign in" button with "no endpoint here", which
 * looks exactly like a broken feature and is really just a missing server.
 *
 * It hands Vite's request and response to the same handler Vercel calls, so
 * there is one implementation of the sign-in and no second code path that could
 * drift from it. Only `/api/admin/session` is mounted; nothing else in the
 * project is server-side, and nothing else should become so by accident.
 */
function adminEndpoint() {
  const mount = (middlewares) => {
    middlewares.use('/api/admin/session', (req, res, next) => {
      // connect strips the mount path, so the handler sees '/' or '/?query'.
      if (req.url !== '/' && req.url !== '' && !req.url.startsWith('/?')) {
        next();
        return;
      }
      Promise.resolve(adminSession(req, res)).catch(() => {
        if (res.writableEnded) return;
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'failed' }));
      });
    });
  };

  return {
    name: 'clearview-admin-endpoint',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  };
}

export default defineConfig(({ mode }) => {
  /**
   * Give the endpoint the credentials from `.env`.
   *
   * Vite deliberately does not put env files into `process.env` — it exposes
   * only `VITE_`-prefixed values, and only inside the bundle. So a locally run
   * endpoint would find nothing configured. Fill in the `ADMIN_` variables
   * here, and only those: they are read on the server side of a request, and
   * the server in this case is this process. Anything already exported in the
   * shell wins, so a one-off `ADMIN_EMAIL=… npm run preview` still works.
   */
  const env = loadEnv(mode, process.cwd(), '');
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('ADMIN_') || process.env[key] !== undefined) continue;
    process.env[key] = value;
  }

  return {
    // Relative base so the built site works from any folder, on any static host
    // (GitHub Pages project sites, Netlify, S3 subfolders, plain file servers).
    base: './',
    plugins: [react(), tailwindcss(), adminEndpoint()],
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
    },
  };
});
