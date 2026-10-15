/**
 * The page's structure, and nothing else.
 *
 * Which sections exist, in what order, which half of the screen each one's text
 * sits in, how its bullets are shown, and how its phones are arranged. None of
 * this is content and none of it is editable from the admin screen — see the
 * note at the top of `site.js` for why: a published file that could add, remove
 * or reorder whole sections could make the page describe a product that does not
 * exist, and no screen in this project reviews a diff for that.
 *
 * The order here is the order the copy in `site.js` is read in, position by
 * position, which is why the two lists are kept side by side in one mind: a
 * section added in one place and not the other would silently drop.
 *
 *   side     — 'left'  | 'right': which half the text sits in, alternating
 *   points   — 'rows'  | 'notes' | 'split': the bullet treatment
 *   cluster  — the phones: `key` names a screenshot, `y`/`r`/`mx` the offset,
 *              rotation and overlap of each one
 */
export const SECTION_LAYOUT = [
  {
    id: 'protection',
    side: 'left',
    pointsStyle: 'rows',
    cluster: [
      { key: 'strictMode', y: '30px', r: '-4.5deg', mx: '0' },
      { key: 'protection', y: '-14px', r: '2.5deg', mx: '-7%' },
    ],
  },
  {
    id: 'media',
    side: 'right',
    pointsStyle: 'notes',
    cluster: [
      { key: 'mediaChannels', y: '22px', r: '-4deg', mx: '0' },
      { key: 'mediaPlaylists', y: '-12px', r: '0deg', mx: '-8%' },
      { key: 'mediaFav', y: '-12px', r: '0deg', mx: '-8%' },
      { key: 'mediaNowPlaying', y: '24px', r: '4deg', mx: '-8%' },
    ],
  },
  {
    id: 'goodpost',
    side: 'left',
    tone: 'band',
    pointsStyle: 'rows',
    cluster: [
      { key: 'goodpostChannels', y: '-12px', r: '2.5deg', mx: '0' },
      { key: 'goodpostChannel', y: '28px', r: '-4deg', mx: '-8%' },
    ],
  },
  {
    id: 'productivity',
    side: 'right',
    pointsStyle: 'split',
    cluster: [
      { key: 'todo', y: '18px', r: '-4deg', mx: '0' },
      { key: 'todoAnalytics', y: '-14px', r: '0deg', mx: '-8%' },
      { key: 'tools', y: '-14px', r: '0deg', mx: '-8%' },
      { key: 'dhikr', y: '22px', r: '4deg', mx: '-8%' },
    ],
  },
  {
    id: 'quran',
    side: 'left',
    tone: 'band',
    pointsStyle: 'notes',
    cluster: [
      { key: 'quranSurahs', y: '26px', r: '-4deg', mx: '0' },
      { key: 'quranReminder', y: '-12px', r: '2.5deg', mx: '-7%' },
    ],
  },
];

/**
 * The hero's phones.
 *
 * Here rather than in the store for the same reason as the sections above: it is
 * arrangement. The screens it names are the admin's.
 */
export const HERO_LAYOUT = [
  { key: 'mediaFeed', y: '28px', r: '-5deg', mx: '0px' },
  { key: 'protection', y: '-18px', r: '0deg', mx: '-9%' },
  { key: 'todo', y: '32px', r: '5deg', mx: '-9%' },
];
