#!/usr/bin/env node
/**
 * Make the admin credentials.
 *
 * The admin screen signs in against values in the deployment's environment, and
 * this is what writes them: the password never leaves this process, and what
 * comes out the other end is a salt and a scrypt hash — which is the whole
 * reason the environment stores a hash and not the password.
 *
 *   node tools/make-admin-hash.mjs you@example.com
 *   npm run admin:hash -- you@example.com
 *
 * It prints three lines. Paste them into `.env` for local work, and into
 * Vercel → Settings → Environment Variables for the live site. Neither belongs
 * in git (`.env` is ignored).
 *
 *   node tools/make-admin-hash.mjs --check
 *
 * `--check` answers the other question: is the hash in `ADMIN_PASSWORD_HASH`
 * actually the password I think it is? It reads that variable — or `.env` — and
 * tests one against it.
 *
 * Both modes read stdin when it is a pipe, so an unattended run can generate a
 * throwaway credential without a flag that would put the password in the shell
 * history:
 *
 *   printf 'a-throwaway-password\na-throwaway-password\n' | node tools/make-admin-hash.mjs dev@example.com
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';

// Must match api/admin/session.js — a hash is only worth anything if both ends
// agree on how to read it.
const N = 16384;
const r = 8;
const p = 1;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;
const ALGORITHM = 'scrypt';
/**
 * `:` rather than `$`, and this is not a style choice: a `$` in a `.env` file is
 * expanded by dotenv, so a `$`-separated hash pasted into `.env` is silently
 * rewritten and stops working. `:`, `+` and `/` mean nothing to dotenv, to a
 * shell, or to a hosting dashboard's variable field, so one string works in all
 * three without quoting.
 */
const SEPARATOR = ':';
/** This is the only thing in front of the admin screen; guessing it must cost something. */
const MIN_PASSWORD = 12;

const MAX_MEM = 128 * N * r * 2;

/** Deliberately slow and memory-hungry — the same parameters the endpoint verifies with. */
function derive(password, salt) {
  return scryptSync(password, salt, KEY_LENGTH, { N, r, p, maxmem: MAX_MEM });
}

function encode(password, salt) {
  return [ALGORITHM, N, r, p, salt.toString('base64'), derive(password, salt).toString('base64')].join(
    SEPARATOR,
  );
}

/** The format `api/admin/session.js` accepts: `scrypt:N:r:p:salt:hash`. */
function decode(text) {
  const parts = String(text ?? '').trim().split(SEPARATOR);
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return null;
  const [, cost, blockSize, parallelisation, salt, digest] = parts;
  const saltBytes = Buffer.from(salt, 'base64');
  const digestBytes = Buffer.from(digest, 'base64');
  if (saltBytes.length === 0 || digestBytes.length === 0) return null;
  return { N: Number(cost), r: Number(blockSize), p: Number(parallelisation), salt: saltBytes, digest: digestBytes };
}

// ── Asking ───────────────────────────────────────────────────────────────

const interactive = process.stdin.isTTY === true;

/** Answers from a pipe, read once. A lost line would look like a typo. */
async function readPipedAnswers() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks)
    .toString('utf8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''));
}

let answers = null;
let rl = null;

/**
 * Read one answer.
 *
 * Through a terminal, a secret answer is hidden: the prompt is printed, then
 * echoing is silenced until the line is in.
 */
async function ask(prompt, { secret = false } = {}) {
  if (!interactive) {
    answers ??= await readPipedAnswers();
    process.stdout.write(`${prompt}\n`);
    return (answers.shift() ?? '').trim();
  }

  rl ??= createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    const write = rl.output.write.bind(rl.output);
    if (secret) {
      write(prompt);
      rl.output.write = () => {};
    }
    rl.question(secret ? '' : prompt, (answer) => {
      if (secret) {
        rl.output.write = write;
        write('\n');
      }
      resolve(answer);
    });
  });
}

const finishAsking = () => rl?.close();

// ── The two modes ────────────────────────────────────────────────────────

/** `.env` if it is there, so `--check` needs no exporting. */
function envFile() {
  try {
    return Object.fromEntries(
      readFileSync(new URL('../.env', import.meta.url), 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'))
        .map((line) => {
          const at = line.indexOf('=');
          if (at === -1) return [line, ''];
          return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
        }),
    );
  } catch {
    return {};
  }
}

async function generate(email) {
  try {
    const password = await ask(`Admin password for ${email} (min ${MIN_PASSWORD} characters): `, {
      secret: true,
    });
    if (password.length < MIN_PASSWORD) {
      console.error(
        `\nThat is ${password.length} characters. Use at least ${MIN_PASSWORD} — this password is the only thing standing in front of the admin screen.`,
      );
      process.exitCode = 1;
      return;
    }
    const again = await ask('Type it again: ', { secret: true });
    if (again !== password) {
      console.error('\nThe two passwords do not match.');
      process.exitCode = 1;
      return;
    }

    const salt = randomBytes(SALT_BYTES);
    console.log(
      [
        '',
        'Paste these into .env, and into Vercel → Settings → Environment Variables:',
        '',
        `ADMIN_EMAIL=${email}`,
        `ADMIN_PASSWORD_HASH=${encode(password, salt)}`,
        `ADMIN_SESSION_SECRET=${randomBytes(32).toString('base64url')}`,
        '',
        'Notes:',
        '  · The hash uses ":" as its separator on purpose: "$" and "#" mean something to .env files.',
        '  · The hash is salted, so running this again gives a different value for the same password.',
        '  · ADMIN_SESSION_SECRET signs the session tokens; changing it signs every admin out.',
        '  · Redeploy (or restart the dev server) after changing any of them.',
        '  · Neither .env nor these values belong in git.',
        '',
      ].join('\n'),
    );
  } finally {
    finishAsking();
  }
}

async function check() {
  const fromFile = envFile();
  const hash = (process.env.ADMIN_PASSWORD_HASH ?? fromFile.ADMIN_PASSWORD_HASH ?? '').trim();
  if (hash === '') {
    console.error('No ADMIN_PASSWORD_HASH in the environment or in .env — nothing to check.');
    process.exitCode = 1;
    return;
  }

  const decoded = decode(hash);
  if (!decoded) {
    console.error('ADMIN_PASSWORD_HASH is not in the form this project writes:');
    console.error('  scrypt:16384:8:1:<salt>:<hash>');
    if (hash.includes('$')) {
      // The old form. Worth its own sentence: the value looks right, and the
      // reason it stops working is in the .env file rather than in the value.
      console.error(
        'It contains "$", which is the separator this project used to write. A "$" in a .env file is expanded when the file is read — `scrypt$16384$8$1$…` arrives as `scrypt$16384$8$1==` — so a hash in that form cannot survive the file it is pasted into.',
      );
    }
    console.error('Run this without --check to make a new one.');
    process.exitCode = 1;
    return;
  }

  try {
    const password = await ask('Password to test: ', { secret: true });
    const attempted = scryptSync(password, decoded.salt, decoded.digest.length, {
      N: decoded.N,
      r: decoded.r,
      p: decoded.p,
      maxmem: MAX_MEM,
    });
    const matches =
      attempted.length === decoded.digest.length && timingSafeEqual(attempted, decoded.digest);
    console.log(
      matches
        ? '\nMatches ADMIN_PASSWORD_HASH — the endpoint will accept this password.'
        : '\nDoes NOT match ADMIN_PASSWORD_HASH. Run this without --check to make a new one.',
    );
    if (!matches) process.exitCode = 1;
  } finally {
    finishAsking();
  }
}

const [argument] = process.argv.slice(2);

if (argument === '--check') {
  await check();
} else if (!argument || !argument.includes('@')) {
  console.error(
    [
      'Usage:',
      '  node tools/make-admin-hash.mjs you@example.com   make ADMIN_EMAIL, ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET',
      '  node tools/make-admin-hash.mjs --check           test a password against ADMIN_PASSWORD_HASH',
    ].join('\n'),
  );
  process.exitCode = 1;
} else {
  await generate(argument.trim().toLowerCase());
}
