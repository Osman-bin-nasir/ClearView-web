import { useEffect } from 'react';

/**
 * Scroll-reveal driver.
 *
 * Fades in every element marked with `data-reveal` once it enters the
 * viewport, then stops watching it. The matching CSS lives in index.css
 * (.reveal / .is-visible) and the reduced-motion block there neutralises it.
 *
 * `dependency` is the current route. The landing page is unmounted when the
 * privacy or admin page is shown and re-mounted when it comes back, which
 * re-creates every `.reveal` element at opacity 0 — so the observer has to be
 * armed again, or returning to the site would show a blank page.
 */
export default function useReveal(dependency) {
  useEffect(() => {
    const targets = Array.from(document.querySelectorAll('[data-reveal]'));
    if (targets.length === 0) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Reduced motion (or no IntersectionObserver): show everything immediately.
    if (prefersReduced || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-visible'));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      },
      // Wait until the element is a little way into the viewport so the
      // animation reads as a response to scrolling, not to page load.
      { rootMargin: '0px 0px -8% 0px', threshold: 0.1 },
    );

    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [dependency]);
}
