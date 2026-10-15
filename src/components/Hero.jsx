import Cluster from './Cluster.jsx';
import DownloadMenu from './DownloadMenu.jsx';
import { HERO_LAYOUT } from '../data/layout.js';
import { useSite } from '../data/site.js';

/**
 * The opening screen.
 *
 * ONE BUTTON, and it is the whole answer: the hero used to carry a store button,
 * a second button to the section listing all three apps, and a sentence about
 * which of them was available — three ways of saying where ClearView is. The
 * button opens the three, and each row inside says whether it is out yet.
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
            <DownloadMenu />
          </div>
        </div>

        <div className="reveal" data-reveal style={{ '--reveal-delay': '140ms' }}>
          <Cluster items={HERO_LAYOUT} priority />
        </div>
      </div>
    </section>
  );
}
