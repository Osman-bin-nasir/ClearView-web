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
 * WHAT SIGNING IN DOES NOT DO: publish the links. The admin edits them here and
 * exports `app-links.json`, which is committed to the site — a push to the
 * repository, which a token cannot grant. The screen says so.
 */

import { useSyncExternalStore } from 'react';

/** Where the function is mounted. Root-relative: Vercel serves /api at the domain root. */
const ENDPOINT = '/api/admin/session';

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
      parts.push(
        `replace ${list(result.unusable)}, which is set but not to a value this endpoint accepts`,
      );
    }
    const advice = parts.length
      ? `In the environment, ${parts.join(', and ')}, then redeploy — or restart the dev server.`
      : 'Add ADMIN_EMAIL, ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET to the environment, then redeploy — or restart the dev server.';
    return `${ADMIN_ERRORS.not_configured} ${advice} Generate the values with node tools/make-admin-hash.mjs.`;
  }
  return ADMIN_ERRORS[result?.error] ?? ADMIN_ERRORS.failed;
}
