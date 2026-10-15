import { brandLogo, useSite } from '../data/site.js';

/**
 * Sticky header: the wordmark on the left, the site's few destinations on the
 * right.
 *
 * It deliberately carries NO download button. It used to: a small ghosted
 * "Download" that opened the same three apps as the hero's. Two buttons doing
 * one job, and the one in the header is the one a visitor has already scrolled
 * past — the page's own answer to "where do I get this" is the three cards under
 * `#platforms`, and the hero's button scrolls to them. Anything the header
 * needs, it can reach as a link, like the rest of the nav.
 */
export default function Header() {
  const site = useSite();

  return (
    <header className="sticky top-0 z-50 border-b border-edge bg-ink/85 backdrop-blur-md">
      <div className="wrap flex items-center justify-between gap-4 py-3">
        <a
          href="#top"
          className="flex items-center gap-2.5 font-display text-[1.05rem] font-bold tracking-tight text-mist"
        >
          {/* Decorative: the wordmark text next to it carries the name. */}
          <img
            src={brandLogo(site)}
            width="26"
            height="26"
            alt=""
            className="h-[26px] w-[26px] shrink-0 rounded-[8px] ring-1 ring-white/10"
          />
          {site.brand.name}
        </a>

        {/* Visible at every width now that the button is gone: a phone gets the
            same four links, a little smaller, rather than no navigation. */}
        <nav
          className="flex flex-wrap items-center justify-end gap-x-5 gap-y-1 text-[0.8rem] text-dim sm:gap-x-6 sm:text-sm"
          aria-label="Sections"
        >
          {site.header.nav.map((item) => (
            <a key={`${item.label}-${item.href}`} className="hover:text-teal" href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
