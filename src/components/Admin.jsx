import { useEffect, useMemo, useRef, useState } from 'react';
import { adminErrorMessage, refresh, signIn, signOut, useAdmin } from '../data/admin.js';
import {
  linksFileText,
  parseLinksFile,
  platformsOrigin,
  resetPlatforms,
  savePlatforms,
  usePlatforms,
} from '../data/links.js';
import {
  parseSiteFile,
  resetSite,
  saveSite,
  siteFileText,
  siteOrigin,
  useSite,
} from '../data/site.js';

/**
 * The admin screen, reached from the footer.
 *
 * TWO THINGS IT EDITS, because they are two different kinds of change:
 *
 *   · CONTENT — every word and every picture on the page. Its fields are laid
 *     out in the page's own order, under the page's own headings, so an admin
 *     editing "Media" sees the eyebrow, title, lead and bullets of the Media
 *     section in the order a visitor reads them.
 *   · LINKS — where the three apps are downloaded from, with the status that
 *     decides whether a card shows a button at all.
 *
 * Two things about it are stated on the page rather than left to be discovered,
 * because getting either wrong is the way an admin ends up believing something
 * untrue:
 *
 *   · SIGNING IN IS REAL. The email and password are checked by this
 *     deployment's own function against the environment, and the browser only
 *     holds a short-lived signed token. No sign-up, no password stored here.
 *   · PUBLISHING IS STILL A COMMIT. Edits save in this browser and export as
 *     JSON files, which are what make them the site's. A token cannot push to
 *     the repository, and pretending otherwise would be a lie with a Save
 *     button on it.
 */

// ── Shared bits ──────────────────────────────────────────────────────────

/** The obvious placeholders, so a "live" link that is still a mock is caught. */
function looksPlaceholder(url) {
  return /id0{6,}|a{16,}/i.test(url) || url.trim() === '';
}

function urlProblem(url) {
  const value = url.trim();
  if (value === '') return 'A URL is required.';
  if (!/^https:\/\//i.test(value)) return 'Store links should start with https://';
  if (looksPlaceholder(value)) return 'This still looks like a placeholder URL.';
  return '';
}

/** A small field wrapper so every control is labelled the same way. */
function Field({ label, hint, children, wide = false }) {
  return (
    <label className={`field${wide ? ' md:col-span-2' : ''}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

function Notice({ tone = 'info', children }) {
  return <p className={`notice notice--${tone}`}>{children}</p>;
}

/** Read and write one value in the draft by path: `sections.2.title`. */
const readPath = (document, path) =>
  path.split('.').reduce((value, key) => (value === undefined || value === null ? undefined : value[key]), document);

function writePath(document, path, value) {
  const keys = path.split('.');
  const clone = { ...document };
  let cursor = clone;
  for (const key of keys.slice(0, -1)) {
    const current = cursor[key];
    cursor[key] = Array.isArray(current) ? [...current] : { ...current };
    cursor = cursor[key];
  }
  cursor[keys.at(-1)] = value;
  return clone;
}

// ── The content editor ───────────────────────────────────────────────────

/** A growing textarea: the site's copy is sentences, not one-liners. */
function LongField({ value, onChange }) {
  return (
    <textarea
      className="input input--lines"
      rows={4}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** One bullet per row. An empty list keeps the built-in bullets. */
function LinesField({ lines, onChange }) {
  const update = (index, value) => onChange(lines.map((line, i) => (i === index ? value : line)));

  return (
    <div className="admin__lines">
      {lines.map((line, index) => (
        <div className="admin__line" key={index}>
          <input
            className="input"
            value={line}
            onChange={(event) => update(index, event.target.value)}
          />
          <button
            type="button"
            className="admin__icon-btn"
            aria-label={`Remove line ${index + 1}`}
            onClick={() => onChange(lines.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      <div>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange([...lines, ''])}>
          Add a line
        </button>
      </div>
    </div>
  );
}

/** `label` + `href` pairs: the header's nav and the footer's Site column. */
function LinksField({ links, onChange }) {
  const update = (index, patch) =>
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));

  return (
    <div className="admin__lines">
      {links.map((link, index) => (
        <div className="admin__line" key={index}>
          <input
            className="input"
            aria-label={`Link ${index + 1} label`}
            placeholder="Label"
            value={link.label}
            onChange={(event) => update(index, { label: event.target.value })}
          />
          <input
            className="input"
            aria-label={`Link ${index + 1} target`}
            placeholder="#section or #/privacy"
            value={link.href}
            onChange={(event) => update(index, { href: event.target.value })}
          />
          <button
            type="button"
            className="admin__icon-btn"
            aria-label={`Remove link ${index + 1}`}
            onClick={() => onChange(links.filter((_, i) => i !== index))}
          >
            ✕
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onChange([...links, { label: '', href: '' }])}
        >
          Add a link
        </button>
      </div>
    </div>
  );
}

/**
 * The screenshots.
 *
 * The image is the one thing here that cannot be typed into a field and
 * published from this screen: publishing is a commit, and a picture the admin
 * attached on their own machine is not in the repository. So the field is a
 * FILE NAME under `public/images/`, with the current image beside it as a
 * check — drop the file in, point the key at it, and every place that key
 * appears follows, including the phone clusters.
 */
function ScreensField({ screens, onChange }) {
  const update = (index, patch) =>
    onChange(screens.map((shot, i) => (i === index ? { ...shot, ...patch } : shot)));

  return (
    <div className="admin__shots">
      {screens.map((shot, index) => (
        <div className="admin__shot" key={shot.key}>
          <div className="admin__shot-preview">
            {/* The draft's file, so the thumbnail follows what is being typed. */}
            <img
              src={shot.file ? imagePath(shot.file) : ''}
              alt=""
              width={shot.w}
              height={shot.h}
              loading="lazy"
            />
          </div>
          <div className="admin__shot-body">
            <span className="admin__shot-key">{shot.key}</span>
            <input
              className="input"
              aria-label={`${shot.key} image file`}
              placeholder="images under public/images/"
              value={shot.file}
              onChange={(event) => update(index, { file: event.target.value })}
            />
            <input
              className="input"
              aria-label={`${shot.key} title`}
              placeholder="Label under the thumbnail"
              value={shot.title}
              onChange={(event) => update(index, { title: event.target.value })}
            />
            <textarea
              className="input input--lines"
              aria-label={`${shot.key} alt text`}
              rows={2}
              placeholder="What the screenshot shows, for screen readers"
              value={shot.alt}
              onChange={(event) => update(index, { alt: event.target.value })}
            />
            <div className="admin__line">
              <input
                className="input"
                type="number"
                aria-label={`${shot.key} width`}
                placeholder="width"
                value={shot.w}
                onChange={(event) => update(index, { w: Number(event.target.value) || 0 })}
              />
              <input
                className="input"
                type="number"
                aria-label={`${shot.key} height`}
                placeholder="height"
                value={shot.h}
                onChange={(event) => update(index, { h: Number(event.target.value) || 0 })}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/** One image under /images, resolved against the document. */
function imagePath(file) {
  return new URL(`images/${file}`, document.baseURI).href;
}

/** The privacy policy's sections: a title and a body each. */
function PolicyField({ sections, onChange }) {
  const update = (index, patch) =>
    onChange(sections.map((section, i) => (i === index ? { ...section, ...patch } : section)));

  return (
    <div className="admin__lines">
      {sections.map((section, index) => (
        <div key={index} style={{ display: 'grid', gap: '0.6rem', marginBottom: '1.25rem' }}>
          <div className="admin__line">
            <input
              className="input"
              aria-label={`Policy section ${index + 1} title`}
              placeholder="Heading"
              value={section.title}
              onChange={(event) => update(index, { title: event.target.value })}
            />
            <button
              type="button"
              className="admin__icon-btn"
              aria-label={`Remove policy section ${index + 1}`}
              onClick={() => onChange(sections.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
          <textarea
            className="input input--lines"
            aria-label={`Policy section ${index + 1} body`}
            rows={5}
            value={section.body}
            onChange={(event) => update(index, { body: event.target.value })}
          />
        </div>
      ))}
      <div>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => onChange([...sections, { title: '', body: '' }])}
        >
          Add a section
        </button>
      </div>
    </div>
  );
}

/** One heading and a run of fields, so the editor reads like the page. */
function Group({ title, note, children, pair = false }) {
  return (
    <section className="admin__group">
      <div className="admin__group-head">
        <h2 className="admin__group-title">{title}</h2>
        {note ? <p className="admin__group-note">{note}</p> : null}
      </div>
      <div className={`admin__fields${pair ? ' admin__fields--pair' : ''}`}>{children}</div>
    </section>
  );
}

/**
 * The whole page, as fields.
 *
 * The groups run in the order of the page: brand, hero, the three apps, then the
 * product areas, then the screenshots, the closing section, the footer and the
 * policy. A field left blank keeps the built-in text — that is the merge's rule,
 * and saying it once here is what stops an empty box ever blanking a headline.
 */
function SiteEditor({ draft, setDraft }) {
  const field = (path, label, { hint, kind = 'text', wide = false } = {}) => {
    const value = readPath(draft, path);
    const set = (next) => setDraft((current) => writePath(current, path, next));

    if (kind === 'lines') {
      return (
        <Field key={path} label={label} hint={hint} wide>
          <LinesField lines={Array.isArray(value) ? value : []} onChange={set} />
        </Field>
      );
    }
    if (kind === 'links') {
      return (
        <Field key={path} label={label} hint={hint} wide>
          <LinksField links={Array.isArray(value) ? value : []} onChange={set} />
        </Field>
      );
    }
    if (kind === 'long') {
      return (
        <Field key={path} label={label} hint={hint} wide>
          <LongField value={value ?? ''} onChange={set} />
        </Field>
      );
    }
    return (
      <Field key={path} label={label} hint={hint} wide={wide}>
        <input className="input" value={value ?? ''} onChange={(event) => set(event.target.value)} />
      </Field>
    );
  };

  const update = (path, value) => setDraft((current) => writePath(current, path, value));

  return (
    <>
      <Group title="Brand & header" note="The name and mark at the top of every page." pair>
        {field('brand.name', 'Brand name')}
        {field('brand.logo', 'Logo file', { hint: 'A file at the site root, e.g. logo.png' })}
        {field('header.cta', 'Header button')}
        {field('header.nav', 'Header links', { kind: 'links', hint: 'A hash target, e.g. #platforms' })}
      </Group>

      <Group title="Opening screen" pair>
        {field('hero.eyebrow', 'Eyebrow')}
        {field('hero.cta', 'Download button')}
        {field('hero.title', 'Headline', { wide: true })}
        {field('hero.lead', 'Paragraph', { kind: 'long' })}
      </Group>

      <Group title="The three apps" note="What each card says. Where each one is downloaded from is on the App links tab.">
        {field('platforms.eyebrow', 'Eyebrow')}
        {field('platforms.title', 'Heading')}
        {field('platforms.lead', 'Paragraph', { kind: 'long' })}
      </Group>

      {['android', 'ios', 'chrome'].map((id) => (
        <Group key={id} title={draft.platforms.cards[id].name || id} note="One card" pair>
          {field(`platforms.cards.${id}.name`, 'Name')}
          {field(`platforms.cards.${id}.short`, 'Short name', { hint: 'Used on the buttons, e.g. “Coming soon on Chrome”' })}
          {field(`platforms.cards.${id}.device`, 'Device line')}
          {field(`platforms.cards.${id}.store`, 'Store name')}
          {field(`platforms.cards.${id}.note`, 'Card note', { kind: 'long' })}
        </Group>
      ))}

      {draft.sections.map((section, index) => (
        <Group
          key={section.title || index}
          title={`Section ${index + 1} · ${section.eyebrow || 'untitled'}`}
          note="The page's order and its phone arrangement stay in the code."
          pair
        >
          {field(`sections.${index}.eyebrow`, 'Eyebrow')}
          {field(`sections.${index}.title`, 'Heading')}
          {field(`sections.${index}.lead`, 'Paragraph', { kind: 'long' })}
          {field(`sections.${index}.points`, 'Bullets', {
            kind: 'lines',
            hint:
              index === 3
                ? 'This section shows each line as “Name — description”.'
                : 'One bullet per row.',
          })}
          {field(`sections.${index}.note`, 'Footnote', { hint: 'Leave blank for none.' })}
        </Group>
      ))}

      <Group title="Screenshots" note="Every screen in the strip, in order. The phone clusters above use these images too.">
        {field('gallery.eyebrow', 'Eyebrow')}
        {field('gallery.title', 'Heading')}
        {field('gallery.hint', 'Line beside the heading', { wide: true })}
        <div className="md:col-span-2">
          <ScreensField
            screens={draft.gallery.screens}
            onChange={(screens) => update('gallery.screens', screens)}
          />
        </div>
      </Group>

      <Group title="Closing section" pair>
        {field('closing.title', 'Headline', { wide: true })}
        {field('closing.cta', 'Download button')}
      </Group>

      <Group title="Footer" pair>
        {field('footer.tagline', 'Tagline', { kind: 'long' })}
        {field('footer.appsTitle', 'Apps column heading')}
        {field('footer.siteTitle', 'Site column heading')}
        {field('footer.siteLinks', 'Site links', { kind: 'links' })}
        {field('footer.disclosure', 'Disclosure', {
          kind: 'long',
          hint: 'Required wording — keep it in full.',
        })}
        {field('footer.copyright', 'Copyright line', { hint: '{year} is filled in at render.' })}
      </Group>

      <Group title="Privacy policy" pair>
        {field('privacy.eyebrow', 'Eyebrow')}
        {field('privacy.title', 'Heading')}
        {field('privacy.updated', 'Last updated')}
        {field('privacy.updatedLabel', 'Updated line', { hint: '{date} is replaced with the value above.' })}
        {field('privacy.intro', 'Opening paragraph', { kind: 'long' })}
        <div className="md:col-span-2">
          <Field
            label="Sections"
            hint="A line starting with “- ” becomes a bullet. **bold** and `code` work inline."
          >
            <PolicyField
              sections={draft.privacy.sections}
              onChange={(sections) => update('privacy.sections', sections)}
            />
          </Field>
        </div>
        {field('privacy.note', 'Note')}
      </Group>
    </>
  );
}

// ── The links editor ─────────────────────────────────────────────────────

function LinksEditor({ draft, setDraft }) {
  const update = (id, patch) =>
    setDraft((current) =>
      current.map((platform) => (platform.id === id ? { ...platform, ...patch } : platform)),
    );

  return (
    <>
      <div className="admin__stack">
        {draft.map((platform) => {
          const problem = platform.status === 'live' ? urlProblem(platform.url) : '';
          return (
            <section key={platform.id} className="pcard">
              <header className="pcard__head">
                <div>
                  <h3 className="pcard__name">{platform.name}</h3>
                  <p className="pcard__device">{platform.store}</p>
                </div>
              </header>

              <Field label="Store URL" hint={problem || 'Where the button sends people.'}>
                <input
                  className={`input ${problem ? 'input--warn' : ''}`}
                  type="url"
                  inputMode="url"
                  spellCheck="false"
                  value={platform.url}
                  onChange={(event) => update(platform.id, { url: event.target.value })}
                />
              </Field>

              <Field label="Status" hint="“Coming soon” shows a label instead of a button.">
                <select
                  className="input"
                  value={platform.status}
                  onChange={(event) => update(platform.id, { status: event.target.value })}
                >
                  <option value="live">Available now — link is published</option>
                  <option value="soon">Coming soon — no link yet</option>
                </select>
              </Field>

              <Field label="Card note">
                <textarea
                  className="input"
                  rows={3}
                  value={platform.note}
                  onChange={(event) => update(platform.id, { note: event.target.value })}
                />
              </Field>
            </section>
          );
        })}
      </div>

      <Notice>
        The <strong>name</strong>, <strong>device line</strong> and <strong>store name</strong> on
        these cards are on the Content tab — the card's words and its link are two different
        decisions, and a wrong word and a wrong link are two different mistakes.
      </Notice>
    </>
  );
}

// ── The editor: draft, save, publish, preview ────────────────────────────

function Editor({ email, onSignOut }) {
  const site = useSite();
  const platforms = usePlatforms();
  const [tab, setTab] = useState('content');
  const [status, setStatus] = useState('');
  const siteFileRef = useRef(null);
  const linksFileRef = useRef(null);

  // A Save, a Revert or an import replaces a store; the form follows it. The
  // draft is a clone, because the store's document is shared with the page and
  // must never be edited in place.
  const [contentDraft, setContentDraft] = useState(() => structuredClone(site));
  const [linksDraft, setLinksDraft] = useState(() => platforms.map((p) => ({ ...p })));

  useEffect(() => {
    setContentDraft(structuredClone(site));
  }, [site]);

  useEffect(() => {
    setLinksDraft(platforms.map((platform) => ({ ...platform })));
  }, [platforms]);

  const contentDirty = useMemo(
    () => JSON.stringify(contentDraft) !== JSON.stringify(site),
    [contentDraft, site],
  );
  const linksDirty = useMemo(
    () => JSON.stringify(linksDraft) !== JSON.stringify(platforms),
    [linksDraft, platforms],
  );
  const dirty = tab === 'content' ? contentDirty : linksDirty;

  /** Download text as a file. Both exports work the same way. */
  const download = (name, text, message) => {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(message);
  };

  /** Returns true when the draft was accepted and stored. */
  const onSave = () => {
    if (tab === 'links') {
      const problems = linksDraft
        .map((platform) => (platform.status === 'live' ? urlProblem(platform.url) : ''))
        .filter(Boolean);
      if (problems.length > 0) {
        setStatus(problems[0]);
        setTab('links');
        return false;
      }
      const stored = savePlatforms(linksDraft);
      setStatus(
        stored
          ? 'Saved in this browser. Export the file below to publish it for everyone.'
          : 'Saved for this session, but this browser refused to store it — private mode blocks it. Export the file before you close the tab.',
      );
      return true;
    }

    const stored = saveSite(contentDraft);
    setStatus(
      stored
        ? 'Saved in this browser. Open the site to check it, then export the file below to publish it for everyone.'
        : 'Saved for this session, but this browser refused to store it — private mode blocks it. Export the file before you close the tab.',
    );
    return true;
  };

  const onReset = () => {
    if (tab === 'links') {
      resetPlatforms();
      setStatus('Back to the published links.');
      return;
    }
    resetSite();
    setStatus('Back to the published content.');
  };

  const onExport = () => {
    if (tab === 'links') {
      download('app-links.json', linksFileText(linksDraft), 'Exported app-links.json — commit it to public/ to publish these links.');
      return;
    }
    download('site-content.json', siteFileText(contentDraft), 'Exported site-content.json — commit it to public/ to publish this content.');
  };

  const onImport = async (event, kind) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    event.target.value = '';

    if (kind === 'links') {
      const result = parseLinksFile(text);
      if (!result.ok) {
        setStatus(result.error);
        return;
      }
      savePlatforms(result.platforms);
      setStatus('Imported. Check the links, then export to publish.');
      return;
    }

    const result = parseSiteFile(text);
    if (!result.ok) {
      setStatus(result.error);
      return;
    }
    saveSite(result.content);
    setStatus('Imported. Check the page, then export to publish.');
  };

  /**
   * See the draft on the real page.
   *
   * Save first, then open: the page reads the draft out of this browser at
   * load, so a tab opened before the save would show the previous version and
   * look like the edit had been lost.
   */
  const onPreview = () => {
    if (!onSave()) return;
    window.open(new URL('#top', document.baseURI).href, '_blank', 'noopener');
    setStatus('Saved in this browser and opened in a new tab. Reload that tab after each save.');
  };

  const origin = tab === 'links' ? platformsOrigin() : siteOrigin();

  return (
    <>
      <div className="admin__bar">
        <p className="text-sm text-dim">
          Signed in as <strong className="text-mist">{email}</strong>
          {origin === 'local' ? ' · unpublished edits on this device' : ' · published copy'}
        </p>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onSignOut}>
          Sign out
        </button>
      </div>

      <div className="admin__tabs" role="tablist" aria-label="What to edit">
        <button
          type="button"
          role="tab"
          className="admin__tab"
          aria-selected={tab === 'content'}
          onClick={() => {
            setTab('content');
            setStatus('');
          }}
        >
          Content
        </button>
        <button
          type="button"
          role="tab"
          className="admin__tab"
          aria-selected={tab === 'links'}
          onClick={() => {
            setTab('links');
            setStatus('');
          }}
        >
          App links
        </button>
      </div>

      <p className="admin__group-note mt-4">
        Every word and picture on the site, in the order a visitor reads them. A field left blank
        keeps the built-in text.
      </p>

      {tab === 'content' ? (
        <SiteEditor draft={contentDraft} setDraft={setContentDraft} />
      ) : (
        <LinksEditor draft={linksDraft} setDraft={setLinksDraft} />
      )}

      <div className="admin__sticky">
        <button type="button" className="btn btn--primary btn--sm" onClick={onSave} disabled={!dirty}>
          Save changes
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onPreview}>
          Preview on the site
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
          Revert to published
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onExport}>
          Export {tab === 'links' ? 'app-links.json' : 'site-content.json'}
        </button>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => (tab === 'links' ? linksFileRef.current : siteFileRef.current)?.click()}
        >
          Import…
        </button>
        <span className="admin__status">{status}</span>
        <input
          ref={siteFileRef}
          type="file"
          accept="application/json,.json"
          className="hidden-input"
          onChange={(event) => onImport(event, 'content')}
        />
        <input
          ref={linksFileRef}
          type="file"
          accept="application/json,.json"
          className="hidden-input"
          onChange={(event) => onImport(event, 'links')}
        />
      </div>

      <Notice tone="warn">
        <strong>Publishing.</strong> Edits are stored in this browser only, so you can look at them
        on the real page before anyone else sees them. To make them the site's, export the file
        above and commit it — <code>public/site-content.json</code> for the words and pictures,{' '}
        <code>public/app-links.json</code> for the store links. The site reads both at startup and
        the next deploy carries them. Signing in does not change this: a session token cannot push
        to the repository.
      </Notice>
    </>
  );
}

// ── Sign in ──────────────────────────────────────────────────────────────

function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await signIn({ email, password });
    setBusy(false);
    // Cleared whether it worked or not: a refusal is often the point at which
    // someone walks away from the screen. The address stays, because a mistyped
    // one is worth seeing and correcting.
    setPassword('');
    if (!result.ok) {
      setError(adminErrorMessage(result));
      return;
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      <h2 className="text-xl">Sign in</h2>
      <p className="mt-2 text-sm text-dim">
        The admin credentials for this deployment. They are set in the environment, not here —
        there is no sign-up on this screen and no password is stored in this browser.
      </p>

      <div className="mt-6 flex flex-col gap-4">
        <Field label="Email">
          <input
            className="input"
            type="email"
            autoComplete="username"
            autoFocus
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>

        <Field label="Password" hint="Checked by this site’s own endpoint, never in the browser.">
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
      </div>

      {error ? <Notice tone="warn">{error}</Notice> : null}

      <div className="admin__actions mt-6">
        <button type="submit" className="btn btn--primary btn--sm" disabled={busy}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </div>
    </form>
  );
}

// ── The page ─────────────────────────────────────────────────────────────

export default function Admin() {
  const { phase, configured, missing, unusable, signedIn, email } = useAdmin();

  // Re-asked on every visit rather than trusted from storage: the answer
  // depends on the live environment, and an expiry or a rotated secret is the
  // server's to decide, not this tab's.
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <main className="wrap py-14 md:py-20">
      <div className="max-w-4xl">
        <span className="eyebrow">Admin</span>
        <h1 className="mt-4 text-[clamp(2rem,5vw,3rem)]">The website</h1>
        <p className="lead mt-4">
          Every word, every picture and every store link on this site. Change something here and
          the page follows it — the header, the footer and the privacy policy included.
        </p>

        {phase === 'loading' ? <Notice>Checking this deployment’s admin endpoint…</Notice> : null}

        {phase === 'unreachable' ? (
          <Notice tone="warn">
            <strong>No admin endpoint.</strong> {adminErrorMessage({ error: 'unreachable' })} Deploy
            the repository rather than the contents of <code>dist/</code> — the endpoint is a Vercel
            function in <code>api/</code>, and without it there is nothing to sign in to.
          </Notice>
        ) : null}

        {phase === 'ready' && !configured ? (
          <Notice tone="warn">
            <strong>Not configured yet.</strong>{' '}
            {adminErrorMessage({ error: 'not_configured', missing, unusable })}
          </Notice>
        ) : null}

        {phase === 'ready' && configured && !signedIn ? (
          <div className="mt-10">
            <SignIn />
          </div>
        ) : null}

        {signedIn ? (
          <div className="mt-10">
            <Editor email={email || 'admin'} onSignOut={signOut} />
          </div>
        ) : null}

        <Notice>
          <strong>What this is.</strong> A real sign-in. The password is checked by this
          deployment’s own function against a salted scrypt hash in the environment, and the browser
          is given nothing but a short-lived signed token, kept in this tab. The hash and the
          signing secret are never compiled into the site’s JavaScript — anything a browser can read
          is public, which is exactly why the check moved off it.
        </Notice>

        <Notice tone="warn">
          <strong>What it does not do.</strong> It does not let a signed-in admin change the live
          site from here: the site's words come from the committed{' '}
          <code>public/site-content.json</code> and its links from{' '}
          <code>public/app-links.json</code>. One more step — a public <code>GET</code> and an
          authenticated <code>PUT</code> that commits the file — would make Save publish, and that
          is a change to this repository and a redeploy.
        </Notice>

        <Notice>
          <strong>What stays in the code.</strong> The page's structure: which sections exist, in
          what order, which half of the screen their text sits in, and how the phones are arranged.
          A published file that could add, remove or reorder whole sections could make the page
          describe a product that does not exist, and nothing here would catch it. Words, pictures
          and links are yours; the shape of the page is not.
        </Notice>
      </div>
    </main>
  );
}
