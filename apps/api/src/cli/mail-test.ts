/**
 * Sends one email through the configured transport and prints the provider's response.
 *
 *   pnpm --filter @mbc/api mail:test someone@example.com
 *   pnpm --filter @mbc/api mail:test someone@example.com --template invitation
 *   node dist/cli/mail-test.js someone@example.com            (inside the api image)
 *
 * Transport comes from MAIL_TRANSPORT (smtp | mailpit | memory) and the SMTP_* / MAIL_* variables.
 * Branding comes from the active event in the database when DATABASE_URL is set, otherwise from
 * generic defaults. The recipient address is printed once, here, because the operator typed it.
 */
import 'dotenv/config';

import { getPrisma } from '../db.js';
import { genericBranding, loadEventBranding } from '../mail/branding.js';
import { createMailer, mailConfigFromEnv } from '../mail/index.js';
import {
  renderInvitation,
  renderMagicLink,
  renderTestDelivery,
  type TemplateName,
} from '../mail/templates/index.js';

function usage(): never {
  console.error(
    'usage: mail-test <address> [--template test-delivery|invitation|magic-link] [--from-label <text>]',
  );
  process.exit(2);
}

async function main() {
  const args = process.argv.slice(2);
  const to = args[0];
  if (!to || to.startsWith('--') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) usage();

  let template: TemplateName = 'test-delivery';
  let fromLabel = process.env.NODE_ENV ?? 'development';
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--template') {
      const value = args[++i];
      if (value !== 'test-delivery' && value !== 'invitation' && value !== 'magic-link') usage();
      template = value;
    } else if (arg === '--from-label') {
      fromLabel = args[++i] ?? fromLabel;
    } else {
      usage();
    }
  }

  const config = mailConfigFromEnv();
  let branding = genericBranding(config);
  if (process.env.DATABASE_URL) {
    try {
      const fromDb = await loadEventBranding(getPrisma(), config);
      if (fromDb) branding = fromDb;
    } catch (error) {
      console.warn(
        `warning: could not load event branding from the database (${error instanceof Error ? error.message : String(error)}); using generic branding`,
      );
    }
  }

  const sampleUrl = `${config.appUrl}/signin?token=sample-token-not-valid`;
  const rendered =
    template === 'invitation'
      ? renderInvitation(branding, {
          recipientName: 'Test Delegate',
          inviteUrl: sampleUrl,
          expiresInMinutes: 7 * 24 * 60,
          eventSummary: branding.footerLine,
        })
      : template === 'magic-link'
        ? renderMagicLink(branding, {
            recipientName: 'Test Delegate',
            signInUrl: sampleUrl,
            expiresInMinutes: 15,
            code: '483 921',
          })
        : renderTestDelivery(branding, { sentFrom: fromLabel, sentAt: new Date().toISOString() });

  const mailer = createMailer(config);
  console.log(
    `transport=${config.transport} host=${config.smtp.host}:${config.smtp.port} from=${config.from}`,
  );
  console.log(`template=${template} subject="${rendered.subject}" to=${to}`);

  try {
    await mailer.verify();
    console.log('connection verified');
    const result = await mailer.send({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    console.log(`provider response: ${result.response}`);
    console.log(`message id: ${result.messageId}`);
    console.log(`accepted: ${result.accepted.length}, rejected: ${result.rejected.length}`);
    if (result.rejected.length > 0) process.exitCode = 1;
  } finally {
    await mailer.close();
    if (process.env.DATABASE_URL) await getPrisma().$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error('mail-test failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
