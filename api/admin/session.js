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
 * WHAT THIS STILL IS NOT: authority over the published links. Signing in gates
 * this screen; the links themselves are published by committing
 * `public/app-links.json`, which is a push to the repository and cannot be
 * granted by a token. The screen says so rather than implying otherwise.
 */

import { createHash, createHmac, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

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
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
/** A login body is two short strings; anything larger is not one. */
const MAX_BODY_BYTES = 4 * 1024;
/** Failures per address before it is locked out, and for how long. */
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
/** A secret shorter than this is not worth signing with. */
const MIN_SECRET_LENGTH = 16;

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

// ── Environment ──────────────────────────────────────────────────────────

/**
 * Read the configuration, and say what is wrong with it.
 *
 * `missing` and `unusable` carry ENV VAR NAMES only — never a value, and never
 * a hint about the password. They exist so the admin screen can tell the person
 * deploying exactly which setting to add, instead of a flat "denied".
 */
function readConfig() {
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

/**
 * Read `scrypt:N:r:p:salt:hash`.
 *
 * Returns null for anything else — including a plaintext password someone
 * pasted into `ADMIN_PASSWORD_HASH`. Refusing to guess is the point: a
 * misconfigured deployment must fail closed and say the setting is wrong, not
 * quietly compare a password to a password in a way nobody can see.
 */
function parseHash(value) {
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

// ── Comparisons and tokens ───────────────────────────────────────────────

/**
 * Compare two secrets without leaking where they differ.
 *
 * Both sides are hashed first so the comparison is between equal-length
 * buffers whatever the inputs were — `timingSafeEqual` throws on a length
 * mismatch, and its error would itself be the leak.
 */
function sameSecret(a, b) {
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
function signToken(email, secret, now) {
  const payload = base64url(
    JSON.stringify({ sub: email, iat: now, exp: now + TOKEN_TTL_MS }),
  );
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return { token: `${payload}.${signature}`, expiresAt: now + TOKEN_TTL_MS };
}

/** The claims in a token, or null if it is forged, malformed or expired. */
function verifyToken(token, secret, now) {
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
function bearerToken(req) {
  const header = req.headers?.authorization ?? req.headers?.Authorization;
  if (typeof header !== 'string') return '';
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1] : '';
}

// ── Failed attempts ──────────────────────────────────────────────────────

/**
 * Failures per address, held in the instance that saw them.
 *
 * Best effort, and honest about it: Vercel runs several instances and recycles
 * them, so this slows a password guesser down rather than stopping one, and it
 * resets when the function cold-starts. A real limit needs shared storage, and
 * a real defence is the length of the password — which is why the generator
 * insists on one.
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

// ── Request plumbing ─────────────────────────────────────────────────────

const send = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.setHeader('content-length', Buffer.byteLength(body));
  res.end(body);
};

/**
 * The JSON body, `{}` for an empty one, or undefined when it is not JSON or is
 * too large to be a login.
 *
 * `req.body` is used when the runtime already parsed it (Vercel does for
 * `application/json`); otherwise the stream is read, which is what the dev
 * server's middleware hands over.
 */
async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') return req.body;

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) return undefined;
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

// ── The endpoint ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const method = String(req.method ?? 'GET').toUpperCase();
  const now = Date.now();
  const config = readConfig();

  if (method === 'GET') {
    // A stored token is checked against the live secret on every load: rotate
    // ADMIN_SESSION_SECRET and every session minted before it stops working.
    const claims = config.configured
      ? verifyToken(bearerToken(req), config.secret, now)
      : null;
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

  const body = await readJsonBody(req);
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
