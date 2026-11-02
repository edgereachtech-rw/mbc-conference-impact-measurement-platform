import ExcelJS from 'exceljs';

/**
 * Excel writer (task of 2026-11-02): every CSV download has an .xlsx twin built from the same
 * rows, so figures open in Excel with their types intact instead of as text a spreadsheet has to
 * guess at. ExcelJS is already a dependency (it reads the registration uploads), so this adds no
 * new library.
 *
 * A cell value stays what the caller gave it: a number is written as a number and a date as a
 * date, which is the whole point of offering Excel over CSV. Strings are written as text, so a
 * reference like "01-02" is not turned into a date by the spreadsheet.
 */

export type Cell = string | number | boolean | Date | null | undefined;

export interface Sheet {
  /** The tab name. Excel refuses brackets, slashes, colons, asterisks and question marks, and
   * anything over 31 characters, so the name is sanitised rather than allowed to fail a download. */
  name: string;
  /** Column headings; omit for a sheet of plain rows (a metadata sheet, say). */
  header?: readonly string[];
  rows: ReadonlyArray<readonly Cell[]>;
  /** Columns to render as a percentage, by zero-based index into the row (values 0-1 or 0-100). */
  percentColumns?: readonly number[];
}

const INK = { head: 'FFF3F4F6', text: 'FF111827', rule: 'FFD1D5DB' };

/** Excel's own rules for a tab name, applied quietly rather than failing a download. */
const sheetName = (name: string, index: number) => {
  const cleaned = name.replace(/[[\]*/\\?:]/g, ' ').trim();
  return (cleaned || `Sheet ${index + 1}`).slice(0, 31);
};

const widthOf = (value: Cell) => {
  if (value === null || value === undefined) return 0;
  if (value instanceof Date) return 12;
  return String(value).length;
};

export async function toXlsx(sheets: readonly Sheet[], meta: { title: string; organiser: string }) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.organiser;
  workbook.title = meta.title;
  workbook.created = new Date();

  sheets.forEach((sheet, index) => {
    const ws = workbook.addWorksheet(sheetName(sheet.name, index));
    if (sheet.header) {
      const row = ws.addRow([...sheet.header]);
      row.font = { bold: true, color: { argb: INK.text } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK.head } };
      row.border = { bottom: { style: 'thin', color: { argb: INK.rule } } };
      ws.views = [{ state: 'frozen', ySplit: 1 }]; // the headings stay in view when scrolling
      ws.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: Math.max(1, sheet.header.length) },
      };
    }
    for (const r of sheet.rows) ws.addRow(r.map((c) => (c === undefined ? null : c)));

    for (const i of sheet.percentColumns ?? []) {
      // Values are recorded as whole percentages, so the format shows the number with a % sign.
      ws.getColumn(i + 1).numFmt = '0.0"%"';
    }

    // Column widths from the content, so nothing opens as ### and no column is absurdly wide.
    const columns = Math.max(sheet.header?.length ?? 0, ...sheet.rows.map((r) => r.length), 1);
    for (let c = 0; c < columns; c += 1) {
      const longest = sheet.rows.reduce(
        (max, row) => Math.max(max, widthOf(row[c])),
        widthOf(sheet.header?.[c]),
      );
      ws.getColumn(c + 1).width = Math.min(60, Math.max(10, longest + 2));
      ws.getColumn(c + 1).alignment = { vertical: 'top', wrapText: longest > 60 };
    }
  });

  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data as ArrayBuffer);
}

/** Content types and the extension for each rich download, in one place. */
export const MEDIA_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
} as const;

export type DownloadFormat = keyof typeof MEDIA_TYPES;
