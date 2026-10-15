import Cluster from './Cluster.jsx';
import { DownloadIcon } from './icons.jsx';
import { HERO_LAYOUT } from '../data/layout.js';
import { useSite } from '../data/site.js';

/**
 * The opening screen.
 *
 * ONE BUTTON, and it is the whole answer: the hero used to carry a store button,
 * a second button to the section listing all three apps, and a sentence about
 * which of them was available — three ways of saying where ClearView is.
 *
 * The button does not open a menu of its own. It takes the visitor DOWN to the
 * three cards, which are the page's actual answer to "where do I get this": a
 * full card each, with the store, the status and the note beside it. A menu that
 * repeated those three rows in a popover was the same information twice, in the
 * smaller of the two places.
 */
export default function Hero() {
  const site = useSite();

  return (
    <section id="top" className="relative">
      <div className="wrap grid items-center gap-10 pt-14 pb-16 lg:grid-cols-[1.02fr_1fr] lg:gap-10 lg:pt-24 lg:pb-24">
        <div className="reveal" data-reveal>
          {/* The eyebrow names all three platforms: this is the organisation's
              page now, not the Android app's. */}
          <span className="eyebrow">{site.hero.eyebrow}</span>

          <h1 className="mt-5 text-[clamp(2.25rem,6.2vw,3.75rem)] font-extrabold">
            {site.hero.title}
          </h1>

          <p className="lead mt-6">{site.hero.lead}</p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a className="btn btn--primary" href="#platforms">
              <DownloadIcon />
              {site.hero.cta}
            </a>
          </div>
        </div>

        <div className="reveal" data-reveal style={{ '--reveal-delay': '140ms' }}>
          <Cluster items={HERO_LAYOUT} priority />
        </div>
      </div>
    </section>
  );
}
