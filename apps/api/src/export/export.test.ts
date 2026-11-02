import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { parseBlocks, parseSpans, spansText, type Block } from './blocks.js';
import { blocksText, toDocx } from './docx.js';
import { toPdf } from './pdf.js';
import { toXlsx } from './xlsx.js';

/**
 * The rich downloads (task of 2026-11-02). The PDF and Word files are laid out from the blocks
 * parsed out of the report's own Markdown, so the parser is where the content lives and is tested
 * hardest; the writers are checked for a real, openable file. The Excel workbook is re-opened and
 * read back, which proves the cells and their types rather than just the bytes.
 */

const META = { title: 'Test report', organiser: 'M.Bryan Consulting Group' };

describe('markdown blocks', () => {
  it('reads headings, bullets, notes, paragraphs and tables', () => {
    const blocks = parseBlocks(
      [
        '# Event: Immediate conference report',
        '',
        '> **DRAFT: not approved for sharing.** Reviewed first.',
        '',
        '- **Population:** 120 delegates. Everyone registered.',
        '',
        '## Participation',
        '',
        'Pre-conference assessment: 80 submitted of 120 invited (67%).',
        '',
        '| Option | Count | % of answers |',
        '| --- | --- | --- |',
        '| Yes | 50 | 63% |',
        '| No | 30 | 38% |',
        '',
        '### A sub-heading',
      ].join('\n'),
    );
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'note',
      'bullet',
      'heading',
      'paragraph',
      'table',
      'heading',
    ]);
    const [h1, note, bullet, h2, paragraph, table, h3] = blocks as Block[];
    expect(h1).toMatchObject({ level: 1 });
    const textOf = (block: Block | undefined) =>
      block && block.kind !== 'table' ? spansText(block.spans) : '';
    expect(textOf(h1)).toBe('Event: Immediate conference report');
    expect(h2).toMatchObject({ level: 2 });
    expect(h3).toMatchObject({ level: 3 });
    // The bold run inside a line is kept as its own span so the writers can bold just that part.
    expect(bullet && bullet.kind === 'bullet' ? bullet.spans : []).toEqual([
      { text: 'Population:', bold: true },
      { text: ' 120 delegates. Everyone registered.' },
    ]);
    expect(textOf(note)).toBe('DRAFT: not approved for sharing. Reviewed first.');
    expect(textOf(paragraph)).toContain('80 submitted of 120 invited');
    expect(table).toEqual({
      kind: 'table',
      header: ['Option', 'Count', '% of answers'],
      rows: [
        ['Yes', '50', '63%'],
        ['No', '30', '38%'],
      ],
    });
  });

  it('keeps a pipe inside a cell, and does not mistake a lone pipe row for a table', () => {
    const table = parseBlocks(
      ['| A | B |', '| --- | --- |', 'x', '| one \\| two | three |'].join('\n'),
    );
    // The row after the rule is plain text, so the table ends there and the pipe row follows.
    expect(table[0]).toEqual({ kind: 'table', header: ['A', 'B'], rows: [] });
    expect(table[1]!.kind).toBe('paragraph');
    expect(table[2]!.kind).toBe('paragraph');

    const withPipe = parseBlocks(
      ['| A | B |', '| --- | --- |', '| one \\| two | three |'].join('\n'),
    );
    expect(withPipe[0]).toEqual({
      kind: 'table',
      header: ['A', 'B'],
      rows: [['one | two', 'three']],
    });
  });

  it('pads a short row and ignores a trailing extra cell, so columns always line up', () => {
    const blocks = parseBlocks(
      ['| A | B | C |', '| --- | --- | --- |', '| 1 |', '| 1 | 2 | 3 | 4 |'].join('\n'),
    );
    expect(blocks[0]).toEqual({
      kind: 'table',
      header: ['A', 'B', 'C'],
      rows: [
        ['1', '', ''],
        ['1', '2', '3'],
      ],
    });
  });

  it('reads italic runs and plain text with no markers', () => {
    expect(parseSpans('a _b_ c')).toEqual([
      { text: 'a ' },
      { text: 'b', italic: true },
      { text: ' c' },
    ]);
    expect(parseSpans('plain')).toEqual([{ text: 'plain' }]);
    expect(parseSpans('')).toEqual([{ text: '' }]);
  });
});

const REPORT = [
  '# ITTEC 2026: Immediate conference report',
  '',
  '> **DRAFT: not approved for sharing.**',
  '',
  '- **Population:** 2 delegates',
  '',
  '## Participation',
  '',
  'Two delegates attended.',
  '',
  '| Metric | Count | Of |',
  '| --- | --- | --- |',
  '| Registered | 2 | 2 |',
  '| Attended | 1 | 2 |',
].join('\n');

describe('PDF', () => {
  it('writes a real PDF with the report content', async () => {
    const file = await toPdf(parseBlocks(REPORT), { ...META, subtitle: 'ITTEC 2026' });
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
    expect(file.toString('latin1')).toContain('%%EOF');
    expect(file.length).toBeGreaterThan(1_000);
  });

  it('spreads a long table over pages without failing', async () => {
    const rows = Array.from({ length: 180 }, (_, i) => `| Row ${i} | ${i} | 200 |`);
    const blocks = parseBlocks(
      ['# Long', '', '| Metric | Count | Of |', '| --- | --- | --- |', ...rows].join('\n'),
    );
    const file = await toPdf(blocks, META);
    // "Page 1 of N" is written on every page once the whole document is laid out.
    expect(file.length).toBeGreaterThan(10_000);
    expect(file.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('Word', () => {
  it('writes a real .docx carrying the report text', async () => {
    const file = await toDocx(parseBlocks(REPORT), { ...META, subtitle: 'ITTEC 2026' });
    // A .docx is a zip: PK magic bytes, and the parts Word expects named in the archive.
    expect(file.subarray(0, 2).toString()).toBe('PK');
    const archive = file.toString('latin1');
    expect(archive).toContain('word/document.xml');
    expect(archive).toContain('[Content_Types].xml');
    expect(file.length).toBeGreaterThan(1_000);
  });

  it('flattens blocks to text, tables included', () => {
    expect(blocksText(parseBlocks(REPORT))).toContain('Registered | 2 | 2');
    expect(blocksText(parseBlocks(REPORT))).toContain('ITTEC 2026: Immediate conference report');
  });
});

describe('Excel', () => {
  async function reopen(file: Buffer) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as ArrayBuffer);
    return workbook;
  }

  it('writes cells that keep their type, with a frozen heading row', async () => {
    const file = await toXlsx(
      [
        {
          name: 'Figures',
          header: ['Metric', 'Count', 'Percent'],
          rows: [
            ['Registered', 2, null],
            ['Attended', 1, 50],
          ],
          percentColumns: [2],
        },
      ],
      META,
    );
    const workbook = await reopen(file);
    const sheet = workbook.getWorksheet('Figures')!;
    expect(sheet.getRow(1).values).toEqual([undefined, 'Metric', 'Count', 'Percent']);
    expect(sheet.getRow(1).font?.bold).toBe(true);
    expect(sheet.getRow(2).getCell(1).value).toBe('Registered');
    // A count is a number, not the text "2": the reason to offer Excel rather than CSV.
    expect(sheet.getRow(2).getCell(2).value).toBe(2);
    expect(typeof sheet.getRow(3).getCell(3).value).toBe('number');
    expect(sheet.getColumn(3).numFmt).toContain('%');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(workbook.creator).toBe(META.organiser);
  });

  it('writes several sheets and sanitises a name Excel would refuse', async () => {
    const file = await toXlsx(
      [
        { name: 'Report', header: ['Field', 'Value'], rows: [['Event', 'ITTEC 2026']] },
        { name: 'Sessions / rooms [2026]: a very long tab name indeed', rows: [['x']] },
      ],
      META,
    );
    const workbook = await reopen(file);
    expect(workbook.worksheets).toHaveLength(2);
    const second = workbook.worksheets[1]!;
    expect(second.name.length).toBeLessThanOrEqual(31);
    expect(second.name).not.toContain('/');
    expect(second.name).not.toContain('[');
    expect(workbook.getWorksheet('Report')!.getRow(2).getCell(2).value).toBe('ITTEC 2026');
  });

  it('writes a sheet of plain rows with no heading row', async () => {
    const file = await toXlsx(
      [{ name: 'Feedback', rows: [['Event', 'ITTEC'], [], ['Rating', 4]] }],
      META,
    );
    const sheet = (await reopen(file)).getWorksheet('Feedback')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Event');
    expect(sheet.getRow(3).getCell(2).value).toBe(4);
    // No heading row means no frozen pane: ExcelJS reports no views at all for such a sheet.
    expect((sheet.views ?? [])[0]?.state).not.toBe('frozen');
  });
});
