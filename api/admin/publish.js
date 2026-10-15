/**
 * Publishing: the admin screen's Save, for everyone.
 *
 * WHY THIS EXISTS: the site's words and links are two committed files —
 * `public/site-content.json` and `public/app-links.json` — and the page fetches
 * them at startup out of its own build. A static build cannot write to the
 * repository, so the editor used to hand you the file to commit by hand. This is
 * the endpoint that removes that step: it takes the document the admin approved
 * and commits it, and the repository's existing Vercel integration turns that
 * commit into a deploy.
 *
 *   GET    /api/admin/publish   can this deployment publish, and where to?
 *   POST   /api/admin/publish   { files: [{ path, content }] } → { published: [...] }
 *
 * WHAT ADMITS A REQUEST: the same signed token /api/admin/session mints, checked
 * with the same module. Signing in is the gate, and it is the only one — which
 * is also why the token check lives in `server/admin-auth.js` rather than being
 * written out again here.
 *
 * WHAT IT WILL NOT DO:
 *
 *   · Write anywhere but those two paths. The allowlist is in this file, on the
 *     server, and a path outside it is refused before any credential is used.
 *     Otherwise a signed-in admin session would be authority to rewrite any file
 *     in the repository, which is a much larger thing than publishing words.
 *   · Accept a document that is not JSON of the expected shape, or one that is
 *     implausibly large for a page's text.
 *   · Say anything about the GitHub token. `configured` and the target repo are
 *     reported; the credential is never in a response, a log or an error.
 *
 * Environment (server-side only):
 *
 *   GITHUB_TOKEN    fine-grained token, Contents: read and write, on that repo
 *   GITHUB_REPO     owner/name — defaults to nothing, because guessing it would
 *                   be a guess about which repository gets written to
 *   GITHUB_BRANCH   defaults to main
 *
 * Under `npm run dev` there is no repository to commit to, so the dev server
 * hands this handler an implementation that writes the file into `public/`
 * directly. Same handler, same validation, same allowlist; the difference is
 * where the bytes land, and the endpoint reports which of the two it is.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { bearerToken, readConfig, readJsonBody, send, verifyToken } from '../../server/admin-auth.js';

/** A content document is text and image paths; far below this in practice. */
const MAX_BODY_BYTES = 512 * 1024;

/**
 * The files this endpoint may write, and the shape each one must have.
 *
 * A path not in here is refused, so the size of the damage a session can do is
 * the size of this object.
 */
export const PUBLISHABLE = Object.freeze({
  'public/site-content.json': { kind: 'content', key: 'content', type: 'object' },
  'public/app-links.json': { kind: 'links', key: 'links', type: 'array' },
});

/** An expected refusal, with the status and the machine-readable reason. */
export class PublishError extends Error {
  constructor(code, { status = 400, detail = '' } = {}) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Check what was sent, before a credential is involved.
 *
 * Returns `{ ok: true, files }` or `{ ok: false, reason }`. Everything is
 * checked here rather than at the storage layer: the local backend writes files
 * and the GitHub backend commits them, and the rules about what may be published
 * must be the same for both.
 */
export function validate(body) {
  const list = Array.isArray(body?.files) ? body.files : [];
  if (list.length === 0) return { ok: false, reason: 'no_files' };
  if (list.length > Object.keys(PUBLISHABLE).length) return { ok: false, reason: 'too_many_files' };

  const files = [];
  for (const entry of list) {
    const path = String(entry?.path ?? '').trim();
    const rule = PUBLISHABLE[path];
    if (!rule) return { ok: false, reason: 'unknown_file' };

    const content = typeof entry?.content === 'string' ? entry.content : '';
    if (content === '') return { ok: false, reason: 'empty_content' };
    if (Buffer.byteLength(content) > MAX_BODY_BYTES) return { ok: false, reason: 'too_large' };

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      return { ok: false, reason: 'not_json' };
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, reason: 'not_an_object' };
    }
    const payload = parsed[rule.key];
    if (rule.type === 'object' && (payload === null || typeof payload !== 'object' || Array.isArray(payload))) {
      return { ok: false, reason: 'not_a_document' };
    }
    if (rule.type === 'array' && !Array.isArray(payload)) {
      return { ok: false, reason: 'not_a_list' };
    }

    files.push({ path, kind: rule.kind, content });
  }
  return { ok: true, files };
}

// ── Where the bytes go ───────────────────────────────────────────────────

/**
 * What a GitHub status means here, in the terms of the setting to change.
 *
 * GitHub's words for the two refusals that matter most are one line each — "Not
 * Found", and "Resource not accessible by personal access token" — and neither
 * names a checkbox. The *status* is what is informative: 401 is the token, 403
 * is its permissions, 404 is whether it can see the repository at all. The same
 * readings are in tools/check-github-token.mjs, which asks GitHub directly and
 * can be run before a publish rather than after one.
 */
function explain(status, action) {
  if (status === 401) {
    return 'GitHub refused the token itself: it is mistyped, expired or revoked, and a new value reaches this deployment only through a redeploy';
  }
  if (status === 403) {
    return action === 'read'
      ? 'GitHub answers 403 when the token has no permission for this repository at all: set Contents to Read and write, tick the repository under Repository access, and press Save changes — then npm run github:check will confirm it'
      : 'GitHub answers 403 when the token can reach the repository but not write to it: Contents must be Read and write (and a classic token needs the repo scope, even on a public repository), and Save changes must be pressed on the token — a permission edit changes no value, so this needs no redeploy. npm run github:check reports which of them it is';
  }
  if (status === 404) {
    return 'GitHub answers 404 when a token cannot see the repository, so check GITHUB_REPO and that the token was granted this repository';
  }
  return '';
}

/** The status, GitHub's own words if there are any, the subject, and the reading of it. */
function refusal(status, action, { message = '', subject = '' } = {}) {
  const head = [message ? `${status}: ${message}` : String(status), subject].filter(Boolean).join(' ');
  const hint = explain(status, action);
  return hint ? `${head} — ${hint}` : head;
}


/**
 * Commit to the repository through GitHub's Contents API.
 *
 * One file per commit, which is what the admin screen publishes: the tab you
 * pressed Publish on. The current blob's `sha` is read first so an update is an
 * update rather than a conflict — and a 404 there is normal, because the first
 * publish is what creates `public/site-content.json` in a fresh checkout.
 *
 * Environment is read lazily rather than at import, so tests can configure a
 * deployment after the module is loaded, and so the default export does not
 * depend on when Vercel happens to have injected the variables.
 */
export function githubStorage({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const token = () => String(env.GITHUB_TOKEN ?? '').trim();
  const repo = () => String(env.GITHUB_REPO ?? '').trim();
  const branch = () => String(env.GITHUB_BRANCH ?? '').trim() || 'main';

  const api = (path) => `https://api.github.com/repos/${repo()}/contents/${path}`;
  const headers = () => ({
    authorization: `Bearer ${token()}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    // GitHub rejects a request with no user agent; this one says who is writing.
    'user-agent': 'clearview-admin-publish',
  });

  return {
    mode: 'github',
    configured: () => token() !== '' && /^[\w.-]+\/[\w.-]+$/.test(repo()),
    missingEnv: () => [
      ...(token() === '' ? ['GITHUB_TOKEN'] : []),
      ...(/^[\w.-]+\/[\w.-]+$/.test(repo()) ? [] : ['GITHUB_REPO']),
    ],
    // Empty when there is no repository to name: a target of " @ main" reads as a
    // destination when there is none, and the screen prints this verbatim.
    target: () => (/^[\w.-]+\/[\w.-]+$/.test(repo()) ? `${repo()} @ ${branch()}` : ''),

    async commit({ path, content, message }) {
      const where = `${api(path)}?ref=${encodeURIComponent(branch())}`;
      const current = await fetchImpl(where, { headers: headers() });

      let sha;
      if (current.status === 200) {
        sha = (await current.json())?.sha;
        if (typeof sha !== 'string' || sha === '') {
          throw new PublishError('github_unreadable', { status: 502, detail: 'no sha for the existing file' });
        }
      } else if (current.status !== 404) {
        // A 404 here is normal — the first publish is what creates the file — so
        // anything else is a refusal, and the refusal names the token.
        throw new PublishError('github_failed', {
          status: 502,
          detail: refusal(current.status, 'read', { subject: `reading ${path}` }),
        });
      }

      const response = await fetchImpl(api(path), {
        method: 'PUT',
        headers: { ...headers(), 'content-type': 'application/json' },
        body: JSON.stringify({
          message,
          content: Buffer.from(content, 'utf8').toString('base64'),
          branch: branch(),
          ...(sha ? { sha } : {}),
        }),
      });

      if (!response.ok) {
        // GitHub's own words first, then the reading of the status, which is the
        // part that names what to change. Nothing from the request is echoed: the
        // token is in a header, never in this. A file being written is never a
        // 404 here — not when it exists, and not when it is new.
        let message = '';
        try {
          const body = await response.json();
          if (typeof body?.message === 'string') message = body.message;
        } catch {
          /* a body that is not JSON leaves the status as the whole story */
        }
        throw new PublishError('github_failed', {
          status: 502,
          detail: refusal(response.status, 'write', { message }),
        });
      }

      const body = await response.json();
      return { sha: body?.commit?.sha ?? null, url: body?.commit?.html_url ?? null };
    },
  };
}

/**
 * Write the file into the project — what `npm run dev` uses.
 *
 * There is no repository to commit to from a local server, and committing to the
 * live branch from a development machine would deploy half-finished edits. So
 * locally, publishing is a file write: the same file, in the same place, which
 * is what the admin would otherwise have exported and moved by hand. It is not a
 * deploy, and the endpoint says `directory` rather than `github` so the screen
 * can too.
 */
export function directoryStorage({ root = resolve(import.meta.dirname, '../..') } = {}) {
  return {
    mode: 'directory',
    configured: () => true,
    missingEnv: () => [],
    target: () => root,

    async commit({ path, content }) {
      if (!Object.hasOwn(PUBLISHABLE, path)) {
        throw new PublishError('unknown_file', { status: 400 });
      }
      const file = join(root, path);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
      return { sha: null, url: null };
    },
  };
}

// ── The endpoint ─────────────────────────────────────────────────────────

const MESSAGES = {
  'public/site-content.json': 'Publish site content from the admin screen',
  'public/app-links.json': 'Publish app links from the admin screen',
};

/**
 * The handler, with its storage injected.
 *
 * Vercel calls the default export, which commits to GitHub. The dev server
 * builds one with `directoryStorage()` instead, so there is one implementation
 * of the authorisation and validation rather than a local shortcut that could
 * disagree with the deployed one.
 */
export function makePublishHandler({ storage = githubStorage(), now = () => Date.now() } = {}) {
  return async function handler(req, res) {
    const method = String(req.method ?? 'GET').toUpperCase();

    if (method === 'GET') {
      // What the screen needs to say where a publish would go, and whether it
      // can go anywhere at all. No credential, and no fragment of one.
      send(res, 200, {
        configured: storage.configured(),
        mode: storage.mode,
        target: storage.target(),
        missing: storage.missingEnv?.() ?? [],
        files: Object.keys(PUBLISHABLE),
      });
      return;
    }

    if (method !== 'POST') {
      res.setHeader('allow', 'GET, POST');
      send(res, 405, { error: 'method_not_allowed' });
      return;
    }

    const config = readConfig();
    if (!config.configured) {
      send(res, 503, { error: 'not_configured', missing: config.missing, unusable: config.unusable });
      return;
    }

    const claims = verifyToken(bearerToken(req), config.secret, now());
    if (!claims) {
      // No detail beyond this. Which half of the credential was wrong is not
      // something an unauthenticated caller gets to learn.
      send(res, 401, { error: 'invalid_token' });
      return;
    }

    const body = await readJsonBody(req, MAX_BODY_BYTES);
    if (!body) {
      send(res, 400, { error: 'bad_request', reason: 'body' });
      return;
    }

    const checked = validate(body);
    if (!checked.ok) {
      send(res, 400, { error: 'bad_request', reason: checked.reason });
      return;
    }

    if (!storage.configured()) {
      // The deployment can sign an admin in but has nowhere to publish to. Say
      // which variable is missing rather than failing at the commit.
      send(res, 503, {
        error: 'publish_not_configured',
        missing: storage.missingEnv?.() ?? [],
      });
      return;
    }

    try {
      const published = [];
      for (const file of checked.files) {
        const result = await storage.commit({
          path: file.path,
          content: file.content,
          message: MESSAGES[file.path] ?? `Publish ${file.path} from the admin screen`,
        });
        published.push({ path: file.path, kind: file.kind, sha: result.sha, url: result.url });
      }
      send(res, 200, { ok: true, mode: storage.mode, target: storage.target(), published });
    } catch (error) {
      const known = error instanceof PublishError;
      send(res, known ? error.status : 502, {
        error: known ? error.code : 'publish_failed',
        ...(known && error.detail ? { detail: error.detail } : {}),
      });
    }
  };
}

export default makePublishHandler();
