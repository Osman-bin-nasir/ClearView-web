/**
 * The admin's sign-in — the browser half.
 *
 * The email and the password are POSTed to this deployment's own function
 * (`api/admin/session.js`) and checked there against `ADMIN_EMAIL` and
 * `ADMIN_PASSWORD_HASH` from the environment. This file holds no secret, cannot
 * check a password, and never sees a hash: all it gets back is a signed token,
 * which it keeps in `sessionStorage` so that closing the tab signs the admin
 * out. The token is a claim, not a permission — the server verifies the
 * signature on every request, so editing it changes nothing.
 *
 * That is the difference from what this used to be. The old screen created its
 * own password in the browser and compared it there, which meant the "admin"
 * was whoever could open devtools on their own machine.
 *
 * WHAT THE TOKEN IS FOR: admitting a publish. The same signature is checked by
 * `api/admin/publish.js` before it commits a document to the repository, so
 * signing in is the one gate in front of both screens. What the token cannot do
 * is decide what may be published: the file allowlist and the shape checks live
 * on the server, and a session that asked to write anywhere else would be
 * refused there.
 */

import { useSyncExternalStore } from 'react';

/** Where the functions are mounted. Root-relative: Vercel serves /api at the domain root. */
const ENDPOINT = '/api/admin/session';
const PUBLISH_ENDPOINT = '/api/admin/publish';

/** The two documents the site reads, and the tab each one belongs to. */
export const PUBLISH_PATHS = Object.freeze({
  content: 'public/site-content.json',
  links: 'public/app-links.json',
});

/**
 * The signed session, on this device.
 *
 * `sessionStorage` rather than `localStorage`: a session that outlives the tab
 * is a session nobody chose to keep open. The server's `exp` is the real limit;
 * the copy here only decides what the screen shows before the first reply.
 */
const SESSION_KEY = 'clearview.admin.session.v1';

const readSession = () => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(SESSION_KEY) ?? 'null');
    if (!parsed || typeof parsed.token !== 'string' || parsed.token === '') return null;
    if (typeof parsed.expiresAt === 'number' && parsed.expiresAt > 0 && parsed.expiresAt <= Date.now()) {
      // Expired. The server would refuse it anyway; clearing it here means the
      // screen does not sit on a dead session until the first request.
      clearSession();
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

function writeSession(session) {
  try {
    window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* private mode can refuse it; the session then lasts until the next reload */
  }
}

function clearSession() {
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* nothing to remove */
  }
}

// ── The store ────────────────────────────────────────────────────────────

/**
 * `phase` is what the screen keys on:
 *   loading     — asking the server; say so rather than showing a form that may not work
 *   ready       — the server answered
 *   unreachable — no reply: this deployment has no function, or it is down
 */
let state = {
  phase: 'loading',
  configured: false,
  missing: [],
  unusable: [],
  signedIn: false,
  email: '',
};

const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const getAdminState = () => state;

/** React binding for the sign-in state. */
export function useAdmin() {
  return useSyncExternalStore(subscribe, getAdminState, getAdminState);
}

// ── Talking to the endpoint ──────────────────────────────────────────────

/**
 * Ask the server who we are.
 *
 * Called when the admin screen mounts. It re-validates a stored token against
 * the live signing secret, so a token minted before `ADMIN_SESSION_SECRET` was
 * rotated stops working the moment the server says so — the browser cannot
 * decide that, and must not assume it.
 */
export async function refresh() {
  const session = readSession();
  const headers = session ? { authorization: `Bearer ${session.token}` } : {};
  try {
    const response = await fetch(ENDPOINT, { headers, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    if (body.signedIn !== true) clearSession();
    state = {
      phase: 'ready',
      configured: body.configured === true,
      missing: Array.isArray(body.missing) ? body.missing : [],
      unusable: Array.isArray(body.unusable) ? body.unusable : [],
      signedIn: body.signedIn === true,
      email: body.signedIn === true ? String(body.email ?? '') : '',
    };
  } catch {
    // A 404 means the function is not deployed, which is the common way to get
    // here — the site was built and uploaded as plain static files.
    state = { ...state, phase: 'unreachable', configured: false, signedIn: false, email: '' };
  }
  emit();
  return state;
}

/**
 * Sign in. Returns `{ ok: true }` or `{ ok: false, error, missing, unusable }`,
 * with `error` a key into ADMIN_ERRORS.
 */
export async function signIn({ email, password }) {
  let response;
  try {
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: String(email ?? ''), password: String(password ?? '') }),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, error: 'unreachable' };
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    // A host that answers with an HTML error page is not an auth service; the
    // generic failure below is the honest report of that.
  }

  if (!response.ok) {
    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : 'failed',
      missing: Array.isArray(body.missing) ? body.missing : [],
      unusable: Array.isArray(body.unusable) ? body.unusable : [],
    };
  }
  if (typeof body.token !== 'string' || body.token === '') return { ok: false, error: 'failed' };

  writeSession({ token: body.token, email: body.email ?? '', expiresAt: Number(body.expiresAt) || 0 });
  state = {
    ...state,
    phase: 'ready',
    configured: true,
    missing: [],
    unusable: [],
    signedIn: true,
    email: String(body.email ?? ''),
  };
  emit();
  return { ok: true };
}

/**
 * Sign out.
 *
 * Nothing to tell the server: the token is a signed claim with an expiry, not a
 * row to delete, and dropping it here is what ends the session. (The token is
 * still valid until it expires — anyone who copied it out of this browser keeps
 * their own copy, which is true of every stateless token.)
 */
export function signOut() {
  clearSession();
  state = { ...state, signedIn: false, email: '' };
  emit();
}

// ── Publishing ───────────────────────────────────────────────────────────

/**
 * Can this deployment publish, and where to?
 *
 * Read when the editor mounts so the screen can say `publishing is not set up`
 * before someone has typed a paragraph and pressed the button, rather than
 * afterwards. `null` means the question could not be asked at all — no endpoint
 * (a static upload with no functions) or no network.
 */
export async function fetchPublishState() {
  try {
    const response = await fetch(PUBLISH_ENDPOINT, { cache: 'no-store' });
    if (!response.ok) return null;
    const body = await response.json();
    return {
      configured: body.configured === true,
      // 'github' on the deployment, 'directory' under `npm run dev`.
      mode: typeof body.mode === 'string' ? body.mode : '',
      target: typeof body.target === 'string' ? body.target : '',
      missing: Array.isArray(body.missing) ? body.missing : [],
    };
  } catch {
    return null;
  }
}

/**
 * Publish one document.
 *
 * The token goes in the header — the body is the document and nothing else, and
 * a credential in a body is a credential in a log. Returns `{ ok: true, mode,
 * target, published }` or `{ ok: false, error, … }` with `error` a key into
 * PUBLISH_ERRORS.
 */
export async function publish({ kind, content }) {
  const path = PUBLISH_PATHS[kind];
  if (!path) return { ok: false, error: 'failed' };

  const session = readSession();
  if (!session) return { ok: false, error: 'signed_out' };

  let response;
  try {
    response = await fetch(PUBLISH_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.token}`,
      },
      body: JSON.stringify({ files: [{ path, content }] }),
      cache: 'no-store',
    });
  } catch {
    return { ok: false, error: 'unreachable' };
  }

  let body = {};
  try {
    body = await response.json();
  } catch {
    /* a host that answers with HTML is not this endpoint */
  }

  if (response.status === 401) {
    // The session was refused, so it is not a session any more: drop it, and the
    // screen goes back to the sign-in card rather than offering a button that
    // cannot work.
    signOut();
    return { ok: false, error: 'invalid_token' };
  }

  if (!response.ok) {
    return {
      ok: false,
      error: typeof body.error === 'string' ? body.error : 'failed',
      reason: typeof body.reason === 'string' ? body.reason : '',
      missing: Array.isArray(body.missing) ? body.missing : [],
      detail: typeof body.detail === 'string' ? body.detail : '',
    };
  }

  return {
    ok: true,
    mode: typeof body.mode === 'string' ? body.mode : '',
    target: typeof body.target === 'string' ? body.target : '',
    published: Array.isArray(body.published) ? body.published : [],
  };
}

// ── What the screen says ─────────────────────────────────────────────────

/** One sentence per refusal, for the form. */
export const ADMIN_ERRORS = {
  unreachable:
    'The admin endpoint did not answer. This deployment needs its server function (api/admin/session.js) — on Vercel that means deploying this repository, not just dist/.',
  not_configured:
    'This deployment has no admin credentials yet, so there is nothing to sign in with.',
  invalid: 'That email and password did not match the admin credentials for this deployment.',
  rate_limited: 'Too many failed attempts from this connection. Wait a few minutes, then try again.',
  bad_request: 'Enter both the email address and the password.',
  failed: 'The sign-in did not complete. Try again.',
  method_not_allowed: 'The sign-in did not complete. Try again.',
};

/**
 * The sentence to show for a failed sign-in.
 *
 * `not_configured` is the one refusal that is about the deployment rather than
 * the person typing, so it names the environment variables that are missing or
 * unreadable — a name, never a value.
 */
export function adminErrorMessage(result) {
  if (result?.error === 'not_configured') {
    const list = (names) =>
      names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
    const parts = [];
    if (result.missing?.length) parts.push(`set ${list(result.missing)}`);
    if (result.unusable?.length) {
      // A plaintext password in ADMIN_PASSWORD_HASH is the mistake people make,
      // and the one refusal where "not a value this endpoint accepts" would send
      // them looking for a typo instead of the thing that is actually wrong.
      const wrong = list(result.unusable);
      const passwordPasted = result.unusable.includes('ADMIN_PASSWORD_HASH');
      parts.push(
        passwordPasted
          ? `replace ${wrong} — it has to be a hash, not the password (a password there is refused, not compared)`
          : `replace ${wrong}, which is set but not to a value this endpoint accepts`,
      );
    }
    const advice = parts.length
      ? `In the environment, ${parts.join(', and ')}, then redeploy — or restart the dev server.`
      : 'Add ADMIN_EMAIL, ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET to the environment, then redeploy — or restart the dev server.';
    return `${ADMIN_ERRORS.not_configured} ${advice} Make them with npm run admin:set -- you@example.com, or node tools/make-admin-hash.mjs.`;
  }
  return ADMIN_ERRORS[result?.error] ?? ADMIN_ERRORS.failed;
}

/** One sentence per refusal a publish can come back with. */
export const PUBLISH_ERRORS = {
  unreachable:
    'The publish endpoint did not answer. The site may be a static upload with no functions behind it.',
  signed_out: 'That session has ended. Sign in again.',
  invalid_token: 'That session expired while you were editing. Sign in again — your edits are still here.',
  not_configured:
    'This deployment has no admin credentials, so there is nothing to publish with.',
  publish_not_configured:
    'This deployment cannot publish yet: it has nowhere to put the file.',
  bad_request:
    'The site refused that document: it was not the JSON of the shape it expects. Reload this page and try again.',
  github_failed: 'GitHub refused the commit.',
  publish_failed: 'The publish did not complete. Try again.',
  failed: 'The publish did not complete. Try again.',
};

/**
 * The sentence to show when a publish fails.
 *
 * The two "not configured" cases name the variables to set, because that is the
 * difference between a feature that is broken and a feature that was never given
 * a credential; `github_failed` carries GitHub's own words, which name the
 * permission or the conflict and are worth more than anything invented here.
 */
export function publishErrorMessage(result) {
  const list = (names) =>
    names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];

  if (result?.error === 'not_configured' || result?.error === 'publish_not_configured') {
    const names = result.missing ?? [];
    const advice = names.length
      ? `Add ${list(names)} to the environment, then redeploy — or restart the dev server.`
      : 'Add GITHUB_TOKEN and GITHUB_REPO to the environment, then redeploy.';
    return `${PUBLISH_ERRORS[result.error]} ${advice} The token needs Contents: read and write on this repository.`;
  }
  if (result?.error === 'github_failed' && result.detail) {
    return `${PUBLISH_ERRORS.github_failed} ${result.detail}`;
  }
  return PUBLISH_ERRORS[result?.error] ?? PUBLISH_ERRORS.failed;
}
