import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { importConfigFromEnv } from './config.js';
import {
  headerSignature,
  isAttendanceRecordColumn,
  suggestMapping,
  validateMapping,
} from './mapping.js';
import { classifyRows, countRows, type MatchContext } from './matching.js';
import { normaliseNameKey, normaliseRow, parseAttendanceFormat } from './normalise.js';
import { cellText, detectDelimiter, parseCsv, parseCsvRecords, parseImportFile } from './parse.js';
import { csvCell } from './service.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('CSV parsing (D3 step 2, criterion 1)', () => {
  it('detects comma and semicolon from the header line and honours quoting', () => {
    expect(detectDelimiter('a,b;c')).toBe(',');
    expect(detectDelimiter('a;b;c,d')).toBe(';');
    expect(detectDelimiter('"x;y;z",b')).toBe(',');
    expect(parseCsvRecords('a,"b,1","c ""q""",d\r\n1,2,3,4\n', ',')).toEqual([
      ['a', 'b,1', 'c "q"', 'd'],
      ['1', '2', '3', '4'],
    ]);
  });

  it('strips a BOM, requires a header, refuses duplicate headers and invalid UTF-8', () => {
    const ok = parseCsv(enc('﻿Email;Name\r\na@x.io;Ann\r\n\r\n'));
    expect(ok.delimiter).toBe(';');
    expect(ok.headers).toEqual(['Email', 'Name']);
    expect(ok.rows).toEqual([{ Email: 'a@x.io', Name: 'Ann' }]);
    expect(() => parseCsv(enc('\n\n'))).toThrow(/header/);
    expect(() => parseCsv(enc('Email,email\na,b'))).toThrow(/unique/);
    // Excel's Windows default writes Windows-1252: decoded, with the encoding reported.
    const ansi = parseCsv(
      new Uint8Array([
        0x45, 0x6d, 0x61, 0x69, 0x6c, 0x2c, 0x4e, 0x6f, 0x6d, 0x0a, 0x61, 0x40, 0x78, 0x2e, 0x69,
        0x6f, 0x2c, 0x52, 0x65, 0x6e, 0xe9, 0x0a,
      ]),
    );
    expect(ansi.encoding).toBe('windows-1252');
    expect(ansi.rows[0]).toEqual({ Email: 'a@x.io', Nom: 'Ren\u00e9' });
    // Excel's "Unicode Text" is UTF-16 with a byte-order mark: decoded losslessly.
    const utf16 = new Uint8Array([
      0xff,
      0xfe,
      ...Buffer.from('Email\tNom\na@x.io\tRen\u00e9\n'.replace(/\t/g, ','), 'utf16le'),
    ]);
    const wide = parseCsv(utf16);
    expect(wide.encoding).toBe('utf-16le');
    expect(wide.rows[0]).toEqual({ Email: 'a@x.io', Nom: 'Ren\u00e9' });
    expect(parseCsv(enc('Email,Nom\na@x.io,Ren\u00e9')).encoding).toBe('utf-8');
    expect(() => parseCsv(enc('a,b\n"open'))).toThrow(/not closed/);
  });

  it('refuses wrong types, empty and oversize files, and more than 5,000 rows with split guidance', async () => {
    await expect(parseImportFile(enc('a,b\n1,2'), 'export.xls')).rejects.toMatchObject({
      status: 415,
    });
    await expect(parseImportFile(new Uint8Array(0), 'x.csv')).rejects.toMatchObject({
      code: 'file_empty',
    });
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    await expect(parseImportFile(big, 'x.csv')).rejects.toMatchObject({ code: 'file_too_large' });
    const lines = ['email,name'];
    for (let i = 0; i < 5001; i += 1) lines.push(`u${i}@x.io,User ${i}`);
    await expect(parseImportFile(enc(lines.join('\n')), 'x.csv')).rejects.toMatchObject({
      code: 'too_many_rows',
      message: expect.stringMatching(/Split the export/),
    });
    lines.pop();
    const ok = await parseImportFile(enc(lines.join('\n')), 'x.csv');
    expect(ok.rows).toHaveLength(5000);
  });
});

describe('XLSX parsing values-only (criterion 1)', () => {
  async function workbook(build: (sheet: ExcelJS.Worksheet) => void): Promise<Uint8Array> {
    const wb = new ExcelJS.Workbook();
    build(wb.addWorksheet('Registrations'));
    return new Uint8Array(await wb.xlsx.writeBuffer());
  }

  it('reads the first worksheet, formulas give cached results only, links give their text', async () => {
    const bytes = await workbook((sheet) => {
      sheet.addRow(['Email', 'Name', 'Format', 'Note']);
      sheet.addRow(['a@x.io', 'Ann A', 'Virtual', { formula: 'SUM(1,2)', result: 3 }]);
      sheet.addRow([
        { text: 'b@x.io', hyperlink: 'mailto:b@x.io' },
        { richText: [{ text: 'Bob ' }, { text: 'B' }] },
        'In person',
        { formula: 'HYPERLINK("http://evil")' },
      ]);
    });
    const parsed = await parseImportFile(bytes, 'reg.xlsx');
    expect(parsed.headers).toEqual(['Email', 'Name', 'Format', 'Note']);
    expect(parsed.rows[0]).toEqual({
      Email: 'a@x.io',
      Name: 'Ann A',
      Format: 'Virtual',
      Note: '3',
    });
    expect(parsed.rows[1]).toEqual({
      Email: 'b@x.io',
      Name: 'Bob B',
      Format: 'In person',
      Note: '',
    });
    expect(cellText(new Date('2026-11-12T00:00:00Z'))).toBe('2026-11-12T00:00:00.000Z');
    expect(cellText({ error: '#REF!' } as never)).toBe('');
  });

  it('a CSV and an XLSX with the same rows parse identically', async () => {
    const rows = [
      ['Email', 'Name', 'Format'],
      ['a@x.io', 'Ann A', 'physical'],
      ['b@x.io', 'Bob B', 'virtual'],
    ];
    const csv = await parseImportFile(enc(rows.map((r) => r.join(',')).join('\n')), 'r.csv');
    const xlsx = await parseImportFile(
      await workbook((sheet) => rows.forEach((r) => sheet.addRow(r))),
      'r.xlsx',
    );
    expect(xlsx.headers).toEqual(csv.headers);
    expect(xlsx.rows).toEqual(csv.rows);
  });

  it('refuses a workbook that is not XLSX', async () => {
    await expect(parseImportFile(enc('not a zip'), 'x.xlsx')).rejects.toMatchObject({
      code: 'xlsx_unreadable',
    });
  });
});

describe('mapping (E2-8, D4)', () => {
  it('suggests a generic mapping from header synonyms and joins first and last names', () => {
    const { mapping, unmapped } = suggestMapping([
      'E-mail Address',
      'First Name',
      'Last Name',
      'Company',
      'Ticket Type',
      'Checked In',
      'Registration ID',
    ]);
    expect(mapping.email).toBe('E-mail Address');
    expect(mapping.name).toEqual({ first: 'First Name', last: 'Last Name' });
    expect(mapping.organisation).toBe('Company');
    expect(mapping.attendanceFormat).toBe('Ticket Type');
    expect(mapping.externalRegistrationId).toBe('Registration ID');
    expect(unmapped).toEqual(['Checked In']);
    expect(isAttendanceRecordColumn('Checked In')).toBe(true);
    expect(isAttendanceRecordColumn('Attendance format')).toBe(false);
  });

  it('refuses unknown, reused and attendance-record columns, and an unmapped required field', () => {
    const headers = ['Email', 'Name', 'Attended'];
    expect(() => validateMapping({ email: 'Email', name: 'Nope' }, headers, 'physical')).toThrow(
      /no column/,
    );
    expect(() => validateMapping({ email: 'Email', name: 'Email' }, headers, 'physical')).toThrow(
      /mapped to both/,
    );
    expect(() =>
      validateMapping(
        { email: 'Email', name: 'Name', attendanceFormat: 'Attended' },
        headers,
        undefined,
      ),
    ).toThrow(/never imported/);
    expect(() => validateMapping({ email: 'Email', name: 'Name' }, headers, undefined)).toThrow(
      /attendanceFormat is not mapped/,
    );
    expect(validateMapping({ email: 'Email', name: 'Name' }, headers, 'virtual')).toEqual({
      ignoredColumns: ['Attended'],
    });
    expect(headerSignature(['Email ', 'NAME'])).toBe(headerSignature(['email', 'name']));
    expect(headerSignature(['Email'])).not.toBe(headerSignature(['Email', 'Name']));
  });
});

describe('row normalisation and validation (D3 step 3, D4, criterion 2)', () => {
  const mapping = {
    email: 'Email',
    name: 'Name',
    attendanceFormat: 'Format',
    organisation: 'Org',
    registrationStatus: 'Status',
    capacity: 'Capacity',
  };

  it('accepts a valid row with defaults, synonyms and normalised email', () => {
    const row = normaliseRow(
      {
        Email: ' Ann@X.IO ',
        Name: '  Ann   A ',
        Format: 'In person',
        Org: '',
        Status: '',
        Capacity: '',
      },
      mapping,
      undefined,
    );
    expect(row).toEqual({
      ok: true,
      values: {
        email: 'ann@x.io',
        name: 'Ann A',
        attendanceFormat: 'physical',
        organisation: null,
        jobTitle: null,
        country: null,
        capacity: 'individual',
        nominatingOrganisation: null,
        registrationStatus: 'active',
        externalRegistrationId: null,
      },
    });
    // Export placeholders for absent values are empty, never stored as text.
    const placeholders = normaliseRow(
      { Email: 'b@x.io', Name: 'B', Format: 'Physical', Org: 'NULL', Status: 'N/A', Capacity: '-' },
      mapping,
      undefined,
    );
    expect(placeholders.ok && placeholders.values.organisation).toBeNull();
    expect(placeholders.ok && placeholders.values.registrationStatus).toBe('active');
    expect(placeholders.ok && placeholders.values.capacity).toBe('individual');
    const nullFormat = normaliseRow(
      { Email: 'b@x.io', Name: 'B', Format: 'NULL' },
      mapping,
      undefined,
    );
    expect(nullFormat.ok).toBe(false);
    expect(parseAttendanceFormat('ONLINE')).toBe('virtual');
    expect(parseAttendanceFormat('hybrid')).toBeUndefined();
  });

  it('rejects invalid email, missing name, unknown format, control characters, duplicate/test status', () => {
    const bad = normaliseRow(
      {
        Email: 'not-an-email',
        Name: '',
        Format: 'teleport',
        Org: 'A\u0007B',
        Status: 'test',
        Capacity: 'x',
      },
      mapping,
      undefined,
    );
    expect(bad.ok).toBe(false);
    if (bad.ok) return;
    expect(bad.rejections.map((r) => r.reason).sort()).toEqual(
      [
        'attendance_format_unknown',
        'capacity_unknown',
        'control_character',
        'email_invalid',
        'name_missing',
        'registration_status_unknown',
      ].sort(),
    );
    const missing = normaliseRow({ Email: '', Name: 'X', Format: 'virtual' }, mapping, undefined);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.rejections[0]?.reason).toBe('email_missing');
    const long = normaliseRow(
      { Email: 'a@x.io', Name: 'x'.repeat(201), Format: 'virtual' },
      mapping,
      undefined,
    );
    expect(long.ok).toBe(false);
  });

  it('applies admin translations of file values before the built-in synonyms and never guesses the rest', () => {
    const translations = {
      attendanceFormat: { 'Standard (NGR)': 'physical' as const, '': 'virtual' as const },
      capacity: { 'Team Rate': 'nominee' as const },
      registrationStatus: { pending: 'active' as const },
    };
    const tier = normaliseRow(
      {
        Email: 'a@x.io',
        Name: 'A',
        Format: 'standard (ngr)',
        Capacity: 'Team Rate',
        Status: 'PENDING',
      },
      mapping,
      undefined,
      translations,
    );
    expect(tier.ok && tier.values.attendanceFormat).toBe('physical');
    expect(tier.ok && tier.values.capacity).toBe('nominee');
    expect(tier.ok && tier.values.registrationStatus).toBe('active');
    const blank = normaliseRow(
      { Email: 'a@x.io', Name: 'A', Format: '' },
      mapping,
      undefined,
      translations,
    );
    expect(blank.ok && blank.values.attendanceFormat).toBe('virtual');
    const untranslated = normaliseRow(
      { Email: 'a@x.io', Name: 'A', Format: 'Final (NGR)' },
      mapping,
      undefined,
      translations,
    );
    expect(untranslated.ok).toBe(false);
    if (!untranslated.ok)
      expect(untranslated.rejections[0]?.reason).toBe('attendance_format_unknown');
  });

  it('applies the run-wide attendance default only when no column is mapped', () => {
    const noColumn = normaliseRow(
      { Email: 'a@x.io', Name: 'A' },
      { email: 'Email', name: 'Name' },
      'virtual',
    );
    expect(noColumn.ok && noColumn.values.attendanceFormat).toBe('virtual');
    const emptyCell = normaliseRow({ Email: 'a@x.io', Name: 'A', Format: '' }, mapping, 'virtual');
    expect(emptyCell.ok).toBe(false);
  });

  it('name keys ignore whitespace, case and NFC form but nothing else (criterion 21)', () => {
    expect(normaliseNameKey('  ada   LOVELACE ')).toBe(normaliseNameKey('Ada Lovelace'));
    expect(normaliseNameKey('Réna')).toBe(normaliseNameKey('Réna'));
    expect(normaliseNameKey('Rena')).not.toBe(normaliseNameKey('Réna'));
    expect(normaliseNameKey('Lovelace Ada')).not.toBe(normaliseNameKey('Ada Lovelace'));
    expect(normaliseNameKey('A. Lovelace')).not.toBe(normaliseNameKey('Ada Lovelace'));
  });
});

describe('classification (D5, criteria 3, 4, 7, 21, 22)', () => {
  const mapping = {
    email: 'Email',
    name: 'Name',
    attendanceFormat: 'Format',
    organisation: 'Org',
    externalRegistrationId: 'Id',
  };
  const row = (n: number, cells: Record<string, string>) => ({
    rowNumber: n,
    normalised: normaliseRow({ Format: 'virtual', ...cells }, mapping, undefined),
  });
  const ctx = (over: Partial<MatchContext> = {}): MatchContext => ({
    source: 'src',
    registrations: [],
    owners: new Map(),
    ...over,
  });

  it('identical repeats are duplicates; differing repeats quarantine every row', () => {
    const rows = classifyRows(
      [
        row(2, { Email: 'a@x.io', Name: 'Ann A' }),
        row(3, { Email: 'A@X.IO', Name: 'ann a' }),
        row(4, { Email: 'b@x.io', Name: 'Bob B' }),
        row(5, { Email: 'b@x.io', Name: 'Bobby B' }),
        row(6, { Email: 'c@x.io', Name: 'Cy C', Org: 'One' }),
        row(7, { Email: 'c@x.io', Name: 'Cy C', Org: 'Two' }),
      ],
      ctx(),
    );
    const by = new Map(rows.map((r) => [r.rowNumber, r]));
    expect(by.get(2)?.outcome).toBe('accepted');
    expect(by.get(3)?.outcome).toBe('duplicate_in_file');
    expect(by.get(4)?.reasonCode).toBe('shared_email_in_file');
    expect(by.get(5)?.reasonCode).toBe('shared_email_in_file');
    expect(by.get(6)?.reasonCode).toBe('inconsistent_repeat');
    expect(by.get(7)?.reasonCode).toBe('inconsistent_repeat');
    expect(by.get(6)?.conflict?.existing.rows).toEqual([7]);
    expect(countRows(rows)).toMatchObject({
      accepted: 1,
      duplicateInFile: 1,
      conflict: 4,
      total: 6,
    });
  });

  it('updates, no-change, links, name mismatch, historical and provisional addresses, inactive account', () => {
    const reg = {
      id: 'd1',
      identityId: 'i1',
      email: 'ann@x.io',
      name: 'Ann A',
      organisation: 'Old Org',
      jobTitle: null,
      country: null,
      attendanceFormat: 'virtual' as const,
      capacity: 'individual' as const,
      nominatingOrganisation: null,
      registrationStatus: 'active' as const,
      externalRegistrationId: null,
      registrationSource: null,
    };
    const owners = new Map([
      [
        'ann@x.io',
        {
          identityId: 'i1',
          kind: 'current' as const,
          displayName: 'Ann A',
          userAccountId: null,
          accountStatus: null,
        },
      ],
      [
        'bob@x.io',
        {
          identityId: 'i2',
          kind: 'current' as const,
          displayName: 'Bob B',
          userAccountId: 'u2',
          accountStatus: 'active' as const,
        },
      ],
      [
        'old@x.io',
        {
          identityId: 'i2',
          kind: 'historical' as const,
          displayName: 'Bob B',
          userAccountId: 'u2',
          accountStatus: 'active' as const,
        },
      ],
      [
        'res@x.io',
        {
          identityId: 'i3',
          kind: 'provisional' as const,
          displayName: 'Res R',
          userAccountId: null,
          accountStatus: null,
        },
      ],
      [
        'off@x.io',
        {
          identityId: 'i4',
          kind: 'current' as const,
          displayName: 'Off O',
          userAccountId: 'u4',
          accountStatus: 'inactive' as const,
        },
      ],
    ]);
    const rows = classifyRows(
      [
        row(2, { Email: 'ann@x.io', Name: 'Ann A', Org: 'New Org' }),
        row(3, { Email: 'bob@x.io', Name: '  bob   b ' }),
        row(4, { Email: 'bob@x.io', Name: 'Robert B' }), // same email twice with different names -> in-file conflict
        row(5, { Email: 'old@x.io', Name: 'Bob B' }),
        row(6, { Email: 'res@x.io', Name: 'Res R' }),
        row(7, { Email: 'off@x.io', Name: 'Off O' }),
        row(8, { Email: 'new@x.io', Name: 'ANN  A', Org: 'old org' }), // same name and organisation, other email
      ],
      ctx({ registrations: [reg], owners }),
    );
    const by = new Map(rows.map((r) => [r.rowNumber, r]));
    expect(by.get(2)).toMatchObject({ outcome: 'updated', delegateId: 'd1', identityId: 'i1' });
    expect(by.get(2)?.changes).toEqual([{ field: 'organisation', from: 'Old Org', to: 'New Org' }]);
    expect(by.get(3)?.reasonCode).toBe('shared_email_in_file');
    expect(by.get(5)?.reasonCode).toBe('previous_email_of_identity');
    expect(by.get(6)?.reasonCode).toBe('address_under_migration_review');
    expect(by.get(7)?.reasonCode).toBe('inactive_account');
    expect(by.get(8)).toMatchObject({ outcome: 'accepted', possibleDuplicate: true });

    const second = classifyRows(
      [
        row(2, { Email: 'ann@x.io', Name: 'Ann A', Org: 'Old Org' }),
        row(3, { Email: 'bob@x.io', Name: 'bob b' }),
        row(4, { Email: 'bob2@x.io', Name: 'Someone Else' }),
      ],
      ctx({
        registrations: [reg],
        owners: new Map([...owners, ['bob2@x.io', owners.get('bob@x.io')!]]),
      }),
    );
    expect(second[0]).toMatchObject({ outcome: 'unchanged', reasonDetail: 'updated (no change)' });
    expect(second[1]).toMatchObject({ outcome: 'linked', identityId: 'i2' });
    expect(second[2]).toMatchObject({ outcome: 'conflict', reasonCode: 'name_mismatch' });
    expect(second[2]?.conflict?.existing).toEqual({ identityId: 'i2', name: 'Bob B' });
  });

  it('external ids: mismatch with another registration, old-email rows with linkage, in-file id clashes', () => {
    const reg = {
      id: 'd1',
      identityId: 'i1',
      email: 'old@x.io',
      name: 'Ann A',
      organisation: null,
      jobTitle: null,
      country: null,
      attendanceFormat: 'virtual' as const,
      capacity: 'individual' as const,
      nominatingOrganisation: null,
      registrationStatus: 'active' as const,
      externalRegistrationId: 'R1',
      registrationSource: 'src',
    };
    const owners = new Map([
      [
        'old@x.io',
        {
          identityId: 'i1',
          kind: 'historical' as const,
          displayName: 'Ann A',
          userAccountId: null,
          accountStatus: null,
        },
      ],
      [
        'ann@x.io',
        {
          identityId: 'i1',
          kind: 'current' as const,
          displayName: 'Ann A',
          userAccountId: null,
          accountStatus: null,
        },
      ],
    ]);
    const rows = classifyRows(
      [
        row(2, { Email: 'old@x.io', Name: 'Ann A', Id: 'R1' }), // record's own imported email: update in place
        row(4, { Email: 'p@x.io', Name: 'P', Id: 'R9' }),
        row(5, { Email: 'q@x.io', Name: 'Q', Id: 'R9' }), // same id, two emails in the file
      ],
      ctx({ registrations: [reg], owners }),
    );
    const by = new Map(rows.map((r) => [r.rowNumber, r]));
    expect(by.get(2)).toMatchObject({ outcome: 'unchanged', delegateId: 'd1' });
    const stranger = classifyRows(
      [row(3, { Email: 'stranger@x.io', Name: 'Someone', Id: 'R1' })],
      ctx({ registrations: [reg], owners }),
    );
    expect(stranger[0]).toMatchObject({ outcome: 'conflict', reasonCode: 'external_id_mismatch' });
    expect(stranger[0]?.conflict?.existing).toMatchObject({
      delegateId: 'd1',
      externalRegistrationId: 'R1',
    });
    expect(by.get(4)?.reasonCode).toBe('external_id_mismatch');
    expect(by.get(5)?.reasonCode).toBe('external_id_mismatch');

    // Old-email row with the same id after an email change: updates in place, identity untouched.
    const changed = classifyRows(
      [row(2, { Email: 'old@x.io', Name: 'Ann A', Id: 'R1', Org: 'Org' })],
      ctx({ registrations: [{ ...reg, email: 'ann@x.io' }], owners }),
    );
    expect(changed[0]).toMatchObject({ outcome: 'updated', delegateId: 'd1', identityId: 'i1' });
    // Same id, a genuinely new unowned email: conflict (rule 1).
    const newEmail = classifyRows(
      [row(2, { Email: 'brand-new@x.io', Name: 'Ann A', Id: 'R1' })],
      ctx({ registrations: [reg], owners }),
    );
    expect(newEmail[0]?.reasonCode).toBe('external_id_mismatch');
    // Source scoping: the same id from another source is not compared.
    const otherSource = classifyRows(
      [row(2, { Email: 'fresh@x.io', Name: 'F', Id: 'R1' })],
      ctx({ source: 'other', registrations: [reg], owners }),
    );
    expect(otherSource[0]?.outcome).toBe('accepted');
  });
});

describe('import configuration (D9 safeguard, OQ-22)', () => {
  it('is disabled by default, and production refuses uploads without an approved retention value', () => {
    expect(importConfigFromEnv({}).uploadsEnabled).toBe(false);
    expect(importConfigFromEnv({ IMPORT_UPLOADS_ENABLED: 'true', NODE_ENV: 'test' })).toMatchObject(
      {
        uploadsEnabled: true,
        requireMigrationGate: false,
      },
    );
    expect(() =>
      importConfigFromEnv({ IMPORT_UPLOADS_ENABLED: 'true', NODE_ENV: 'production' }),
    ).toThrow(/IMPORT_FILE_RETENTION_DAYS/);
    expect(
      importConfigFromEnv({
        IMPORT_UPLOADS_ENABLED: 'true',
        NODE_ENV: 'production',
        IMPORT_FILE_RETENTION_DAYS: '30',
      }),
    ).toMatchObject({ uploadsEnabled: true, requireMigrationGate: true, fileRetentionDays: 30 });
    expect(importConfigFromEnv({ NODE_ENV: 'production' }).uploadsEnabled).toBe(false);
  });

  it('neutralises formula-like cells in the row report', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('plain')).toBe('plain');
  });
});
