# ClearView website

The organisation's site for **ClearView** — one brand, three apps: the Android app,
the iOS app and the Chrome extension. It presents all three, says where each one is
downloaded from, and links to the privacy policy and the admin screen.

**One download button, and it is the whole answer.** The hero, the header and the
closing section each carry a single **Download** button that opens the three apps with
their stores, marking the ones that are not out yet as coming soon. There is no
"Get it on Play" beside a "See all three apps", and no sentence explaining which
platforms exist — the menu says it once, where the visitor is already looking (§One
button).

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

The hero's copy and every button on the page come from the content store (§Changing
copy or screenshots), and the download button is one component used three times:

| Where | What it is |
| --- | --- |
| the hero | the primary button under the paragraph |
| the header | the same menu, small and ghosted |
| the closing section | the same button again |

Clicking it opens a small panel: one row per app, with the app's own mark, its device
and store, and — for a platform that is not live — *Coming soon* and **no link at all**.
Escape closes it, as does a click anywhere else. An unreleased app renders as a row
rather than a button that 404s, which is the same rule the platform cards follow.

## The three apps, and their links

Every store link, and whether a platform is live or "coming soon", lives in **one
place** — `src/data/links.js`, with a published copy at `public/app-links.json`:

| Layer | Who writes it | Wins over |
| --- | --- | --- |
| `DEFAULT_PLATFORMS` in `src/data/links.js` | the developer | — |
| `public/app-links.json` | the **admin screen** (exported), then committed | the defaults |
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
npm run admin:hash -- you@example.com     # prints the three variables to set
```

Paste the three lines into `.env` for local work, and into **Vercel → Settings →
Environment Variables** for the live site. `.env` is ignored by git, deliberately: a
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
  defence, which is why the generator insists on twelve characters. `--check` tests a
  password against the configured hash:
  `npm run admin:hash -- --check`.
- **It fails closed.** A plaintext password pasted into `ADMIN_PASSWORD_HASH`, a hash in
  the wrong shape, a short signing secret, or a missing variable: the screen says which
  variable is wrong and offers no form. It never guesses what a value was meant to be.

`vite.config.js` mounts the same handler on `npm run dev` and `npm run preview`, so both
local commands behave like the deployment rather than answering the Sign in button with a
404. Nothing is added to the build by it — the output is still a static bundle.

### Publishing is still a commit

Signing in does not change the live site. The admin edits, **Save** keeps the draft in
that browser, **Preview on the site** opens the real page with the draft applied, and
**Export** writes the file to be committed — `site-content.json` for the words and
pictures, `app-links.json` for the store links. The next deploy carries them. The screen
says so on itself, because an admin who believes they changed a live site and did not is
worse off than one who was told how it works.

The draft is this browser's, not the session's: signing out does not discard work, and a
different browser starts from the published copy. **Revert to published** is the way back.

Making **Save** publish would need somewhere to put the file: a public `GET` plus an
authenticated `PUT` backed by a store, or a commit made through the GitHub API. That is a
change to this repository and a redeploy, not a setting.

## Run it

```bash
npm install
cp .env.example .env                # then fill it in — see §The admin screen
npm run admin:hash -- you@example.com
npm run dev        # http://localhost:5173
npm run build      # writes dist/
npm run preview    # serve the built site locally
npm test           # the admin endpoint's tests (node:test, no browser needed)
```

The two admin variables are read from `.env` by `vite.config.js` for `dev` and
`preview` only, so the sign-in works locally without exporting anything. The landing page
and the privacy policy need none of it.

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
                           signs a session token. The only server-side code
.env.example               the three admin variables, and where to put them
tests/admin-api.test.js    the endpoint's tests, run with `npm test`
tools/make-admin-hash.mjs  writes ADMIN_PASSWORD_HASH + ADMIN_SESSION_SECRET (--check
                           tests a password against the hash that is configured)
src/hooks/useReveal.js     IntersectionObserver scroll reveals
src/hooks/useHashRoute.js  the router: #/privacy, #/admin, and nothing else
src/components/            Header, Hero, DownloadMenu, Platforms, Section, Cluster,
                           Phone, Gallery, Lightbox, FinalCta, Footer,
                           PrivacyPolicy, Admin, icons
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
| `public/site-content.json` | the **admin screen** (exported), then committed | the defaults |
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
