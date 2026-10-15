import DownloadMenu from './DownloadMenu.jsx';
import { useSite } from '../data/site.js';

/**
 * Section 9 — closing call to action. Left-aligned with the button opposite it.
 *
 * One button, like the hero: the same Download menu, so the last thing on the
 * page asks the same question as the first and answers it the same way.
 */
export default function FinalCta() {
  const site = useSite();

  return (
    <section className="border-t border-edge">
      <div className="wrap py-16 md:py-24">
        <div
          className="reveal glow relative overflow-hidden rounded-[28px] border border-edge-teal px-7 py-12 md:px-14 md:py-16"
          data-reveal
        >
          <div className="relative flex flex-col items-start gap-8 md:flex-row md:items-end md:justify-between md:gap-12">
            <h2 className="max-w-2xl text-[clamp(1.85rem,4.6vw,3rem)] font-extrabold">
              {site.closing.title}
            </h2>

            <div className="flex shrink-0 flex-wrap gap-3">
              <DownloadMenu label={site.closing.cta} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
