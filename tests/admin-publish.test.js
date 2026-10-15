/**
 * The publish endpoint, tested where the decision is made.
 *
 * Publishing is the one thing in this project that writes to the repository, so
 * the cases that matter are the refusals: no token, a forged token, a document
 * that is the wrong shape, and above all a path that is not one of the two
 * files. A session that could write anywhere in the repository would be a far
 * larger authority than "this person edits the website", and the allowlist is
 * what keeps those two different things.
 *
 * The GitHub side is driven through an injected `fetch`, so the exact request is
 * inspectable without a network, a token or a commit. The local side is driven
 * into a temporary directory, so it cannot touch this checkout's `public/`.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, scryptSync } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  PUBLISHABLE,
  directoryStorage,
  githubStorage,
  makePublishHandler,
  validate,
} from '../api/admin/publish.js';
import { signToken } from '../server/admin-auth.js';

const ENV_KEYS = [
  'ADMIN_EMAIL',
  'ADMIN_PASSWORD_HASH',
  'ADMIN_SESSION_SECRET',
  'GITHUB_TOKEN',
  'GITHUB_REPO',
  'GITHUB_BRANCH',
];
const EMAIL = 'admin@example.com';
const SECRET = 'test-signing-secret-that-is-long-enough';
const TOKEN = 'github_pat_test_value_that_must_never_be_echoed';

/** The same encoding tools/make-admin-hash.mjs writes; `readConfig` must accept it. */
const hashOf = (password) => {
  const salt = Buffer.alloc(16, 5);
  return [
    'scrypt',
    16384,
    8,
    1,
    salt.toString('base64'),
    scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 128 * 16384 * 8 * 2 }).toString('base64'),
  ].join(':');
};

const CONTENT_FILE = 'public/site-content.json';
const LINKS_FILE = 'public/app-links.json';

const contentDocument = (title = 'A heading') =>
  `${JSON.stringify({ version: 1, updatedAt: '2026-10-15T00:00:00.000Z', content: { hero: { title } } }, null, 2)}\n`;
const linksDocument = (url = 'https://play.google.com/store/apps/details?id=com.example') =>
  `${JSON.stringify({ version: 1, updatedAt: '2026-10-15T00:00:00.000Z', links: [{ id: 'android', url }] }, null, 2)}\n`;

/** A deployment that can sign someone in, and optionally one that can publish. */
function configure({ github = true } = {}) {
  process.env.ADMIN_EMAIL = EMAIL;
  process.env.ADMIN_PASSWORD_HASH = hashOf('correct horse battery staple');
  process.env.ADMIN_SESSION_SECRET = SECRET;
  if (github) {
    process.env.GITHUB_TOKEN = TOKEN;
    process.env.GITHUB_REPO = 'muddassir-2025/ClearView-web';
    process.env.GITHUB_BRANCH = 'main';
  } else {
    for (const key of ['GITHUB_TOKEN', 'GITHUB_REPO', 'GITHUB_BRANCH']) delete process.env[key];
  }
}

const signedIn = (secret = SECRET, sub = EMAIL, now = Date.now()) => signToken(sub, secret, now).token;

function mockRequest({ method = 'GET', body, raw, headers = {}, parsedBody = false } = {}) {
  const text = raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body);
  const chunks = text === undefined ? [] : [Buffer.from(text)];
  return {
    method,
    url: '/api/admin/publish',
    headers,
    ...(parsedBody && body !== undefined ? { body } : {}),
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

/** A `fetch` that hands back queued replies and records what it was asked. */
function fakeFetch(replies) {
  const queue = [...replies];
  const fetchImpl = async (url, options = {}) => {
    const reply = queue.shift() ?? { status: 500, json: {} };
    fetchImpl.calls.push({
      url: String(url),
      method: String(options.method ?? 'GET').toUpperCase(),
      headers: options.headers ?? {},
      body: options.body === undefined ? undefined : JSON.parse(options.body),
    });
    return {
      status: reply.status,
      ok: reply.status >= 200 && reply.status < 300,
      json: async () => reply.json ?? {},
    };
  };
  fetchImpl.calls = [];
  return fetchImpl;
}

const publishRequest = (files, { token = signedIn() } = {}) =>
  mockRequest({
    method: 'POST',
    body: { files },
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

// ── What the deployment tells the screen ─────────────────────────────────

test('an unconfigured deployment says which variables are missing, and never the token', async () => {
  configure({ github: false });
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl: fakeFetch([]) }) });
  const res = mockResponse();
  await handler(mockRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.json.configured, false);
  assert.equal(res.json.mode, 'github');
  assert.deepEqual(res.json.missing, ['GITHUB_TOKEN', 'GITHUB_REPO']);
  assert.ok(!res.text.includes(TOKEN), 'a credential must never be in a response');
});

test('a configured deployment names the repository and branch a publish would write to', async () => {
  configure();
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl: fakeFetch([]) }) });
  const res = mockResponse();
  await handler(mockRequest(), res);

  assert.equal(res.json.configured, true);
  assert.equal(res.json.target, 'muddassir-2025/ClearView-web @ main');
  assert.deepEqual(res.json.files, Object.keys(PUBLISHABLE));
  assert.ok(!res.text.includes(TOKEN));
});

// ── Who may publish ──────────────────────────────────────────────────────

test('a publish with no token is refused, and touches no storage', async () => {
  configure();
  const fetchImpl = fakeFetch([]);
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
  const res = mockResponse();
  await handler(publishRequest([{ path: CONTENT_FILE, content: contentDocument() }], { token: '' }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.json.error, 'invalid_token');
  assert.equal(fetchImpl.calls.length, 0, 'an unauthorised request must not reach GitHub');
});

test('a token signed with another secret is refused', async () => {
  configure();
  const fetchImpl = fakeFetch([]);
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
  const res = mockResponse();
  await handler(
    publishRequest([{ path: CONTENT_FILE, content: contentDocument() }], {
      token: signedIn('a-secret-that-is-not-the-deploymentâ€™s-33'),
    }),
    res,
  );

  assert.equal(res.statusCode, 401);
  assert.equal(fetchImpl.calls.length, 0);
});

test('an expired token is refused', async () => {
  configure();
  const fetchImpl = fakeFetch([]);
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
  const res = mockResponse();
  await handler(
    publishRequest([{ path: CONTENT_FILE, content: contentDocument() }], {
      token: signedIn(SECRET, EMAIL, Date.now() - 13 * 60 * 60 * 1000),
    }),
    res,
  );

  assert.equal(res.statusCode, 401);
  assert.equal(fetchImpl.calls.length, 0);
});

test('signing in is not enough when the deployment has no credentials', async () => {
  for (const key of ['ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'ADMIN_SESSION_SECRET']) delete process.env[key];
  const fetchImpl = fakeFetch([]);
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
  const res = mockResponse();
  await handler(publishRequest([{ path: CONTENT_FILE, content: contentDocument() }]), res);

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json.missing, ['ADMIN_EMAIL', 'ADMIN_SESSION_SECRET', 'ADMIN_PASSWORD_HASH']);
  assert.equal(fetchImpl.calls.length, 0);
});

test('a signed-in admin on a deployment with no GitHub token is told which variable to add', async () => {
  configure({ github: false });
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl: fakeFetch([]) }) });
  const res = mockResponse();
  await handler(publishRequest([{ path: CONTENT_FILE, content: contentDocument() }]), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.json.error, 'publish_not_configured');
  assert.deepEqual(res.json.missing, ['GITHUB_TOKEN', 'GITHUB_REPO']);
});

test('another method is refused and told what is allowed', async () => {
  configure();
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl: fakeFetch([]) }) });
  const res = mockResponse();
  await handler(mockRequest({ method: 'DELETE', headers: { authorization: `Bearer ${signedIn()}` } }), res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'GET, POST');
});

// ── What may be published, and where ─────────────────────────────────────

test('a path outside the two files is refused before any credential is used', async () => {
  configure();
  for (const path of [
    'public/other.json',
    'src/main.jsx',
    'package.json',
    '../outside.json',
    '/etc/passwd',
    'public/site-content.json/../app-links.json',
    '',
  ]) {
    const fetchImpl = fakeFetch([]);
    const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
    const res = mockResponse();
    await handler(publishRequest([{ path, content: contentDocument() }]), res);

    assert.equal(res.statusCode, 400, `${path} must be refused`);
    assert.equal(res.json.reason, 'unknown_file');
    assert.equal(fetchImpl.calls.length, 0, `${path} must not reach GitHub`);
  }
});

test('a document that is not JSON, or not the expected shape, is refused', async () => {
  configure();
  const cases = [
    { files: [{ path: CONTENT_FILE, content: 'not json at all' }], reason: 'not_json' },
    { files: [{ path: CONTENT_FILE, content: '[1,2,3]' }], reason: 'not_an_object' },
    { files: [{ path: CONTENT_FILE, content: '{"version":1}' }], reason: 'not_a_document' },
    { files: [{ path: CONTENT_FILE, content: '{"content":[]}' }], reason: 'not_a_document' },
    { files: [{ path: LINKS_FILE, content: '{"links":{}}' }], reason: 'not_a_list' },
    { files: [{ path: LINKS_FILE, content: '{"links":[]}' }], reason: 'ok' },
    { files: [{ path: CONTENT_FILE, content: '' }], reason: 'empty_content' },
    { files: [], reason: 'no_files' },
    { files: [{ path: CONTENT_FILE, content: contentDocument() }, { path: CONTENT_FILE, content: contentDocument() }, { path: LINKS_FILE, content: linksDocument() }], reason: 'too_many_files' },
  ];

  for (const { files, reason } of cases) {
    assert.equal(validate({ files }).reason ?? 'ok', reason, JSON.stringify(files).slice(0, 60));
  }
});

// ── The commit itself ────────────────────────────────────────────────────

test('a publish commits the file, updating the blob it replaces', async () => {
  configure();
  const fetchImpl = fakeFetch([
    { status: 200, json: { sha: 'blob-sha-of-the-old-file' } },
    { status: 200, json: { commit: { sha: 'commit-sha', html_url: 'https://github.com/x/y/commit/123' } } },
  ]);
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
  const document = contentDocument('Publish works');
  const res = mockResponse();
  await handler(publishRequest([{ path: CONTENT_FILE, content: document }]), res);

  assert.equal(res.statusCode, 200, res.text);
  assert.equal(res.json.ok, true);
  assert.equal(res.json.mode, 'github');
  assert.equal(res.json.published[0].sha, 'commit-sha');
  assert.equal(res.json.published[0].kind, 'content');

  const [read, write] = fetchImpl.calls;
  assert.equal(read.method, 'GET');
  assert.equal(read.url, `https://api.github.com/repos/muddassir-2025/ClearView-web/contents/${CONTENT_FILE}?ref=main`);
  assert.equal(read.headers.authorization, `Bearer ${TOKEN}`);

  assert.equal(write.method, 'PUT');
  assert.equal(write.url, `https://api.github.com/repos/muddassir-2025/ClearView-web/contents/${CONTENT_FILE}`);
  assert.equal(write.body.branch, 'main');
  assert.equal(write.body.sha, 'blob-sha-of-the-old-file', 'the replaced blob gives the API its sha');
  assert.match(write.body.message, /site content/i);
  // The file on GitHub has to be the file the admin approved, byte for byte.
  assert.equal(Buffer.from(write.body.content, 'base64').toString('utf8'), document);
});

test('the first publish of a file that does not exist yet creates it', async () => {
  configure();
  const fetchImpl = fakeFetch([
    { status: 404, json: { message: 'Not Found' } },
    { status: 201, json: { commit: { sha: 'first-commit', html_url: 'https://github.com/x/y/commit/first' } } },
  ]);
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
  const res = mockResponse();
  await handler(publishRequest([{ path: LINKS_FILE, content: linksDocument() }]), res);

  assert.equal(res.statusCode, 200, res.text);
  assert.equal('sha' in fetchImpl.calls[1].body, false, 'a new file is created without a blob sha');
  assert.match(fetchImpl.calls[1].body.message, /app links/i);
});

test('a GitHub refusal comes back with GitHub’s own words and no token', async () => {
  configure();
  const fetchImpl = fakeFetch([
    { status: 200, json: { sha: 'blob-sha' } },
    { status: 403, json: { message: 'Resource not accessible by personal access token' } },
  ]);
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
  const res = mockResponse();
  await handler(publishRequest([{ path: CONTENT_FILE, content: contentDocument() }]), res);

  assert.equal(res.statusCode, 502);
  assert.equal(res.json.error, 'github_failed');
  assert.match(res.json.detail, /Resource not accessible/);
  assert.ok(!res.text.includes(TOKEN), 'the token must not travel back to the browser');
});

test('a token that cannot read the repository is reported as such', async () => {
  configure();
  const fetchImpl = fakeFetch([{ status: 401, json: { message: 'Bad credentials' } }]);
  const handler = makePublishHandler({ storage: githubStorage({ fetchImpl }) });
  const res = mockResponse();
  await handler(publishRequest([{ path: CONTENT_FILE, content: contentDocument() }]), res);

  assert.equal(res.statusCode, 502);
  assert.match(res.json.detail, /401/);
  assert.equal(fetchImpl.calls.length, 1, 'nothing is written when the file cannot be read');
});

// ── The local backend ────────────────────────────────────────────────────

test('under npm run dev a publish writes the file, and the reply says so', async (t) => {
  configure({ github: false });
  const root = await mkdtemp(join(tmpdir(), 'clearview-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const handler = makePublishHandler({ storage: directoryStorage({ root }) });
  const document = contentDocument('Written locally');
  const res = mockResponse();
  await handler(publishRequest([{ path: CONTENT_FILE, content: document }]), res);

  assert.equal(res.statusCode, 200, res.text);
  assert.equal(res.json.mode, 'directory', 'the screen is told this was not a deploy');
  assert.equal(await readFile(join(root, CONTENT_FILE), 'utf8'), document);
});

test('the local backend refuses a path outside the allowlist even if asked directly', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'clearview-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    () => directoryStorage({ root }).commit({ path: '../../etc/hosts', content: '{}' }),
    /unknown_file/,
  );
});
