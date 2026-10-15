/**
 * The admin sign-in, done where it can actually be a secret.
 *
 * WHY THIS EXISTS: the admin screen used to create its own password in the
 * browser and check it there. That was a lock, never authentication — the
 * "account" was a salt and a hash in `localStorage`, so anyone who could open
 * devtools could sign in, and the check proved nothing about who they were.
 *
 * This is a Vercel function instead, which is the one place in this project that
 * can keep a secret. The admin's email and password hash live in the
 * deployment's environment (never in the bundle — anything the browser can read
 * is public), the comparison happens here, and the browser only ever receives a
 * short-lived signed token.
 *
 *   GET    /api/admin/session   who am I, and is this deployment configured?
 *   POST   /api/admin/session   { email, password } → { token, email, expiresAt }
 *
 * Environment (all server-side; none of them are VITE_-prefixed, so none of them
 * reach the built JavaScript):
 *
 *   ADMIN_EMAIL            the one address that may sign in
 *   ADMIN_PASSWORD_HASH    scrypt:N:r:p:salt:hash — from tools/make-admin-hash.mjs
 *   ADMIN_SESSION_SECRET   signs the tokens; changing it signs everyone out
 *
 * The token this mints is also what admits a publish: `api/admin/publish.js`
 * verifies the same signature with the same module (`server/admin-auth.js`)
 * before it commits anything. Signing in is therefore the one gate in front of
 * both screens, and there is one implementation of the check rather than two.
 */

import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  bearerToken,
  readConfig,
  readJsonBody,
  sameSecret,
  send,
  signToken,
  verifyToken,
} from '../../server/admin-auth.js';

const scryptAsync = promisify(scrypt);

/** A login body is two short strings; anything larger is not one. */
const MAX_BODY_BYTES = 4 * 1024;
/** Failures per address before it is locked out, and for how long. */
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * The parameters a password is checked against when the email is wrong or the
 * configured hash cannot be read.
 *
 * Without this, a request for an unknown address returns as soon as the string
 * comparison fails while a real one pays for a key derivation — a difference an
 * attacker can time to learn which emails exist. Every rejected attempt costs
 * the same work as an accepted one.
 */
const DUMMY_HASH = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  salt: Buffer.alloc(16, 7),
  digest: Buffer.alloc(32),
});

// ── Failed attempts ──────────────────────────────────────────────────────

/**
 * Failures per address, held in the instance that saw them.
 *
 * Best effort, and honest about it: Vercel runs several instances and recycles
 * them, so this slows a password guesser down rather than stopping one, and it
 * resets when the function cold-starts. A real limit needs shared storage, and
 * a real defence is the length of the password — which is why the generator
 * says so when one is short.
 */
const failures = new Map();

function clientAddress(req) {
  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded !== '') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress ?? 'unknown';
}

function lockoutFor(address, now) {
  const record = failures.get(address);
  if (!record) return 0;
  if (record.until > now) return record.until - now;
  if (record.until !== 0) failures.delete(address); // the lockout has passed
  return 0;
}

function recordFailure(address, now) {
  const record = failures.get(address) ?? { count: 0, until: 0 };
  record.count += 1;
  if (record.count >= MAX_FAILURES) {
    record.until = now + LOCKOUT_MS;
    record.count = 0;
  }
  failures.set(address, record);
}

// ── The endpoint ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const method = String(req.method ?? 'GET').toUpperCase();
  const now = Date.now();
  const config = readConfig();

  if (method === 'GET') {
    // A stored token is checked against the live secret on every load: rotate
    // ADMIN_SESSION_SECRET and every session minted before it stops working.
    const claims = config.configured ? verifyToken(bearerToken(req), config.secret, now) : null;
    send(res, 200, {
      configured: config.configured,
      missing: config.missing,
      unusable: config.unusable,
      signedIn: claims !== null,
      email: claims?.sub ?? null,
      expiresAt: claims?.exp ?? null,
    });
    return;
  }

  if (method !== 'POST') {
    res.setHeader('allow', 'GET, POST');
    send(res, 405, { error: 'method_not_allowed' });
    return;
  }

  if (!config.configured) {
    // 503, not 401: nothing is wrong with the password the person typed —
    // the deployment has not been given credentials yet.
    send(res, 503, {
      error: 'not_configured',
      missing: config.missing,
      unusable: config.unusable,
    });
    return;
  }

  const address = clientAddress(req);
  const wait = lockoutFor(address, now);
  if (wait > 0) {
    res.setHeader('retry-after', String(Math.ceil(wait / 1000)));
    send(res, 429, { error: 'rate_limited', retryAfterSeconds: Math.ceil(wait / 1000) });
    return;
  }

  const body = await readJsonBody(req, MAX_BODY_BYTES);
  if (!body) {
    send(res, 400, { error: 'bad_request' });
    return;
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (email === '' || password === '') {
    send(res, 400, { error: 'bad_request' });
    return;
  }

  // The email is checked first, but a wrong one still pays for a key derivation
  // (see DUMMY_HASH), so the two refusals are indistinguishable in time.
  const sameEmail = sameSecret(email, config.email);
  const hash = sameEmail && config.hash ? config.hash : DUMMY_HASH;
  const derived = await scryptAsync(password, hash.salt, hash.digest.length, {
    N: hash.N,
    r: hash.r,
    p: hash.p,
    maxmem: 128 * hash.N * hash.r * 2,
  });
  const samePassword = sameEmail && timingSafeEqual(derived, hash.digest);

  if (!samePassword) {
    recordFailure(address, now);
    // One message for both halves. "No such admin" and "wrong password" are the
    // same refusal, because telling them apart is how an address is confirmed.
    send(res, 401, { error: 'invalid' });
    return;
  }

  failures.delete(address);
  const { token, expiresAt } = signToken(config.email, config.secret, now);
  send(res, 200, { token, email: config.email, expiresAt });
}
