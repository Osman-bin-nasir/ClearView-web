import { usePlatforms } from '../data/links.js';
import { brandLogo, useSite } from '../data/site.js';

/**
 * Section 10 — footer.
 *
 * It carries the two things that are easy to lose: a way into the privacy policy
 * and a way into the admin screen. Both are plain hash links, so neither depends
 * on the page being served by a host that can rewrite paths.
 *
 * Every word here — the tagline, the column headings, the required disclosure
 * and the copyright line — is the admin's, from the content store. `{year}` in
 * the copyright is filled in at render, because a year typed into a file is a
 * year that goes stale.
 */
export default function Footer() {
  const platforms = usePlatforms();
  const site = useSite();
  const { footer } = site;

  return (
    <footer className="border-t border-edge">
      <div className="wrap grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <div className="flex items-center gap-2.5 font-display text-base font-bold tracking-tight">
            <img
              src={brandLogo(site)}
              width="22"
              height="22"
              alt=""
              className="h-[22px] w-[22px] shrink-0 rounded-[7px] ring-1 ring-white/10"
            />
            {site.brand.name}
          </div>
          <p className="mt-3 max-w-xs text-sm text-dim">{footer.tagline}</p>
        </div>

        <nav aria-label={footer.appsTitle}>
          <h2 className="foot__title">{footer.appsTitle}</h2>
          <ul className="foot__list">
            {platforms.map((platform) => (
              <li key={platform.id}>
                <a href="#platforms">{site.platforms.cards[platform.id]?.name ?? platform.name}</a>
                <span className="foot__meta">
                  {platform.status === 'live'
                    ? site.platforms.cards[platform.id]?.store ?? platform.store
                    : 'Coming soon'}
                </span>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label={footer.siteTitle}>
          <h2 className="foot__title">{footer.siteTitle}</h2>
          <ul className="foot__list">
            {footer.siteLinks.map((link) => (
              <li key={`${link.label}-${link.href}`}>
                <a href={link.href}>{link.label}</a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="wrap flex flex-col gap-4 pb-10 md:flex-row md:items-end md:justify-between">
        {/* Required disclosure, kept in full and unedited. */}
        <p className="max-w-xl text-xs leading-relaxed text-dim">{footer.disclosure}</p>

        <p className="hair pt-6 text-xs text-dim md:border-0 md:pt-0">
          {footer.copyright.replace('{year}', String(new Date().getFullYear()))}
        </p>
      </div>
    </footer>
  );
}
