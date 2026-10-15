/**
 * One screenshot inside a phone frame.
 *
 * The frame (rounded corners, thin bezel, soft teal shadow) is styled by
 * `.phone` in index.css. Real width/height come from the screen metadata so
 * the browser reserves the right space before the lazy image arrives.
 *
 * @param {object}  props.screen   Entry from `screen()` in data/site.js
 * @param {boolean} props.priority true for above-the-fold phones (hero)
 */
export default function Phone({ screen, priority = false, className = '', style }) {
  return (
    <div className={`phone ${className}`} style={style}>
      <img
        src={screen.src}
        width={screen.w}
        height={screen.h}
        alt={screen.alt}
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : 'auto'}
        decoding="async"
      />
    </div>
  );
}
