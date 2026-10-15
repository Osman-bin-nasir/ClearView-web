import Phone from './Phone.jsx';
import { screen, useSite } from '../data/site.js';

/**
 * A group of overlapping phone mockups.
 *
 * Desktop renders the staggered fan defined by each item's `y` / `r` / `mx`
 * (vertical offset, rotation, negative margin used as overlap). Below 768px
 * the same markup becomes a swipeable scroll-snap row — see `.cluster` in
 * index.css. The teal halo sits on the wrapper, outside the scroll container,
 * so it never adds scrollable width on phones.
 *
 * Each item names a screenshot KEY; the image behind that key is the admin's.
 * A key whose screen has been removed from the content is skipped rather than
 * rendered as a broken frame.
 */
export default function Cluster({ items, className = '', glow = true, priority = false }) {
  const site = useSite();
  const phones = items.map((item) => ({ item, shot: screen(site, item.key) })).filter(({ shot }) => shot);

  if (phones.length === 0) return null;

  return (
    <div className={`${glow ? 'glow' : ''} ${className}`}>
      <div className={`cluster cluster--${phones.length}`}>
        {phones.map(({ item, shot }) => (
          <div
            key={item.key}
            className="cluster__item"
            style={{
              '--y': item.y ?? '0px',
              '--r': item.r ?? '0deg',
              '--mx': item.mx ?? '0px',
            }}
          >
            <Phone screen={shot} priority={priority} />
          </div>
        ))}
      </div>
    </div>
  );
}
