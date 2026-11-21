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
  danger: '#a3471f',
};

/** Starts a new page when fewer than `needed` points are left on this one. */
function room(doc: Doc, needed: number) {
  if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
}

/** The first page's title block (2026-11-21): a navy band, the title, a lead and the facts. */
function writeCover(doc: Doc, block: Extract<Block, { kind: 'cover' }>, width: number) {
  const left = doc.page.margins.left;
  doc.rect(0, 0, doc.page.width, 96).fill(INK.navy);
  doc
    .font(FONT.bold)
    .fontSize(SIZE.small)
    .fillColor(INK.white)
    .text(block.eyebrow.toUpperCase(), left, 40, { width, characterSpacing: 1.2 });
  doc.y = 128;
  doc.font(FONT.bold).fontSize(24).fillColor(INK.navy).text(block.title, left, doc.y, { width });
  if (block.lead) {
    doc.moveDown(0.5);
    doc.font(FONT.body).fontSize(11).fillColor(INK.muted).text(block.lead, { width });
  }
  doc.moveDown(1);
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .strokeColor(INK.green)
    .lineWidth(2)
    .stroke();
  doc.moveDown(0.9);
  const column = (width - 24) / 2;
  for (let i = 0; i < block.facts.length; i += 2) {
    const top = doc.y;
    let tallest = 0;
    block.facts.slice(i, i + 2).forEach((fact, j) => {
      const x = left + j * (column + 24);
      doc
        .font(FONT.bold)
        .fontSize(SIZE.small)
        .fillColor(INK.muted)
        .text(fact.label.toUpperCase(), x, top, { width: column, characterSpacing: 0.6 });
      doc
        .font(FONT.bold)
        .fontSize(11)
        .fillColor(INK.text)
        .text(fact.value, x, doc.y + 2, {
          width: column,
        });
      tallest = Math.max(tallest, doc.y - top);
    });
    doc.y = top + tallest + 12;
  }
  doc.x = left;
  doc.moveDown(0.6);
}

/** Headline figures in tiles of up to three a row, each with a green rule above. */
function writeFigures(doc: Doc, items: Array<{ value: string; label: string }>, width: number) {
  const left = doc.page.margins.left;
  const perRow = Math.min(3, Math.max(1, items.length));
  const gap = 12;
  const tile = (width - gap * (perRow - 1)) / perRow;
  for (let i = 0; i < items.length; i += perRow) {
    room(doc, 64);
    const top = doc.y;
    let tallest = 0;
    items.slice(i, i + perRow).forEach((item, j) => {
      const x = left + j * (tile + gap);
      const labelHeight = doc
        .font(FONT.body)
        .fontSize(SIZE.small + 0.5)
        .heightOfString(item.label, { width: tile - 20 });
      const height = 42 + labelHeight;
      tallest = Math.max(tallest, height);
      doc.rect(x, top, tile, height).fill(INK.band);
      doc.rect(x, top, tile, 3).fill(INK.green);
      doc
        .font(FONT.bold)
        .fontSize(18)
        .fillColor(INK.navy)
        .text(item.value, x + 10, top + 12, {
          width: tile - 20,
          lineBreak: false,
        });
      doc
        .font(FONT.body)
        .fontSize(SIZE.small + 0.5)
        .fillColor(INK.muted)
        .text(item.label, x + 10, top + 36, { width: tile - 20 });
    });
    doc.y = top + tallest + gap;
  }
  doc.x = left;
  doc.moveDown(0.4);
}

/** The band that opens one delegate's response; never left alone at the foot of a page. */
function writeRespondent(doc: Doc, name: string, details: string, width: number) {
  const left = doc.page.margins.left;
  doc.fontSize(SIZE.small + 0.5);
  const detailsHeight = doc.font(FONT.body).heightOfString(details || ' ', { width: width - 24 });
  const height = 26 + detailsHeight;
  room(doc, height + 70);
  doc.moveDown(0.6);
  const top = doc.y;
  doc.rect(left, top, width, height).fill(INK.band);
  doc.rect(left, top, 3, height).fill(INK.navy);
  doc
    .font(FONT.bold)
    .fontSize(12)
    .fillColor(INK.navy)
    .text(name, left + 12, top + 7, {
      width: width - 24,
    });
  doc
    .font(FONT.body)
    .fontSize(SIZE.small + 0.5)
    .fillColor(INK.muted)
    .text(details, left + 12, doc.y + 1, { width: width - 24 });
  doc.y = top + height + 6;
  doc.x = left;
}

/** A small green heading inside a response. */
function writeLabel(doc: Doc, text: string, width: number) {
  room(doc, 44);
  doc.moveDown(0.35);
  doc
    .font(FONT.bold)
    .fontSize(SIZE.small + 0.5)
    .fillColor(INK.green)
    .text(text.toUpperCase(), doc.page.margins.left, doc.y, { width, characterSpacing: 0.6 });
  doc.moveDown(0.25);
}

/** One question and its answer, in three columns: number, question as asked, answer. */
function writeQa(doc: Doc, block: Extract<Block, { kind: 'qa' }>, width: number) {
  const left = doc.page.margins.left;
  const numberWidth = 26;
  const questionWidth = Math.round(width * 0.4);
  const answerWidth = width - numberWidth - questionWidth - 10;
  const answer = block.empty ? 'No answer' : block.answer;
  const markText =
    block.mark === 'correct' ? '  (correct)' : block.mark === 'incorrect' ? '  (incorrect)' : '';
  doc.fontSize(SIZE.body);
  const questionHeight = doc
    .font(FONT.body)
    .heightOfString(block.question, { width: questionWidth - 8 });
  const answerHeight = doc
    .font(block.empty ? FONT.italic : FONT.body)
    .heightOfString(answer + markText, { width: answerWidth });
  const height = Math.max(questionHeight, answerHeight);
  room(doc, height + 10);
  const top = doc.y + 3;
  doc
    .font(FONT.body)
    .fontSize(SIZE.small + 0.5)
    .fillColor(INK.muted)
    .text(block.number, left, top + 1, {
      width: numberWidth,
    });
  doc
    .font(FONT.body)
    .fontSize(SIZE.body)
    .fillColor(INK.muted)
    .text(block.question, left + numberWidth, top, {
      width: questionWidth - 8,
    });
  const x = left + numberWidth + questionWidth + 10;
  doc
    .font(block.empty ? FONT.italic : FONT.body)
    .fontSize(SIZE.body)
    .fillColor(block.empty ? INK.muted : INK.text)
    .text(answer, x, top, { width: answerWidth, continued: Boolean(markText) });
  if (markText) {
    doc
      .font(FONT.bold)
      .fillColor(block.mark === 'correct' ? INK.green : INK.danger)
      .text(markText, { continued: false });
  }
  doc.y = top + height + 5;
  doc
    .moveTo(left, doc.y)
    .lineTo(left + width, doc.y)
    .strokeColor(INK.rule)
    .lineWidth(0.25)
    .stroke();
  doc.x = left;
}

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
      case 'cover':
        writeCover(doc, block, width);
        break;
      case 'figures':
        writeFigures(doc, block.items, width);
        break;
      case 'respondent':
        writeRespondent(doc, block.name, block.details, width);
        break;
      case 'label':
        writeLabel(doc, block.text, width);
        break;
      case 'qa':
        writeQa(doc, block, width);
        break;
      case 'pagebreak':
        if (doc.y > doc.page.margins.top + 4) doc.addPage();
        break;
    }
  }

  // Running head and foot on every page: who it is about and which page, so a printout stays
  // identifiable. They sit in the margins, so the bottom margin is lifted while they are written:
  // text below it would otherwise make the writer start a new, empty page (2026-11-21).
  const range = doc.bufferedPageRange();
  const coverFirst = blocks[0]?.kind === 'cover';
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const foot = doc.page.height - bottom + 14;
    if (meta.footnote) {
      doc
        .font(FONT.body)
        .fontSize(SIZE.small - 1)
        .fillColor(INK.muted)
        .text(meta.footnote, doc.page.margins.left, foot + 12, { width, lineBreak: false });
    }
    if (!(coverFirst && i === 0)) {
      // The cover's own band carries the organiser; the other pages carry it in the head.
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
      doc
        .font(FONT.body)
        .fontSize(SIZE.small)
        .fillColor(INK.muted)
        .text(meta.title, doc.page.margins.left, foot, { width: width - 60, lineBreak: false });
    }
    doc
      .font(FONT.body)
      .fontSize(SIZE.small)
      .fillColor(INK.muted)
      .text(`Page ${i + 1} of ${range.count}`, doc.page.margins.left, foot, {
        width,
        align: 'right',
        lineBreak: false,
      });
    doc.page.margins.bottom = bottom;
  }

  doc.end();
  return done;
}
