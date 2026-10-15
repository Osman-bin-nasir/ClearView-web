import { usePlatforms } from '../data/links.js';
import { useSite } from '../data/site.js';
import { AppleIcon, ChromeIcon, PlayIcon } from './icons.jsx';

/** One mark per store, so a card reads as a product rather than a link list. */
const ICONS = {
  android: PlayIcon,
  ios: AppleIcon,
  chrome: ChromeIcon,
};

/**
 * The download button for one platform, wherever it appears.
 *
 * One component for the cards, so there is a single place that decides what a
 * button looks like for a product that is live and for one that is not. A
 * "coming soon" platform renders a NON-link: its URL is a placeholder, and a
 * button that 404s reads as a broken product rather than an unreleased one.
 */
export function PlatformButton({ id = 'android', label, variant = 'primary', small = false, className = '' }) {
  const platforms = usePlatforms();
  const site = useSite();
  const platform = platforms.find((entry) => entry.id === id);
  if (!platform) return null;

  const card = site.platforms.cards[id] ?? platform;
  const Icon = ICONS[platform.id] ?? PlayIcon;
  const classes = ['btn', `btn--${variant}`, small ? 'btn--sm' : '', className].filter(Boolean).join(' ');

  if (platform.status !== 'live') {
    return (
      <span className={`${classes} btn--wait`} aria-disabled="true">
        {label ?? `Coming soon on ${card.short}`}
      </span>
    );
  }

  return (
    <a className={classes} href={platform.url} target="_blank" rel="noopener noreferrer">
      <Icon size={small ? 14 : 18} />
      {label ?? `Get it on ${card.store}`}
    </a>
  );
}

function PlatformCard({ platform, card }) {
  const Icon = ICONS[platform.id] ?? PlayIcon;
  const live = platform.status === 'live';

  return (
    <article className={`pcard reveal ${live ? 'pcard--live' : ''}`} data-reveal>
      <header className="pcard__head">
        <span className="pcard__mark" aria-hidden="true">
          <Icon size={20} />
        </span>
        <div>
          <h3 className="pcard__name">{card.name}</h3>
          <p className="pcard__device">
            {card.device} · {card.store}
          </p>
        </div>
      </header>

      <p className={`pill ${live ? 'pill--live' : 'pill--soon'}`} role="status">
        {live ? 'Available now' : 'Coming soon'}
      </p>

      <p className="pcard__note">{card.note}</p>

      <div className="pcard__cta">
        <PlatformButton
          id={platform.id}
          small
          variant={live ? 'ghost' : 'ghost'}
          label={live ? `Get it on ${card.store}` : 'Link publishes here when it is live'}
        />
      </div>
    </article>
  );
}

/**
 * The organisation section: what ClearView is, and the three apps it is.
 *
 * Deliberately placed above the feature sections — those describe the app's own
 * areas, and a visitor who owns a Chrome-only machine needs to find out what
 * runs where before reading five screens of phone features.
 */
export default function Platforms() {
  const platforms = usePlatforms();
  const site = useSite();

  return (
    <section id="platforms" className="border-t border-edge">
      <div className="wrap py-16 md:py-20">
        <div className="reveal max-w-2xl" data-reveal>
          <span className="eyebrow">{site.platforms.eyebrow}</span>
          <h2 className="mt-4 text-[clamp(1.65rem,3.6vw,2.45rem)]">{site.platforms.title}</h2>
          <p className="lead mt-4">{site.platforms.lead}</p>
        </div>

        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {platforms.map((platform) => (
            <PlatformCard
              key={platform.id}
              platform={platform}
              card={site.platforms.cards[platform.id] ?? platform}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
