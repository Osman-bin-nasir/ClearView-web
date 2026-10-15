import { useEffect, useMemo } from 'react';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import Platforms from './components/Platforms.jsx';
import Section from './components/Section.jsx';
import Gallery from './components/Gallery.jsx';
import FinalCta from './components/FinalCta.jsx';
import Footer from './components/Footer.jsx';
import PrivacyPolicy from './components/PrivacyPolicy.jsx';
import Admin from './components/Admin.jsx';
import useReveal from './hooks/useReveal.js';
import useHashRoute from './hooks/useHashRoute.js';
import { SECTION_LAYOUT } from './data/layout.js';
import { useSite } from './data/site.js';

/**
 * The ClearView site.
 *
 * Three pages, chosen by the hash: the landing page (the organisation, its three
 * apps, the app's feature areas and the screenshot strip), `#/privacy` and
 * `#/admin`. The header and footer are shared, so the two inner pages are never
 * a dead end.
 *
 * The WORDS come from src/data/site.js and the store LINKS from
 * src/data/links.js — both editable, both published by the admin screen. The
 * page's structure (which sections exist, in what order, and what each one's
 * phone cluster looks like) is compiled, in src/data/layout.js, so a published
 * file can change what the page says but never what it is.
 */
export default function App() {
  const route = useHashRoute();
  const site = useSite();
  // Re-armed per route: the landing page's reveal targets are re-created every
  // time this component switches back to it, and an observer that only ran once
  // would leave the whole page at opacity 0.
  useReveal(route);

  /** Each section's words, with the layout of the section in the same order. */
  const sections = useMemo(
    () =>
      site.sections
        .map((section, index) => ({ section, layout: SECTION_LAYOUT[index] }))
        .filter((entry) => entry.layout),
    [site],
  );

  /**
   * Land on the anchor, not just the page.
   *
   * Coming back from `#/privacy` by clicking `#platforms` changes the hash and
   * the route in one step — and at that moment the element does not exist yet,
   * so the browser has nothing to scroll to. This runs after the landing page
   * has rendered and finishes the job.
   */
  useEffect(() => {
    if (route !== '') return;
    const id = window.location.hash.slice(1);
    if (id === '') return;
    document.getElementById(id)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  }, [route]);

  return (
    <>
      <Header />

      {route === 'privacy' ? (
        <PrivacyPolicy />
      ) : route === 'admin' ? (
        <Admin />
      ) : (
        <main>
          <Hero />
          <Platforms />

          {/* What the app itself contains. Android and iOS share these areas. */}
          {sections.map(({ section, layout }) => (
            <Section key={layout.id} section={section} layout={layout} />
          ))}

          <Gallery />
          <FinalCta />
        </main>
      )}

      <Footer />
    </>
  );
}
