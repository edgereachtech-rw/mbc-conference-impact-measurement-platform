import { z } from 'zod';

import { withoutBlankValues } from '../lib/env.js';

/**
 * Mail configuration from the environment.
 *
 *   MAIL_TRANSPORT   smtp (default) | mailpit | memory
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD   relay credentials (smtp transport)
 *   MAIL_FROM        "ITTEC 2026 <conference@example.com>" or a bare address
 *   MAIL_CONTACT_EMAIL   Reply-To and the address shown in the footer (defaults to MAIL_FROM's address)
 *   APP_URL          absolute origin used for links and the logo, e.g. https://impact.example.com
 *   MAILPIT_HOST / MAILPIT_PORT   where the development inbox listens (default mailpit:1025)
 */
const envSchema = z.object({
  MAIL_TRANSPORT: z.enum(['smtp', 'mailpit', 'memory']).default('smtp'),
  SMTP_HOST: z.string().min(1).optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().min(3),
  MAIL_CONTACT_EMAIL: z.email().optional(),
  APP_URL: z.url().default('http://localhost:3000'),
  MAILPIT_HOST: z.string().default('mailpit'),
  MAILPIT_PORT: z.coerce.number().int().positive().default(1025),
  NODE_ENV: z.string().optional(),
});

export interface SmtpSettings {
  host: string;
  port: number;
  /** Implicit TLS (port 465). STARTTLS is negotiated automatically on other ports. */
  secure: boolean;
  auth?: { user: string; pass: string };
}

export interface MailConfig {
  transport: 'smtp' | 'mailpit' | 'memory';
  from: string;
  /** Bare address shown in footers and used as Reply-To. */
  contactEmail: string;
  /** Absolute origin without trailing slash. */
  appUrl: string;
  smtp: SmtpSettings;
}

/** Extracts "addr@example.com" from "Name <addr@example.com>" or returns the input trimmed. */
export function addressOf(from: string): string {
  const match = /<([^>]+)>/.exec(from);
  return (match?.[1] ?? from).trim();
}

export function mailConfigFromEnv(env: NodeJS.ProcessEnv = process.env): MailConfig {
  const parsed = envSchema.safeParse(withoutBlankValues(env));
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`invalid mail configuration: ${issues}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === 'production' && e.MAIL_TRANSPORT !== 'smtp') {
    throw new Error(
      `invalid mail configuration: MAIL_TRANSPORT=${e.MAIL_TRANSPORT} is not allowed in production (use smtp)`,
    );
  }

  let smtp: SmtpSettings;
  if (e.MAIL_TRANSPORT === 'mailpit') {
    smtp = { host: e.MAILPIT_HOST, port: e.MAILPIT_PORT, secure: false };
  } else {
    if (e.MAIL_TRANSPORT === 'smtp' && !e.SMTP_HOST) {
      throw new Error('invalid mail configuration: SMTP_HOST is required when MAIL_TRANSPORT=smtp');
    }
    smtp = {
      host: e.SMTP_HOST ?? 'localhost',
      port: e.SMTP_PORT,
      secure: e.SMTP_PORT === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD ?? '' } : undefined,
    };
  }

  return {
    transport: e.MAIL_TRANSPORT,
    from: e.MAIL_FROM,
    contactEmail: e.MAIL_CONTACT_EMAIL ?? addressOf(e.MAIL_FROM),
    appUrl: e.APP_URL.replace(/\/+$/, ''),
    smtp,
  };
}
