import { policyBlocks, richText, useSite } from '../data/site.js';

/**
 * The privacy policy, linked from the footer.
 *
 * It covers all three apps rather than the Android one alone, because that is
 * what the organisation actually operates — and it separates the two things a
 * policy like this is usually vague about: what is checked on the device and
 * never leaves it, and the short list of actions that do send something.
 *
 * The words are the admin's, from the content store. Keep this page in step with
 * the apps when they change: the Chrome extension's own policy is the source for
 * the browser section, and the Android disclosure in the footer ("Accessibility
 * Service is optional...") must stay consistent with what is written here. The
 * fields allow `**bold**` and `code` and one bullet per line — the same two
 * emphases the page had before it became editable, and nothing that could inject
 * markup into the page.
 */
function Inline({ line }) {
  return richText(line).map((part, index) => {
    const key = `${part.kind}-${index}`;
    if (part.kind === 'strong') return <strong key={key}>{part.text}</strong>;
    if (part.kind === 'code') return <code key={key}>{part.text}</code>;
    return part.text;
  });
}

/**
 * One policy section: its title, then its text.
 *
 * Consecutive bullet lines become ONE `<ul>`, so the spacing between them stays
 * the stylesheet's business — the field a person types into should not decide
 * how a list is spaced.
 */
function Section({ title, body }) {
  const groups = [];
  for (const block of policyBlocks(body)) {
    const last = groups[groups.length - 1];
    if (block.bullet && last?.bullets) last.bullets.push(block.text);
    else if (block.bullet) groups.push({ bullets: [block.text] });
    else groups.push({ paragraph: block.text });
  }

  return (
    <section className="prose__section">
      <h2>{title}</h2>
      {groups.map((group, index) =>
        group.bullets ? (
          <ul key={index}>
            {group.bullets.map((line, position) => (
              <li key={position}>
                <Inline line={line} />
              </li>
            ))}
          </ul>
        ) : (
          <p key={index}>
            <Inline line={group.paragraph} />
          </p>
        ),
      )}
    </section>
  );
}

export default function PrivacyPolicy() {
  const site = useSite();
  const { privacy } = site;

  return (
    <main className="wrap py-14 md:py-20">
      <div className="max-w-3xl">
        <span className="eyebrow">{privacy.eyebrow}</span>
        <h1 className="mt-4 text-[clamp(2rem,5vw,3rem)]">{privacy.title}</h1>
        <p className="mt-4 text-sm text-dim">
          {privacy.updatedLabel.replace('{date}', privacy.updated)}
        </p>

        <p className="lead mt-8">{privacy.intro}</p>

        <div className="prose mt-12">
          {privacy.sections.map((section) => (
            <Section key={section.title} title={section.title} body={section.body} />
          ))}
        </div>

        <p className="note mt-12">
          <span>Note</span>
          <span>{privacy.note}</span>
        </p>
      </div>
    </main>
  );
}
