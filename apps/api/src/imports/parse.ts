import { createHash } from 'node:crypto';

import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS } from '@mbc/shared';
import ExcelJS from 'exceljs';

import { HttpError } from '../lib/errors.js';

/**
 * File parsing for registration imports (backlog D3 steps 2 and 3, D9 Files).
 *
 * - `.csv`: UTF-8 (BOM tolerated, invalid bytes refused), comma or semicolon detected from the
 *   header line, RFC 4180 quoting, header row required.
 * - `.xlsx`: first worksheet, cells read as values only. A formula cell contributes its cached
 *   result (or nothing); nothing is evaluated, macros and links are never followed.
 * - Limits (decided): 10 MB and 5,000 data rows; `.xls` and every other type are refused.
 *
 * Output is a header list and one record per data row keyed by header name. Cells are strings;
 * numbers and dates from XLSX are rendered as text. No normalisation happens here.
 */

export type CsvEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252';

export interface ParsedFile {
  headers: string[];
  rows: Array<Record<string, string>>;
  /** Comma or semicolon for CSV; null for XLSX. */
  delimiter: ',' | ';' | null;
  /** How the CSV bytes were decoded; null for XLSX. Anything but utf-8 is reported to the admin. */
  encoding: CsvEncoding | null;
  fileHash: string;
}

export type ImportFileType = 'csv' | 'xlsx';

const SPLIT_HINT = 'Split the export into smaller files and import each one.';

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The accepted type for a file name, or a 415 refusal. `.xls`, `.xlsm` and friends are refused. */
export function fileTypeOf(fileName: string): ImportFileType {
  const lower = fileName.trim().toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx')) return 'xlsx';
  throw new HttpError(
    415,
    'unsupported_file_type',
    'Only .csv and .xlsx files can be imported. Export the registrations as CSV or XLSX (not .xls).',
  );
}

export function assertSizeWithinLimit(sizeBytes: number): void {
  if (sizeBytes > IMPORT_MAX_FILE_BYTES) {
    throw new HttpError(
      413,
      'file_too_large',
      `The file is larger than ${IMPORT_MAX_FILE_BYTES / (1024 * 1024)} MB. ${SPLIT_HINT}`,
    );
  }
  if (sizeBytes === 0) throw new HttpError(422, 'file_empty', 'The file is empty.');
}

export async function parseImportFile(bytes: Uint8Array, fileName: string): Promise<ParsedFile> {
  assertSizeWithinLimit(bytes.byteLength);
  const type = fileTypeOf(fileName);
  const fileHash = sha256(bytes);
  const table = type === 'csv' ? parseCsv(bytes) : await parseXlsx(bytes);
  return { ...table, fileHash };
}

// ---------------------------------------------------------------------------------------------
// Shared table shaping

interface RawTable {
  headers: string[];
  rows: Array<Record<string, string>>;
  delimiter: ',' | ';' | null;
  encoding: CsvEncoding | null;
}

function shapeTable(records: string[][], delimiter: ',' | ';' | null): RawTable {
  // Drop fully blank trailing lines; keep interior blank rows out as well (they carry nothing).
  const nonBlank = records.filter((cells) => cells.some((c) => c.trim() !== ''));
  if (nonBlank.length === 0) {
    throw new HttpError(422, 'header_missing', 'The file has no header row.');
  }
  const headerCells = nonBlank[0]!.map((h) => h.trim());
  if (headerCells.every((h) => h === '')) {
    throw new HttpError(422, 'header_missing', 'The first row must contain the column names.');
  }
  const headers = headerCells.map((h, i) => (h === '' ? `column_${i + 1}` : h));
  const seen = new Map<string, number>();
  for (const h of headers) {
    const key = h.toLowerCase();
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  if (duplicates.length > 0) {
    throw new HttpError(
      422,
      'header_duplicate',
      `Column names must be unique; repeated: ${duplicates.slice(0, 5).join(', ')}.`,
    );
  }
  const dataRows = nonBlank.slice(1);
  if (dataRows.length > IMPORT_MAX_ROWS) {
    throw new HttpError(
      413,
      'too_many_rows',
      `The file has ${dataRows.length} rows; the limit is ${IMPORT_MAX_ROWS}. ${SPLIT_HINT}`,
    );
  }
  const rows = dataRows.map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = cells[i] ?? '';
    });
    return record;
  });
  return { headers, rows, delimiter, encoding: null };
}

// ---------------------------------------------------------------------------------------------
// CSV

/**
 * Decodes CSV bytes. UTF-8 (with or without BOM) is the documented format (D3 step 2). Excel's
 * other CSV flavours are accepted because registration teams send them: "Unicode Text" carries a
 * UTF-16 byte-order mark and decodes losslessly; the Windows default "CSV (Comma delimited)"
 * writes Windows-1252, which cannot be told apart from damaged UTF-8 by inspection, so it is
 * decoded as Windows-1252 and the admin is warned to check accented names in the preview.
 */
export function decodeCsvBytes(bytes: Uint8Array): { text: string; encoding: CsvEncoding } {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes), encoding: 'utf-16le' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes), encoding: 'utf-16be' };
  }
  try {
    return {
      text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes),
      encoding: 'utf-8',
    };
  } catch {
    return { text: new TextDecoder('windows-1252').decode(bytes), encoding: 'windows-1252' };
  }
}

/** Kept for callers that must insist on UTF-8. */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new HttpError(
      422,
      'unreadable_encoding',
      'The file is not valid UTF-8 text. Export it again as UTF-8 CSV or as XLSX.',
    );
  }
}

/** Comma unless the header line holds more unquoted semicolons than commas. */
export function detectDelimiter(firstLine: string): ',' | ';' {
  let commas = 0;
  let semis = 0;
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') commas += 1;
    else if (!quoted && ch === ';') semis += 1;
  }
  return semis > commas ? ';' : ',';
}

/** Strict RFC 4180 reader: quotes escape with "", fields may span lines when quoted. */
export function parseCsvRecords(text: string, delimiter: ',' | ';'): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (field === '') {
        quoted = true;
        i += 1;
        continue;
      }
      // A quote inside an unquoted field is kept literally (lenient on sloppy exports).
      field += ch;
      i += 1;
      continue;
    }
    if (ch === delimiter) {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
      if (ch === '\r' && text[i + 1] === '\n') i += 2;
      else i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (quoted) {
    throw new HttpError(422, 'csv_malformed', 'A quoted value is not closed. Check the last rows.');
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

export function parseCsv(bytes: Uint8Array): RawTable {
  const { text: decoded, encoding } = decodeCsvBytes(bytes);
  const text = decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  const firstLineEnd = text.search(/\r|\n/);
  const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
  const delimiter = detectDelimiter(firstLine);
  return { ...shapeTable(parseCsvRecords(text, delimiter), delimiter), encoding };
}

// ---------------------------------------------------------------------------------------------
// XLSX (values only)

type CellValue = ExcelJS.CellValue;

/** Renders a cell as text without evaluating anything: formulas give their cached result only. */
export function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('');
    }
    if ('text' in value && typeof value.text === 'string') return value.text; // hyperlink: text only
    if ('result' in value) return cellText(value.result as CellValue); // formula: cached result
    if ('error' in value) return '';
    if ('text' in value && value.text && typeof value.text === 'object') {
      return cellText(value.text as CellValue);
    }
  }
  return '';
}

export async function parseXlsx(bytes: Uint8Array): Promise<RawTable> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(bytes) as never);
  } catch {
    throw new HttpError(422, 'xlsx_unreadable', 'The file could not be read as an XLSX workbook.');
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new HttpError(422, 'header_missing', 'The workbook has no worksheet.');
  const records: string[][] = [];
  let width = 0;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    const values = row.values as CellValue[]; // 1-based: index 0 is unused
    for (let c = 1; c < values.length; c += 1) cells.push(cellText(values[c]));
    width = Math.max(width, cells.length);
    records.push(cells);
    if (records.length > IMPORT_MAX_ROWS + 1) {
      throw new HttpError(
        413,
        'too_many_rows',
        `The worksheet has more than ${IMPORT_MAX_ROWS} rows. ${SPLIT_HINT}`,
      );
    }
  });
  return shapeTable(
    records.map((cells) => [...cells, ...Array<string>(width - cells.length).fill('')]),
    null,
  );
}
