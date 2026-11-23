import { describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn(async () => ({ messageId: '<m@x>', accepted: ['a@example.com'] }));
vi.mock('nodemailer', () => ({ default: { createTransport: () => ({ sendMail }) } }));

const { SmtpMailer } = await import('./smtp-mailer.js');

const config = {
  transport: 'smtp' as const,
  from: 'MBC Impact Intelligence Platform <support@example.org>',
  contactEmail: 'support@example.org',
  appUrl: 'https://app.example.org',
  smtp: { host: 'smtp.example.org', port: 587, secure: false },
};

/** The Reply-To of platform emails (2026-11-23). */
describe('SmtpMailer reply address', () => {
  it('sends replies to the configured contact address on the sender’s own domain', async () => {
    await new SmtpMailer(config).send({ to: 'a@example.com', subject: 's', text: 't', html: 'h' });
    expect(sendMail).toHaveBeenLastCalledWith(
      expect.objectContaining({ replyTo: 'support@example.org' }),
    );
  });

  it('keeps a reply address a message sets itself', async () => {
    await new SmtpMailer(config).send({
      to: 'a@example.com',
      subject: 's',
      text: 't',
      html: 'h',
      replyTo: 'events@example.org',
    });
    expect(sendMail).toHaveBeenLastCalledWith(
      expect.objectContaining({ replyTo: 'events@example.org' }),
    );
  });
});
