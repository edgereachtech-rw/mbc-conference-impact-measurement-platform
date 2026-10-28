/** One outgoing email, already rendered. */
export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Reply-To address; defaults to the contact address of the mail config. */
  replyTo?: string;
  /** Extra headers, e.g. List-Unsubscribe for reminders. Never put personal data in header names. */
  headers?: Record<string, string>;
}

/** What the transport reported back. Logged without the recipient address. */
export interface SendResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
  /** Raw provider response line, e.g. "250 2.0.0 OK queued as ABC123". */
  response: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<SendResult>;
  /** Verifies connectivity/credentials without sending (SMTP NOOP). */
  verify(): Promise<void>;
  /** Releases pooled connections. */
  close(): Promise<void>;
}

/**
 * Captures messages instead of sending them. Used by tests and by code paths that must never
 * email anyone (e.g. seed scripts).
 */
export class MemoryMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(message: MailMessage): Promise<SendResult> {
    this.sent.push(message);
    return {
      messageId: `<memory-${this.sent.length}@local>`,
      accepted: [message.to],
      rejected: [],
      response: '250 captured in memory',
    };
  }

  async verify(): Promise<void> {
    return;
  }

  async close(): Promise<void> {
    return;
  }
}
