import { describe, expect, it } from 'vitest';

import {
  findUnknownPlaceholders,
  placeholderValuesFor,
  renderMessageBody,
  substitutePlaceholders,
} from './message-body.js';

const values = placeholderValuesFor({
  name: 'Ada  Lovelace',
  email: 'ada@example.com',
  organisation: 'Analytical Engines',
  eventName: 'ITTEC 2026',
});
const P_STYLE =
  "margin:0 0 16px;font-family:Poppins, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;font-size:16px;line-height:24px;color:#323333;";

describe('message placeholders', () => {
  it('derives per-recipient values and fills supported placeholders only', () => {
    expect(values).toEqual({
      firstName: 'Ada',
      name: 'Ada  Lovelace',
      email: 'ada@example.com',
      organisation: 'Analytical Engines',
      eventName: 'ITTEC 2026',
    });
    expect(
      substitutePlaceholders('Hi {{ firstName }} from {{organisation}} {{nope}}', values),
    ).toBe('Hi Ada from Analytical Engines {{nope}}');
    expect(findUnknownPlaceholders('{{firstName}} {{nope}} {{Nope}} {{nope}}')).toEqual([
      'nope',
      'Nope',
    ]);
    expect(
      placeholderValuesFor({ name: '', email: 'x@y', organisation: null, eventName: 'E' }),
    ).toEqual({ firstName: '', name: '', email: 'x@y', organisation: '', eventName: 'E' });
  });
});

describe('renderMessageBody', () => {
  it('renders headings, paragraphs, line breaks, lists, bold, italics and links to HTML and text', () => {
    const { html, text } = renderMessageBody(
      [
        '# Welcome {{firstName}}',
        '',
        'Line one',
        'line two with **bold** and *italic* and _under_.',
        '',
        '- first',
        '- second',
        '',
        '1. one',
        '2) two',
        '',
        'Read [the agenda](https://example.com/agenda?a=1&b=2) or https://example.com/plain.',
      ].join('\n'),
      values,
    );
    expect(html).toContain('<h1 style="margin:24px 0 12px;');
    expect(html).toContain('Welcome Ada</h1>');
    expect(html).toContain(
      'Line one<br>line two with <strong>bold</strong> and <em>italic</em> and <em>under</em>.',
    );
    expect(html).toContain('<ul style="margin:0 0 16px;padding-left:24px;');
    expect(html).toContain(
      '<li style="margin:0 0 6px;">first</li><li style="margin:0 0 6px;">second</li>',
    );
    expect(html).toContain('<ol style=');
    expect(html).toContain(
      '<li style="margin:0 0 6px;">one</li><li style="margin:0 0 6px;">two</li>',
    );
    expect(html).toContain(
      '<a href="https://example.com/agenda?a=1&amp;b=2" style="color:#002A5E;text-decoration:underline;">the agenda</a>',
    );
    expect(html).toContain('<a href="https://example.com/plain" style=');
    expect(text).toBe(
      [
        'Welcome Ada',
        '',
        'Line one',
        'line two with bold and italic and under.',
        '',
        '- first',
        '- second',
        '',
        '1. one',
        '2. two',
        '',
        'Read the agenda (https://example.com/agenda?a=1&b=2) or https://example.com/plain.',
      ].join('\n'),
    );
  });

  it('never lets markup or unsafe links through', () => {
    const { html, text } = renderMessageBody(
      '<script>alert(1)</script> **<b>x</b>** [click](javascript:alert(1)) [ok](mailto:a@b.c) {{name}}',
      { ...values, name: '<img src=x onerror=alert(1)>' },
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
    expect(html).toContain('[click](javascript:alert(1))');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('<a href="mailto:a@b.c"');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(text).toContain('<img src=x onerror=alert(1)>'); // plain text is not HTML
    expect(text).toContain('[click](javascript:alert(1))');
  });

  it('keeps a bare line as one paragraph and ignores Windows line endings', () => {
    const { html, text } = renderMessageBody('Hello\r\nthere\r\n\r\nBye', values);
    expect(html).toBe(`<p style="${P_STYLE}">Hello<br>there</p>\n<p style="${P_STYLE}">Bye</p>`);
    expect(text).toBe('Hello\nthere\n\nBye');
  });
});
