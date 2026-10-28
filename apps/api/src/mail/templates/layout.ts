/**
 * Shared email layout. Produces an HTML part and a plain-text part from the same content so the
 * two never drift. Visual tokens come from docs/design-tokens.md (navy, brand red, amber, surface
 * grey); fonts fall back to system sans-serif because email clients do not load web fonts.
 *
 * Email constraints honoured here: table layout, inline styles, no external CSS, a single column
 * that fits 360px screens, 44px tall button, dark-mode overrides via prefers-color-scheme with
 * explicit colours (Gmail/Outlook ignore CSS variables).
 */

export interface EmailBranding {
  /** Short event name shown in the header and footer, e.g. "ITTEC 2026". */
  eventName: string;
  /** Full conference name for the footer line. */
  eventFullName?: string;
  /** Organiser shown in the footer, e.g. "M.Bryan Consulting". */
  organiser: string;
  /** Address shown in the footer and used as Reply-To. */
  contactEmail: string;
  /** Absolute origin of the web app; the logo is loaded from `${appUrl}/brand/logo-white.png`. */
  appUrl: string;
  /** Optional venue + dates line for the footer. */
  footerLine?: string;
}

export interface EmailButton {
  label: string;
  /** Absolute URL. */
  url: string;
}

export interface EmailContent {
  subject: string;
  /** Hidden preview text shown by inbox list views. */
  preheader: string;
  /** Small uppercase label above the title. */
  eyebrow?: string;
  title: string;
  /** Paragraphs in order. Plain strings; HTML special characters are escaped. */
  paragraphs: string[];
  /** The one primary action. Its URL is repeated in plain text and under the button. */
  button?: EmailButton;
  /** Lines after the button, e.g. expiry notice. */
  notes?: string[];
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const colours = {
  navy: '#002A5E',
  navyDeep: '#061D3F',
  red: '#8B1C1C',
  amber: '#FFB703',
  surface: '#F1F1F1',
  white: '#FFFFFF',
  text: '#323333',
  muted: '#5B6672',
  line: '#E3E8EF',
  darkBg: '#0B1B33',
  darkCard: '#102B52',
  darkText: '#D9DFE8',
  darkMuted: '#9FB0C8',
} as const;

const fontStack = "Poppins, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const headingStack = "Oswald, 'Arial Narrow', 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function assertAbsoluteUrl(url: string, what: string): void {
  if (!/^https?:\/\/[^\s]+$/i.test(url)) {
    throw new Error(`${what} must be an absolute http(s) URL, got "${url}"`);
  }
}

export function renderLayout(branding: EmailBranding, content: EmailContent): RenderedEmail {
  assertAbsoluteUrl(branding.appUrl, 'branding.appUrl');
  if (content.button) assertAbsoluteUrl(content.button.url, 'button.url');

  const logoUrl = `${branding.appUrl.replace(/\/+$/, '')}/brand/logo-white.png`;
  const title = escapeHtml(content.title);
  const paragraphsHtml = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-family:${fontStack};font-size:16px;line-height:24px;color:${colours.text};" class="body-text">${escapeHtml(p)}</p>`,
    )
    .join('\n');
  const notesHtml = (content.notes ?? [])
    .map(
      (n) =>
        `<p style="margin:0 0 8px;font-family:${fontStack};font-size:14px;line-height:20px;color:${colours.muted};" class="muted-text">${escapeHtml(n)}</p>`,
    )
    .join('\n');
  const buttonHtml = content.button
    ? `
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 20px;">
  <tr>
    <td align="center" bgcolor="${colours.red}" style="border-radius:4px;">
      <a href="${escapeHtml(content.button.url)}" target="_blank" style="display:inline-block;min-width:200px;padding:14px 28px;font-family:${headingStack};font-size:16px;line-height:16px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${colours.white};text-decoration:none;border-radius:4px;background-color:${colours.red};">${escapeHtml(content.button.label)}</a>
    </td>
  </tr>
</table>
<p style="margin:0 0 20px;font-family:${fontStack};font-size:13px;line-height:20px;color:${colours.muted};word-break:break-all;" class="muted-text">If the button does not work, copy this link into your browser:<br><a href="${escapeHtml(content.button.url)}" style="color:${colours.navy};" class="link">${escapeHtml(content.button.url)}</a></p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <title>${title}</title>
  <style>
    :root { color-scheme: light dark; supported-color-schemes: light dark; }
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
    a { color: ${colours.navy}; }
    @media (prefers-color-scheme: dark) {
      .email-bg { background-color: ${colours.darkBg} !important; }
      .card { background-color: ${colours.darkCard} !important; }
      .body-text, .title { color: ${colours.darkText} !important; }
      .muted-text, .footer-text { color: ${colours.darkMuted} !important; }
      .link, .eyebrow { color: ${colours.amber} !important; }
      .divider { border-color: rgba(255,255,255,0.15) !important; }
    }
    @media only screen and (max-width: 480px) {
      .container { width: 100% !important; }
      .card-pad { padding: 24px 16px !important; }
    }
  </style>
</head>
<body class="email-bg" style="margin:0;padding:0;background-color:${colours.surface};">
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${colours.surface};opacity:0;">${escapeHtml(content.preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="email-bg" style="background-color:${colours.surface};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="container" style="width:600px;max-width:100%;">
          <tr>
            <td bgcolor="${colours.navy}" style="background-color:${colours.navy};padding:20px 24px;border-radius:16px 16px 0 0;" align="left">
              <img src="${escapeHtml(logoUrl)}" width="150" height="76" alt="${escapeHtml(branding.eventName)}" style="display:block;width:150px;height:auto;border:0;">
            </td>
          </tr>
          <tr>
            <td bgcolor="${colours.white}" class="card card-pad" style="background-color:${colours.white};padding:32px 32px 16px;" align="left">
              ${content.eyebrow ? `<p class="eyebrow" style="margin:0 0 8px;font-family:${headingStack};font-size:13px;line-height:18px;letter-spacing:2px;text-transform:uppercase;color:${colours.red};">${escapeHtml(content.eyebrow)}</p>` : ''}
              <h1 class="title" style="margin:0 0 16px;font-family:${fontStack};font-size:24px;line-height:32px;font-weight:700;color:${colours.navy};">${title}</h1>
              ${paragraphsHtml}
              ${buttonHtml}
              ${notesHtml}
            </td>
          </tr>
          <tr>
            <td bgcolor="${colours.navyDeep}" style="background-color:${colours.navyDeep};padding:20px 32px;border-radius:0 0 16px 16px;" align="left">
              <p class="footer-text" style="margin:0 0 6px;font-family:${headingStack};font-size:12px;line-height:18px;letter-spacing:1.5px;text-transform:uppercase;color:${colours.darkMuted};">${escapeHtml(branding.eventName)}${branding.eventFullName ? ` &middot; ${escapeHtml(branding.eventFullName)}` : ''}</p>
              ${branding.footerLine ? `<p class="footer-text" style="margin:0 0 6px;font-family:${fontStack};font-size:13px;line-height:20px;color:${colours.darkText};">${escapeHtml(branding.footerLine)}</p>` : ''}
              <p class="footer-text" style="margin:0;font-family:${fontStack};font-size:13px;line-height:20px;color:${colours.darkText};">Questions? Write to <a href="mailto:${escapeHtml(branding.contactEmail)}" style="color:${colours.amber};text-decoration:underline;">${escapeHtml(branding.contactEmail)}</a></p>
              <p class="footer-text" style="margin:12px 0 0;font-family:${fontStack};font-size:12px;line-height:18px;color:${colours.darkMuted};">Sent by ${escapeHtml(branding.organiser)} to the email address you registered with.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

  const textLines: string[] = [];
  textLines.push(branding.eventName.toUpperCase());
  textLines.push('');
  if (content.eyebrow) textLines.push(content.eyebrow.toUpperCase());
  textLines.push(content.title);
  textLines.push('');
  for (const p of content.paragraphs) {
    textLines.push(p);
    textLines.push('');
  }
  if (content.button) {
    textLines.push(`${content.button.label}: ${content.button.url}`);
    textLines.push('');
  }
  for (const n of content.notes ?? []) textLines.push(n);
  if (content.notes?.length) textLines.push('');
  textLines.push('--');
  textLines.push(
    `${branding.eventName}${branding.eventFullName ? ` - ${branding.eventFullName}` : ''}`,
  );
  if (branding.footerLine) textLines.push(branding.footerLine);
  textLines.push(`Questions? Write to ${branding.contactEmail}`);
  textLines.push(`Sent by ${branding.organiser} to the email address you registered with.`);

  return { subject: content.subject, html, text: textLines.join('\n') + '\n' };
}
