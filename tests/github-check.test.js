/**
 * The token checker, tested on the answers it has to tell apart.
 *
 * This is the tool that exists because GitHub's own refusals are not
 * distinguishable by their message: a wrong `GITHUB_REPO`, a token whose
 * Repository access was left read-only, and a token whose Contents permission is
 * read-only can all come back as 403 or 404 with one line of prose. The verdicts
 * below are those three cases, plus the one that matters most — that a token
 * which *can* write is not reported as broken.
 *
 * Driven through an injected `fetch`, so no token and no network are involved.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkToken, tokenKind, verdict } from '../tools/check-github-token.mjs';

const TOKEN = 'github_pat_test_value_that_must_never_be_printed';
const REPO = 'muddassir-2025/ClearView-web';

/** A `fetch` that hands back queued replies and records what it was asked. */
function fakeFetch(replies) {
  const queue = [...replies];
  const fetchImpl = async (url, options = {}) => {
    const reply = queue.shift() ?? { status: 500, json: {} };
    fetchImpl.calls.push({ url: String(url), method: String(options.method ?? 'GET').toUpperCase(), headers: options.headers ?? {} });
    return {
      status: reply.status,
      ok: reply.status >= 200 && reply.status < 300,
      json: async () => reply.json ?? {},
    };
  };
  fetchImpl.calls = [];
  return fetchImpl;
}

const repositoryReply = (permissions = { push: true, pull: true }) => ({
  status: 200,
  json: { full_name: REPO, private: false, permissions },
});

// ── The kind of credential, from the prefix ──────────────────────────────

test('the token kind is named and the value never is', () => {
  assert.equal(tokenKind('github_pat_11ABCDEFG'), 'fine-grained');
  assert.equal(tokenKind('ghp_something'), 'classic');
  assert.equal(tokenKind('  github_pat_spaced  '), 'fine-grained', 'a pasted value may carry whitespace');
  assert.equal(tokenKind('ghs_installation'), 'github app (installation)');
  assert.equal(tokenKind(''), 'missing');
  assert.equal(tokenKind(undefined), 'missing');
  assert.equal(tokenKind('not-a-github-token'), 'unrecognised');
  for (const value of ['github_pat_11ABCDEFG', 'ghp_something']) {
    assert.notEqual(tokenKind(value), value, 'the kind is a name, never the credential');
  }
});

// ── The questions, in the order they fail ────────────────────────────────

test('a token that can write is reported as working, and asked the whole sequence', async () => {
  const fetchImpl = fakeFetch([
    repositoryReply(),
    { status: 200, json: { name: 'main' } },
    { status: 200, json: { sha: 'blob-sha' } },
    { status: 404, json: { message: 'Not Found' } },
    { status: 201, json: { sha: 'dangling-blob' } },
  ]);

  const report = await checkToken({ token: TOKEN, repo: REPO, fetchImpl });

  assert.equal(report.verdict.ok, true, report.verdict.summary);
  assert.equal(report.kind, 'fine-grained');
  assert.equal(report.branchExists, true);
  assert.deepEqual(report.files, [
    { path: 'public/site-content.json', status: 200, exists: true },
    { path: 'public/app-links.json', status: 404, exists: false },
  ]);

  assert.deepEqual(
    fetchImpl.calls.map((call) => `${call.method} ${call.url.replace('https://api.github.com', '')}`),
    [
      `GET /repos/${REPO}`,
      `GET /repos/${REPO}/branches/main`,
      `GET /repos/${REPO}/contents/public/site-content.json?ref=main`,
      `GET /repos/${REPO}/contents/public/app-links.json?ref=main`,
      `POST /repos/${REPO}/git/blobs`,
    ],
    'the write test is last, because it is the only question that needs a writable token to answer',
  );
  assert.equal(fetchImpl.calls.at(-1).headers.authorization, `Bearer ${TOKEN}`);
  assert.ok(!JSON.stringify(report).includes(TOKEN), 'the report must never carry the credential');
});

test('a read-only token is diagnosed from both its permissions and the write', async () => {
  const fetchImpl = fakeFetch([
    repositoryReply({ push: false, pull: true }),
    { status: 200, json: { name: 'main' } },
    { status: 200, json: { sha: 'blob-sha' } },
    { status: 200, json: { sha: 'blob-sha' } },
    { status: 403, json: { message: 'Resource not accessible by personal access token' } },
  ]);

  const report = await checkToken({ token: TOKEN, repo: REPO, fetchImpl });

  assert.equal(report.verdict.ok, false);
  assert.match(report.verdict.summary, /no push access/);
  assert.match(report.verdict.summary, /write test answered 403/);
  assert.ok(
    report.verdict.fixes.some((fix) => /Contents → Read and write/.test(fix)),
    'the fix has to name the setting, not the symptom',
  );
  assert.ok(
    report.verdict.fixes.some((fix) => /Public repositories.*read-only/.test(fix)),
    'Repository access left on “Public repositories” is read-only and must be named',
  );
  assert.equal(fetchImpl.calls.at(-1).method, 'POST', 'the write is still asked, because it is the ground truth');
});

test('a write that succeeds outranks a permissions field that reads read-only', async () => {
  // `permissions` is GitHub's report about the token, not a test of it; the
  // write test is the test. If they disagree, the write is what happens.
  const fetchImpl = fakeFetch([
    repositoryReply({ push: false, pull: true }),
    { status: 200, json: { name: 'main' } },
    { status: 200, json: { sha: 'blob-sha' } },
    { status: 404, json: { message: 'Not Found' } },
    { status: 201, json: { sha: 'dangling-blob' } },
  ]);

  const report = await checkToken({ token: TOKEN, repo: REPO, fetchImpl });
  assert.equal(report.verdict.ok, true, report.verdict.summary);
});

test('a 403 on the write names the Contents permission and the classic-token scope', async () => {
  const fetchImpl = fakeFetch([
    repositoryReply(),
    { status: 200, json: { name: 'main' } },
    { status: 200, json: { sha: 'blob-sha' } },
    { status: 404, json: { message: 'Not Found' } },
    { status: 403, json: { message: 'Resource not accessible by personal access token' } },
  ]);

  const report = await checkToken({ token: 'ghp_classic_token_value', repo: REPO, fetchImpl });

  assert.equal(report.kind, 'classic');
  assert.equal(report.verdict.ok, false);
  assert.match(report.verdict.summary, /Resource not accessible by personal access token/);
  assert.ok(report.verdict.fixes.some((fix) => /`repo` scope/.test(fix)));
  assert.ok(!JSON.stringify(report).includes('ghp_classic_token_value'));
});

test('a token that cannot see the repository is told to check GITHUB_REPO, not the permission', async () => {
  const fetchImpl = fakeFetch([{ status: 404, json: { message: 'Not Found' } }]);

  const report = await checkToken({ token: TOKEN, repo: 'someone/else', fetchImpl });

  assert.equal(report.verdict.ok, false);
  assert.match(report.verdict.summary, /someone\/else/);
  assert.ok(report.verdict.fixes[0].includes('GITHUB_REPO'));
  assert.equal(report.write.status, 0, 'a repository the token cannot see is not asked about writing');
  assert.equal(fetchImpl.calls.length, 1);
});

test('a rejected credential is reported as the credential, not as a repository', async () => {
  const fetchImpl = fakeFetch([{ status: 401, json: { message: 'Bad credentials' } }]);
  const report = await checkToken({ token: TOKEN, repo: REPO, fetchImpl });

  assert.equal(report.verdict.ok, false);
  assert.match(report.verdict.summary, /refused the token itself/);
  assert.ok(report.verdict.fixes.some((fix) => /redeploy/.test(fix)));
});

test('a missing token is a verdict, not a crash', async () => {
  const result = verdict({
    repo: REPO,
    kind: 'missing',
    repository: { status: 0, message: '', permissions: null },
    write: { status: 0, message: '' },
  });

  assert.equal(result.ok, false);
  assert.ok(result.fixes.length > 0);
});
