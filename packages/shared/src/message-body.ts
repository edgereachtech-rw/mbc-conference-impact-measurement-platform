/**
 * Message body renderer for admin emails to delegates (backlog E2-14).
 *
 * The admin writes the body in a small, predictable markdown subset and the same source becomes
 * the HTML part, the plain-text part and the on-screen preview, so the three never drift:
 *
 *   # Heading / ## Subheading       - bullet item          1. numbered item
 *   **bold**   *italic*              [label](https://…)     https://bare.links/are/linked
 *   blank line = new paragraph; a single line break inside a paragraph is kept
 *   {{firstName}} {{name}} {{email}} {{organisation}} {{eventName}} are filled per recipient
 *
 * Everything is escaped before any markup is added and links are limited to http(s) and mailto,
 * so a body can never inject HTML or script into the email or the preview.
 */

export const messagePlaceholders = [
  'firstName',
  'name',
  'email',
  'organisation',
  'eventName',
] as const;
export type MessagePlaceholder = (typeof messagePlaceholders)[number];
export type MessagePlaceholderValues = Record<MessagePlaceholder, string>;

export const messagePlaceholderLabels: Record<MessagePlaceholder, string> = {
  firstName: 'First name',
  name: 'Full name',
  email: 'Email address',
  organisation: 'Organisation',
  eventName: 'Event name',
};

const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9_]*)\s*\}\}/g;
const SAFE_URL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+)$/i;

function isPlaceholder(key: string): key is MessagePlaceholder {
  return (messagePlaceholders as readonly string[]).includes(key);
}

/** Placeholder names used in the text that are not in the supported list, each once. */
export function findUnknownPlaceholders(source: string): string[] {
  const unknown = new Set<string>();
  for (const match of source.matchAll(PLACEHOLDER)) {
    const key = match[1] ?? '';
    if (!isPlaceholder(key)) unknown.add(key);
  }
  return [...unknown];
}

/** Fills supported placeholders; unknown ones are left as typed so they stay visible. */
export function substitutePlaceholders(source: string, values: MessagePlaceholderValues): string {
  return source.replace(PLACEHOLDER, (whole: string, key: string) =>
    isPlaceholder(key) ? values[key] : whole,
  );
}

/** Per-recipient values from a delegate record; the first name is the first word of the name. */
export function placeholderValuesFor(delegate: {
  name: string;
  email: string;
  organisation: string | null;
  eventName: string;
}): MessagePlaceholderValues {
  const name = delegate.name.trim();
  return {
    firstName: name.split(/\s+/)[0] ?? '',
    name,
    email: delegate.email,
    organisation: delegate.organisation?.trim() ?? '',
    eventName: delegate.eventName,
  };
}

export function escapeMessageHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Inline styles because email clients ignore stylesheets; the values follow docs/design-tokens.md.
const FONT = "Poppins, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TEXT = '#323333';
const NAVY = '#002A5E';
const styles = {
  p: `margin:0 0 16px;font-family:${FONT};font-size:16px;line-height:24px;color:${TEXT};`,
  h1: `margin:24px 0 12px;font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:${NAVY};`,
  h2: `margin:20px 0 10px;font-family:${FONT};font-size:18px;line-height:26px;font-weight:700;color:${NAVY};`,
  h3: `margin:16px 0 8px;font-family:${FONT};font-size:16px;line-height:24px;font-weight:700;color:${NAVY};`,
  list: `margin:0 0 16px;padding-left:24px;font-family:${FONT};font-size:16px;line-height:24px;color:${TEXT};`,
  li: 'margin:0 0 6px;',
  a: `color:${NAVY};text-decoration:underline;`,
} as const;

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'paragraph'; lines: string[] };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: 'paragraph', lines: paragraph });
    paragraph = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*\S)\s*$/.exec(line);
    const bullet = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*\S)\s*$/.exec(line);
    if (line.trim() === '') {
      flush();
    } else if (heading) {
      flush();
      blocks.push({
        kind: 'heading',
        level: Math.min(3, heading[1]?.length ?? 1) as 1 | 2 | 3,
        text: heading[2] ?? '',
      });
    } else if (bullet || numbered) {
      flush();
      const ordered = Boolean(numbered);
      const item = (bullet ?? numbered)?.[1] ?? '';
      const last = blocks[blocks.length - 1];
      if (last?.kind === 'list' && last.ordered === ordered) last.items.push(item);
      else blocks.push({ kind: 'list', ordered, items: [item] });
    } else {
      paragraph.push(line.trim());
    }
  }
  flush();
  return blocks;
}

const LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
const BARE_URL = /(^|[\s(])(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const ITALIC_STAR = /(^|[^*\w])\*([^*\n]+)\*(?!\*)/g;
const ITALIC_UNDERSCORE = /(^|[^\w])_([^_\n]+)_(?!\w)/g;

/** Escapes the text, then adds links, bold and italics without ever re-parsing added markup. */
function inlineHtml(text: string): string {
  const links: string[] = [];
  // Private-use characters mark finished links so later passes never touch them.
  const keep = (html: string) => `${links.push(html) - 1}`;
  let out = escapeMessageHtml(text);
  // [label](url): the url is read from the escaped text, so decode the entities it may contain.
  out = out.replace(LINK, (whole: string, label: string, url: string) => {
    const target = url.replace(/&amp;/g, '&');
    return SAFE_URL.test(target)
      ? keep(`<a href="${escapeMessageHtml(target)}" style="${styles.a}">${label}</a>`)
      : whole;
  });
  out = out.replace(BARE_URL, (_whole: string, lead: string, url: string) => {
    const target = url.replace(/&amp;/g, '&');
    return `${lead}${keep(`<a href="${escapeMessageHtml(target)}" style="${styles.a}">${url}</a>`)}`;
  });
  out = out.replace(BOLD, '<strong>$1</strong>');
  out = out.replace(ITALIC_STAR, '$1<em>$2</em>');
  out = out.replace(ITALIC_UNDERSCORE, '$1<em>$2</em>');
  return out.replace(/(\d+)/g, (_m: string, i: string) => links[Number(i)] ?? '');
}

function inlineText(text: string): string {
  return text
    .replace(LINK, (whole: string, label: string, url: string) =>
      SAFE_URL.test(url) ? `${label} (${url})` : whole,
    )
    .replace(BOLD, '$1')
    .replace(ITALIC_STAR, '$1$2')
    .replace(ITALIC_UNDERSCORE, '$1$2');
}

export interface RenderedMessageBody {
  /** Email-safe HTML fragment with inline styles; safe to embed as-is. */
  html: string;
  /** Plain-text version with the same content. */
  text: string;
}

/** Renders the body with the recipient's values filled in. */
export function renderMessageBody(
  source: string,
  values: MessagePlaceholderValues,
): RenderedMessageBody {
  const filled = substitutePlaceholders(source, values);
  const html: string[] = [];
  const text: string[] = [];
  for (const block of parseBlocks(filled)) {
    if (block.kind === 'heading') {
      const tag = `h${block.level}` as const;
      html.push(`<${tag} style="${styles[tag]}">${inlineHtml(block.text)}</${tag}>`);
      text.push(inlineText(block.text), '');
    } else if (block.kind === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      html.push(
        `<${tag} style="${styles.list}">${block.items
          .map((item) => `<li style="${styles.li}">${inlineHtml(item)}</li>`)
          .join('')}</${tag}>`,
      );
      block.items.forEach((item, i) =>
        text.push(`${block.ordered ? `${i + 1}.` : '-'} ${inlineText(item)}`),
      );
      text.push('');
    } else {
      html.push(`<p style="${styles.p}">${block.lines.map(inlineHtml).join('<br>')}</p>`);
      text.push(block.lines.map(inlineText).join('\n'), '');
    }
  }
  return { html: html.join('\n'), text: text.join('\n').trim() };
}
