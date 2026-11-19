import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
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

const INK = {
  text: '17212B',
  muted: '596773',
  navy: '12344A',
  green: '4C8B62',
  rule: 'D5DEE3',
  band: 'EEF3F5',
  stripe: 'F8FAFB',
  white: 'FFFFFF',
};
const PAGE = { width: 12240, height: 15840, contentWidth: 10240 } as const;

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

function tableColumnWidths(header: readonly string[], rows: readonly string[][]) {
  const total = PAGE.contentWidth;
  const min = Math.min(total * 0.1, total / header.length);
  const max = total * (header.length === 1 ? 1 : header.length === 2 ? 0.68 : 0.48);
  const weights = header.map((title, i) => {
    const values = rows.map((row) => Math.min(60, row[i]?.length ?? 0)).sort((a, b) => a - b);
    const typical = values[Math.floor((values.length - 1) * 0.85)] ?? 0;
    return Math.max(title.length, typical, 8);
  });
  const widths = Array(header.length).fill(0) as number[];
  const open = new Set(header.map((_, i) => i));
  let remaining = total;
  while (open.size) {
    const weightTotal = [...open].reduce((sum, i) => sum + weights[i]!, 0);
    const shares = new Map(
      [...open].map((i) => [i, (remaining * weights[i]!) / weightTotal] as const),
    );
    const fixed = [...open].filter((i) => shares.get(i)! < min || shares.get(i)! > max);
    if (!fixed.length) {
      for (const i of open) widths[i] = shares.get(i)!;
      break;
    }
    for (const i of fixed) {
      widths[i] = shares.get(i)! < min ? min : max;
      open.delete(i);
    }
    remaining = total - widths.reduce((sum, value) => sum + value, 0);
  }
  return widths.map(Math.round);
}

function tableOf(header: readonly string[], rows: readonly string[][]): Table {
  const border = { style: BorderStyle.SINGLE, size: 2, color: INK.rule };
  const widths = tableColumnWidths(header, rows);
  const cell = (text: string, bold: boolean, fill: string) =>
    new TableCell({
      margins: { top: 100, bottom: 100, left: 140, right: 140 },
      shading: { type: ShadingType.CLEAR, color: 'auto', fill },
      children: [
        new Paragraph({
          children: [new TextRun({ text, bold, color: bold ? INK.white : INK.text, size: 18 })],
        }),
      ],
    });
  return new Table({
    width: { size: PAGE.contentWidth, type: WidthType.DXA },
    columnWidths: widths,
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
        children: header.map((h) => cell(h, true, INK.navy)),
      }),
      ...rows.map(
        (row, index) =>
          new TableRow({
            children: header.map((_, i) =>
              cell(row[i] ?? '', false, index % 2 ? INK.stripe : INK.white),
            ),
          }),
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
            spacing: {
              before: block.level === 1 ? 0 : block.level === 2 ? 360 : 220,
              after: block.level === 1 ? 220 : 140,
            },
            keepNext: true,
            keepLines: true,
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
        children.push(new Paragraph({ spacing: { after: 180 }, children: runs(block.spans) }));
        break;
      case 'table':
        children.push(tableOf(block.header, block.rows));
        // Word runs consecutive tables together; a spacer keeps them apart and readable.
        children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
        break;
    }
  }

  const document = new Document({
    title: meta.title,
    creator: meta.organiser,
    description: meta.subtitle ?? '',
    styles: {
      default: {
        document: { run: { font: 'Aptos', size: 20, color: INK.text } },
        heading1: { run: { font: 'Aptos Display', size: 44, bold: true, color: INK.navy } },
        heading2: { run: { font: 'Aptos Display', size: 32, bold: true, color: INK.navy } },
        heading3: { run: { font: 'Aptos', size: 24, bold: true, color: INK.green } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: PAGE.width, height: PAGE.height },
            margin: {
              top: 1240,
              right: 1000,
              bottom: 1100,
              left: 1000,
              header: 520,
              footer: 520,
            },
          },
        },
        children,
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                border: {
                  bottom: { style: BorderStyle.SINGLE, size: 4, color: INK.green, space: 5 },
                },
                children: [
                  new TextRun({
                    text: meta.organiser.toUpperCase(),
                    bold: true,
                    color: INK.navy,
                    size: 16,
                  }),
                  ...(meta.subtitle
                    ? [new TextRun({ text: `   ${meta.subtitle}`, color: INK.muted, size: 16 })]
                    : []),
                ],
              }),
            ],
          }),
        },
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
