import { z } from 'zod';

/**
 * Turning a table an admin screen already has into a spreadsheet (task of 2026-11-02).
 *
 * Most downloads are built on the server from the database. Two admin tables are assembled in the
 * browser from data it has already been served and authorised for — the transfer-plan list and the
 * measures-and-evidence report — and used to be saved as CSV with a Blob. Rather than duplicate
 * their row and label logic in a second place on the server, the browser posts the rows it is
 * showing and the server returns the workbook.
 *
 * The endpoint formats; it never reads or writes a record, so it discloses nothing the caller did
 * not already have. It is admin-only all the same, and the limits below are enforced with Zod so a
 * request cannot ask the server to build an unbounded file.
 */

const CELL = 8_000;

/** A cell keeps its type: a number stays a number in Excel, which is the point of the format. */
export const workbookCellSchema = z.union([
  z.string().max(CELL),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export type WorkbookCell = z.infer<typeof workbookCellSchema>;

export const workbookSheetSchema = z.object({
  name: z.string().trim().min(1).max(60),
  header: z.array(z.string().max(300)).max(200).optional(),
  rows: z.array(z.array(workbookCellSchema).max(200)).max(20_000),
  /** Zero-based column indexes to show as percentages. */
  percentColumns: z.array(z.number().int().min(0).max(199)).max(50).optional(),
});
export type WorkbookSheet = z.infer<typeof workbookSheetSchema>;

export const workbookRequestSchema = z.object({
  /** The file name without an extension; the server adds .xlsx and strips anything path-like. */
  filename: z.string().trim().min(1).max(120),
  /** What the workbook is, for its document properties. */
  title: z.string().trim().min(1).max(200),
  sheets: z.array(workbookSheetSchema).min(1).max(5),
});
export type WorkbookRequest = z.infer<typeof workbookRequestSchema>;

/** Keeps a client-supplied name to one safe path segment. */
export const safeFileName = (name: string) =>
  name
    .replace(/[^A-Za-z0-9._ -]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 120) || 'export';
