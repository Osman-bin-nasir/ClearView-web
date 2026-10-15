import { brandLogo, useSite } from '../data/site.js';
import DownloadMenu from './DownloadMenu.jsx';

/**
 * Sticky header: wordmark on the left, the site's few destinations in the
 * middle, one download button on the right.
 *
 * The nav labels, the brand name and the button's word all come from the content
 * store, so the admin edits them like any other copy. The button itself comes
 * from the links store, so when Android's listing moves — or iOS goes live — the
 * menu follows without a code change.
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

        <nav className="hidden items-center gap-6 text-sm text-dim sm:flex" aria-label="Sections">
          {site.header.nav.map((item) => (
            <a key={`${item.label}-${item.href}`} className="hover:text-teal" href={item.href}>
              {item.label}
            </a>
          ))}
        </nav>

        <DownloadMenu small variant="ghost" label={site.header.cta} align="right" />
      </div>
    </header>
  );
}
