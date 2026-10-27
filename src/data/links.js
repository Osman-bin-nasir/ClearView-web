/**
 * ClearView is one organisation with three apps, and this is where each one is
 * downloaded from.
 *
 * Three layers, in order of precedence:
 *
 *   1. `DEFAULT_PLATFORMS` below — the values compiled into the bundle. They are
 *      the fallback, and the reason the site renders correctly with no network
 *      and no published file at all.
 *   2. `app-links.json` at the site root — the PUBLISHED values, written by the
 *      admin screen's Publish (which commits them to the repository on the
 *      deployment) and read once at startup.
 *   3. `localStorage` — what the admin is editing right now, on their own
 *      machine, before they publish anything.
 *
 * The store lives here rather than in a component so the header, the hero, the
 * footer and the admin form all read the same list and cannot drift apart.
 *
 * The iOS entry carries a PLACEHOLDER url on purpose: it is not live, so a
 * plausible-looking link would be a lie the visitor only discovers after
 * clicking. It is marked `soon`, which is what the UI keys on to show
 * "Coming soon" instead of a button.
 */

import { useSyncExternalStore } from 'react';

/** Where the published file lives, relative to the document (see vite base). */
const PUBLISHED_FILE = 'app-links.json';

/** Key for the admin's unpublished edits, on this device only. */
const STORAGE_KEY = 'clearview.app-links.v1';

/**
 * The three apps.
 *
 * `id` is the identity the published file and the local edits are merged on, so
 * an entry added or reordered by hand cannot silently move a URL onto the wrong
 * app.
 */
export const DEFAULT_PLATFORMS = Object.freeze([
  {
    id: 'android',
    name: 'ClearView for Android',
    short: 'Android',
    device: 'Phone & tablet',
    store: 'Google Play',
    status: 'live',
    url: 'https://play.google.com/store/apps/details?id=com.muddassir.clearview',
    note: 'Protection, Browser, Media, GoodPost, Productivity and Quran — the whole app, with Android’s device-level blocking.',
  },
  {
    id: 'ios',
    name: 'ClearView for iOS',
    short: 'iOS',
    device: 'iPhone & iPad',
    store: 'App Store',
    // PLACEHOLDER — the app is not on the App Store yet.
    status: 'soon',
    url: 'https://apps.apple.com/us/app/clearview/id0000000000',
    note: 'The same app built natively in SwiftUI for iOS 18 and later. In development — no store link exists yet.',
  },
  {
    id: 'chrome',
    name: 'ClearView for Chrome',
    short: 'Chrome',
    device: 'Desktop browser',
    store: 'Chrome Web Store',
    status: 'live',
    url: 'https://chromewebstore.google.com/detail/clearview-%E2%80%94-content-prote/iddgbmbbcncfgdbdfckjinfkgnbejamo?hl=en-GB&utm_source=ext_sidebar',
    note: 'The Chrome extension: explicit sites and searches, YouTube ads and Shorts, blocked channels and Brain Bot filtering.',
  },
]);

const clone = (list) => list.map((platform) => ({ ...platform }));

/**
 * The list out of a published file.
 *
 * The file carries `{ version, updatedAt, links: [...] }`, and a hand-written or
 * exported-elsewhere copy may be a bare array. Both are accepted — and this is
 * the step that is easy to get wrong: handing the whole OBJECT to `merge` fails
 * its `Array.isArray` check and the published links are silently ignored, which
 * looks exactly like the file not being read at all.
 */
function linksFrom(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.links)) return parsed.links;
  return null;
}

/**
 * Merge one list over the defaults.
 *
 * Only `url`, `status` and `note` are taken from the incoming list: `id`, `name`,
 * `short`, `device` and `store` are the page's own labels, and a file that could
 * rename a product from the outside would be a way to make the site lie. Returns
 * null for anything that is not a list, so a malformed file is ignored rather
 * than half-applied.
 */
function merge(list) {
  if (!Array.isArray(list)) return null;
  return DEFAULT_PLATFORMS.map((base) => {
    const found = list.find((entry) => entry && entry.id === base.id);
    if (!found) return { ...base };
    const url = typeof found.url === 'string' ? found.url.trim() : '';
    const note = typeof found.note === 'string' ? found.note.trim() : '';
    return {
      ...base,
      url: url === '' ? base.url : url,
      status: found.status === 'live' || found.status === 'soon' ? found.status : base.status,
      note: note === '' ? base.note : note,
    };
  });
}

// ── The store ────────────────────────────────────────────────────────────

/** What the site shows now. Replaced, never mutated, so React can compare it. */
let platforms = clone(DEFAULT_PLATFORMS);
/** What "Reset" goes back to: the published file, else the compiled defaults. */
let baseline = clone(DEFAULT_PLATFORMS);
let origin = 'defaults'; // defaults | published | local

const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPlatforms() {
  return platforms;
}

export function platformsOrigin() {
  return origin;
}

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return merge(JSON.parse(raw));
  } catch {
    // Storage can be disabled, full, or hold something else's data. A broken
    // override must never take the published links down with it.
    return null;
  }
}

function writeStored(list) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the published file, then any local edit over it. Called once, at boot.
 *
 * A missing or broken file is not an error: the compiled defaults are already in
 * place and are exactly what a fresh checkout should show.
 */
export async function loadPlatforms() {
  try {
    const response = await fetch(new URL(PUBLISHED_FILE, document.baseURI), { cache: 'no-cache' });
    if (response.ok) {
      const published = merge(linksFrom(await response.json()));
      if (published) {
        baseline = published;
        platforms = clone(published);
        origin = 'published';
      }
    }
  } catch {
    // Offline, or opened straight off the filesystem. Defaults stand.
  }

  const stored = readStored();
  if (stored) {
    platforms = stored;
    origin = 'local';
  }
  emit();
  return platforms;
}

/** Apply the admin's edit. Returns false when the browser refused to store it. */
export function savePlatforms(next) {
  const merged = merge(next) ?? clone(baseline);
  platforms = merged;
  origin = 'local';
  const stored = writeStored(merged);
  emit();
  return stored;
}

/** Drop the local edit and go back to the published (or compiled) links. */
export function resetPlatforms() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
  platforms = clone(baseline);
  origin = 'published';
  emit();
  return platforms;
}

/**
 * The file the admin publishes.
 *
 * `version` and `updatedAt` are for whoever reads it later; the merge ignores
 * them. Pretty-printed, because this file is meant to be reviewed in a diff.
 */
export function linksFileText(list = platforms) {
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    links: list.map(({ id, name, store, status, url, note }) => ({ id, name, store, status, url, note })),
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}



/** React binding: re-renders whatever reads the links when they change. */
export function usePlatforms() {
  return useSyncExternalStore(subscribe, getPlatforms, getPlatforms);
}
