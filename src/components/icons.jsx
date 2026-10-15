/**
 * Inline SVG icons.
 *
 * Deliberately no icon font and no emoji — just the marks the page needs, drawn
 * in currentColor so they inherit the teal accent. The brand mark itself is the
 * real app logo (public/logo.png), not a drawn stand-in.
 */

/** Google Play triangle, for the store buttons. */
export function PlayIcon({ size = 18, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M22.018 13.298l-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594zM1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087L1.337.924zm12.207 10.065l3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179l11.04 10.973zm0 2.067l-11 10.933c.298.036.612-.016.906-.183l13.324-7.54-3.23-3.21z" />
    </svg>
  );
}

/** Apple mark, for the iOS card. */
export function AppleIcon({ size = 18, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M16.365 12.79c-.02-2.06 1.68-3.05 1.756-3.1-.957-1.4-2.446-1.592-2.976-1.613-1.267-.128-2.472.746-3.114.746-.64 0-1.633-.728-2.686-.708-1.382.02-2.657.803-3.368 2.04-1.436 2.49-.366 6.176 1.03 8.198.683.99 1.497 2.1 2.566 2.06 1.03-.042 1.42-.666 2.665-.666 1.245 0 1.594.666 2.686.646 1.11-.02 1.812-1.01 2.492-2.003.784-1.15 1.107-2.263 1.126-2.32-.025-.011-2.16-.83-2.18-3.28zM14.44 6.29c.568-.688.95-1.645.846-2.596-.816.033-1.804.544-2.39 1.23-.524.607-.983 1.58-.86 2.512.91.07 1.837-.462 2.404-1.146z" />
    </svg>
  );
}

/** Chrome mark, for the extension card. */
export function ChromeIcon({ size = 18, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
    >
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="3.6" />
      <path d="M12 8.4h9.1M8.9 13.8 4.5 6.2M15.1 13.8l-4.4 7.6" />
    </svg>
  );
}

/** Chevron used by the lightbox arrows. */
export function ChevronIcon({ dir = 'right', size = 18 }) {
  const rotation = { left: 90, right: -90, up: 180, down: 0 }[dir] ?? 0;
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transform: `rotate(${rotation}deg)` }}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
