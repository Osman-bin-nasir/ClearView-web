import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import adminSession from './api/admin/session.js';
import { directoryStorage, makePublishHandler } from './api/admin/publish.js';

/**
 * Serve the two admin endpoints from `npm run dev` and `npm run preview`.
 *
 * On Vercel the file in `api/` is deployed as a function and this plugin does
 * nothing at all there — the build output is still a plain static bundle. It
 * exists so the two local commands behave like the deployment: without it, the
 * admin screen answers its own "Sign in" button with "no endpoint here", which
 * looks exactly like a broken feature and is really just a missing server.
 *
 * It hands Vite's request and response to the same handlers Vercel calls, so
 * there is one implementation of the sign-in and one of the publish, and no
 * second code path that could drift from either. Exactly two routes are mounted
 * — `session` and `publish` — and nothing else in the project is server-side.
 *
 * The publish endpoint gets a DIFFERENT storage here than on the deployment.
 * There, a publish commits to the repository and Vercel deploys the result.
 * Here, `directoryStorage()` writes the same document into `public/`, because a
 * laptop has no repository to commit to, and committing the live branch from a
 * development machine would deploy whatever was half-finished at the time.
 * Same handler, same token check, same allowlist; only the destination differs,
 * and both say which one they are.
 */
function adminEndpoint() {
  const publish = makePublishHandler({ storage: directoryStorage() });

  /**
   * Ask an endpoint what it makes of the environment right now.
   *
   * The handler is called with a throwaway request rather than the variables
   * being validated a second time here: the line printed at startup is then
   * necessarily the same verdict a browser will get, including the names of the
   * variables it refuses. Nothing about a value is printed, ever.
   *
   * It does not report the address, either: `GET` answers with the *signed-in*
   * user's email, not the configured one, because telling an anonymous caller
   * whether an address is an administrator would be a way to find out. So the
   * address in the line below comes from the environment, and only after the
   * endpoint has confirmed it is usable.
   */
  const ask = async (handler) => {
    const res = {
      setHeader() {},
      end(text) {
        this.text = text ?? '';
      },
      text: '',
    };
    await handler({ method: 'GET', url: '/', headers: {} }, res);
    try {
      return JSON.parse(res.text === '' ? '{}' : res.text);
    } catch {
      return {};
    }
  };

  /**
   * Say who can sign in, after Vite's own banner.
   *
   * Without this the admin screen is a form nobody has been told the credentials
   * for: `.env` may hold nothing, or hold something made for a password long
   * forgotten. One line at startup turns that into an answer.
   */
  const announce = async () => {
    const verdict = await ask(adminSession).catch(() => ({}));
    const names = [...(verdict.missing ?? []), ...(verdict.unusable ?? [])];
    console.log('');
    if (verdict.configured) {
      const email = String(process.env.ADMIN_EMAIL ?? '').trim();
      console.log(
        `  admin sign-in  ${email} — a different address or password: npm run admin:set -- you@example.com`,
      );
    } else {
      console.log(
        names.length
          ? `  admin sign-in  not configured: ${names.join(', ')}`
          : '  admin sign-in  not configured',
      );
      console.log('  set it up with  npm run admin:set -- you@example.com');
    }

    // Where a Publish would put the file, on this machine. The deployment's
    // answer is different — it commits, and the commit deploys — so saying which
    // one is in front of you is the difference between an edit and a deploy.
    const publishing = await ask(publish).catch(() => ({}));
    console.log(
      publishing.mode === 'directory'
        ? `  publishing     writes the JSON into public/ here — the deployment commits it to GitHub instead`
        : `  publishing     commits to ${publishing.target ?? 'the repository'}`,
    );
    console.log('');
  };

  /** Print the line once the server is listening, so it lands under Vite's addresses. */
  const announceAfterBanner = (server) => {
    const print = server.printUrls?.bind(server);
    server.printUrls = () => {
      print?.();
      announce();
    };
    if (typeof print !== 'function') announce();
  };

  const mount = (middlewares) => {
    for (const [route, handler] of [
      ['/api/admin/session', adminSession],
      ['/api/admin/publish', publish],
    ]) {
      middlewares.use(route, (req, res, next) => {
        // connect strips the mount path, so the handler sees '/' or '/?query'.
        if (req.url !== '/' && req.url !== '' && !req.url.startsWith('/?')) {
          next();
          return;
        }
        Promise.resolve(handler(req, res)).catch(() => {
          if (res.writableEnded) return;
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'failed' }));
        });
      });
    }
  };

  return {
    name: 'clearview-admin-endpoint',
    configureServer: (server) => {
      mount(server.middlewares);
      announceAfterBanner(server);
    },
    configurePreviewServer: (server) => {
      mount(server.middlewares);
      announceAfterBanner(server);
    },
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
