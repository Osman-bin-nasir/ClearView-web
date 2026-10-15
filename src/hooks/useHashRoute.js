import { useEffect, useState } from 'react';

/**
 * The site's whole router: `#/privacy`, `#/admin`, and nothing else.
 *
 * A hash route rather than a real one on purpose. The build is a static bundle
 * with a relative `base`, so it runs from a domain root, a project subfolder, or
 * a plain file server — and only the hash part of a URL works in all three
 * without the host being configured to rewrite unknown paths to index.html.
 *
 * A hash WITHOUT a leading slash is not a route: `#platforms`, `#showcase` and
 * `#top` are ordinary in-page anchors, and treating them as pages would swap the
 * whole site out the moment someone clicked a nav link.
 */
export function readRoute() {
  const hash = window.location.hash;
  if (!hash.startsWith('#/')) return '';
  return hash.slice(2).replace(/\/+$/, '').toLowerCase();
}

export default function useHashRoute() {
  const [route, setRoute] = useState(readRoute);

  useEffect(() => {
    const onHashChange = () => {
      const next = readRoute();
      setRoute(next);
      // A page change starts at the top; an in-page anchor ('' route) is left to
      // the browser, which is what scrolls it into view.
      if (next !== '') window.scrollTo({ top: 0, behavior: 'auto' });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return route;
}
