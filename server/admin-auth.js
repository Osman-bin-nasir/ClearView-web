/**
 * What both admin endpoints share: the environment they read, the token that
 * admits a request, and the plumbing to answer one.
 *
 * This file is deliberately NOT under `api/`. Every `.js` file in that directory
 * becomes a route on Vercel, and a module that exists to be imported by two
 * functions should not also be reachable at a URL of its own. Vercel traces the
 * imports and bundles this into each function that needs it.
 *
 * It lives outside `api/` rather than being duplicated into both endpoints
 * because the token check is the whole of the authorisation for publishing: two
 * copies of `verifyToken` is two places for a signature bug to hide, and the
 * second one would be the one nobody re-read.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Hash format written by tools/make-admin-hash.mjs: `scrypt:N:r:p:salt:hash`. */
const HASH_ALGORITHM = 'scrypt';
/**
 * Why `:` and not the more usual `$`.
 *
 * A `$` in a `.env` file is a variable reference: Vite reads these files through
 * dotenv and expands `$16384` (and `$8`, `$1`, …), so a `$`-separated hash
 * pasted into `.env` arrives here silently rewritten — `scrypt$16384$8$1$…`
 * became `scrypt$16384$8$1=…` in testing, which no longer parses and would look
 * like a wrong password. Escaping it (`\$`) fixes `.env` and breaks the value
 * in a dashboard field that does no expansion. A separator that is not special
 * to any of them is the only version that works everywhere, unquoted.
 */
const HASH_SEPARATOR = ':';
/** How long a signed-in session lasts. Shorter than a work day, longer than a sitting. */
export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** A secret shorter than this is not worth signing with. */
export const MIN_SECRET_LENGTH = 16;

// ── The environment ──────────────────────────────────────────────────────

/**
 * Read `scrypt:N:r:p:salt:hash`.
 *
 * Returns null for anything else — including a plaintext password someone
 * pasted into `ADMIN_PASSWORD_HASH`. Refusing to guess is the point: a
 * misconfigured deployment must fail closed and say the setting is wrong, not
 * quietly compare a password to a password in a way nobody can see.
 */
export function parseHash(value) {
  const text = String(value ?? '').trim();
  const parts = text.split(HASH_SEPARATOR);
  if (parts.length !== 6 || parts[0] !== HASH_ALGORITHM) return null;

  const [, cost, blockSize, parallelisation, salt, digest] = parts;
  const N = Number(cost);
  const r = Number(blockSize);
  const p = Number(parallelisation);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  // A power of two is what scrypt requires; 2^14 is the floor this project writes.
  if (N < 1024 || (N & (N - 1)) !== 0 || r < 1 || p < 1) return null;

  try {
    const saltBytes = Buffer.from(salt, 'base64');
    const digestBytes = Buffer.from(digest, 'base64');
    if (saltBytes.length < 8 || digestBytes.length < 16) return null;
    return { N, r, p, salt: saltBytes, digest: digestBytes };
  } catch {
    return null;
  }
}

/**
 * The configuration, and what is wrong with it.
 *
 * `missing` and `unusable` carry ENV VAR NAMES only — never a value, and never
 * a fragment of one. They are returned to the browser so the admin screen can
 * say which setting to fix, which is the difference between a deployment nobody
 * can sign in to and a deployment whose owner knows what to do about it.
 */
export function readConfig() {
  const email = String(process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
  const secret = String(process.env.ADMIN_SESSION_SECRET ?? '').trim();
  const missing = [];
  const unusable = [];

  if (email === '') missing.push('ADMIN_EMAIL');
  else if (!email.includes('@')) unusable.push('ADMIN_EMAIL');

  if (secret === '') missing.push('ADMIN_SESSION_SECRET');
  else if (secret.length < MIN_SECRET_LENGTH) unusable.push('ADMIN_SESSION_SECRET');

  const hash = parseHash(process.env.ADMIN_PASSWORD_HASH);
  if (String(process.env.ADMIN_PASSWORD_HASH ?? '').trim() === '') {
    missing.push('ADMIN_PASSWORD_HASH');
  } else if (!hash) {
    unusable.push('ADMIN_PASSWORD_HASH');
  }

  return {
    email,
    secret,
    hash,
    missing,
    unusable,
    configured: missing.length === 0 && unusable.length === 0,
  };
}

// ── The session token ────────────────────────────────────────────────────

/**
 * Compare two secrets without leaking where they differ.
 *
 * Both sides are hashed first so the comparison is between equal-length buffers
 * whatever the inputs were — `timingSafeEqual` throws on a length mismatch, and
 * its error would itself be the leak.
 */
export function sameSecret(a, b) {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

const base64url = (input) => Buffer.from(input).toString('base64url');

/**
 * Sign a session token: `<payload>.<hmac>`.
 *
 * A signed claim rather than a random id in a database, because this deployment
 * has no database. The payload is readable — it holds an email and an expiry,
 * nothing else — and the signature is what makes it unforgeable. Anyone can
 * read it; only the holder of `ADMIN_SESSION_SECRET` can mint one.
 */
export function signToken(email, secret, now) {
  const payload = base64url(JSON.stringify({ sub: email, iat: now, exp: now + TOKEN_TTL_MS }));
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt: now + TOKEN_TTL_MS };
}

/** The claims in a token, or null if it is forged, malformed or expired. */
export function verifyToken(token, secret, now) {
  if (typeof token !== 'string') return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const payload = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  if (!sameSecret(signature, expected)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof claims?.exp !== 'number' || claims.exp <= now) return null;
  if (typeof claims?.sub !== 'string' || claims.sub === '') return null;
  return claims;
}

/** The token out of `Authorization: Bearer …`. */
export function bearerToken(req) {
  const header = req.headers?.authorization ?? req.headers?.Authorization;
  if (typeof header !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

// ── Request plumbing ─────────────────────────────────────────────────────

export const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
};

/**
 * The JSON body, `{}` for an empty one, or undefined when it is not JSON or is
 * larger than `maxBytes`.
 *
 * `req.body` is used when the runtime already parsed it (Vercel does for
 * `application/json`); otherwise the stream is read, which is what the dev
 * server's middleware hands over. The limit is a parameter because a login body
 * is two short strings while a publish body is a whole content document.
 */
export async function readJsonBody(req, maxBytes) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') return req.body;

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBytes) return undefined;
      chunks.push(chunk);
    }
  } catch {
    return undefined;
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (text === '') return {};
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
