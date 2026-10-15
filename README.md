# ClearView website

The organisation's site for **ClearView** — one brand, three apps: the Android app,
the iOS app and the Chrome extension. It presents all three, says where each one is
downloaded from, and links to the privacy policy and the admin screen.

**One download button, and it scrolls to the answer.** The hero and the closing section
carry a single **Download** button that takes the visitor down to the three app cards,
where each platform's store, status and note already are. The header carries none — it
is the wordmark and four links. There is no "Get it on Play" beside a "See all three
apps", no popover repeating the cards, and no sentence explaining which platforms
exist (§One button).

Dark, quiet and product-render shaped: near-black canvas (`#0B1214`) with a single
neon-teal accent (`#00E0D2`), Montserrat headings, Inter body copy, and screenshots
shown inside thin-bezel phone frames.

**Stack:** React 19 + Vite + Tailwind CSS v4. No component library, no icon font. The
site is a **static** bundle — the landing page and the privacy policy need nothing but a
file server. One thing does need a server: the admin sign-in. That is a single function
in `api/`, and it is the only server-side code in the project (§The admin screen). Deploy
without it and the site still works; the admin screen then says so, plainly, instead of
showing a form that cannot succeed.

The feature sections describe the phone app (Android and iOS share those areas); the
browser half is the extension, and its job is Protection. The order on the page is
deliberate: a visitor finds out what runs where before reading phone features.

## One button

The hero's copy and both buttons come from the content store (§Changing copy or
screenshots). The button itself is a plain link — `#platforms` — and it appears twice:

| Where | What it is |
| --- | --- |
| the hero | the primary button under the paragraph |
| the closing section | the same button again |
| the header | **nothing.** No button, no menu — the wordmark and four links |

The click scrolls to the three platform cards. Those are the page's real answer to "where
do I get this": a card each, with the app's mark, its device, its store, an *Available
now* / *Coming soon* pill and the note explaining what it is. A popover that repeated
those three rows was the same information twice, in the smaller of the two places.

Because the cards render **no link at all** for a platform that is not live, the scroll
also means nobody can reach a store URL that 404s: the only link on the page for an
unreleased app is the one that does not exist.

The header's own destinations — Platforms, Protection, Screens, Privacy — are edited in
the admin's **Brand & header** group; there is no header button label to edit, because
there is no header button.

## The three apps, and their links

Every store link, and whether a platform is live or "coming soon", lives in **one
place** — `src/data/links.js`, with a published copy at `public/app-links.json`:

| Layer | Who writes it | Wins over |
| --- | --- | --- |
| `DEFAULT_PLATFORMS` in `src/data/links.js` | the developer | — |
| `public/app-links.json` | the **admin screen** (Publish), and the commit it makes | the defaults |
| `localStorage` | the admin screen, unpublished, on that browser | both |

The file is merged over the built-in defaults per app `id`, and only `url`, `status`
and `note` are taken from it. That is deliberate: a file that could rename a product or
add a fourth one would be a way to make the site lie. (**The card's words** — its name,
device line, store name and note — are content, and are edited on the admin screen's
Content tab. A wrong word and a wrong link are two different mistakes.)

> **The iOS and Chrome URLs are placeholders.** Neither is live, so the cards show
> *Coming soon* and render **no link at all** — a plausible-looking store URL that
> 404s reads as a broken product rather than an unreleased one. The admin screen
> refuses to mark a platform live while its URL still looks like a mock.

## The admin screen

Footer → **Admin**, or `#/admin`.

It edits **the whole site**, in two tabs:

- **Content** — every word and every picture, grouped in the order a visitor reads
them, plus the footer and the privacy policy. The fields are labelled with the page's
own headings, so editing "Media" means the Media section's eyebrow, title, lead and
bullets.
- **App links** — where the three apps are downloaded from, and whether a card shows
a button at all.

It is signed in to with an **email and a password that live in the deployment's
environment** — there is no sign-up on the screen, and nothing to create on a first
visit.

```bash
npm run admin:set -- you@example.com      # local: writes the three variables into .env
npm run admin:hash -- you@example.com     # deploy: prints the three variables to set
```

`admin:set` asks for the password, hashes it, and writes `ADMIN_EMAIL`,
`ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` into `.env` itself, leaving every other
line of that file alone. Then restart `npm run dev` — the variables are read once, at
startup — and sign in with the address and the password you just typed. `admin:hash`
prints the same three lines instead, for **Vercel → Settings → Environment Variables**,
where there is no file to write.

`.env` is ignored by git, deliberately: a
committed `ADMIN_PASSWORD_HASH` is a password hash in a public repository, and a
committed `ADMIN_SESSION_SECRET` would let anyone mint an admin token.

The hash is separated by `:` and not the more usual `$`, and that is not a style
choice: a `$` in a `.env` file is a variable reference, which Vite expands while
reading the file, so a `$`-separated hash pasted into `.env` arrives at the endpoint
silently rewritten and refuses the correct password. `:` means nothing to dotenv, to a
shell, or to a hosting dashboard's variable field, so one string works unquoted in all
three. A `$`-separated hash is refused rather than half-supported — a deployment that
cannot read its own credentials should say so, not look like a wrong password.

| Variable | What it is |
| --- | --- |
| `ADMIN_EMAIL` | the one address that may sign in |
| `ADMIN_PASSWORD_HASH` | `scrypt:N:r:p:salt:hash` — a hash, never the password |
| `ADMIN_SESSION_SECRET` | signs the session tokens; rotating it signs every admin out |

### How the sign-in works

All of it is `api/admin/session.js` — one Vercel function, and the only server-side code
in this project:

| Request | Answer |
| --- | --- |
| `GET /api/admin/session` | `{ configured, missing, unusable, signedIn, email, expiresAt }` |
| `POST /api/admin/session` | `{ token, email, expiresAt }`, or `401 invalid` / `429 rate_limited` / `503 not_configured` / `400 bad_request` / `405 method_not_allowed` |

- **The check happens on the server.** The password is verified there with `scrypt` and
  a constant-time comparison, against the hash in the environment. The browser is told
  only whether it matched.
- **The browser gets a token, not a password.** `<payload>.<hmac>` — an email and an
  expiry, signed with `ADMIN_SESSION_SECRET`, good for twelve hours, kept in
  `sessionStorage` so closing the tab ends the session. Editing it changes nothing: the
  signature is re-checked on every request, which is also what makes rotating the secret
  sign everyone out.
- **No secret is in the bundle.** The hash and the signing secret are read by the
  function. Anything a browser can read is public, which is exactly why the check is not
  in the bundle too.
- **A refusal says nothing about which half was wrong.** A bad password and an unknown
  address give the same words, and the unknown address still pays for a key derivation so
  both take the same time. Otherwise the endpoint would answer “is this address an
  administrator?”.
- **Guessing is slowed, not stopped.** Five failures from one address lock that address
  out for fifteen minutes, in the memory of the function instance. Vercel runs several
  and recycles them, so treat it as a speed bump — the length of the password is the real
  defence. The generator accepts `MIN_PASSWORD` = eight characters and suggests twelve,
  saying why when you choose fewer: the lockout only applies to guesses made against the
  running server, so anyone holding the hash can test guesses against it offline for as
  long as they like. Eight is a floor, not a recommendation. `--check` tests a password
  against the configured hash:
  `npm run admin:check`.
- **It fails closed.** A plaintext password pasted into `ADMIN_PASSWORD_HASH`, a hash in
  the wrong shape, a short signing secret, or a missing variable: the screen says which
  variable is wrong and offers no form. It never guesses what a value was meant to be.

`vite.config.js` mounts the same handler on `npm run dev` and `npm run preview`, so both
local commands behave like the deployment rather than answering the Sign in button with a
404. Nothing is added to the build by it — the output is still a static bundle.

### Publishing is a commit, and the deploy follows it

Three buttons, and each one is a different distance from the public:

- **Save** — keeps the draft in this browser, so you can look at it on the real page
  before anyone else sees it. Nothing has left your machine.
- **Preview** — saves, then opens the real page in a new tab with the draft applied.
- **Publish** — hands the document to this deployment's function
  (`api/admin/publish.js`), which commits it to the repository. The repository is
  connected to Vercel, so that commit **is** the deploy: the live site follows in about a
  minute, with nobody typing git commands.

| Variable | What it is |
| --- | --- |
| `GITHUB_TOKEN` | a fine-grained token on this repository with **Contents: read and write** |
| `GITHUB_REPO` | `owner/name` — which repository the commit goes to |
| `GITHUB_BRANCH` | `main`, unless you deploy from another branch |

With none of them set the screen says so: it asks `GET /api/admin/publish` when the
editor opens, disables Publish, and names the variables that are missing — the same way it
reports an unconfigured sign-in, and for the same reason.

#### Making the GitHub token

1. Open <https://github.com/settings/personal-access-tokens/new>. Take the **fine-grained**
   kind: a classic token with `repo` scope reaches every repository you own, which is far
   more than publishing needs.
2. **Token name** `clearview-website-publish`. **Expiration** — 90 days, or a date you will
   still remember: publishing stops the day it expires, and the screen says so.
3. **Resource owner** — your own account. This repository is owned by a user
   (`muddassir-2025`), not an organisation, so there is no approval step.
4. **Repository access** → *Only select repositories* → `ClearView-web`.
5. **Permissions** → *Repository permissions* → **Contents: Read and write**. That is the
   only one needed; *Metadata: Read-only* is added by GitHub on its own.
6. **Generate token** and copy `github_pat_…` — it is shown once, and never again.
7. Paste it into Vercel as `GITHUB_TOKEN`, with `GITHUB_REPO=muddassir-2025/ClearView-web`,
   and **redeploy**: environment variables reach a running deployment only through a new one.
8. **Check it before you need it** — this asks GitHub the same questions the publish does:

   ```bash
   npm run github:check -- muddassir-2025/ClearView-web
   ```

   It reads `GITHUB_TOKEN` from `.env` (or the shell), then reports the repository, the
   branch, each published file, and — the part that matters — a **write test**. That last
   one creates an unreferenced object: no branch, no commit, no file, nothing anyone can
   see. `201` means the token has `Contents: write` and a publish will go through; `403`
   means it does not. It never prints the token, only its kind, and it exits non-zero when a
   publish would fail, so it can be used from a script.

   The paste above is worth doing carefully: pasting the **whole line**
   (`GITHUB_TOKEN=github_pat_…`) into the value field is the mistake this tool catches
   fastest, because the value then contains its own variable name and GitHub answers
   `401 Bad credentials`. A fine-grained token is 93 characters and begins `github_pat_`.

#### Reading a refusal

GitHub's own words for these are one line each (`Not Found`,
`Resource not accessible by personal access token`) and name no setting, so the endpoint
adds the reading of the **status** to whatever GitHub said:

| What it says | What it is |
| --- | --- |
| `401` | The token itself: mistyped, expired or revoked (or the whole line was pasted as the value). A new value needs a redeploy. |
| `403` — *Resource not accessible by personal access token* | The token can reach the repository but may not write to it. `Contents` must be **Read and write**, the repository must be ticked under **Repository access** (`Public repositories` is read-only and can never publish), and **Save changes** must have been pressed. Editing a token changes no value, so this one needs no redeploy. |
| `404` | The token cannot see the repository: the wrong `GITHUB_REPO`, or it was not selected when the token was made. GitHub answers 404 rather than 403 so the reply does not confirm whether a private repository exists. |

`npm run github:check` distinguishes all three, and is the faster way to find out: it
tests whether the token can write instead of waiting for a commit to fail.

Signing in is the gate. The signed token is verified before a commit, with the same module
(`server/admin-auth.js`) that mints and checks it, so there is one implementation of the
check rather than two. What may be published is decided on the server: exactly two paths,
`public/site-content.json` and `public/app-links.json`, each of which must parse as JSON
of the shape it is supposed to be. A session cannot write anywhere else in the repository —
otherwise it would be a great deal more authority than "this person edits the website".

**Under `npm run dev` the same endpoint writes the file instead of committing it.** A
laptop has no repository to commit to, and committing the live branch from one would deploy
whatever was half-finished at the time. So a local publish writes `public/site-content.json`
(or `app-links.json`) into the checkout, and the commit that deploys it stays yours to
make. Both servers print which of the two you are looking at.

The draft is this browser's, not the session's: signing out does not discard work, and a
different browser starts from the published copy. A publish deliberately does **not** clear
the draft — the page has not rebuilt yet, so the local copy is still the newest thing in
the tab, and discarding it would look like the publish had undone the edit.

## Run it

```bash
npm install
npm run admin:set -- you@example.com   # writes .env — see §The admin screen
npm run dev        # http://localhost:5173
npm run build      # writes dist/
npm run preview    # serve the built site locally
npm test           # every test
npm run github:check -- owner/name   # can this token actually publish? (see §Publishing)
```

The three admin variables are read from `.env` by `vite.config.js` for `dev` and
`preview` only, so the sign-in works locally without exporting anything. The landing page
and the privacy policy need none of it. `.env.example` is the empty template; `admin:set`
is what fills a real `.env` in, and it is the only thing in the project that writes one.

Both servers print where an admin signs in and where a publish goes, under Vite's own
banner:

```
  admin sign-in  admin@clearview.test — a different address or password: npm run admin:set -- you@example.com
  publishing     writes the JSON into public/ here — the deployment commits it to GitHub instead
```

The line is produced by calling the endpoint itself with a `GET`, so it cannot disagree
with what the sign-in card does; an unconfigured environment prints the names of the
variables it is missing instead. No value is ever printed.

`#/admin` locally is one card: email, password, **Sign in**. With the three variables in
`.env` it signs in on `npm run dev` and on `npm run preview` alike — the same handler
Vercel calls, mounted on the dev server, so nothing about the local screen is a stand-in.
With no `.env` the card is replaced by a notice naming the variables to set, because a
form that cannot succeed is worse than being told why.

The `.env` in this checkout holds a **local-only** pair, and the password that goes with
it is nowhere on disk — it is only in the hash. `npm run admin:set -- you@example.com`
replaces it with a pair of your choosing; nothing that pair signs is valid anywhere but
this machine, so a deployment needs its own, made the same way and set in Vercel's
environment rather than in this repository.

## Hosting

The build is a plain static bundle — `dist/` can go anywhere.

1. `npm run build`
2. Upload the contents of `dist/` to your host.

- **Vercel** — deploy **the repository**, not the contents of `dist/`: the admin
  function in `api/` is deployed alongside the build, and Vercel detects both by itself
  (framework Vite, build `npm run build`, output `dist`). Add `ADMIN_EMAIL`,
  `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET` under *Settings → Environment
  Variables*, then redeploy — changing a variable does not rebuild an existing
  deployment. Without them the site is fine and the admin screen says it has no
  credentials; without `api/` it says it has no endpoint.
- **Netlify / Cloudflare Pages** — build command `npm run build`, publish directory
  `dist`, plus the same three variables for the admin (`netlify/functions` or an edge
  function would need the handler moved; the site itself needs nothing).
- **GitHub Pages** — push `dist/` to the `gh-pages` branch (or point Pages at a
  `/docs` build output). `vite.config.js` sets `base: './'`, so the site works
  from a project subpath like `user.github.io/clearview-web/` with no changes.
- **Any web host / S3 / nginx** — copy `dist/` into the web root. It is fully
  static; there is no server component.

After deploying, make `og:image` and the canonical link in `index.html` absolute
(crawlers ignore relative URLs for social previews).

To regenerate the share card (`public/og.png`) after changing the copy:

```bash
python tools/make-og.py    # needs Pillow + numpy, run from the project root
```

## Layout of the code

```
index.html                 meta tags, Open Graph, fonts, favicon links
vite.config.js             the build, plus the admin endpoint mounted for dev/preview
public/images/*.jpeg       the app screenshots (optimised, long edge 1000px)
public/logo.png            the app mark, on its white tile (header + footer)
public/favicon-32.png      the same mark, corners rounded, for the browser tab
public/apple-touch-icon.png
public/app-links.json      the PUBLISHED store links (see §The three apps)
server/admin-auth.js       what both admin endpoints share: the environment, the session
                           token, and the request plumbing. Outside api/ on purpose —
                           every file in there becomes a route
tools/make-logo.py         generates the three logo assets from temp/1.jpeg
public/og.png              1200x630 social share card
src/index.css              the only stylesheet — tokens, phone frames, glow,
                           reveal animation, lightbox, platform cards, prose,
                           forms
tools/make-og.py           generates public/og.png
src/data/site.js           every word and picture on the site (single source of
                           truth), with the published + local override layers
src/data/layout.js         the page's STRUCTURE: section ids, order, sides, bullet
                           styles and the phone arrangements. Not editable
public/site-content.json   the PUBLISHED content (see §The admin screen)
src/data/links.js          the three apps, their store links and the override store
src/data/admin.js          the admin's browser half: sign in, token, sign out — the
                           password is never checked here
api/admin/session.js       the admin's server half: verifies the environment's hash and
                           signs a session token
api/admin/publish.js       commits a document to the repository (or, under npm run dev,
                           writes it into public/). The only code that writes files
.env.example               the admin variables and the three publishing ones
api/                       the only server-side code in the project: two endpoints
tests/admin-api.test.js    the sign-in endpoint's tests, run with `npm test`
tests/admin-env.test.js    generates a credential into a throwaway file, then signs in with it
tests/admin-publish.test.js the publish endpoint: who may, what may be written where, and
                           the exact commit it makes (no network, no token, no commit)
tests/github-check.test.js the token checker's verdicts: read-only, a classic token with
                           no scope, a wrong repository, a rejected credential
tools/make-admin-hash.mjs  writes ADMIN_PASSWORD_HASH + ADMIN_SESSION_SECRET, printing
                           them or (--write, npm run admin:set) putting them into .env;
                           --check tests a password against the configured hash
tools/check-github-token.mjs  asks GitHub whether a publishing token can actually commit
                           (npm run github:check): the repository, its own permissions
                           report, the branch, the two files, and a write test that
                           creates one unreferenced object. Never prints the token
src/hooks/useReveal.js     IntersectionObserver scroll reveals
src/hooks/useHashRoute.js  the router: #/privacy, #/admin, and nothing else
src/components/            Header, Hero, Platforms, Section, Cluster, Phone,
                           Gallery, Lightbox, FinalCta, Footer, PrivacyPolicy,
                           Admin, icons
```

### Routing

Two inner pages, both on the **hash** (`#/privacy`, `#/admin`). A hash route keeps
the build working from a domain root, a project subfolder or a plain file server —
which a path route cannot do without the host rewriting unknown paths to
`index.html`. A hash *without* a leading slash (`#platforms`, `#showcase`, `#top`) is
an ordinary in-page anchor, not a route, and stays one.

### Changing copy or screenshots

**You do not edit a component to change a word.** Every string and every image on
the page lives in `src/data/site.js` (`DEFAULT_SITE`), in the page's own order: the
brand, the header, the hero, the three app cards, the five product sections, the
screenshot list, the closing section, the footer and the privacy policy. Components
are layout only.

There are three layers, the same three the store links use:

| Layer | Who writes it | Wins over |
| --- | --- | --- |
| `DEFAULT_SITE` in `src/data/site.js` | the developer | — |
| `public/site-content.json` | the **admin screen** (Publish), and the commit it makes | the defaults |
| `localStorage` | the admin screen, unpublished, on that browser | both |

The store links are **not** in `site.js` — where each app is downloaded from, and
whether it is live, lives in `src/data/links.js` / `public/app-links.json`, because a
wrong link and a wrong sentence are different mistakes with different consequences.

**What is deliberately not editable: the page's structure.** Which sections exist,
in what order, which half of the screen each one's text sits in, how its bullets are
shown, and how its phones are arranged are all in `src/data/layout.js`. A published
file that could add, remove or reorder whole sections could make the page describe a
product that does not exist, and nothing on the admin screen would catch it.

A field left blank keeps the built-in text — the merge's rule, and what stops an
empty box blanking a headline. The policy's section bodies take two bits of markup:
a line starting with `- ` becomes a bullet, and `**bold**` / `body` work inline.

To add a screenshot: drop the file into `public/images/`, then point an existing key
at it from the admin screen's **Screenshots** group (or add an entry to `SCREENS` and
`GALLERY_ORDER` in `site.js`). The phone clusters and the strip both read the images
by key, so pointing one at a new file changes every place it appears.

Keep the policy in step with the apps: the Android Accessibility Service disclosure
in the footer and the browser sections there have to say the same thing.

## Notes

- **`temp/1.jpeg` is the app logo, not a screen.** It is a heart split black and
  red on a white background, so it is used as the brand mark rather than as a
  gallery screenshot: it appears in the header, in the footer, as the favicon and
  in the share card. `tools/make-logo.py` rebuilds those assets from it — rerun it
  if the logo is ever replaced. As delivered it keeps its white background:
  `public/logo.png` is the heart centred on a 300x300 white tile, and the header
  and footer round the corners with CSS.
- The gallery holds the 15 screens, so it renders `{items.length}` of them. Adding
  one back is a one-line change in `SCREENS` + `GALLERY`.
- The Quran section has two screens (reminder + surah list). There is no separate
  full-page reading-view screenshot in the upload, so the reminder screen — which
  already shows a verse with its ayah position and copy controls — carries that part.
- Screens are assigned to sections by what they actually show, matched against the
  app's own screen titles.
- Images are lazily loaded, and every one has descriptive alt text. Phone frames
  carry real `width`/`height` so nothing shifts while they load.
- Tested at 390px wide and at desktop width: no horizontal overflow, and every
  reveal element fades in. `prefers-reduced-motion` is honoured — content appears
  immediately and no transitions run.
