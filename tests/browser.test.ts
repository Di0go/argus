// In a headless Chromium, on the built interface over a recording brought in: the hosts page shows who was there,
// a device opens its own page with who it talked to, search finds by maker, and a link shows the device's card.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { type Running, findChromium, startServer } from '@organon/core/testing';
import { type Browser, chromium } from 'playwright-core';
import { FIXTURE, fakeCapture, ROOT, TSHARK } from './helpers.ts';

const CHROMIUM = findChromium(process.env.ARGUS_TEST_CHROMIUM, chromium.executablePath());
let app: Running;
let browser: Browser | undefined;

before(async () => {
  const fake = await fakeCapture();
  app = await startServer(ROOT, { env: { TSHARK, DUMPCAP: fake.dumpcap, SYS_NET: fake.sysNet, SEED_PCAP: FIXTURE } });
  if (CHROMIUM) browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
});
after(async () => {
  await browser?.close();
  await app.stop();
});

async function page() {
  const p = await browser!.newPage();
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { p, errors };
}

test('The hosts page: the devices with name, IP, MAC and maker, the internet host by its DNS name, the limits said', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  const rows = p.getByRole('table', { name: 'Dispositivos' }).locator('tbody tr');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 7);
  const phone = p.locator('tr', { hasText: 'Alexs-iPhone' });
  assert.match(await phone.innerText(), /192\.168\.1\.23/);
  assert.match(await phone.innerText(), /3c:22:fb:ab:cd:ef/);
  assert.match(await phone.innerText(), /Apple, Inc\./);
  assert.match(await p.locator('tr', { hasText: 'Router Tp-Link' }).innerText(), /router/);
  assert.match(await p.getByRole('table', { name: 'Na internet' }).innerText(), /www\.google\.com/);
  assert.match(await p.locator('.note').innerText(), /cifrado não se lê/);
  // The interfaces, as he would name them, Wi-Fi chosen.
  assert.equal(await p.getByRole('checkbox', { name: 'Wi-Fi' }).isChecked(), true);
  assert.deepEqual(errors, []);
  await p.close();
});

test('A device opens its page, and from there the host it talked to and back', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await p.getByRole('link', { name: 'Este PC' }).click();
  await p.getByRole('heading', { name: 'Este PC' }).waitFor();
  await p.getByRole('table', { name: 'Falou com' }).getByRole('link', { name: 'www.google.com' }).click();
  await p.getByRole('heading', { name: 'www.google.com' }).waitFor();
  assert.match(await p.locator('.facts').innerText(), /142\.250\.184\.14/);
  await p.getByRole('link', { name: 'Este PC' }).click();
  await p.getByRole('heading', { name: 'Este PC' }).waitFor();
  assert.deepEqual(errors, []);
  await p.close();
});

test('Search finds a device by its maker; hovering a link shows its card', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await p.getByRole('table', { name: 'Dispositivos' }).locator('tbody tr').first().waitFor();
  await p.getByRole('searchbox', { name: 'Procurar' }).fill('raspberry');
  const hit = p.locator('.hits a');
  await hit.first().waitFor();
  assert.equal(await hit.count(), 1);
  assert.match(await hit.innerText(), /raspberrypi/);
  await p.getByRole('searchbox', { name: 'Procurar' }).fill('');
  await p.getByRole('table', { name: 'Dispositivos' }).getByRole('link', { name: 'DESKTOP-STUDY' }).hover();
  const card = p.getByRole('tooltip');
  await card.waitFor();
  assert.match(await card.innerText(), /Intel Corporate/);
  assert.match(await card.innerText(), /00:1b:21:aa:bb:cc/);
  assert.deepEqual(errors, []);
  await p.close();
});

test('A capture from the page: the button runs it, says the seconds, and the page shows the new capture', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await p.getByRole('combobox', { name: 'Captura' }).waitFor();
  const before = await p.getByRole('combobox', { name: 'Captura' }).locator('option').count();
  await p.getByRole('button', { name: 'Capturar' }).click();
  await p.getByRole('button', { name: /A capturar/ }).waitFor();
  await p.getByRole('button', { name: 'Capturar' }).waitFor({ timeout: 15_000 });
  await p.waitForFunction((n) => document.querySelectorAll('select[aria-label="Captura"] option').length === n + 1, before);
  assert.match(await p.getByRole('combobox', { name: 'Captura' }).locator('option').first().innerText(), /wlan0/);
  assert.deepEqual(errors, []);
  await p.close();
});
