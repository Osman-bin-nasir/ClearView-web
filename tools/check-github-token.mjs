/**
 * Can this GitHub token actually publish?
 *
 * WHY THIS EXISTS: the admin screen can only report what GitHub says, and
 * GitHub says one line for several different mistakes — "Not Found", or
 * "Resource not accessible by personal access token". A wrong `GITHUB_REPO`, a
 * token whose *Repository access* was left on "Public repositories" (read-only
 * by definition), and a token whose *Contents* permission is read-only all come
 * back looking similar, and they have three different fixes. This asks GitHub
 * the questions that tell them apart, in the order they fail:
 *
 *   1. can the token see the repository?            GET  /repos/{owner}/{name}
 *      — and what does its own permission set say?  the `permissions` in that reply
 *   2. does the branch it would commit to exist?    GET  /repos/.../branches/{branch}
 *   3. can it read the files it publishes?          GET  /repos/.../contents/{path}
 *   4. can it WRITE at all?                         POST /repos/.../git/blobs
 *
 * The last one is the write test, and it changes nothing: it creates an
 * unreferenced object — no branch, no commit, no file, nothing anyone can see.
 * `201` means the token has Contents: write and a publish will go through;
 * `403` means it does not, which is the difference GitHub will not spell out.
 *
 * It is the same requests the endpoint makes, and it never prints the token.
 *
 *   npm run github:check                          # GITHUB_REPO from .env
 *   npm run github:check -- muddassir-2025/ClearView-web
 *
 * Exit status is 0 when a publish would work and 1 when it would not, so it can
 * be used in a script as well as read.
 */

import { pathToFileURL } from 'node:url';

const API = 'https://api.github.com';

/** The two files the admin screen publishes — the paths the endpoint may write. */
const PUBLISHED_PATHS = ['public/site-content.json', 'public/app-links.json'];

/**
 * Which kind of credential this is, from its prefix alone.
 *
 * Worth knowing rather than printing: a fine-grained token (`github_pat_`) has a
 * per-repository permission list, while a classic one (`ghp_`) has coarse scopes
 * and needs `repo` — on a *public* repository, writes need a scope even though
 * reads do not. The value itself is returned to nobody.
 */
export function tokenKind(token) {
  const value = String(token ?? '').trim();
  if (value === '') return 'missing';
  if (value.startsWith('github_pat_')) return 'fine-grained';
  if (value.startsWith('ghp_')) return 'classic';
  if (value.startsWith('ghs_')) return 'github app (installation)';
  if (value.startsWith('gho_')) return 'oauth';
  if (value.startsWith('ghu_')) return 'user-to-server';
  return 'unrecognised';
}

/**
 * What the answers add up to, and what to do about them.
 *
 * Pure, so every verdict below can be tested without a token and without a
 * network — including the refusals, which are the ones that matter.
 */
export function verdict({ repo, kind, repository, write }) {
  const fixes = [];
  const classic = kind === 'classic' ? ['A classic token needs the `repo` scope (or `public_repo` on a public repository).'] : [];
  const permissionFix = [
    'Repository permissions → Contents → Read and write.',
    'Repository access must be “Only select repositories” (with this one ticked) or “All repositories”: “Public repositories” is read-only and can never publish.',
    'Press Save changes at the bottom — permission edits do not apply until you do.',
    'The token’s value does not change, so GITHUB_TOKEN in Vercel stays as it is and no redeploy is needed.',
  ];

  // 1. The repository itself. This is the only check whose status is unambiguous:
  //    GitHub answers 404 when a token cannot see a repository, and 401 when the
  //    token is not a credential at all.
  if (repository.status === 401) {
    return {
      ok: false,
      summary: 'GitHub refused the token itself — it is mistyped, expired, or has been revoked.',
      fixes: ['Make a new token, replace GITHUB_TOKEN, and redeploy — a new value reaches the deployment only through a new one.'],
    };
  }
  if (repository.status === 403) {
    return {
      ok: false,
      summary: `The token has no permission at all for ${repo}.`,
      fixes: [...permissionFix, ...classic],
    };
  }
  if (repository.status === 404) {
    return {
      ok: false,
      summary: `The token cannot see ${repo} — GitHub answers 404 rather than 403 so that the answer does not confirm whether a private repository exists.`,
      fixes: [
        `Check GITHUB_REPO: it must be exactly owner/name, here ${repo}.`,
        'Then tick this repository under the token’s Repository access (or choose “All repositories”).',
        ...classic,
      ],
    };
  }
  if (repository.status !== 200) {
    return {
      ok: false,
      summary: `GitHub answered ${repository.status} for the repository${repository.message ? `: ${repository.message}` : '.'}`,
      fixes: ['Nothing about the token can be judged until the repository can be read.'],
    };
  }

  // 2. What the token's own permission set says. For a read-only token this is
  //    the answer, before any write is attempted — and it explains why the read
  //    of a *public* repository succeeded while the commit did not.
  // 3. The write itself — the question the whole tool exists to ask, and the
  //    only answer that settles it. The `permissions` above are reported by
  //    GitHub rather than tested, so a write that *succeeds* outranks them.
  if (write.status >= 200 && write.status < 300) {
    return { ok: true, summary: `The token can commit to ${repo}: a publish from the admin screen will go through.`, fixes: [] };
  }

  const push = repository.permissions?.push;
  if (push === false) {
    return {
      ok: false,
      summary: `The token may read ${repo} but not write to it: its own permissions report no push access${write.status ? `, and the write test answered ${write.status}` : ''}.`,
      fixes: [...permissionFix, ...classic],
    };
  }
  if (write.status === 401) {
    return {
      ok: false,
      summary: 'GitHub refused the token on the write.',
      fixes: ['Make a new token, replace GITHUB_TOKEN, and redeploy.'],
    };
  }
  if (write.status === 403) {
    return {
      ok: false,
      summary: `The token may not write to ${repo} — Github's words: ${write.message || 'Resource not accessible by personal access token'}.`,
      fixes: [...permissionFix, ...classic],
    };
  }
  if (write.status === 404) {
    return {
      ok: false,
      summary: `GitHub answered 404 on the write, which means it will not confirm that ${repo} exists to this token.`,
      fixes: [`Check GITHUB_REPO (${repo}), then tick the repository under the token’s Repository access.`, ...classic],
    };
  }
  return {
    ok: false,
    summary: `GitHub answered ${write.status} on the write${write.message ? `: ${write.message}` : '.'}`,
    fixes: [],
  };
}

/**
 * Ask GitHub everything the endpoint's failure would have hidden.
 *
 * `fetchImpl` is injected so the sequence can be tested without a network, the
 * way `githubStorage` is in api/admin/publish.js. The token travels in the
 * Authorization header and appears in no field of the returned report.
 */
export async function checkToken({ token, repo, branch = 'main', fetchImpl = globalThis.fetch } = {}) {
  const kind = tokenKind(token);
  const headers = {
    authorization: `Bearer ${String(token ?? '').trim()}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    // GitHub rejects a request with no user agent, and this one says who it is.
    'user-agent': 'clearview-admin-publish-check',
  };

  const read = async (url, options = {}) => {
    const response = await fetchImpl(url, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
    let message = '';
    let body = {};
    try {
      body = await response.json();
      if (typeof body?.message === 'string') message = body.message;
    } catch {
      /* a body that is not JSON leaves the status as the whole story */
    }
    return { status: response.status, message, body };
  };

  const repositoryResult = await read(`${API}/repos/${repo}`);
  const branchResult =
    repositoryResult.status === 200 ? await read(`${API}/repos/${repo}/branches/${encodeURIComponent(branch)}`) : { status: 0 };

  const files = [];
  if (repositoryResult.status === 200) {
    for (const path of PUBLISHED_PATHS) {
      const result = await read(`${API}/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`);
      files.push({ path, status: result.status, exists: result.status === 200 });
    }
  }

  const writeResult =
    repositoryResult.status === 200
      ? await read(`${API}/repos/${repo}/git/blobs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // One unreferenced object. Nothing is added to a branch, so nothing
          // about the site changes — this is the only way to ask GitHub whether
          // the token may write without writing anything that can be seen.
          body: JSON.stringify({
            content: Buffer.from('clearview-admin-publish: token check', 'utf8').toString('base64'),
            encoding: 'base64',
          }),
        })
      : { status: 0, message: '' };

  const repository = {
    status: repositoryResult.status,
    message: repositoryResult.message,
    permissions: repositoryResult.body?.permissions ?? null,
  };

  return {
    repo,
    branch,
    kind,
    repository,
    branchExists: branchResult.status === 0 ? null : branchResult.status === 200,
    files,
    write: { status: writeResult.status, message: writeResult.message },
    verdict: verdict({ repo, kind, repository, write: writeResult }),
  };
}

// ── The command ──────────────────────────────────────────────────────────

/** `owner/name`, the same shape the endpoint insists on. */
const REPO_SHAPE = /^[\w.-]+\/[\w.-]+$/;

async function main() {
  const repo = String(process.argv[2] ?? process.env.GITHUB_REPO ?? '').trim();
  const token = process.env.GITHUB_TOKEN ?? '';
  const branch = String(process.env.GITHUB_BRANCH ?? '').trim() || 'main';
  const kind = tokenKind(token);

  if (!REPO_SHAPE.test(repo)) {
    console.error(
      'Which repository? Neither GITHUB_REPO nor the argument is owner/name.\n' +
        '  npm run github:check -- muddassir-2025/ClearView-web',
    );
    process.exitCode = 2;
    return;
  }
  if (kind === 'missing') {
    console.error(
      'GITHUB_TOKEN is not set. Put the token in the shell for this one command — there is no need to write it to .env:\n' +
        '  GITHUB_TOKEN=github_pat_… GITHUB_REPO=' +
        repo +
        ' npm run github:check',
    );
    process.exitCode = 2;
    return;
  }

  // The kind, never the value: naming it is what tells a classic token's coarse
  // `repo` scope from a fine-grained token's per-repository permission list.
  console.log(`\n${repo} @ ${branch} — ${kind} token (no value is printed, ever)\n`);

  const report = await checkToken({ token, repo, branch });

  const mark = (ok) => (ok ? 'ok  ' : 'FAIL');
  console.log(`  ${mark(report.repository.status === 200)}  repository   ${report.repository.status}${report.repository.message ? `: ${report.repository.message}` : ''}`);
  if (report.repository.permissions) {
    const { pull, push, admin } = report.repository.permissions;
    console.log(`         permissions  push: ${push ? 'yes' : 'no'}, pull: ${pull ? 'yes' : 'no'}${admin ? ', admin: yes' : ''}`);
  }
  if (report.branchExists !== null) {
    console.log(`  ${mark(report.branchExists)}  branch        ${branch}${report.branchExists ? '' : ' — no such branch; GITHUB_BRANCH is wrong'}`);
  }
  for (const file of report.files) {
    // A 404 here is normal: it is a file that does not exist yet, and the first
    // publish is what creates it. Reported as what it is, not as a failure.
    console.log(`  ok    contents      ${file.path} — ${file.exists ? 'exists, will be updated' : 'not yet published, will be created'}`);
  }
  console.log(`  ${mark(report.write.status >= 200 && report.write.status < 300)}  write test    ${report.write.status}${report.write.message ? `: ${report.write.message}` : ''}   (a dangling object; no branch, no commit, no file)`);

  const { verdict: conclusion } = report;
  console.log(`\n${conclusion.ok ? 'Publish works.' : 'This token cannot publish yet.'} ${conclusion.summary}\n`);
  for (const fix of conclusion.fixes) console.log(`  · ${fix}`);
  if (conclusion.fixes.length) console.log('');

  process.exitCode = conclusion.ok ? 0 : 1;
}

// Only when run as a command: importing this file for its functions must not
// reach the network or exit the process.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`The check could not be completed: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
