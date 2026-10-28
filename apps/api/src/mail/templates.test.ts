import { describe, expect, it } from 'vitest';

import { MemoryMailer } from './mailer.js';
import {
  type EmailBranding,
  renderInvitation,
  renderLayout,
  renderMagicLink,
  renderTestDelivery,
} from './templates/index.js';

const branding: EmailBranding = {
  eventName: 'Example Conf 2026',
  eventFullName: 'Example Conference on Testing',
  organiser: 'Example Organisers',
  contactEmail: 'hello@example.com',
  appUrl: 'https://impact.example.com',
  footerLine: 'Example Hall, Example City | 1-2 January 2026',
};

const renderedAll = () => [
  renderInvitation(branding, {
    recipientName: 'Ada <Lovelace>',
    inviteUrl: 'https://impact.example.com/invite/abc123',
    expiresInMinutes: 7 * 24 * 60,
    eventSummary: '1-2 January 2026',
  }),
  renderMagicLink(branding, {
    signInUrl: 'https://impact.example.com/signin?token=xyz',
    expiresInMinutes: 15,
    code: '123 456',
  }),
  renderTestDelivery(branding, { sentFrom: 'vitest', sentAt: '2026-10-28T10:00:00.000Z' }),
];

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? '');
}

describe('email templates', () => {
  it('every link in the HTML is absolute (http(s) or mailto)', () => {
    for (const email of renderedAll()) {
      const links = hrefs(email.html);
      expect(links.length).toBeGreaterThan(0);
      for (const href of links) {
        expect(href).toMatch(/^(https?:\/\/|mailto:)/);
      }
      expect(email.html).toContain('src="https://impact.example.com/brand/logo-white.png"');
    }
  });

  it('has no unresolved placeholders or stray values', () => {
    for (const email of renderedAll()) {
      for (const part of [email.subject, email.html, email.text]) {
        expect(part).not.toMatch(/\{\{|\}\}|\$\{|undefined|null|\[object Object\]|NaN/);
      }
    }
  });

  it('always produces a plain-text part that carries the action link', () => {
    const [invitation, magicLink, test] = renderedAll();
    expect(invitation?.text).toContain('https://impact.example.com/invite/abc123');
    expect(magicLink?.text).toContain('https://impact.example.com/signin?token=xyz');
    expect(magicLink?.text).toContain('123 456');
    expect(test?.text).toContain('hello@example.com');
    for (const email of renderedAll()) {
      expect(email.text.length).toBeGreaterThan(100);
      // No layout markup leaks into the text part (angle brackets in names are fine).
      expect(email.text).not.toMatch(/<(p|a|table|td|tr|div|html|body|h1|img|style)[\s>]/i);
    }
  });

  it('escapes user-provided text in the HTML part', () => {
    const [invitation] = renderedAll();
    expect(invitation?.html).toContain('Hello Ada &lt;Lovelace&gt;,');
    expect(invitation?.html).not.toContain('Ada <Lovelace>');
  });

  it('is mobile-friendly and declares dark-mode support', () => {
    const [, magicLink] = renderedAll();
    const html = magicLink?.html ?? '';
    expect(html).toContain('name="viewport"');
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('@media (prefers-color-scheme: dark)');
    expect(html).toContain('max-width:100%');
    expect(html).toMatch(/padding:14px 28px/); // 44px tall button
  });

  it('rejects relative URLs so broken links never ship', () => {
    expect(() =>
      renderLayout(branding, {
        subject: 's',
        preheader: 'p',
        title: 't',
        paragraphs: ['x'],
        button: { label: 'Go', url: '/relative' },
      }),
    ).toThrow(/absolute/);
    expect(() =>
      renderLayout(
        { ...branding, appUrl: 'impact.example.com' },
        {
          subject: 's',
          preheader: 'p',
          title: 't',
          paragraphs: ['x'],
        },
      ),
    ).toThrow(/absolute/);
  });

  it('formats expiry windows for humans', () => {
    expect(
      renderMagicLink(branding, { signInUrl: 'https://x.example/a', expiresInMinutes: 1 }).text,
    ).toContain('expires in 1 minute.');
    expect(
      renderInvitation(branding, {
        inviteUrl: 'https://x.example/a',
        expiresInMinutes: 7 * 24 * 60,
      }).text,
    ).toContain('expires in 7 days.');
  });
});

describe('MemoryMailer', () => {
  it('captures messages without sending', async () => {
    const mailer = new MemoryMailer();
    const [email] = renderedAll();
    const result = await mailer.send({
      to: 'nobody@example.com',
      subject: email?.subject ?? '',
      html: email?.html ?? '',
      text: email?.text ?? '',
    });
    expect(result.accepted).toEqual(['nobody@example.com']);
    expect(mailer.sent).toHaveLength(1);
  });
});
