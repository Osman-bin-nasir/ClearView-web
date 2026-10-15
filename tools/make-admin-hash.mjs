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
 *   node tools/make-admin-hash.mjs --write you@example.com
 *   npm run admin:set -- you@example.com
 *
 * `--write` skips the pasting: it puts the same three variables into `.env`
 * itself, leaving every other line in the file alone. Pasting three long values
 * by hand is the step where a credential gets truncated, or where the password
 * ends up in `ADMIN_PASSWORD_HASH` instead of the hash — which then looks
 * exactly like a wrong password on the sign-in card.
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
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
/**
 * The shortest password this will accept.
 *
 * Eight, not twelve. Twelve is what the project recommends, but a floor that low
 * cannot be the thing that stops someone: the way around a refused password is to
 * paste the plaintext into `ADMIN_PASSWORD_HASH`, which the endpoint then refuses to
 * compare against anything — a short password is better than a credential that does
 * not work and a value nobody can explain. Below eight it stops.
 */
const MIN_PASSWORD = 8;
/** What the project suggests, and the point below which this says so out loud. */
const RECOMMENDED_PASSWORD = 12;

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

/**
 * The file the variables live in: `.env` beside this script, unless
 * `CLEARVIEW_ENV_FILE` names somewhere else.
 *
 * The override is what lets the tests drive the whole path — generate, write,
 * sign in with what was written — without touching a developer's own `.env`.
 */
function envPath() {
  const override = String(process.env.CLEARVIEW_ENV_FILE ?? '').trim();
  return override !== '' ? override : fileURLToPath(new URL('../.env', import.meta.url));
}

/** `.env` if it is there, so `--check` needs no exporting. */
function envFile() {
  try {
    return Object.fromEntries(
      readFileSync(envPath(), 'utf8')
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

/** The three variables this project owns, in the order a reader wants them. */
const ENV_KEYS = ['ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET'];

/**
 * Put the values into the env file, replacing only the lines they own.
 *
 * Everything else in the file is left exactly as it was — comments, blank
 * lines, and any variable that has nothing to do with the admin screen. The
 * keys that are not there yet are appended under a heading, so a first run on a
 * file that has no ADMIN_ variables reads as something deliberate rather than
 * three stray lines at the bottom.
 */
function writeEnv(values) {
  const path = envPath();
  let text = '';
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    text = ''; // No file yet: this run creates it.
  }

  const pending = new Map(Object.entries(values));
  const lines = text.split('\n').map((line) => {
    const name = /^\s*([A-Z0-9_]+)\s*=/.exec(line)?.[1];
    if (name === undefined || !pending.has(name)) return line;
    const value = pending.get(name);
    pending.delete(name);
    return `${name}=${value}`;
  });

  if (pending.size > 0) {
    while (lines.length > 0 && lines.at(-1).trim() === '') lines.pop();
    if (lines.length > 0) lines.push('');
    else lines.push('# ClearView admin credentials, written by tools/make-admin-hash.mjs.');
    for (const name of ENV_KEYS) {
      if (pending.has(name)) lines.push(`${name}=${pending.get(name)}`);
    }
  }

  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}async function generate(email, { write = false } = {}) {
  try {
    // Name the file in the prompt. A `--write` that lands on a different file than
    // the one you had in mind is the mistake this line exists to prevent, and it is
    // cheaper to read than to reconstruct.
    const where = write ? ` (writing to ${envPath()})` : '';
    const password = await ask(
      `Admin password for ${email}${where} — min ${MIN_PASSWORD}, ${RECOMMENDED_PASSWORD} suggested: `,
      { secret: true },
    );
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

    if (password.length < RECOMMENDED_PASSWORD) {
      console.warn(
        [
          '',
          `${password.length} characters is short for the only password in front of the admin screen.`,
          `${MIN_PASSWORD} is the floor this tool will accept; ${RECOMMENDED_PASSWORD} or more is what the project suggests.`,
          'Why it matters: anyone who gets hold of the hash can test guesses against it offline, with no rate',
          'limit — the lockout only slows down guesses made against the running server. A passphrase of a few',
          'unrelated words is easier to remember than random characters and takes far longer to search.',
        ].join('\n'),
      );
    }

    const salt = randomBytes(SALT_BYTES);
    const values = {
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD_HASH: encode(password, salt),
      ADMIN_SESSION_SECRET: randomBytes(32).toString('base64url'),
    };

    if (write) {
      const path = writeEnv(values);
      console.log(
        [
          '',
          `Wrote ADMIN_EMAIL, ADMIN_PASSWORD_HASH and ADMIN_SESSION_SECRET to ${path}.`,
          '',
          `Sign in as ${email} with the password you just typed.`,
          'Anything else already in that file was left alone.',
          '',
          'Notes:',
          '  · Restart the dev server if it is already running: it reads the file at startup.',
          '  · The hash is salted, so running this again replaces it with a different value for the same password.',
          '  · ADMIN_SESSION_SECRET signs the session tokens; changing it signs every admin out.',
          '  · This is a local credential. Make a separate one for the deployment and set it in Vercel → Settings → Environment Variables.',
          '  · The password was not written to the file, and neither .env nor the hash belongs in git.',
          '',
        ].join('\n'),
      );
      return;
    }

    console.log(
      [
        '',
        'Paste these into .env, and into Vercel → Settings → Environment Variables:',
        '',
        ...ENV_KEYS.map((name) => `${name}=${values[name]}`),
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

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const confirmed = argv.includes('--yes');
const argument = argv.find((value) => !value.startsWith('--'));

/**
 * Refuse a write that nobody is watching.
 *
 * A password arriving on a pipe means a script is driving this tool, and a script
 * driving it at a credential file is exactly how a real `.env` gets replaced by a
 * throwaway one — the write succeeds, the file looks right, and the credential it
 * displaced is gone. `--yes` says the unattended write is the intent.
 */
if (write && !confirmed && !interactive) {
  console.error(
    [
      'Refusing to write from a pipe without --yes.',
      `The file it would replace is ${envPath()}, and the password it just read came from a script rather than a person.`,
      'Pass --yes if replacing that file is what you meant.',
    ].join('\n'),
  );
  process.exit(1);
}

if (argv.includes('--check')) {
  await check();
} else if (!argument || !argument.includes('@')) {
  console.error(
    [
      'Usage:',
      '  node tools/make-admin-hash.mjs you@example.com         make ADMIN_EMAIL, ADMIN_PASSWORD_HASH, ADMIN_SESSION_SECRET and print them',
      '  node tools/make-admin-hash.mjs --write you@example.com put the same three into .env instead of printing them',
      '        (add --yes when the password comes from a pipe rather than a terminal)',
      '  node tools/make-admin-hash.mjs --check                 test a password against ADMIN_PASSWORD_HASH',
    ].join('\n'),
  );
  process.exitCode = 1;
} else {
  await generate(argument.trim().toLowerCase(), { write });
}
