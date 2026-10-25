// The dev instance starts and draws its page: Vite serving the interface from source with the core in node_modules,
// as `pnpm dev` does (the build alone does not prove it: the core's 0.1.0 built and did not start).

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type ChildProcess, spawn } from 'node:child_process';
import { findChromium, freePort, type Running, startServer } from '@organon/core/testing';
import { type Browser, chromium } from 'playwright-core';
import { FIXTURE, ROOT, TSHARK } from './helpers.ts';

const CHROMIUM = findChromium(process.env.ARGUS_TEST_CHROMIUM, chromium.executablePath());
let app: Running;
let vite: ChildProcess;
let base = '';
let browser: Browser | undefined;
let viteLog = '';

before(async () => {
  app = await startServer(ROOT, { env: { TSHARK, SEED_PCAP: FIXTURE } });
  const port = await freePort();
  base = `http://localhost:${port}`;
  vite = spawn('pnpm', ['exec', 'vite', '--force'], {
    cwd: ROOT,
    env: { ...process.env, ARGUS_VITE_PORT: String(port), ARGUS_PORT: String(app.port), ARGUS_INSTANCE: 'dev' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const s of [vite.stdout, vite.stderr]) s?.on('data', (d: Buffer) => (viteLog += d.toString()));
  if (CHROMIUM) browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
});

after(async () => {
  await browser?.close();
  vite.kill();
  await app.stop();
});

test('pnpm dev: Vite serves the page from source, /api goes through to the dev server, no error', { skip: !CHROMIUM }, async () => {
  const page = await browser!.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.goto(base);
  await page.getByRole('heading', { name: 'Now' }).waitFor({ timeout: 10_000 });
  // The recording brought in, listed: the API went through Vite to the dev server.
  await page.goto(`${base}/#/captures`);
  await page.getByRole('table', { name: 'Captures' }).locator('tbody tr').first().waitFor({ timeout: 10_000 });
  assert.deepEqual(errors, []);
  assert.doesNotMatch(viteLog, /error/i, viteLog);
  await page.close();
});
