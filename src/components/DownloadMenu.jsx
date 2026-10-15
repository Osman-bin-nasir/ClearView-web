import { useEffect, useId, useRef, useState } from 'react';
import { usePlatforms } from '../data/links.js';
import { useSite } from '../data/site.js';
import { AppleIcon, ChromeIcon, PlayIcon } from './icons.jsx';

/**
 * The one download button.
 *
 * The site used to make a visitor choose: a button for the one live store, a
 * second button to a section that lists all three, and a sentence explaining
 * that two of them were still coming. That is three answers to one question.
 * This is one button — **Download** — that opens the three apps, each with its
 * own store, and says plainly which of them is not out yet.
 *
 * A platform that is not live renders as a row with no link at all, exactly as
 * its card does: a plausible-looking store URL that 404s reads as a broken
 * product rather than an unreleased one.
 *
 * @param {{ small?: boolean, variant?: 'primary'|'ghost', label?: string, align?: 'left'|'right' }} props
 */
export default function DownloadMenu({ small = false, variant = 'primary', label, align = 'left' }) {
  const platforms = usePlatforms();
  const site = useSite();
  const [open, setOpen] = useState(false);
  const wrapper = useRef(null);
  const menuId = useId();

  const buttonLabel = label ?? site.hero.cta;

  // Escape closes it, and a click anywhere else does too. Both are wired only
  // while it is open, so a closed menu costs nothing.
  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        wrapper.current?.querySelector('button')?.focus();
      }
    };
    const onPointerDown = (event) => {
      if (!wrapper.current?.contains(event.target)) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const buttonClass = ['btn', `btn--${variant}`, small ? 'btn--sm' : '', 'dl__button']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={`dl dl--${align}`} ref={wrapper}>
      <button
        type="button"
        className={buttonClass}
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="true"
        onClick={() => setOpen((current) => !current)}
      >
        <DownloadIcon />
        {buttonLabel}
        <span className={`dl__caret${open ? ' is-open' : ''}`} aria-hidden="true">
          ▾
        </span>
      </button>

      {open && (
        <div className="dl__menu" id={menuId}>
          <p className="dl__title">Choose where you are</p>
          {platforms.map((platform) => (
            <PlatformRow
              key={platform.id}
              platform={platform}
              card={site.platforms.cards[platform.id] ?? platform}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const ICONS = { android: PlayIcon, ios: AppleIcon, chrome: ChromeIcon };

function PlatformRow({ platform, card }) {
  const Icon = ICONS[platform.id] ?? PlayIcon;
  const live = platform.status === 'live';

  const body = (
    <>
      <span className="dl__mark" aria-hidden="true">
        <Icon size={18} />
      </span>
      <span className="dl__text">
        <span className="dl__name">{card.name}</span>
        <span className="dl__meta">
          {card.device} · {live ? card.store : 'Coming soon'}
        </span>
      </span>
      {live && <span className="dl__go" aria-hidden="true">↗</span>}
    </>
  );

  if (!live) {
    return (
      <span className="dl__row dl__row--wait" aria-disabled="true">
        {body}
      </span>
    );
  }

  return (
    <a className="dl__row" href={platform.url} target="_blank" rel="noopener noreferrer">
      {body}
    </a>
  );
}

/** A download mark, drawn rather than borrowed, like every other icon here. */
function DownloadIcon({ size = 18 }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5" />
      <path d="M4 18.5h16" />
    </svg>
  );
}
