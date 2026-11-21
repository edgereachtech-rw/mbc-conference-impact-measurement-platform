import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
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
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
const NO_BORDERS = {
  top: NONE,
  bottom: NONE,
  left: NONE,
  right: NONE,
  insideHorizontal: NONE,
  insideVertical: NONE,
};

/** Text with its line breaks kept, as runs. */
function lines(
  text: string,
  extra: { color?: string; size?: number; bold?: boolean; italics?: boolean } = {},
) {
  return text.split('\n').map(
    (line, i) =>
      new TextRun({
        text: line,
        break: i > 0 ? 1 : undefined,
        color: extra.color ?? INK.text,
        bold: extra.bold,
        italics: extra.italics,
        ...(extra.size ? { size: extra.size } : {}),
      }),
  );
}

/** The cover's facts, two to a row, in a borderless table. */
function factsTable(facts: ReadonlyArray<{ label: string; value: string }>): Table {
  const half = Math.round(PAGE.contentWidth / 2);
  const rows: TableRow[] = [];
  for (let i = 0; i < facts.length; i += 2) {
    const pair = facts.slice(i, i + 2);
    while (pair.length < 2) pair.push({ label: '', value: '' });
    rows.push(
      new TableRow({
        children: pair.map(
          (f) =>
            new TableCell({
              width: { size: half, type: WidthType.DXA },
              margins: { top: 60, bottom: 120, left: 0, right: 200 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: f.label.toUpperCase(),
                      bold: true,
                      color: INK.muted,
                      size: 15,
                    }),
                  ],
                }),
                new Paragraph({ children: [new TextRun({ text: f.value, bold: true, size: 22 })] }),
              ],
            }),
        ),
      }),
    );
  }
  return new Table({
    width: { size: PAGE.contentWidth, type: WidthType.DXA },
    columnWidths: [half, PAGE.contentWidth - half],
    borders: NO_BORDERS,
    rows,
  });
}

/** Headline figures as shaded tiles in one row, a green rule on top of each. */
function figuresTable(items: ReadonlyArray<{ value: string; label: string }>): Table {
  const width = Math.floor(PAGE.contentWidth / Math.max(1, items.length));
  return new Table({
    width: { size: PAGE.contentWidth, type: WidthType.DXA },
    columnWidths: items.map(() => width),
    borders: {
      ...NO_BORDERS,
      insideVertical: { style: BorderStyle.SINGLE, size: 24, color: INK.white },
    },
    rows: [
      new TableRow({
        children: items.map(
          (item) =>
            new TableCell({
              width: { size: width, type: WidthType.DXA },
              shading: { type: ShadingType.CLEAR, color: 'auto', fill: INK.band },
              borders: { top: { style: BorderStyle.SINGLE, size: 18, color: INK.green } },
              margins: { top: 120, bottom: 120, left: 160, right: 160 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: item.value, bold: true, size: 34, color: INK.navy }),
                  ],
                }),
                new Paragraph({
                  children: [new TextRun({ text: item.label, size: 16, color: INK.muted })],
                }),
              ],
            }),
        ),
      }),
    ],
  });
}

/** The band opening one delegate's response. */
function respondentTable(name: string, details: string): Table {
  return new Table({
    width: { size: PAGE.contentWidth, type: WidthType.DXA },
    columnWidths: [PAGE.contentWidth],
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          new TableCell({
            width: { size: PAGE.contentWidth, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, color: 'auto', fill: INK.band },
            borders: { left: { style: BorderStyle.SINGLE, size: 24, color: INK.navy } },
            margins: { top: 100, bottom: 100, left: 180, right: 180 },
            children: [
              new Paragraph({
                keepNext: true,
                children: [new TextRun({ text: name, bold: true, size: 24, color: INK.navy })],
              }),
              new Paragraph({
                keepNext: true,
                children: [new TextRun({ text: details, size: 16, color: INK.muted })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

const QA_WIDTHS = [520, Math.round(PAGE.contentWidth * 0.4), 0] as number[];
QA_WIDTHS[2] = PAGE.contentWidth - QA_WIDTHS[0]! - QA_WIDTHS[1]!;

/** One question and its answer as a table row: number, question as asked, answer. */
function qaTable(block: Extract<Block, { kind: 'qa' }>): Table {
  const rule = { style: BorderStyle.SINGLE, size: 2, color: INK.rule };
  const cell = (width: number, children: Paragraph[]) =>
    new TableCell({
      width: { size: width, type: WidthType.DXA },
      margins: { top: 70, bottom: 70, left: 0, right: 160 },
      children,
    });
  const answer = block.empty
    ? [new TextRun({ text: 'No answer', italics: true, color: INK.muted })]
    : [
        ...lines(block.answer),
        ...(block.mark
          ? [
              new TextRun({
                text: block.mark === 'correct' ? '  (correct)' : '  (incorrect)',
                bold: true,
                color: block.mark === 'correct' ? INK.green : 'A3471F',
              }),
            ]
          : []),
      ];
  return new Table({
    width: { size: PAGE.contentWidth, type: WidthType.DXA },
    columnWidths: QA_WIDTHS,
    borders: { ...NO_BORDERS, bottom: rule },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [
          cell(QA_WIDTHS[0]!, [
            new Paragraph({
              children: [new TextRun({ text: block.number, color: INK.muted, size: 16 })],
            }),
          ]),
          cell(QA_WIDTHS[1]!, [
            new Paragraph({ children: lines(block.question, { color: INK.muted }) }),
          ]),
          cell(QA_WIDTHS[2]!, [new Paragraph({ children: answer })]),
        ],
      }),
    ],
  });
}

export function toDocx(blocks: readonly Block[], meta: DocumentMeta): Promise<Buffer> {
  const children: Array<Paragraph | Table> = [];
  for (const block of blocks) {
    switch (block.kind) {
      case 'cover':
        children.push(
          new Paragraph({
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: block.eyebrow.toUpperCase(),
                bold: true,
                color: INK.green,
                size: 18,
              }),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.TITLE,
            spacing: { after: 200 },
            children: [new TextRun({ text: block.title, bold: true, color: INK.navy, size: 48 })],
          }),
          ...(block.lead
            ? [
                new Paragraph({
                  spacing: { after: 240 },
                  children: [new TextRun({ text: block.lead, color: INK.muted, size: 22 })],
                }),
              ]
            : []),
          new Paragraph({
            spacing: { after: 200 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: INK.green, space: 4 } },
            children: [],
          }),
          factsTable(block.facts),
          new Paragraph({ spacing: { after: 200 }, children: [] }),
        );
        break;
      case 'figures':
        if (block.items.length) {
          children.push(figuresTable(block.items));
          children.push(new Paragraph({ spacing: { after: 200 }, children: [] }));
        }
        break;
      case 'respondent':
        children.push(new Paragraph({ spacing: { before: 200 }, keepNext: true, children: [] }));
        children.push(respondentTable(block.name, block.details));
        break;
      case 'label':
        children.push(
          new Paragraph({
            spacing: { before: 180, after: 60 },
            keepNext: true,
            children: [
              new TextRun({
                text: block.text.toUpperCase(),
                bold: true,
                color: INK.green,
                size: 16,
              }),
            ],
          }),
        );
        break;
      case 'qa':
        children.push(qaTable(block));
        break;
      case 'pagebreak':
        children.push(new Paragraph({ children: [new PageBreak()] }));
        break;
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
                    text: `${meta.footnote ? `${meta.footnote} · ` : ''}${meta.subtitle ? `${meta.subtitle} · ` : ''}${meta.organiser} · Page `,
                    color: INK.muted,
                    size: 16,
                  }),
                  new TextRun({ children: [PageNumber.CURRENT], color: INK.muted, size: 16 }),
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
    .map((b) => {
      switch (b.kind) {
        case 'table':
          return [b.header.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('\n');
        case 'cover':
          return [
            b.eyebrow,
            b.title,
            b.lead ?? '',
            ...b.facts.map((f) => `${f.label}: ${f.value}`),
          ].join('\n');
        case 'figures':
          return b.items.map((i) => `${i.value} ${i.label}`).join('\n');
        case 'respondent':
          return `${b.name}\n${b.details}`;
        case 'label':
          return b.text;
        case 'qa':
          return `${b.number} ${b.question}: ${b.empty ? 'No answer' : b.answer}${b.mark ? ` (${b.mark})` : ''}`;
        case 'pagebreak':
          return '';
        default:
          return spansText(b.spans);
      }
    })
    .join('\n');
