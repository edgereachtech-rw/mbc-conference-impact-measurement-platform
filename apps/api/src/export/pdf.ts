import PDFDocument from 'pdfkit';

import { type Block, type DocumentMeta, type Span, spansText } from './blocks.js';

/**
 * PDF writer (task of 2026-11-02). Takes the blocks parsed from a report's Markdown and lays them
 * out on A4 with the base-14 fonts, so no font files ship with the image and no browser is needed
 * to render a download. Tables are measured and wrapped rather than clipped: a report that does
 * not fit the width is still readable, which matters more than matching the screen exactly.
 */

const PAGE = { size: 'A4' as const, margin: 48 };
const FONT = { body: 'Helvetica', bold: 'Helvetica-Bold', italic: 'Helvetica-Oblique' };
const SIZE = { h1: 19, h2: 13.5, h3: 11.5, body: 9.5, small: 8 };
const INK = { text: '#111827', muted: '#4b5563', rule: '#d1d5db', band: '#f3f4f6' };

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

/** Column widths proportional to the widest cell in each column, never below a readable minimum. */
function columnWidths(
  doc: Doc,
  header: readonly string[],
  rows: readonly string[][],
  total: number,
) {
  const natural = header.map((h, i) => {
    const widest = rows.reduce(
      (max, row) =>
        Math.max(
          max,
          doc
            .font(FONT.body)
            .fontSize(SIZE.body)
            .widthOfString(row[i] ?? ''),
        ),
      doc.font(FONT.bold).fontSize(SIZE.body).widthOfString(h),
    );
    return widest + 12;
  });
  const sum = natural.reduce((a, b) => a + b, 0);
  if (sum <= total) return natural;
  // Too wide: give every column its share of the overflow, but keep narrow columns legible.
  const min = Math.min(46, total / header.length);
  const scaled = natural.map((w) => Math.max(min, (w / sum) * total));
  const scaledSum = scaled.reduce((a, b) => a + b, 0);
  return scaled.map((w) => (w / scaledSum) * total);
}

function rowHeight(doc: Doc, cells: readonly string[], widths: readonly number[], font: string) {
  return cells.reduce((tallest, text, i) => {
    const h = doc
      .font(font)
      .fontSize(SIZE.body)
      .heightOfString(text || ' ', { width: (widths[i] ?? 0) - 8 });
    return Math.max(tallest, h);
  }, 0);
}

function writeRow(
  doc: Doc,
  cells: readonly string[],
  widths: readonly number[],
  font: string,
  height: number,
) {
  const top = doc.y;
  let x = doc.page.margins.left;
  cells.forEach((text, i) => {
    const w = widths[i] ?? 0;
    doc
      .font(font)
      .fontSize(SIZE.body)
      .fillColor(INK.text)
      .text(text, x + 4, top + 3, { width: w - 8 });
    x += w;
  });
  doc.y = top + height + 6;
  doc.x = doc.page.margins.left;
}

function writeTable(doc: Doc, header: readonly string[], rows: readonly string[][], width: number) {
  const widths = columnWidths(doc, header, rows, width);
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const writeHeader = () => {
    const height = rowHeight(doc, header, widths, FONT.bold);
    doc
      .rect(doc.page.margins.left, doc.y, width, height + 6)
      .fill(INK.band)
      .fillColor(INK.text);
    writeRow(doc, header, widths, FONT.bold, height);
    doc
      .moveTo(doc.page.margins.left, doc.y - 3)
      .lineTo(doc.page.margins.left + width, doc.y - 3)
      .strokeColor(INK.rule)
      .lineWidth(0.5)
      .stroke();
  };

  if (doc.y + 60 > bottom()) doc.addPage();
  writeHeader();
  for (const row of rows) {
    const height = rowHeight(doc, row, widths, FONT.body);
    if (doc.y + height + 6 > bottom()) {
      doc.addPage();
      writeHeader(); // a table continuing on the next page repeats its header
    }
    writeRow(doc, row, widths, FONT.body, height);
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
    margin: PAGE.margin,
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
        doc.moveDown(block.level === 1 ? 0 : 0.7);
        doc.font(FONT.bold).fontSize(size).fillColor(INK.text);
        doc.text(spansText(block.spans), { width });
        if (block.level <= 2) {
          doc.moveDown(0.25);
          doc
            .moveTo(doc.page.margins.left, doc.y)
            .lineTo(doc.page.margins.left + width, doc.y)
            .strokeColor(INK.rule)
            .lineWidth(block.level === 1 ? 1 : 0.5)
            .stroke();
          doc.moveDown(0.5);
        } else {
          doc.moveDown(0.3);
        }
        break;
      }
      case 'note': {
        const text = spansText(block.spans);
        doc.fontSize(SIZE.body);
        const height = doc.font(FONT.bold).heightOfString(text, { width: width - 20 }) + 14;
        doc.rect(doc.page.margins.left, doc.y, width, height).fill(INK.band);
        doc.fillColor(INK.text).font(FONT.bold);
        doc.text(text, doc.page.margins.left + 10, doc.y + 7, { width: width - 20 });
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
    const y = doc.page.height - doc.page.margins.bottom + 14;
    doc
      .font(FONT.body)
      .fontSize(SIZE.small)
      .fillColor(INK.muted)
      .text(
        `${meta.subtitle ? `${meta.subtitle} · ` : ''}${meta.organiser}`,
        doc.page.margins.left,
        y,
        { width: width - 60, lineBreak: false },
      )
      .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, y, {
        width,
        align: 'right',
        lineBreak: false,
      });
  }

  doc.end();
  return done;
}
