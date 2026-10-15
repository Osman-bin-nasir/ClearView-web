/**
 * Setting up a local sign-in, from one command to a working password.
 *
 * `npm run admin:set -- you@example.com` is the only supported way to put admin
 * credentials into `.env`, and it is the step where the two mistakes that look
 * like a bug actually happen: the password ends up in `ADMIN_PASSWORD_HASH`
 * (the endpoint refuses it, and the screen says "did not match"), or the file
 * is written in a way that loses the variables already in it.
 *
 * So this drives the real tool over the real handler: generate a credential
 * into a throwaway file, then sign in with what it wrote. The env file is
 * redirected with `CLEARVIEW_ENV_FILE` — a developer's own `.env` is never
 * touched by the tests.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/admin/session.js';

const TOOL = fileURLToPath(new URL('../tools/make-admin-hash.mjs', import.meta.url));

const ENV_KEYS = ['ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'];
const EMAIL = 'set-up@example.com';
const PASSWORD = 'a-password-long-enough-to-keep';
const WRONG = 'not-the-password-that-was-set';

/** A fresh throwaway file per test, seeded the way a real `.env` often looks. */
function scratchEnv(t, seed) {
  const path = join(tmpdir(), `clearview-admin-${process.pid}-${Math.random().toString(36).slice(2)}.env`);
  if (seed !== undefined) writeFileSync(path, seed);
  t.after(() => {
    try {
      rmSync(path);
    } catch {
      // Nothing to remove: the file was never created.
    }
  });
  return path;
}

/**
 * `npm run admin:set -- you@example.com`, with the password piped in.
 *
 * `--yes` because the password arrives on a pipe: the tool refuses an unattended
 * write to a credential file otherwise, on the grounds that a script driving it is
 * how a real `.env` gets replaced by a throwaway one.
 */
const setCredentials = (path, email = EMAIL) =>
  spawnSync(process.execPath, [TOOL, '--write', '--yes', email], {
    input: `${PASSWORD}\n${PASSWORD}\n`,
    env: { ...process.env, CLEARVIEW_ENV_FILE: path },
    encoding: 'utf8',
  });

/** The file read the way dotenv reads it, comments and blanks dropped. */
function parseEnv(text) {
  return Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        return at === -1 ? [line, ''] : [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      }),
  );
}

function mockRequest({ method = 'GET', body, headers = {} } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  return {
    method,
    url: '/api/admin/session',
    headers,
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function mockResponse() {
  return {
    statusCode: 0,
    text: '',
    setHeader() {},
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

const call = async (options = {}) => {
  const res = mockResponse();
  await handler(
    mockRequest({ ...options, headers: { 'x-forwarded-for': `198.51.100.${(nextAddress += 1)}` } }),
    res,
  );
  return res;
};

test('admin:set writes a credential that the endpoint signs in with', async (t) => {
  const path = scratchEnv(t);
  const run = setCredentials(path);
  assert.equal(run.status, 0, `the tool must succeed:\n${run.stdout}\n${run.stderr}`);

  const text = readFileSync(path, 'utf8');
  const written = parseEnv(text);

  assert.deepEqual(Object.keys(written).sort(), [...ENV_KEYS].sort());
  assert.equal(written.ADMIN_EMAIL, EMAIL);

  // The whole point of the variable: what is on disk must not be the password.
  assert.ok(
    !text.includes(PASSWORD),
    'the password must never reach the file — ADMIN_PASSWORD_HASH holds a hash',
  );
  assert.match(
    written.ADMIN_PASSWORD_HASH,
    /^scrypt:\d+:\d+:\d+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/,
    'the hash must be in the form the endpoint parses',
  );
  assert.notEqual(written.ADMIN_SESSION_SECRET, '');

  // Then the half that actually answers the question: does it sign in?
  for (const key of ENV_KEYS) process.env[key] = written[key];
  t.after(() => ENV_KEYS.forEach((key) => delete process.env[key]));

  const status = await call();
  assert.equal(status.json.configured, true);
  assert.deepEqual(status.json.missing, []);
  assert.deepEqual(status.json.unusable, []);

  const good = await call({ method: 'POST', body: { email: EMAIL, password: PASSWORD } });
  assert.equal(good.statusCode, 200, 'the password that was typed must be accepted');
  assert.equal(typeof good.json.token, 'string');

  const bad = await call({ method: 'POST', body: { email: EMAIL, password: WRONG } });
  assert.equal(bad.statusCode, 401);
});

test('admin:set leaves the rest of the file alone', async (t) => {
  const path = scratchEnv(
    t,
    [
      '# a comment that has nothing to do with the admin screen',
      'SOME_OTHER_KEY=keep-me',
      '',
      'ADMIN_EMAIL=stale@example.com',
      'ADMIN_PASSWORD_HASH=' + 'x'.repeat(40),
      '',
    ].join('\n'),
  );

  const run = setCredentials(path);
  assert.equal(run.status, 0, run.stderr);

  const text = readFileSync(path, 'utf8');
  assert.ok(text.includes('# a comment that has nothing to do with the admin screen'));
  assert.ok(text.includes('SOME_OTHER_KEY=keep-me'), 'an unrelated variable must survive');
  assert.equal(
    text.split('\n').filter((line) => line.startsWith('ADMIN_EMAIL=')).length,
    1,
    'an existing value is replaced in place, not appended',
  );

  const written = parseEnv(text);
  assert.equal(written.ADMIN_EMAIL, EMAIL, 'the stale address must be gone');
  assert.deepEqual(Object.keys(written).sort(), ['ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET', 'SOME_OTHER_KEY'].sort());
});

test('admin:set refuses an unattended write of a credential file without --yes', async (t) => {
  const path = scratchEnv(t);
  const run = spawnSync(process.execPath, [TOOL, '--write', EMAIL], {
    input: `${PASSWORD}\n${PASSWORD}\n`,
    env: { ...process.env, CLEARVIEW_ENV_FILE: path },
    encoding: 'utf8',
  });

  assert.notEqual(run.status, 0, 'a password from a pipe must not silently replace a credential file');
  assert.match(run.stderr, /--yes/, 'the refusal must name the way through');
  assert.ok(!run.stdout.includes('Wrote ADMIN_EMAIL'), 'nothing may be written');
  assert.throws(() => readFileSync(path, 'utf8'), 'the file must be untouched');
});

test('admin:set accepts an eight-character password, and warns that it is short', async (t) => {
  const path = scratchEnv(t);
  const short = 'eight888';
  const run = spawnSync(process.execPath, [TOOL, '--write', '--yes', EMAIL], {
    input: `${short}\n${short}\n`,
    env: { ...process.env, CLEARVIEW_ENV_FILE: path },
    encoding: 'utf8',
  });

  assert.equal(run.status, 0, run.stderr);
  assert.match(
    run.stdout + run.stderr,
    /short for the only password|floor this tool will accept/,
    'eight characters is allowed but must be said to be short',
  );

  const written = parseEnv(readFileSync(path, 'utf8'));
  for (const key of ENV_KEYS) process.env[key] = written[key];
  t.after(() => ENV_KEYS.forEach((key) => delete process.env[key]));

  const good = await call({ method: 'POST', body: { email: EMAIL, password: short } });
  assert.equal(good.statusCode, 200, 'the endpoint has no length rule — what was set up must sign in');
});

test('admin:set refuses to write a password that is too short', async (t) => {
  const path = scratchEnv(t);
  const run = spawnSync(process.execPath, [TOOL, '--write', '--yes', EMAIL], {
    input: 'seven77\nseven77\n',
    env: { ...process.env, CLEARVIEW_ENV_FILE: path },
    encoding: 'utf8',
  });

  assert.notEqual(run.status, 0, 'below the floor must be refused');
  assert.ok(!run.stdout.includes('Wrote ADMIN_EMAIL'), 'nothing may be written');
  assert.throws(() => readFileSync(path, 'utf8'), 'no file for a refused credential');
});
