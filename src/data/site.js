/**
 * The site's content: every word and every picture the page shows.
 *
 * THIS IS THE SINGLE SOURCE OF TRUTH. `DEFAULT_SITE` below compiles into the
 * bundle and is exactly what a fresh checkout renders, and it is what the admin
 * screen edits and publishes. Components are layout only: they read from here,
 * so changing a headline is a change to a value, not to a component.
 *
 * Three layers, in order of precedence — the same three `links.js` uses, for the
 * same reason:
 *
 *   1. `DEFAULT_SITE` — the compiled defaults, correct with no network and no
 *      published file at all.
 *   2. `site-content.json` at the site root — the PUBLISHED document, written by
 *      the admin screen's Publish (which commits it to the repository on the
 *      deployment) and read once at startup.
 *   3. `localStorage` — the admin's unpublished draft, on their own machine.
 *
 * WHAT IS NOT IN HERE, on purpose:
 *
 *   · The store links (`url`, `status`) — those live in `links.js`, because a
 *     wrong link and a wrong sentence are different mistakes with different
 *     consequences, and the one that sends a visitor to a 404 has its own rules.
 *   · The page's STRUCTURE — which sections exist, in what order, and how many
 *     phones sit in each cluster. Text and images are the admin's; a document
 *     that could add, remove or reorder whole sections could make the page
 *     describe a product that does not exist, and no screen in this project
 *     reviews a diff for that.
 */

import { useSyncExternalStore } from 'react';

/** Where the published document lives, relative to the document (see vite base). */
const PUBLISHED_FILE = 'site-content.json';

/** Key for the admin's unpublished draft, on this device only. */
const STORAGE_KEY = 'clearview.site-content.v1';

/** Resolve a path under /images against the HTML document, not the JS bundle. */
const image = (file) => new URL(`images/${file}`, document.baseURI).href;

/** Resolve a file that sits at the site root rather than under /images. */
const asset = (file) => new URL(file, document.baseURI).href;

/**
 * Every screenshot the page can show, keyed by a readable slug.
 *
 * The keys are the page's own vocabulary: a section's phone cluster names the
 * screens it wants, and the gallery lists them in app order. `file` is what the
 * admin edits — drop a new image into `public/images/` and point the key at it,
 * and every place that key appears follows. `w`/`h` are the real pixel
 * dimensions, so the browser reserves the right space before a lazy image
 * arrives and the page does not jump.
 */
const SCREENS = {
  protection: {
    file: 'protection.jpeg',
    w: 501,
    h: 1000,
    title: 'Protection',
    alt: 'ClearView Protection screen showing Protection active on Chrome and Google, Brain Rot Protection, the Shorts blocker and blocked channel totals',
  },
  strictMode: {
    file: 'protection-strict-mode.jpeg',
    w: 505,
    h: 1000,
    title: 'Strict Mode',
    alt: 'Protection settings listing Strict Mode, blocked keywords and websites, the shared blocklist with pending requests and an activity log',
  },
  mediaFeed: {
    file: 'media-feed.jpeg',
    w: 509,
    h: 1000,
    title: 'Media feed',
    alt: 'ClearView media feed listing saved videos from followed channels with durations and view counts',
  },
  mediaChannels: {
    file: 'media-feed-channels.jpeg',
    w: 514,
    h: 1000,
    title: 'Channels',
    alt: 'Media tab showing followed channels as handles with the videos they published below',
  },
  mediaPlaylists: {
    file: 'media-playlists.jpeg',
    w: 508,
    h: 1000,
    title: 'Playlists',
    alt: 'Playlists screen with an imported YouTube playlist of 66 videos and custom playlists below it',
  },
  mediaFav: {
    file: 'media-fav-playlist.jpeg',
    w: 511,
    h: 1000,
    title: 'Favourite playlist',
    alt: 'A saved playlist of 17 items, each labelled by how it was added: RSS, URL or from device, with file sizes',
  },
  mediaNowPlaying: {
    file: 'media-now-playing.jpeg',
    w: 509,
    h: 1000,
    title: 'Now Playing',
    alt: 'Now Playing screen with artwork, playback controls, speed setting and a download timestamp',
  },
  goodpostChannels: {
    file: 'goodpost-channels.jpeg',
    w: 505,
    h: 1000,
    title: 'Channels',
    alt: 'GoodPost channels screen with trending channels, a following list and follow buttons',
  },
  goodpostChannel: {
    file: 'goodpost-channel.jpeg',
    w: 501,
    h: 1000,
    title: 'Channel',
    alt: 'A GoodPost channel showing dated posts in order, with no likes, comments or follower counts',
  },
  todo: {
    file: 'todo.jpeg',
    w: 510,
    h: 1000,
    title: 'Todo',
    alt: 'Todo screen listing today, upcoming and completed tasks, including a range-based prayer task with several alarm times',
  },
  todoAnalytics: {
    file: 'todo-analytics.jpeg',
    w: 507,
    h: 1000,
    title: 'Analytics',
    alt: 'Todo analytics with a yearly heat map, total active days and longest streak, plus a monthly calendar marked done, missed and scheduled',
  },
  tools: {
    file: 'tools.jpeg',
    w: 505,
    h: 1000,
    title: 'More / tools',
    alt: 'More screen splitting Tools and Protection, listing the to-do list, Set Phone Limit, the Dhikr Counter and Protection settings',
  },
  dhikr: {
    file: 'dhikr-counter.jpeg',
    w: 494,
    h: 1000,
    title: 'Dhikr counter',
    alt: 'Dhikr counter mid-count, showing Astaghfirullah with 10 of a 100 target reached',
  },
  quranReminder: {
    file: 'quran-reminder.jpeg',
    w: 502,
    h: 1000,
    title: 'Quran reminder',
    alt: 'Quran reminder showing a verse from Surah Al-Burooj with its ayah position, the Hijri date and copy options',
  },
  quranSurahs: {
    file: 'quran-surahs.jpeg',
    w: 495,
    h: 1000,
    title: 'Surah list',
    alt: 'Quran surah list with search and bookmarks tabs, showing each surah number, Arabic name, English meaning and translation',
  },
};

/** Turn the table above into the list document the store carries. */
const screenList = (order) => order.map((key) => ({ key, ...SCREENS[key] }));

/** Screenshot gallery — every screen, in app order. */
const GALLERY_ORDER = [
  'protection',
  'strictMode',
  'mediaFeed',
  'mediaChannels',
  'mediaPlaylists',
  'mediaFav',
  'mediaNowPlaying',
  'goodpostChannels',
  'goodpostChannel',
  'todo',
  'todoAnalytics',
  'tools',
  'dhikr',
  'quranReminder',
  'quranSurahs',
];

/**
 * Every word on the page.
 *
 * The nested shape is the page's own: an eyebrow, a title, a lead and a set of
 * points per section. `sections[].id` and `sections[].side` are structural and
 * are never taken from a published file — see the note at the top of this file.
 */
export const DEFAULT_SITE = Object.freeze({
  brand: {
    name: 'ClearView',
    logo: 'logo.png',
  },

  header: {
    /*
     * The header's few destinations. `href` is a hash target or route.
     *
     * There is no header BUTTON to label: the header is the wordmark and these
     * links, and the download button belongs to the hero, where a visitor is
     * actually looking for it.
     */
    nav: [
      { label: 'Platforms', href: '#platforms' },
      { label: 'Protection', href: '#protection' },
      { label: 'Screens', href: '#showcase' },
      { label: 'Privacy', href: '#/privacy' },
    ],
  },

  hero: {
    eyebrow: 'Android · iOS · Chrome',
    title: 'Watch what you want, not what they want.',
    lead: 'ClearView is one organisation with three apps: safer browsing, focused media, productivity and everyday tools on Android and on iPhone and iPad — and the same protection running in Chrome, right where the browsing happens.',
    /* The one button in the hero, and what it says. It scrolls to the cards. */
    cta: 'Download',
  },

  platforms: {
    eyebrow: 'One organisation, three apps',
    title: 'The same protection, wherever you browse.',
    lead: 'ClearView ships on Android, on iPhone and iPad, and in Chrome. Each is built for the device it runs on — and all three share the same rule set, the same matcher and the same community blocklist.',
    /* The three cards, by id. The url and status beside each one are the
       admin's, and live in links.js. */
    cards: {
      android: {
        name: 'ClearView for Android',
        short: 'Android',
        device: 'Phone & tablet',
        store: 'Google Play',
        note: 'Protection, Media, GoodPost, Productivity and Quran — the whole app, with Android’s device-level blocking.',
      },
      ios: {
        name: 'ClearView for iOS',
        short: 'iOS',
        device: 'iPhone & iPad',
        store: 'App Store',
        note: 'The same app built natively in SwiftUI for iOS 18 and later. In development — no store link exists yet.',
      },
      chrome: {
        name: 'ClearView for Chrome',
        short: 'Chrome',
        device: 'Desktop browser',
        store: 'Chrome Web Store',
        note: 'The browser half: explicit sites and searches, YouTube ads and Shorts, blocked channels and Brain Bot filtering. In review.',
      },
    },
  },

  /* The product areas, in page order. `points` is a list of lines; a section
     with `pointsStyle: 'split'` shows each line as `Key — value`, so the admin
     writes "Tasks — Normal, range-based …" and the page splits it on the dash. */
  sections: [
    {
      eyebrow: 'Protection',
      title: 'Guard rails you set once.',
      lead: 'ClearView watches Chrome and Google Search and stops the pages and searches you told it to stop — then stays quiet.',
      points: [
        'Blocks explicit websites and adult search terms.',
        'Strict Mode matches patterns, so innocent words like “woman” or “girl” on their own are fine. “woman beach” is not.',
        'Pauses YouTube Shorts in Chrome and in the YouTube app.',
        'Brain Rot Protection: tap “Not interested” and that channel is blocked with an explanation overlay instead of vanishing silently.',
        'Share a blocked channel to the shared blocklist. Once an admin approves it, it is blocked for every ClearView user.',
        'DNS-level blocking, plus a password lock so the settings stay yours.',
      ],
      note: 'Protection applies to websites you visit in Chrome and to Google Search.',
    },
    {
      eyebrow: 'Media',
      title: 'Your feeds, without the algorithm.',
      lead: 'Add the YouTube, Instagram and X accounts you actually follow and ClearView turns them into one feed you control.',
      points: [
        'Add handles and get their posts as an RSS feed.',
        'Import a YouTube playlist, start your own, or add a video by URL or from your device.',
        'Download audio and keep it on the phone.',
        'Watch inside the app and resume exactly where you stopped.',
      ],
    },
    {
      eyebrow: 'GoodPost',
      title: 'A quiet place for useful posts.',
      lead: 'GoodPost works like a WhatsApp channel. Creators post, readers read — no audience to perform for.',
      points: [
        'No sign-up and no login to read. Only creators create an account.',
        'Follow the channels you care about and get their updates as they land.',
        'No likes, no comments, no engagement-bait feed.',
      ],
    },
    {
      eyebrow: 'Productivity',
      title: 'Plan the day, then hold the line.',
      lead: 'A to-do list that understands time, a limit that locks the phone when the timer ends, and a counter that stays out of the way.',
      points: [
        'Tasks — Normal, range-based, attempted and alarm-based. The alarm ones ring until you deal with them.',
        'Progress — A heat map, calendar, bar graph, score and progress view of what you actually finished.',
        'Phone limit — Set Phone Limit locks the phone when the countdown expires — it runs in the background — and you unlock it with your password.',
        'Dhikr counter — Count your dhikr with a target and a clean, large-tap surface.',
      ],
    },
    {
      eyebrow: 'Quran',
      title: 'Reading that works offline.',
      lead: 'English and Arabic together, search and bookmarks, and a reminder that shows up when you want it.',
      points: [
        'Reading works offline. Word-by-word audio needs an internet connection.',
        'Search any surah or jump back to a bookmark.',
        'Hijri date alongside the Gregorian one, with a Quran widget for the home screen.',
      ],
    },
  ],

  gallery: {
    eyebrow: 'Screens',
    title: 'Every screen in the app.',
    hint: 'swipe or scroll the strip · tap one to enlarge',
    screens: screenList(GALLERY_ORDER),
  },

  closing: {
    title: 'Use your digital world intentionally.',
    cta: 'Download',
  },

  footer: {
    tagline: 'Built for phones, for the browser, and for the person holding either.',
    appsTitle: 'Apps',
    siteTitle: 'Site',
    siteLinks: [
      { label: 'Privacy policy', href: '#/privacy' },
      { label: 'Admin', href: '#/admin' },
    ],
    /* Required disclosure, unedited. */
    disclosure:
      'Accessibility Service is optional and used only for blocking features. It is never used for audio recording.',
    copyright: '© {year} ClearView · Android · iOS · Chrome',
  },

  privacy: {
    eyebrow: 'Legal',
    title: 'Privacy policy',
    updatedLabel: 'Last updated {date}',
    updated: '15 October 2026',
    intro: 'ClearView is an organisation that ships three apps — Android, iOS and a Chrome extension — over one shared backend. This page says what each of them does with your data, in plain terms, and the short list of things that ever leave your device.',
    note: 'This page describes what the apps actually do. It is written to be read, not to be a substitute for legal advice.',
    /*
     * The policy's sections. Each body is plain text where a line starting
     * with "- " is a bullet, **bold** is bold, and `code` is code — enough
     * markup to keep the page readable without putting HTML in a text field.
     */
    sections: [
      {
        title: 'In short',
        body: [
          '- The pages you visit and the searches you make are checked **on your own device**. They are never uploaded, never logged and never profiled.',
          '- ClearView collects **no browsing history**, and there is no advertising, no analytics and no tracking of any kind.',
          '- Nothing leaves your device unless you ask for it — a keyword or channel you submit for everyone to block, or a mistake you report. That request carries a random install id and nothing about you.',
          '- Reading GoodPost needs no account. Only creators and administrators sign in.',
        ].join('\n'),
      },
      {
        title: 'What is checked on your device',
        body: [
          '- Every address, search query and YouTube title the apps examine is matched locally, against a rules bundle the app already holds. The matching happens in the app; the rules are not uploaded and the content you were looking at is not sent anywhere.',
          '- When a page is blocked, the page that replaces it is told only a **reason code** — never the blocked address and never the term that matched — so the content you were being protected from is not reprinted on screen or left in your history.',
          '- Blocking counts belong to you and stay on your device.',
        ].join('\n'),
      },
      {
        title: 'What can leave your device',
        body: [
          'Only actions you start, and only this much:',
          '- **Asking to block something for everyone.** The keyword or channel handle you submit, the kind of request, and a random install id.',
          '- **Reporting a mistake.** The rule that blocked something it should not have, and the same install id.',
          '- **Refreshing the shared blocklist.** The install id, so the server can answer with the current rules. Your queries and the pages you visited are never part of this request.',
          '- **GoodPost.** If you read posts, the request for a channel or a post goes to the backend. If you are a creator or an administrator, the account you sign in with is stored on the backend — see the GoodPost section below.',
        ].join('\n'),
      },
      {
        title: 'The Chrome extension',
        body: [
          '- The extension asks for permission to see the address of a navigation so it can be checked and stopped, and to refuse blocked hosts and YouTube ad requests before they load. It does not read the contents of the pages you visit.',
          '- Its content script runs only on YouTube, and only to hide Shorts, remove ads, filter feed cards and add its own “Block this channel” entry.',
          '- The Protection password is a device lock, not an account. It is stored as a salted PBKDF2 hash on that device, is never synced, and is never sent anywhere.',
          '- Your blocked websites, keywords and channels are settings, so they sync with your Chrome profile if you have Chrome Sync on — exactly as your other browser settings do.',
        ].join('\n'),
      },
      {
        title: 'The Android app',
        body: [
          '- The Accessibility Service is **optional** and is used only for blocking features. It is never used for audio recording, and never used to read or transmit the content of other apps.',
          '- Device administration, uninstall protection and the phone limit are protections of the device itself and can be turned off by the person who set them up.',
          '- If you choose DNS-level blocking, the domain-name lookups that make it work leave the device to the DNS provider you selected. Turn it off and they stop.',
          '- Media sources you add (YouTube channels, Instagram and X profiles) are fetched from those services directly, under their terms and their privacy policies, not ours.',
        ].join('\n'),
      },
      {
        title: 'The iOS app',
        body: [
          '- The iOS app reads the media sources you add from those services directly. Where a service only exposes its data through a public, login-free endpoint, that is what is used — the app does not ask for your account on another platform.',
          '- Audio is extracted and played on the device itself. It is not routed through a ClearView server.',
          '- Android’s device-level blocking, overlays and phone locking are not part of the iOS build, and the app says so rather than implying protection it does not provide.',
        ].join('\n'),
      },
      {
        title: 'GoodPost',
        body: [
          '- Reading needs no account and no sign-up. You can follow channels and read posts anonymously.',
          '- Creators and administrators do have accounts, because publishing has to be attributable. Those accounts hold an email address and a password hash, and nothing more than running the service requires.',
          '- The backend keeps what the service needs to operate: the channels, posts and reactions you create, the device identity needed to serve you, and an administrative audit log. Client IP addresses in that log are stored as an irreversible hash, not as addresses.',
        ].join('\n'),
      },
      {
        title: 'Cookies and third parties',
        body: [
          '- This website sets no cookies and runs no analytics. Its fonts are served by Google Fonts, which means your browser contacts Google to fetch them — the one third party this page talks to. Self-hosting the fonts would remove even that, and is worth doing if you would rather the site made no third-party request at all.',
          '- The apps talk to the ClearView backend at `clearview-1neb.onrender.com`. Store links lead to Google Play, the App Store and the Chrome Web Store, which are governed by their own policies.',
        ].join('\n'),
      },
      {
        title: 'Children',
        body: [
          '- ClearView is intended to be used by an adult, or by a younger person with a parent or guardian — the Protection settings and their password are designed for exactly that arrangement. None of the apps asks a child for personal information, and none creates an account for one.',
        ].join('\n'),
      },
      {
        title: 'Your choices',
        body: [
          '- Remove a keyword, a blocked website or a blocked channel at any time in the app or the extension — it stops applying immediately.',
          '- Uninstalling an app removes the data it kept locally on that device. Deleting the extension does the same in Chrome.',
          '- To have something you contributed removed from the shared blocklist, or to ask what is held about an account, use the contact route below.',
        ].join('\n'),
      },
      {
        title: 'Changes and contact',
        body: [
          '- If this policy changes, the date at the top of this page changes with it. Material changes are described here rather than announced quietly.',
          '- Questions, or a data request, can be raised through the project’s issue tracker.',
        ].join('\n'),
      },
    ],
  },
});

// ── Merging a published document over the defaults ───────────────────────

const isText = (value) => typeof value === 'string';
const text = (value, fallback) => (isText(value) && value.trim() !== '' ? value : fallback);

/**
 * Take one string, one list of strings and one nested object at a time.
 *
 * Written as small explicit steps rather than a generic deep merge on purpose:
 * a published file is edited by hand and by a screen, and the failure mode worth
 * designing against is a file that half-applies — a section whose title changed
 * but whose points silently vanished. Anything unreadable falls back to the
 * compiled value, and nothing is ever left undefined.
 */
function mergeSection(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return { ...base };
  const points = Array.isArray(incoming.points)
    ? incoming.points.filter(isText).map((line) => line.trim()).filter(Boolean)
    : base.points;
  return {
    eyebrow: text(incoming.eyebrow, base.eyebrow),
    title: text(incoming.title, base.title),
    lead: text(incoming.lead, base.lead),
    points: points.length > 0 ? points : base.points,
    note: isText(incoming.note) && incoming.note.trim() !== '' ? incoming.note : base.note,
  };
}

/** A screen, from a published document. `key` and the dimensions stay compiled. */
function mergeScreen(base, incoming) {
  if (!incoming || typeof incoming !== 'object') return { ...base };
  return {
    key: base.key,
    file: text(incoming.file, base.file),
    w: Number.isFinite(incoming.w) && incoming.w > 0 ? incoming.w : base.w,
    h: Number.isFinite(incoming.h) && incoming.h > 0 ? incoming.h : base.h,
    title: text(incoming.title, base.title),
    alt: text(incoming.alt, base.alt),
  };
}

/** The whole document, defaults with a published (or draft) copy laid over it. */
export function mergeSite(incoming) {
  const base = DEFAULT_SITE;
  if (!incoming || typeof incoming !== 'object') return structuredClone(base);
  const doc = typeof incoming.content === 'object' && incoming.content ? incoming.content : incoming;

  const nav = Array.isArray(doc.header?.nav)
    ? doc.header.nav
        .filter((item) => item && isText(item.label) && isText(item.href))
        .map((item) => ({ label: item.label.trim(), href: item.href.trim() }))
    : [];
  const cards = { ...base.platforms.cards };
  for (const id of Object.keys(cards)) {
    const found = doc.platforms?.cards?.[id];
    if (!found || typeof found !== 'object') continue;
    cards[id] = {
      name: text(found.name, cards[id].name),
      short: text(found.short, cards[id].short),
      device: text(found.device, cards[id].device),
      store: text(found.store, cards[id].store),
      note: text(found.note, cards[id].note),
    };
  }

  const sections = base.sections.map((section, index) =>
    mergeSection(section, doc.sections?.[index]),
  );

  const incomingScreens = Array.isArray(doc.gallery?.screens) ? doc.gallery.screens : null;
  const screens = incomingScreens
    ? incomingScreens
        .map((screen, index) => {
          const fallback = base.gallery.screens[index] ?? base.gallery.screens[0];
          return mergeScreen({ ...fallback, key: text(screen?.key, fallback.key) }, screen);
        })
        .filter(Boolean)
    : base.gallery.screens.map((screen) => ({ ...screen }));

  const siteLinks = Array.isArray(doc.footer?.siteLinks)
    ? doc.footer.siteLinks
        .filter((item) => item && isText(item.label) && isText(item.href))
        .map((item) => ({ label: item.label.trim(), href: item.href.trim() }))
    : [];

  const privacySections = Array.isArray(doc.privacy?.sections)
    ? doc.privacy.sections
        .filter((section) => section && isText(section.title) && isText(section.body))
        .map((section) => ({ title: section.title, body: section.body }))
    : [];

  return {
    brand: {
      name: text(doc.brand?.name, base.brand.name),
      logo: text(doc.brand?.logo, base.brand.logo),
    },
    /*
     * `header.cta` no longer exists — the header has no button — so a published
     * file that still carries one is ignored rather than half-applied.
     */
    header: {
      nav: nav.length > 0 ? nav : base.header.nav.map((item) => ({ ...item })),
    },
    hero: {
      eyebrow: text(doc.hero?.eyebrow, base.hero.eyebrow),
      title: text(doc.hero?.title, base.hero.title),
      lead: text(doc.hero?.lead, base.hero.lead),
      cta: text(doc.hero?.cta, base.hero.cta),
    },
    platforms: {
      eyebrow: text(doc.platforms?.eyebrow, base.platforms.eyebrow),
      title: text(doc.platforms?.title, base.platforms.title),
      lead: text(doc.platforms?.lead, base.platforms.lead),
      cards,
    },
    sections,
    gallery: {
      eyebrow: text(doc.gallery?.eyebrow, base.gallery.eyebrow),
      title: text(doc.gallery?.title, base.gallery.title),
      hint: text(doc.gallery?.hint, base.gallery.hint),
      screens: screens.length > 0 ? screens : base.gallery.screens.map((s) => ({ ...s })),
    },
    closing: {
      title: text(doc.closing?.title, base.closing.title),
      cta: text(doc.closing?.cta, base.closing.cta),
    },
    footer: {
      tagline: text(doc.footer?.tagline, base.footer.tagline),
      appsTitle: text(doc.footer?.appsTitle, base.footer.appsTitle),
      siteTitle: text(doc.footer?.siteTitle, base.footer.siteTitle),
      siteLinks: siteLinks.length > 0 ? siteLinks : base.footer.siteLinks.map((i) => ({ ...i })),
      disclosure: text(doc.footer?.disclosure, base.footer.disclosure),
      copyright: text(doc.footer?.copyright, base.footer.copyright),
    },
    privacy: {
      eyebrow: text(doc.privacy?.eyebrow, base.privacy.eyebrow),
      title: text(doc.privacy?.title, base.privacy.title),
      updatedLabel: text(doc.privacy?.updatedLabel, base.privacy.updatedLabel),
      updated: text(doc.privacy?.updated, base.privacy.updated),
      intro: text(doc.privacy?.intro, base.privacy.intro),
      note: text(doc.privacy?.note, base.privacy.note),
      sections:
        privacySections.length > 0
          ? privacySections
          : base.privacy.sections.map((section) => ({ ...section })),
    },
  };
}

// ── The store ────────────────────────────────────────────────────────────

/** What the page shows now. Replaced, never mutated, so React can compare it. */
let site = mergeSite(null);
/** What "Revert" goes back to: the published document, else the compiled one. */
let baseline = mergeSite(null);
let origin = 'defaults'; // defaults | published | local

const listeners = new Set();
const emit = () => listeners.forEach((listener) => listener());

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSite() {
  return site;
}

export function siteOrigin() {
  return origin;
}

/** React binding. Components read the copy through this. */
export function useSite() {
  return useSyncExternalStore(subscribe, getSite, getSite);
}

function readStored() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return mergeSite(JSON.parse(raw));
  } catch {
    // Storage can be disabled, full, or hold something else's data. A broken
    // draft must never take the published page down with it.
    return null;
  }
}

function writeStored(document) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
    return true;
  } catch {
    return false;
  }
}

/**
 * Load the published document, then any local draft over it. Called once, at boot.
 *
 * A missing or broken file is not an error: the compiled defaults are already in
 * place and are exactly what a fresh checkout should render.
 */
export async function loadSite() {
  try {
    const response = await fetch(new URL(PUBLISHED_FILE, document.baseURI), { cache: 'no-cache' });
    if (response.ok) {
      // Read the body once: a second `json()` on the same response throws.
      const published = mergeSite(await response.json());
      baseline = published;
      site = mergeSite(published);
      origin = 'published';
    }
  } catch {
    // Offline, or opened straight off the filesystem. Defaults stand.
  }

  const stored = readStored();
  if (stored) {
    site = stored;
    origin = 'local';
  }
  emit();
  return site;
}

/** Apply the admin's edit. Returns false when the browser refused to store it. */
export function saveSite(document) {
  const merged = mergeSite(document);
  site = merged;
  origin = 'local';
  const stored = writeStored(merged);
  emit();
  return stored;
}

/** Drop the draft and go back to the published (or compiled) document. */
export function resetSite() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
  site = mergeSite(baseline);
  origin = 'published';
  emit();
  return site;
}

/**
 * The file the admin publishes.
 *
 * `version` and `updatedAt` are for whoever reads it later; the merge ignores
 * them. Pretty-printed, because this file is meant to be reviewed in a diff.
 */
export function siteFileText(document = site) {
  const payload = { version: 1, updatedAt: new Date().toISOString(), content: document };
  return `${JSON.stringify(payload, null, 2)}\n`;
}



// ── Reading the document from a component ────────────────────────────────

/** The brand mark, resolved against the document. */
export const brandLogo = (document) => asset(document.brand.logo);

/** One screenshot, resolved: `{ src, w, h, alt, title }` or null if it is gone. */
export function screen(document, key) {
  const found = document.gallery.screens.find((entry) => entry.key === key);
  if (!found) return null;
  return { ...found, src: image(found.file) };
}

/** A section's points, split for the `split` layout: `Key — value`. */
export function splitPoint(line) {
  const at = line.indexOf(' — ');
  if (at === -1) return { label: line, text: '' };
  return { label: line.slice(0, at), text: line.slice(at + 3) };
}

/**
 * Text with the two bits of markup the fields allow: `**bold**` and `code`.
 *
 * Returned as an array of strings and elements so React can render it without
 * `dangerouslySetInnerHTML` — a published file is a text field, and text that
 * can inject elements is not a text field.
 */
export function richText(line) {
  const parts = String(line).split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.filter(Boolean).map((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return { kind: 'strong', text: part.slice(2, -2) };
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return { kind: 'code', text: part.slice(1, -1) };
    }
    return { kind: 'text', text: part };
  });
}

/** The policy's body text, as paragraphs and bullets. */
export function policyBlocks(body) {
  return String(body)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('- ') ? { bullet: true, text: line.slice(2) } : { bullet: false, text: line }));
}
