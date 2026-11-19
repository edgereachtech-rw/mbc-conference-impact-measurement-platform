import PDFDocument from 'pdfkit';

import { type Block, type DocumentMeta, type Span, spansText } from './blocks.js';

/**
 * PDF writer (task of 2026-11-02). Takes the blocks parsed from a report's Markdown and lays them
 * out on A4 with the base-14 fonts, so no font files ship with the image and no browser is needed
 * to render a download. Tables are measured and wrapped rather than clipped: a report that does
 * not fit the width is still readable, which matters more than matching the screen exactly.
 */

const PAGE = { size: 'A4' as const, margin: 52, marginTop: 58, marginBottom: 54 };
const FONT = { body: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' };
const SIZE = { h1: 25, h2: 16, h3: 12, body: 10, small: 8 };
const INK = {
  text: '#17212b',
  muted: '#596773',
  navy: '#12344a',
  green: '#4c8b62',
  rule: '#d5dee3',
  band: '#eef3f5',
  stripe: '#f8fafb',
  white: '#ffffff',
};

type Doc = PDFKit.PDFDocument;

const fontFor = (span: Span) => (span.bold ? FONT.bold : span.italic ? FONT.italic : FONT.body);

/** Writes spans as one flowing paragraph so bold and italic runs wrap with the text around them. */
function writeSpans(doc: Doc, spans: readonly Span[], width: number, indent = 0) {
  const x = doc.page.margins.left + indent;
  doc.x = x;
  spans.forEach((span, i) => {
    doc
      .font(fontFor(span))
      .fillColor(INK.text)
      .text(span.text, { width: width - indent, continued: i < spans.length - 1 });
  });
  if (spans.length === 0) doc.font(FONT.body).text('', { width });
  doc.x = doc.page.margins.left;
}

/** Allocate width by each column's measured content, with caps so long answers wrap cleanly. */
function columnWidths(
  doc: Doc,
  header: readonly string[],
  rows: readonly string[][],
  total: number,
) {
  const natural = header.map((h, i) => {
    const cellWidths = rows.map((row) =>
      doc
        .font(FONT.body)
        .fontSize(SIZE.body)
        .widthOfString(row[i] ?? ''),
    );
    cellWidths.sort((a, b) => a - b);
    // The 85th percentile keeps one long free-text response from taking over the whole table.
    const bodyWidth = cellWidths[Math.floor((cellWidths.length - 1) * 0.85)] ?? 0;
    return Math.max(doc.font(FONT.bold).fontSize(SIZE.body).widthOfString(h), bodyWidth) + 16;
  });
  const min = Math.min(44, total / header.length);
  const max = total * (header.length === 2 ? 0.66 : header.length === 1 ? 1 : 0.44);
  const weights = natural.map((value) => Math.max(min, value));
  const widths = Array(header.length).fill(0) as number[];
  const open = new Set(header.map((_, i) => i));
  let remaining = total;
  while (open.size > 0) {
    const weightTotal = [...open].reduce((sum, i) => sum + weights[i]!, 0);
    const shares = new Map(
      [...open].map((i) => [i, (remaining * weights[i]!) / weightTotal] as const),
    );
    const constrained = [...open].filter((i) => shares.get(i)! < min || shares.get(i)! > max);
    if (constrained.length === 0) {
      for (const i of open) widths[i] = (remaining * weights[i]!) / weightTotal;
      break;
    }
    for (const i of constrained) {
      widths[i] = shares.get(i)! < min ? min : max;
      open.delete(i);
    }
    remaining = total - widths.reduce((sum, value) => sum + value, 0);
  }
  return widths;
}

function rowHeight(doc: Doc, cells: readonly string[], widths: readonly number[], font: string) {
  return cells.reduce((tallest, text, i) => {
    const h = doc
      .font(font)
      .fontSize(SIZE.body)
      .heightOfString(text || ' ', { width: (widths[i] ?? 0) - 12 });
    return Math.max(tallest, h);
  }, 0);
}

function writeRow(
  doc: Doc,
  cells: readonly string[],
  widths: readonly number[],
  font: string,
  height: number,
  fill?: string,
) {
  const top = doc.y;
  if (fill) {
    const tableWidth = widths.reduce((sum, w) => sum + w, 0);
    doc.rect(doc.page.margins.left, top, tableWidth, height + 6).fill(fill);
  }
  let x = doc.page.margins.left;
  cells.forEach((text, i) => {
    const w = widths[i] ?? 0;
    doc
      .font(font)
      .fontSize(SIZE.body)
      .fillColor(font === FONT.bold && fill === INK.navy ? INK.white : INK.text)
      .text(text, x + 6, top + 4, { width: w - 12 });
    x += w;
  });
  doc.y = top + height + 8;
  doc.x = doc.page.margins.left;
}

function writeTable(doc: Doc, header: readonly string[], rows: readonly string[][], width: number) {
  const widths = columnWidths(doc, header, rows, width);
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const writeHeader = () => {
    const height = rowHeight(doc, header, widths, FONT.bold);
    writeRow(doc, header, widths, FONT.bold, height, INK.navy);
    doc
      .moveTo(doc.page.margins.left, doc.y - 3)
      .lineTo(doc.page.margins.left + width, doc.y - 3)
      .strokeColor(INK.rule)
      .lineWidth(0.5)
      .stroke();
  };

  if (doc.y + 60 > bottom()) doc.addPage();
  writeHeader();
  for (const [index, row] of rows.entries()) {
    const height = rowHeight(doc, row, widths, FONT.body);
    if (doc.y + height + 6 > bottom()) {
      doc.addPage();
      writeHeader(); // a table continuing on the next page repeats its header
    }
    writeRow(doc, row, widths, FONT.body, height, index % 2 ? INK.stripe : undefined);
    doc
      .moveTo(doc.page.margins.left, doc.y - 3)
      .lineTo(doc.page.margins.left + width, doc.y - 3)
      .strokeColor(INK.rule)
      .lineWidth(0.25)
      .stroke();
  }
  doc.moveDown(0.6);
}

/** Renders the blocks to a PDF and resolves with the whole file. */
export function toPdf(blocks: readonly Block[], meta: DocumentMeta): Promise<Buffer> {
  const doc = new PDFDocument({
    size: PAGE.size,
    margins: {
      top: PAGE.marginTop,
      bottom: PAGE.marginBottom,
      left: PAGE.margin,
      right: PAGE.margin,
    },
    bufferPages: true,
    info: { Title: meta.title, Author: meta.organiser, Creator: meta.organiser },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  for (const block of blocks) {
    switch (block.kind) {
      case 'heading': {
        const size = block.level === 1 ? SIZE.h1 : block.level === 2 ? SIZE.h2 : SIZE.h3;
        if (block.level < 3 && doc.y + size * 3 > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
        }
        doc.moveDown(block.level === 1 ? 0 : block.level === 2 ? 0.85 : 0.45);
        const color = block.level === 1 ? INK.navy : block.level === 2 ? INK.navy : INK.green;
        doc.font(FONT.bold).fontSize(size).fillColor(color);
        doc.text(spansText(block.spans), { width });
        if (block.level <= 2) {
          doc.moveDown(0.3);
          doc
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.margins.left + width, doc.y)
            .strokeColor(block.level === 1 ? INK.green : INK.rule)
            .lineWidth(block.level === 1 ? 2 : 0.6)
            .stroke();
          doc.moveDown(block.level === 1 ? 0.65 : 0.45);
        } else {
          doc.moveDown(0.3);
        }
        break;
      }
      case 'note': {
        const text = spansText(block.spans);
        doc.fontSize(SIZE.body);
        const height = doc.font(FONT.bold).heightOfString(text, { width: width - 24 }) + 16;
        doc.rect(doc.page.margins.left, doc.y, width, height).fill(INK.band);
        doc.rect(doc.page.margins.left, doc.y, 3, height).fill(INK.green);
        doc.fillColor(INK.navy).font(FONT.bold);
        doc.text(text, doc.page.margins.left + 12, doc.y + 8, { width: width - 24 });
        doc.x = doc.page.margins.left;
        doc.moveDown(0.8);
        break;
      }
      case 'bullet': {
        doc.fontSize(SIZE.body);
        doc.font(FONT.body).fillColor(INK.muted).text('•', doc.page.margins.left, doc.y, {
          continued: false,
        });
        doc.y -= doc.heightOfString('•', { width: 10 });
        writeSpans(doc, block.spans, width, 12);
        doc.moveDown(0.15);
        break;
      }
      case 'paragraph': {
        doc.fontSize(SIZE.body);
        writeSpans(doc, block.spans, width);
        doc.moveDown(0.4);
        break;
      }
      case 'table':
        doc.fontSize(SIZE.body);
        writeTable(doc, block.header, block.rows, width);
        break;
    }
  }

  // Running foot on every page: who it is about and which page, so a printout stays identifiable.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc
      .font(FONT.bold)
      .fontSize(SIZE.small)
      .fillColor(INK.navy)
      .text(meta.organiser.toUpperCase(), doc.page.margins.left, 22, {
        width: width * 0.45,
        lineBreak: false,
      });
    if (meta.subtitle) {
      doc
        .font(FONT.body)
        .fontSize(SIZE.small)
        .fillColor(INK.muted)
        .text(meta.subtitle, doc.page.margins.left + width * 0.45, 22, {
          width: width * 0.55,
          align: 'right',
          lineBreak: false,
        });
    }
    doc
      .moveTo(doc.page.margins.left, 38)
      .lineTo(doc.page.margins.left + width, 38)
      .strokeColor(INK.rule)
      .lineWidth(0.5)
      .stroke();
    const y = doc.page.height - doc.page.margins.bottom + 14;
    doc
      .font(FONT.body)
      .fontSize(SIZE.small)
      .fillColor(INK.muted)
      .text(meta.title, doc.page.margins.left, y, { width: width - 60, lineBreak: false })
      .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, y, {
        width,
        align: 'right',
        lineBreak: false,
      });
  }

  doc.end();
  return done;
}
