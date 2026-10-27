// Takes full-page screenshots of the web app at phone, tablet and desktop widths.
// Usage: pnpm --filter @mbc/web build && node scripts/screenshots.mjs
// Output: docs/screenshots/<route>-<width>.png

import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'docs', 'screenshots');
const port = Number(process.env.SCREENSHOT_PORT ?? 3100);
const baseUrl = `http://127.0.0.1:${port}`;

const routes = [
  { name: 'home', path: '/' },
  { name: 'signin', path: '/signin' },
  { name: 'account', path: '/account' },
  { name: 'admin', path: '/admin' },
];
const widths = [360, 768, 1280];

async function waitForServer(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server at ${url} did not start`);
}

async function main() {
  await mkdir(outDir, { recursive: true });

  const server = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['--filter', '@mbc/web', 'exec', 'next', 'start', '-p', String(port)],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );

  try {
    await waitForServer(baseUrl);
    const browser = await chromium.launch();
    for (const width of widths) {
      const context = await browser.newContext({
        viewport: { width, height: width < 768 ? 740 : 900 },
        deviceScaleFactor: 2,
      });
      const page = await context.newPage();
      for (const route of routes) {
        await page.goto(`${baseUrl}${route.path}`, { waitUntil: 'networkidle' });
        // eslint-disable-next-line no-undef -- runs inside the browser page
        await page.evaluate(() => document.fonts.ready);
        const file = path.join(outDir, `${route.name}-${width}.png`);
        await page.screenshot({ path: file, fullPage: true });
        console.log('saved', path.relative(root, file));
      }
      await context.close();
    }
    await browser.close();
  } finally {
    // next start runs through a shell on Windows, so kill the whole process tree.
    if (process.platform === 'win32' && server.pid) {
      spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      server.kill();
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
