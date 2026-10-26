// pnpm pictures: the README's pictures (docs/images/*.webp), from the demo's made-up house and never from a real
// network. It starts the demo on a free port, lets it listen for a while (ARGUS_PICTURES_WAIT seconds, 240: the chart
// needs minutes to have a shape), and takes each page at 1600 × 1000 in a headless Chromium, light and dark: Now,
// the TV's page (what it is, what it is doing, its day), and search over the devices. ImageMagick turns them into WebP.
//
//   pnpm build && pnpm pictures

import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { findChromium, freePort } from '@organon/core/testing';
import { chromium, type Page } from 'playwright-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'docs/images');
const WAIT = Number(process.env.ARGUS_PICTURES_WAIT ?? 240);
const executablePath = findChromium(process.env.ARGUS_TEST_CHROMIUM, chromium.executablePath());
if (!executablePath) throw new Error('no Chromium found (ARGUS_TEST_CHROMIUM)');

const port = await freePort();
const base = `http://localhost:${port}`;
const demo = spawn(process.execPath, ['scripts/demo.ts'], { cwd: ROOT, env: { ...process.env, ARGUS_DEMO_PORT: String(port) }, stdio: 'ignore' });
try {
  for (let i = 0; i < 300 && !(await fetch(base).then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 100));
  console.log(`the demo on ${base}; listening for ${WAIT} s`);
  await new Promise((r) => setTimeout(r, WAIT * 1000));
  const browser = await chromium.launch({ executablePath, headless: true });
  for (const scheme of ['light', 'dark'] as const) {
    const p = await browser.newPage({ viewport: { width: 1600, height: 1000 }, colorScheme: scheme });
    // The look is kept in this browser (the core's theme-boot.js reads it before the first paint).
    await p.addInitScript((mode) => localStorage.setItem('argus.look', JSON.stringify({ mode })), scheme);
    await p.goto(`${base}/#/`);
    await p.locator('ul[aria-label="Who is using the network"] li').first().waitFor();
    await save(p, `now-${scheme}`);
    await p.goto(`${base}/#/devices`);
    await p.locator('table tbody tr[data-device] a', { hasText: 'Living Room TV' }).click();
    await p.waitForURL(/#\/device\//);
    await p.getByRole('heading', { name: 'Today' }).waitFor();
    await save(p, `device-${scheme}`);
    await p.goto(`${base}/#/devices`);
    await p.locator('table tbody tr[data-device]').first().waitFor();
    await p.keyboard.press('Control+k');
    await p.keyboard.type('living', { delay: 60 });
    await save(p, `search-${scheme}`);
    await p.close();
  }
  await browser.close();
} finally {
  demo.kill('SIGTERM');
}

async function save(p: Page, name: string) {
  await p.waitForTimeout(1500);
  // The demo is a dev instance: its badge is not part of the picture.
  await p.addStyleTag({ content: 'span.dev[title] { display: none !important; }' });
  const png = await p.screenshot();
  const r = spawnSync('magick', ['png:-', '-quality', '82', `webp:${path.join(OUT, `${name}.webp`)}`], { input: png });
  if (r.status !== 0) throw new Error(`magick: ${r.stderr}`);
  console.log(`docs/images/${name}.webp`);
}
