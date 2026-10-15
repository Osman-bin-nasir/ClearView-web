import { useCallback, useMemo, useRef, useState } from 'react';
import { screen, useSite } from '../data/site.js';
import Lightbox from './Lightbox.jsx';

/**
 * Section 8 — the full screenshot strip.
 *
 * A horizontal scroll-snap row (touch-friendly on phones, wheel/trackpad on
 * desktop) where every thumbnail opens the lightbox. Left/right arrow keys
 * move focus along the strip; the browser scrolls the focused item into view.
 *
 * The list, the titles and the alt text are the admin's: every screenshot in the
 * content store is shown here in order, so replacing an image or reordering the
 * strip is a change in the admin screen rather than in this file.
 */
export default function Gallery() {
  const site = useSite();
  const items = useMemo(
    () => site.gallery.screens.map((entry) => screen(site, entry.key)).filter(Boolean),
    [site],
  );
  const [index, setIndex] = useState(null); // null = lightbox closed
  const stripRef = useRef(null);

  const close = useCallback(() => setIndex(null), []);
  const prev = useCallback(
    () => setIndex((i) => (i === null ? i : (i - 1 + items.length) % items.length)),
    [items.length],
  );
  const next = useCallback(
    () => setIndex((i) => (i === null ? i : (i + 1) % items.length)),
    [items.length],
  );

  const onStripKeyDown = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const buttons = Array.from(stripRef.current?.querySelectorAll('button') ?? []);
    const current = buttons.indexOf(document.activeElement);
    if (current === -1) return;

    event.preventDefault();
    buttons[current + (event.key === 'ArrowRight' ? 1 : -1)]?.focus();
  };

  return (
    <section id="showcase" className="border-y border-edge py-16 md:py-20">
      <div className="wrap">
        <div className="reveal flex flex-col gap-3 md:flex-row md:items-end md:justify-between" data-reveal>
          <div>
            <span className="eyebrow">{site.gallery.eyebrow}</span>
            <h2 className="mt-4 text-[clamp(1.65rem,3.6vw,2.45rem)]">{site.gallery.title}</h2>
          </div>
          <p className="text-sm text-dim md:text-right">
            {items.length} screens · {site.gallery.hint}
          </p>
        </div>
      </div>

      <div
        ref={stripRef}
        className="strip mt-10"
        role="group"
        aria-label="ClearView screenshots"
        onKeyDown={onStripKeyDown}
      >
        {items.map((item, i) => (
          <button
            key={`${item.key}-${item.file}`}
            type="button"
            className="strip__item"
            onClick={() => setIndex(i)}
            aria-label={`Enlarge screenshot: ${item.title}`}
          >
            <div className="phone">
              <img
                src={item.src}
                width={item.w}
                height={item.h}
                alt={item.alt}
                loading="lazy"
                decoding="async"
              />
            </div>
            <span className="strip__label">{item.title}</span>
          </button>
        ))}
      </div>

      {index !== null && (
        <Lightbox items={items} index={index} onClose={close} onPrev={prev} onNext={next} />
      )}
    </section>
  );
}
