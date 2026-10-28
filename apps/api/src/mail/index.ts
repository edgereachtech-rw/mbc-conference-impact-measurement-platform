import { mailConfigFromEnv, type MailConfig } from './config.js';
import { MemoryMailer, type Mailer } from './mailer.js';
import { createMailpitMailer, SmtpMailer } from './smtp-mailer.js';

export type { Mailer, MailMessage, SendResult } from './mailer.js';
export { MemoryMailer } from './mailer.js';
export { mailConfigFromEnv, type MailConfig } from './config.js';
export { SmtpMailer, createMailpitMailer } from './smtp-mailer.js';
export * from './templates/index.js';

/** Picks the transport from MAIL_TRANSPORT: smtp (relay), mailpit (dev inbox) or memory (tests). */
export function createMailer(config: MailConfig = mailConfigFromEnv()): Mailer {
  switch (config.transport) {
    case 'memory':
      return new MemoryMailer();
    case 'mailpit':
      return createMailpitMailer(config);
    default:
      return new SmtpMailer(config);
  }
}
