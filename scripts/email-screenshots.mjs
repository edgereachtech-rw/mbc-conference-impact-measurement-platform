// Screenshots of the emails currently in Mailpit, at phone width, in light and dark mode.
// Usage: MAILPIT_URL=http://127.0.0.1:8025 node scripts/email-screenshots.mjs
// Output: docs/screenshots/email-<template>-<light|dark>.png and docs/screenshots/email-inbox.png
//
// Send the emails first, e.g. pnpm --filter @mbc/api mail:test you@example.com --template invitation

import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
const mailpit = (process.env.MAILPIT_URL ?? 'http://127.0.0.1:8025').replace(/\/+$/, '');

/** Maps a subject to the template name used in the file name. */
function templateOf(subject) {
  if (subject.startsWith('[Test]')) return 'test-delivery';
  if (/invitation/i.test(subject)) return 'invitation';
  if (/sign in/i.test(subject)) return 'magic-link';
  return 'other';
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const res = await fetch(`${mailpit}/api/v1/messages?limit=50`);
  if (!res.ok) throw new Error(`Mailpit API ${res.status} at ${mailpit}`);
  const { messages } = await res.json();
  if (!messages?.length) throw new Error('no messages in Mailpit');

  // Newest message per template.
  const byTemplate = new Map();
  for (const m of messages) {
    const name = templateOf(m.Subject);
    if (!byTemplate.has(name)) byTemplate.set(name, m);
  }

  const browser = await chromium.launch();
  for (const [name, message] of byTemplate) {
    for (const colorScheme of ['light', 'dark']) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        colorScheme,
        ignoreHTTPSErrors: true, // the logo may come from a local stack with a self-signed certificate
      });
      const page = await context.newPage();
      await page.goto(`${mailpit}/view/${message.ID}.html`, { waitUntil: 'networkidle' });
      const file = path.join(outDir, `email-${name}-${colorScheme}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log('saved', path.relative(root, file), `(${message.Subject})`);
      await context.close();
    }
  }

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await page.goto(`${mailpit}/`, { waitUntil: 'networkidle' });
  const inbox = path.join(outDir, 'email-inbox.png');
  await page.screenshot({ path: inbox });
  console.log('saved', path.relative(root, inbox));
  await context.close();
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
