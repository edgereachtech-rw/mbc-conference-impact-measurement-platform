/**
 * The document model every rich export is built from.
 *
 * The reports are written once, as Markdown, in `src/reports/render.ts`. Rather than write that
 * report three more times for PDF, Word and Excel, this module parses the small Markdown subset
 * that renderer emits into blocks, and the PDF and Word writers lay those blocks out. One source
 * of wording, three encodings: a sentence added to the report appears in every format with no
 * further work, and the formats can never drift apart.
 *
 * The subset is ours, not CommonMark: headings `#` to `###`, blockquotes, `-` bullets, pipe
 * tables, blank lines, and `**bold**` / `_italic_` inside a line. Anything else is carried through
 * as plain text rather than guessed at.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; spans: Span[] }
  | { kind: 'paragraph'; spans: Span[] }
  | { kind: 'bullet'; spans: Span[] }
  /** A blockquote: the DRAFT banner on an unapproved external report, and nothing else so far. */
  | { kind: 'note'; spans: Span[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

/** `**bold**` and `_italic_`, which is all the renderer uses. Markers are never nested. */
export function parseSpans(line: string): Span[] {
  const spans: Span[] = [];
  const pattern = /\*\*([^*]+)\*\*|_([^_]+)_/g;
  let at = 0;
  for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
    if (m.index > at) spans.push({ text: line.slice(at, m.index) });
    if (m[1] !== undefined) spans.push({ text: m[1], bold: true });
    else if (m[2] !== undefined) spans.push({ text: m[2], italic: true });
    at = m.index + m[0].length;
  }
  if (at < line.length) spans.push({ text: line.slice(at) });
  return spans.length > 0 ? spans : [{ text: line }];
}

/** The plain text of a run of spans, for a table cell or a page header. */
export const spansText = (spans: readonly Span[]) => spans.map((s) => s.text).join('');

const isTableRow = (line: string) => line.startsWith('|') && line.endsWith('|');
const isTableRule = (line: string) => /^\|(\s*:?-+:?\s*\|)+$/.test(line);

/** `| a | b |` into its cells, undoing the `\|` the renderer escapes inside a cell. */
function tableCells(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  for (let i = 1; i < line.length - 1; i += 1) {
    const ch = line[i];
    if (ch === '\\' && line[i + 1] === '|') {
      current += '|';
      i += 1;
    } else if (ch === '|') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trimEnd();
    if (line.trim() === '') continue;

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length as 1 | 2 | 3,
        spans: parseSpans(heading[2]!.trim()),
      });
      continue;
    }

    if (isTableRow(line)) {
      // A table is a header row, a rule, then rows: without the rule it is just a line of text.
      const next = (lines[i + 1] ?? '').trimEnd();
      if (!isTableRule(next)) {
        blocks.push({ kind: 'paragraph', spans: parseSpans(line) });
        continue;
      }
      const header = tableCells(line);
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length; j += 1) {
        const row = (lines[j] ?? '').trimEnd();
        if (!isTableRow(row) || isTableRule(row)) break;
        const cells = tableCells(row);
        // Keep every row the width of the header so the writers can lay out columns.
        while (cells.length < header.length) cells.push('');
        rows.push(cells.slice(0, header.length));
      }
      blocks.push({ kind: 'table', header, rows });
      i = j - 1;
      continue;
    }

    if (line.startsWith('> ')) {
      blocks.push({ kind: 'note', spans: parseSpans(line.slice(2).trim()) });
      continue;
    }

    if (line.startsWith('- ')) {
      blocks.push({ kind: 'bullet', spans: parseSpans(line.slice(2).trim()) });
      continue;
    }

    blocks.push({ kind: 'paragraph', spans: parseSpans(line.trim()) });
  }
  return blocks;
}

/** What a writer needs besides the blocks: the running head and the first page's title. */
export interface DocumentMeta {
  /** The document title, used for the file's own metadata and the PDF running head. */
  title: string;
  /** The organiser, for the Word and PDF document properties. */
  organiser: string;
  /** One line under the running head, e.g. the event and the reporting date. */
  subtitle?: string;
}
