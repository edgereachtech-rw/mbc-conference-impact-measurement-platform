import nodemailer, { type Transporter } from 'nodemailer';

import type { MailConfig } from './config.js';
import type { Mailer, MailMessage, SendResult } from './mailer.js';

/**
 * Nodemailer SMTP transport. Used for the production relay (STARTTLS on 587, implicit TLS on 465)
 * and, with MAIL_TRANSPORT=mailpit, for the development inbox (plain SMTP, no auth).
 */
export class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(private readonly config: MailConfig) {
    const { host, port, secure, auth } = config.smtp;
    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth,
      // Refuse to downgrade to plaintext on the relay; Mailpit has no TLS so it is exempt.
      requireTLS: config.transport === 'smtp' && !secure,
      pool: true,
      maxConnections: 2,
      connectionTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }

  async send(message: MailMessage): Promise<SendResult> {
    const info = await this.transporter.sendMail({
      from: this.config.from,
      to: message.to,
      replyTo: message.replyTo ?? this.config.contactEmail,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: message.headers,
    });
    return {
      messageId: info.messageId ?? '',
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
      response: info.response ?? '',
    };
  }

  async verify(): Promise<void> {
    await this.transporter.verify();
  }

  async close(): Promise<void> {
    this.transporter.close();
  }
}

/** Development inbox: Mailpit speaks plain SMTP on 1025 and shows mail at http://localhost:8025. */
export function createMailpitMailer(config: MailConfig): SmtpMailer {
  return new SmtpMailer({ ...config, transport: 'mailpit' });
}
