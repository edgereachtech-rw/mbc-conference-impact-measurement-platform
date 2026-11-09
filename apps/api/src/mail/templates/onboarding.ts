import { escapeHtml, renderLayout, type EmailBranding, type RenderedEmail } from './layout.js';

/**
 
 *
 * Sent once an admin asks for it, after the delegate has their account. It is the only email that
 * carries the attendance codes, so it is written to be kept: the codes are inline images rather
 * than links, which a delegate can show at the door with no signal and no sign-in.
 *
 * The body is assembled here rather than from `paragraphs` because it carries a schedule and the
 * codes; every value is escaped on the way in, as the layout contract requires.
 */

export interface OnboardingDate {
  /** The day as the delegate reads it: "Thursday 12 November 2026". */
  label: string;
  /** Content-ID of the inline QR image for that day. */
  cid: string;
}

export interface OnboardingPackInput {
  recipientName?: string;
  /** "12-13 November 2026", already formatted in the event's zone. */
  eventDates: string;
  venue?: string;
  /** Absolute link to the delegate's own dashboard. */
  dashboardUrl: string;
  /** Absolute link to the delegate's event page, where the card is. */
  badgeUrl: string;
  dates: OnboardingDate[];
  /** What the pre-conference assessment is called and whether it is open yet. */
  firstStep?: string;
}

const P = 'margin:0 0 14px;font-size:15px;line-height:23px;color:#1f2937;';
const H =
  'margin:22px 0 8px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#5b6b7f;font-weight:700;';

export function renderOnboardingPack(
  branding: EmailBranding,
  input: OnboardingPackInput,
): RenderedEmail {
  const greeting = input.recipientName ? `Hello ${escapeHtml(input.recipientName)},` : 'Hello,';
  const where = input.venue ? ` at ${escapeHtml(input.venue)}` : '';

  const codes = input.dates
    .map(
      (d) => `
      <td align="center" style="padding:0 10px 16px;">
        <img src="cid:${escapeHtml(d.cid)}" width="150" height="150" alt="Check-in code for ${escapeHtml(d.label)}"
             style="display:block;border:1px solid #d9e1ea;padding:6px;background:#ffffff;">
        <div style="margin-top:6px;font-size:13px;color:#1f2937;">${escapeHtml(d.label)}</div>
      </td>`,
    )
    .join('');

  const html = `
    <p style="${P}">${greeting}</p>
    <p style="${P}">You are registered for <strong>${escapeHtml(branding.eventName)}</strong>, ${escapeHtml(input.eventDates)}${where}. This platform is where you record what you want to get out of the conference, and what you do with it afterwards — so the value shows up in your work, not just in the room.</p>

    <p style="${H}">What happens when</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:6px 0;border-bottom:1px solid #eef2f6;font-size:15px;color:#1f2937;"><strong>Before</strong> &nbsp;A short check-in: where you are now and what you want to change.</td></tr>
      <tr><td style="padding:6px 0;border-bottom:1px solid #eef2f6;font-size:15px;color:#1f2937;"><strong>At the conference</strong> &nbsp;Check in each day with the code below, give feedback on sessions, and build your Transfer Plan.</td></tr>
      <tr><td style="padding:6px 0;font-size:15px;color:#1f2937;"><strong>Afterwards</strong> &nbsp;Short follow-ups at 30, 60, 90 days, and beyond asking what you have been able to apply..</td></tr>
    </table>
${
  input.dates.length > 0
    ? `
    <p style="${H}">Your check-in codes</p>
    <p style="${P}">Show this at the entrance on each day. Save this email or take a screenshot — the codes work without signal, and they are also on the platform under Attendance.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;"><tr>${codes}</tr></table>
    <p style="margin:0 0 14px;font-size:13px;line-height:20px;color:#5b6b7f;">An organiser checks you in; holding the code is not attendance on its own. The code carries no personal details.</p>`
    : ''
}
    <p style="${H}">Tell people you are coming</p>
    <p style="${P}"> Have you downloaded your "I will be attending" card? If not, you can still do so with the link sent to your email box earlier thanks.</p>
${input.firstStep ? `\n    <p style="${P}"><strong>Your first step:</strong> ${escapeHtml(input.firstStep)}</p>` : ''}
  `.trim();

  const text = [
    input.recipientName ? `Hello ${input.recipientName},` : 'Hello,',
    '',
    `You are registered for ${branding.eventName}, ${input.eventDates}${input.venue ? ` at ${input.venue}` : ''}. This platform is where you record what you want to get out of the conference, and what you do with it afterwards.`,
    '',
    'WHAT HAPPENS WHEN',
    'Before: a short check-in on where you are now and what you want to change.',
    'At the conference: check in each day with your code, give session feedback, build your Transfer Plan.',
    'Afterwards: short follow-ups at 30, 60, 90 days, and beyond asking what you have been able to apply.',
    '',
    ...(input.dates.length > 0
      ? [
          'YOUR CHECK-IN CODES',
          'Attached to this email as images, one per day:',
          ...input.dates.map((d) => `  - ${d.label}`),
          'An organiser checks you in; holding the code is not attendance on its own.',
          '',
        ]
      : []),
    'TELL PEOPLE YOU ARE COMING',
    `A card with your name on it is on your event page: ${input.badgeUrl}`,
    '',
    ...(input.firstStep ? [`Your first step: ${input.firstStep}`, ''] : []),
    `Open your dashboard: ${input.dashboardUrl}`,
  ].join('\n');

  return renderLayout(branding, {
    subject: `Welcome to ${branding.eventName}: your check-in codes and what happens when`,
    preheader: 'Your check-in codes, what the platform is for, and what happens before and after.',
    eyebrow: 'Welcome',
    title: `You are set for ${branding.eventName}`,
    paragraphs: [],
    body: { html, text },
    button: { label: 'Open my dashboard', url: input.dashboardUrl },
    notes: [
      'You sign in with this email address — there is no password. Ask for a link whenever you need one.',
      `Questions about your registration? Write to ${branding.contactEmail}.`,
    ],
  });
}
