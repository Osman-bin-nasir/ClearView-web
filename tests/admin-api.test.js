/**
 * The admin endpoint, tested where the decision is made.
 *
 * These call the real handler (`api/admin/session.js`) with the shapes of
 * request and response Vercel hands it, so what is tested is what is deployed —
 * no server needs to be started, and there is no second implementation of the
 * sign-in to drift out of step.
 *
 * The cases that matter are the refusals: a wrong password, a forged or expired
 * token, an address nobody configured, a plaintext value pasted into a variable
 * that must hold a hash, and a deployment with no credentials at all. Each of
 * those has to fail closed and say why.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, scryptSync } from 'node:crypto';
import handler from '../api/admin/session.js';

// ── A request, a response, and the environment in between ────────────────

const ENV_KEYS = ['ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'];
const EMAIL = 'admin@example.com';
const PASSWORD = 'correct horse battery staple';
const SECRET = 'test-signing-secret-that-is-long-enough';
const SALT = Buffer.alloc(16, 3);
const PARAMS = { N: 16384, r: 8, p: 1 };

/** The same encoding tools/make-admin-hash.mjs writes. */
const hashOf = (password, salt = SALT) =>
  [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    scryptSync(password, salt, 32, { ...PARAMS, maxmem: 128 * PARAMS.N * PARAMS.r * 2 }).toString('base64'),
  ].join(':');

/** A request the handler can read a body from, the way a runtime hands it one. */
function mockRequest({ method = 'GET', body, raw, headers = {}, parsedBody = false } = {}) {
  const text =
    raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
  const chunks = text === undefined ? [] : [Buffer.from(text)];
  return {
    method,
    url: '/api/admin/session',
    headers,
    ...(parsedBody && body !== undefined ? { body } : {}),
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function mockResponse() {
  return {
    statusCode: 0,
    headers: {},
    text: '',
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
    },
    end(text) {
      this.text = text ?? '';
      this.writableEnded = true;
      return this;
    },
    get json() {
      return JSON.parse(this.text === '' ? 'null' : this.text);
    },
  };
}

let nextAddress = 0;
/** A fresh client address per call: failures are counted per address, so sharing one would leak between tests. */
const from = () => ({ 'x-forwarded-for': `203.0.113.${(nextAddress += 1)}` });

const call = async (options = {}) => {
  const res = mockResponse();
  await handler(mockRequest(options), res);
  return res;
};

/** Configure the deployment the way a deploy would, or not at all. */
function configure({ email = EMAIL, hash = hashOf(PASSWORD), secret = SECRET } = {}) {
  process.env.ADMIN_EMAIL = email;
  process.env.ADMIN_PASSWORD_HASH = hash;
  process.env.ADMIN_SESSION_SECRET = secret;
}

const unconfigure = () => ENV_KEYS.forEach((key) => delete process.env[key]);

const sign = (payload, secret = SECRET) => {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${createHmac('sha256', secret).update(encoded).digest('base64url')}`;
};

// ── A deployment with no credentials ─────────────────────────────────────

test('an unconfigured deployment says so, and names the variables', async () => {
  unconfigure();
  const status = await call();
  assert.equal(status.statusCode, 200);
  assert.equal(status.json.configured, false);
  assert.equal(status.json.signedIn, false);
  assert.deepEqual([...status.json.missing].sort(), [...ENV_KEYS].sort());
  assert.equal(status.headers['cache-control'], 'no-store');

  const login = await call({ method: 'POST', body: { email: EMAIL, password: PASSWORD }, headers: from() });
  assert.equal(login.statusCode, 503, 'no credentials is the deployment’s problem, not a wrong password');
  assert.equal(login.json.error, 'not_configured');
  assert.equal(login.text.includes(PASSWORD), false);
});

test('a configured deployment reports ready and signed out', async () => {
  configure();
  const res = await call();
  assert.equal(res.json.configured, true);
  assert.deepEqual(res.json.missing, []);
  assert.deepEqual(res.json.unusable, []);
  assert.equal(res.json.signedIn, false);
  assert.equal(res.json.email, null);
});

// ── Signing in ───────────────────────────────────────────────────────────

test('the right email and password sign an admin in', async () => {
  configure();
  const before = Date.now();
  const res = await call({
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
    headers: from(),
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.email, EMAIL);
  assert.equal(typeof res.json.token, 'string');
  assert.equal(res.json.token.includes(PASSWORD), false, 'a token must not carry the password');
  assert.ok(res.json.expiresAt > before, 'a session has to expire in the future');

  // The address is matched case-insensitively, like every other login.
  const shouty = await call({
    method: 'POST',
    body: { email: EMAIL.toUpperCase(), password: PASSWORD },
    headers: from(),
  });
  assert.equal(shouty.statusCode, 200);
});

test('a login body the runtime already parsed works too', async () => {
  configure();
  const res = await call({
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
    parsedBody: true,
    headers: from(),
  });
  assert.equal(res.statusCode, 200, 'Vercel parses JSON bodies before the handler sees them');
});

test('the token signs the next request in', async () => {
  configure();
  const login = await call({
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
    headers: from(),
  });

  const res = await call({ headers: { ...from(), authorization: `Bearer ${login.json.token}` } });
  assert.equal(res.json.signedIn, true);
  assert.equal(res.json.email, EMAIL);
  assert.equal(res.json.expiresAt, login.json.expiresAt);
});

// ── Refusals ─────────────────────────────────────────────────────────────

test('a wrong password and an unknown address are refused identically', async () => {
  configure();
  const wrongPassword = await call({
    method: 'POST',
    body: { email: EMAIL, password: 'not the password' },
    headers: from(),
  });
  const unknownAddress = await call({
    method: 'POST',
    body: { email: 'someone@else.test', password: PASSWORD },
    headers: from(),
  });

  assert.equal(wrongPassword.statusCode, 401);
  assert.equal(unknownAddress.statusCode, 401);
  // Identical bodies on purpose: telling them apart is how an attacker learns
  // which addresses are administrators.
  assert.deepEqual(wrongPassword.json, unknownAddress.json);
  assert.deepEqual(wrongPassword.json, { error: 'invalid' });
});

test('a tampered token is refused', async () => {
  configure();
  const login = await call({
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
    headers: from(),
  });
  const [payload, signature] = login.json.token.split('.');

  // Claim a longer life without the signature to back it up.
  const extended = `${Buffer.from(
    JSON.stringify({ sub: EMAIL, iat: Date.now(), exp: Date.now() + 10 * 365 * 24 * 3600 * 1000 }),
  ).toString('base64url')}.${signature}`;
  for (const token of [`${payload}.${signature.slice(0, -1)}x`, extended, `${payload}.`, '.x', 'nonsense', '']) {
    const res = await call({ headers: { ...from(), authorization: `Bearer ${token}` } });
    assert.equal(res.json.signedIn, false, `${token || '(empty)'} must not sign anyone in`);
  }
});

test('a token signed with another secret is refused — which is what rotating the secret does', async () => {
  configure({ secret: 'a-different-signing-secret-value' });
  const foreign = sign({ sub: EMAIL, iat: Date.now(), exp: Date.now() + 3_600_000 });
  const res = await call({ headers: { ...from(), authorization: `Bearer ${foreign}` } });
  assert.equal(res.json.signedIn, false);
});

test('an expired token is refused', async () => {
  configure();
  const expired = sign({ sub: EMAIL, iat: Date.now() - 7_200_000, exp: Date.now() - 3_600_000 });
  const res = await call({ headers: { ...from(), authorization: `Bearer ${expired}` } });
  assert.equal(res.json.signedIn, false);
});

test('a signed token without an expiry is refused', async () => {
  configure();
  const boundless = sign({ sub: EMAIL, iat: Date.now() });
  const res = await call({ headers: { ...from(), authorization: `Bearer ${boundless}` } });
  assert.equal(res.json.signedIn, false, 'a token with no exp would never stop working');
});

test('a body that is not JSON, or is too large, is refused', async () => {
  configure();
  const notJson = await call({ method: 'POST', raw: 'email=admin@example.com', headers: from() });
  assert.equal(notJson.statusCode, 400);
  assert.deepEqual(notJson.json, { error: 'bad_request' });

  const huge = await call({
    method: 'POST',
    raw: `{"email":"${EMAIL}","password":"${'x'.repeat(9000)}"}`,
    headers: from(),
  });
  assert.equal(huge.statusCode, 400);
});

test('a body missing either half is refused, and says which', async () => {
  configure();
  const noPassword = await call({ method: 'POST', body: { email: EMAIL }, headers: from() });
  assert.equal(noPassword.statusCode, 400);
  assert.deepEqual(noPassword.json, { error: 'bad_request' });

  const blank = await call({ method: 'POST', body: { email: EMAIL, password: '' }, headers: from() });
  assert.equal(blank.statusCode, 400);
});

test('another method is refused and told what is allowed', async () => {
  configure();
  const res = await call({ method: 'PUT', headers: from() });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
  assert.deepEqual(res.json, { error: 'method_not_allowed' });
});

// ── Misconfiguration fails closed ────────────────────────────────────────

test('a password pasted into ADMIN_PASSWORD_HASH is not treated as a hash', async () => {
  configure({ hash: PASSWORD });
  const status = await call();
  assert.equal(status.json.configured, false, 'a plaintext value must not pass as a configured hash');
  assert.deepEqual(status.json.unusable, ['ADMIN_PASSWORD_HASH']);

  const login = await call({
    method: 'POST',
    body: { email: EMAIL, password: PASSWORD },
    headers: from(),
  });
  assert.equal(login.statusCode, 503, 'the password that is sitting in the variable must not sign in');
});

test('a hash that is not the right shape is refused', async () => {
  const forms = [
    'scrypt:16384:8:1:onlyfivefields',
    'scrypt:16384:8:1::',
    'scrypt:0:8:1:c2FsdHNhbHRzYWx0:aGFzaGhhc2hoYXNoaGFzaA==',
    'scrypt:1000:8:1:c2FsdHNhbHRzYWx0:aGFzaGhhc2hoYXNoaGFzaA==',
    'scrypt:16384:8:1:c2FsdA==:aGFzaA==',
    'bcrypt:16384:8:1:c2FsdHNhbHRzYWx0:aGFzaGhhc2hoYXNoaGFzaA==',
    // The separator this project used to write. A `$` in a `.env` file is a
    // variable reference and gets expanded, so a hash in this form cannot
    // survive the file it is pasted into — it must be refused, loudly, rather
    // than accepted here and broken there.
    'scrypt$16384$8$1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA==',
  ];
  for (const hash of forms) {
    configure({ hash });
    const status = await call();
    assert.equal(status.json.configured, false, `“${hash}” must not be accepted`);
    assert.deepEqual(status.json.unusable, ['ADMIN_PASSWORD_HASH']);
  }
});

test('a signing secret too short to sign with is refused', async () => {
  configure({ secret: 'short' });
  const status = await call();
  assert.equal(status.json.configured, false);
  assert.deepEqual(status.json.unusable, ['ADMIN_SESSION_SECRET']);
});

// ── Guessing ─────────────────────────────────────────────────────────────

test('repeated failures lock that address out, and only that address', async () => {
  configure();
  const attacker = from();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await call({
      method: 'POST',
      body: { email: EMAIL, password: `guess ${attempt}` },
      headers: attacker,
    });
    assert.equal(res.statusCode, 401);
  }

  const locked = await call({ method: 'POST', body: { email: EMAIL, password: PASSWORD }, headers: attacker });
  assert.equal(locked.statusCode, 429, 'the lockout outlasts the guesses');
  assert.equal(locked.json.error, 'rate_limited');
  assert.ok(Number(locked.headers['retry-after']) > 0);

  const elsewhere = await call({ method: 'POST', body: { email: EMAIL, password: PASSWORD }, headers: from() });
  assert.equal(elsewhere.statusCode, 200, 'another address is not punished for this one’s guesses');
});

test('a successful sign-in clears that address’s failures', async () => {
  configure();
  const address = from();
  await call({ method: 'POST', body: { email: EMAIL, password: 'wrong' }, headers: address });
  await call({ method: 'POST', body: { email: EMAIL, password: PASSWORD }, headers: address });

  // Four more failures would normally not lock, so a fifth success proves the
  // earlier one was forgotten rather than merely survived.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await call({ method: 'POST', body: { email: EMAIL, password: 'wrong' }, headers: address });
  }
  const res = await call({ method: 'POST', body: { email: EMAIL, password: PASSWORD }, headers: address });
  assert.equal(res.statusCode, 200);
});
