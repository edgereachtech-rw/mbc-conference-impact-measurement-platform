/**
 * The delegate's "I will be attending" card (task of 2026-11-03).
 *
 * A delegate shares this before the conference: the event's own logo, the dates and venue, their
 * name, and who sponsored them. It is drawn as SVG rather than composed as a bitmap so the API
 * needs no image library and no native dependency in its container; the browser turns it into a
 * PNG when the delegate downloads it.
 *
 * The event logo is inlined as a data URI rather than linked. A linked image would not survive the
 * download (an external image taints a canvas, so the PNG export fails), would not render in a
 * mail client, and would tell the logo's host every time anyone opened the card.
 */

export interface BadgeInput {
  eventName: string;
  /** "NOVEMBER 12-13 2026", already in the event's own words. */
  dateLine: string;
  /** Venue and city; omitted when the event has no location. */
  venueLine?: string;
  delegateName: string;
  /** The delegate's nominating organisation, when the registration carries one. */
  sponsor?: string;
  /** The event logo as a data URI; the card falls back to type when it is missing. */
  logoDataUri?: string;
  /** Who runs the event, for the foot of the card. */
  organiser: string;
}

const W = 800;
const H = 1050;

const INK = '#002a5e';
const MUTED = '#5b6b7f';
const LINE = '#d9e1ea';
const ACCENT = '#c8a008';

/** XML-escapes text. Everything here is delegate- or admin-supplied, so nothing is trusted. */
const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

/**
 * Splits a name over at most two lines so a long one stays inside the card. SVG has no text
 * wrapping, and measuring without a font engine is guesswork, so the break is by words against a
 * character budget — generous enough that ordinary names never break at all.
 */
function nameLines(name: string, perLine = 22): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > perLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

/** Shrinks the name to fit when it is long, rather than letting it run past the card. */
const nameSize = (lines: string[]) => {
  const longest = Math.max(...lines.map((l) => l.length));
  if (longest <= 16) return 54;
  if (longest <= 22) return 46;
  return 40;
};

export function renderBadgeSvg(input: BadgeInput): string {
  const lines = nameLines(input.delegateName);
  const size = nameSize(lines);
  // The name block is centred on the card; everything below it is measured from its last line.
  const nameTop = 620;
  const nameBlock = lines
    .map(
      (line, i) =>
        `<text x="${W / 2}" y="${nameTop + i * (size + 8)}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${size}" font-weight="700" fill="${INK}">${esc(line)}</text>`,
    )
    .join('\n    ');
  const afterName = nameTop + (lines.length - 1) * (size + 8);

  const logo = input.logoDataUri
    ? `<clipPath id="ring"><circle cx="${W / 2}" cy="352" r="150"/></clipPath>
    <circle cx="${W / 2}" cy="352" r="156" fill="#ffffff" stroke="${INK}" stroke-width="6"/>
    <image href="${esc(input.logoDataUri)}" x="${W / 2 - 150}" y="202" width="300" height="300"
           preserveAspectRatio="xMidYMid meet" clip-path="url(#ring)"/>`
    : `<circle cx="${W / 2}" cy="352" r="156" fill="#f4f7fb" stroke="${INK}" stroke-width="6"/>
    <text x="${W / 2}" y="370" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
          font-size="44" font-weight="700" fill="${INK}">${esc(input.eventName.slice(0, 18))}</text>`;

  const venue = input.venueLine
    ? `<text x="${W / 2}" y="146" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
            font-size="24" fill="${MUTED}">${esc(input.venueLine)}</text>`
    : '';

  const sponsor = input.sponsor
    ? `<text x="${W / 2}" y="${afterName + 190}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
            font-size="20" letter-spacing="2" fill="${MUTED}">SPONSORED BY</text>
    <text x="${W / 2}" y="${afterName + 226}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif"
          font-size="28" font-style="italic" fill="${INK}">${esc(input.sponsor)}</text>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img"
     aria-label="${esc(`${input.delegateName} will be attending ${input.eventName}`)}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="${LINE}" stroke-width="2"/>

  <text x="${W / 2}" y="96" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="30" letter-spacing="1" fill="${INK}">${esc(input.dateLine)}</text>
  ${venue}
  <line x1="60" y1="182" x2="${W - 60}" y2="182" stroke="${LINE}" stroke-width="2"/>

  ${logo}

  ${nameBlock}

  <text x="${W / 2}" y="${afterName + 86}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="34" font-weight="700" letter-spacing="3" fill="${INK}">I WILL BE ATTENDING</text>
  <text x="${W / 2}" y="${afterName + 136}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="38" font-weight="700" letter-spacing="2" fill="${ACCENT}">${esc(input.eventName)}</text>

  ${sponsor}

  <line x1="60" y1="${H - 92}" x2="${W - 60}" y2="${H - 92}" stroke="${LINE}" stroke-width="2"/>
  <text x="${W / 2}" y="${H - 48}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif"
        font-size="20" fill="${MUTED}">${esc(input.organiser)}</text>
</svg>
`;
}
