import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';

import { type Block, type DocumentMeta, type Span, spansText } from './blocks.js';

/**
 * Word writer (task of 2026-11-02). Takes the same blocks as the PDF writer and produces a .docx
 * that opens in Word, Pages and Google Docs. Real Word styles are used (Heading 1-3, a bordered
 * table, a page-number footer) rather than hand-sized text, so whoever receives the report can
 * restyle or extend it in their own template without undoing ours.
 */

const INK = { text: '111827', muted: '4B5563', rule: 'D1D5DB', band: 'F3F4F6' };
const FULL = { size: 100, type: WidthType.PERCENTAGE } as const;

const runs = (spans: readonly Span[], extra: { color?: string; size?: number } = {}) =>
  spans.map(
    (span) =>
      new TextRun({
        text: span.text,
        bold: span.bold,
        italics: span.italic,
        color: extra.color ?? INK.text,
        ...(extra.size ? { size: extra.size } : {}),
      }),
  );

const headingLevel = (level: 1 | 2 | 3) =>
  level === 1
    ? HeadingLevel.HEADING_1
    : level === 2
      ? HeadingLevel.HEADING_2
      : HeadingLevel.HEADING_3;

function tableOf(header: readonly string[], rows: readonly string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 2, color: INK.rule };
  const cell = (text: string, bold: boolean) =>
    new TableCell({
      margins: { top: 60, bottom: 60, left: 90, right: 90 },
      shading: bold ? { type: ShadingType.CLEAR, color: 'auto', fill: INK.band } : undefined,
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold, color: INK.text, size: 18 })],
        }),
      ],
    });
  return new Table({
    width: FULL,
    borders: {
      top: border,
      bottom: border,
      left: border,
      right: border,
      insideHorizontal: border,
      insideVertical: border,
    },
    rows: [
      new TableRow({
        tableHeader: true, // repeats the header when a table runs over a page break
        children: header.map((h) => cell(h, true)),
      }),
      ...rows.map(
        (row) => new TableRow({ children: header.map((_, i) => cell(row[i] ?? '', false)) }),
      ),
    ],
  });
}

/** Renders the blocks to a .docx and resolves with the whole file. */
export function toDocx(blocks: readonly Block[], meta: DocumentMeta): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'heading':
        children.push(
          new Paragraph({
            heading: headingLevel(block.level),
            spacing: { before: block.level === 1 ? 0 : 240, after: 120 },
            children: runs(block.spans),
          }),
        );
        break;
      case 'note':
        children.push(
          new Paragraph({
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: INK.band },
            spacing: { before: 120, after: 160 },
            border: { left: { style: BorderStyle.SINGLE, size: 12, color: INK.muted, space: 6 } },
            children: runs(block.spans).map((run) => run),
          }),
        );
        break;
      case 'bullet':
        children.push(
          new Paragraph({
            bullet: { level: 0 },
            spacing: { after: 40 },
            children: runs(block.spans),
          }),
        );
        break;
      case 'paragraph':
        children.push(new Paragraph({ spacing: { after: 120 }, children: runs(block.spans) }));
        break;
      case 'table':
        children.push(tableOf(block.header, block.rows));
        // Word runs consecutive tables together; a spacer keeps them apart and readable.
        children.push(new Paragraph({ spacing: { after: 120 }, children: [] }));
        break;
    }
  }

  const document = new Document({
    title: meta.title,
    creator: meta.organiser,
    description: meta.subtitle ?? '',
    styles: {
      default: {
        document: { run: { font: 'Calibri', size: 19, color: INK.text } },
        heading1: { run: { font: 'Calibri', size: 36, bold: true, color: INK.text } },
        heading2: { run: { font: 'Calibri', size: 27, bold: true, color: INK.text } },
        heading3: { run: { font: 'Calibri', size: 23, bold: true, color: INK.text } },
      },
    },
    sections: [
      {
        children,
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${meta.subtitle ? `${meta.subtitle} · ` : ''}${meta.organiser}`,
                    color: INK.muted,
                    size: 16,
                  }),
                ],
              }),
            ],
          }),
        },
      },
    ],
  });

  return Packer.toBuffer(document).then((data) => Buffer.from(data));
}

/** The plain text of the blocks, for tests and for a mail body that mirrors a download. */
export const blocksText = (blocks: readonly Block[]) =>
  blocks
    .map((b) =>
      b.kind === 'table'
        ? [b.header.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('\n')
        : spansText(b.spans),
    )
    .join('\n');
