// In a headless Chromium, on the built interface, with the pretend dumpcap and tshark (the fixture played back as if
// it were coming in now): turning the Wi-Fi on fills the page live, without a reload; a device opens its page and
// walks to the company it talks to and back; search, the hover card and the menu reach the entities; a reload loses
// nothing; a saved capture opens as it was; on a phone the ribbon slides in.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Running, findChromium, startServer } from '@organon/core/testing';
import { type Browser, chromium, type Page } from 'playwright-core';
import { FIXTURE, fakeCapture, fakeTshark, ROOT } from './helpers.ts';

const CHROMIUM = findChromium(process.env.ARGUS_TEST_CHROMIUM, chromium.executablePath());
const truth = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lan.truth.json'), 'utf8'));
let app: Running;
let browser: Browser | undefined;

before(async () => {
  const fake = await fakeCapture();
  const ts = await fakeTshark();
  app = await startServer(ROOT, { env: { TSHARK: ts.tshark, DUMPCAP: fake.dumpcap, SYS_NET: fake.sysNet, SEED_PCAP: FIXTURE, EMIT_MS: '250' } });
  if (CHROMIUM) browser = await chromium.launch({ executablePath: CHROMIUM, headless: true });
});
after(async () => {
  await browser?.close();
  await app.stop();
});

async function page(viewport = { width: 1440, height: 900 }) {
  const p = await browser!.newPage({ viewport });
  const errors: string[] = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  return { p, errors };
}

const devices = (p: Page) => p.getByRole('table', { name: 'Dispositivos' }).locator('tbody tr');

test('Before listening: the page says so, offers the interfaces as switches, and says once what can and cannot be seen', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await p.getByRole('heading', { name: 'Ainda não está a escutar' }).waitFor();
  const wifi = p.getByRole('switch', { name: /Wi-Fi/ });
  assert.equal(await wifi.getAttribute('aria-checked'), 'false');
  // The folded ones (Docker, loopback, all) are under "Mais".
  assert.equal(await p.getByRole('switch', { name: /Docker/ }).count(), 0);
  await p.getByRole('button', { name: /^Mais \d/ }).click();
  await p.getByRole('switch', { name: /Docker/ }).waitFor();
  assert.equal(await p.getByText('O que vai cifrado não se lê').count(), 1);
  assert.match(await p.locator('.statusline').innerText(), /Sem escutar/);
  assert.equal(await p.getByRole('navigation', { name: 'Sítios' }).getByRole('link', { name: 'Agora' }).getAttribute('aria-current'), 'page');
  assert.deepEqual(errors, []);
  await p.close();
});

test('Turning the Wi-Fi on: the devices, the hosts and the bandwidth arrive live, and a reload loses nothing', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await p.getByRole('switch', { name: /Wi-Fi/ }).click();
  await p.waitForFunction((n) => document.querySelectorAll('table[aria-label="Dispositivos"] tbody tr').length === n, 7, { timeout: 15_000 });
  assert.equal(await p.getByRole('switch', { name: /Wi-Fi/ }).getAttribute('aria-checked'), 'true');
  assert.match(await p.locator('.statusline').innerText(), /A escutar Wi-Fi/);
  const phone = p.locator('tr', { hasText: truth.hosts.phone.name });
  assert.match(await phone.innerText(), new RegExp(truth.hosts.phone.ip.replaceAll('.', '\\.')));
  assert.match(await phone.innerText(), /Apple/);
  assert.match(await p.locator('tr', { hasText: 'Router' }).innerText(), /Router/);
  assert.match(await p.getByRole('list', { name: 'Empresas e sites' }).innerText(), /Google/);
  assert.equal(await p.getByRole('img', { name: /Débito, toda a rede/ }).count(), 1);
  // Reloaded, the session is the server's: the same devices, the switch still on.
  await p.reload();
  await p.waitForFunction((n) => document.querySelectorAll('table[aria-label="Dispositivos"] tbody tr').length === n, 7);
  assert.equal(await p.getByRole('switch', { name: /Wi-Fi/ }).getAttribute('aria-checked'), 'true');
  assert.deepEqual(errors, []);
  await p.close();
});

test('A device opens its page; from there the company it talks to, and back; each page gets its own tab', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await devices(p).first().waitFor();
  await p.getByRole('table', { name: 'Dispositivos' }).getByRole('link', { name: 'Este PC' }).click();
  await p.getByRole('heading', { name: 'Este PC' }).waitFor();
  assert.match(await p.locator('.props').innerText(), new RegExp(truth.hosts.me.mac));
  await p.getByRole('list', { name: 'Empresas e sites' }).getByRole('link', { name: 'Google' }).click();
  await p.getByRole('heading', { name: 'Google' }).waitFor();
  await p.getByRole('list', { name: 'Anfitriões' }).getByRole('link', { name: truth.hosts.web.name }).first().click();
  await p.getByRole('heading', { name: truth.hosts.web.name }).waitFor();
  assert.match(await p.locator('.page-head').innerText(), new RegExp(truth.hosts.web.ip.replaceAll('.', '\\.')));
  await p.getByRole('list', { name: 'Quem lhe falou' }).getByRole('link', { name: 'Este PC' }).click();
  await p.getByRole('heading', { name: 'Este PC' }).waitFor();
  assert.ok((await p.getByRole('tab').count()) >= 3);
  assert.deepEqual(errors, []);
  await p.close();
});

test('Search finds a device by its maker; the hover card and the menu reach a device from its link', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await devices(p).first().waitFor();
  await p.keyboard.press('Control+k');
  await p.getByRole('dialog', { name: 'Procurar' }).getByRole('textbox').fill('raspberry');
  await p.getByRole('option', { name: /raspberrypi/ }).waitFor();
  await p.keyboard.press('Enter');
  await p.getByRole('heading', { name: 'raspberrypi' }).waitFor();
  await p.goto(`${app.base}/#/devices`);
  // Scrolled to first, as a person does: a scroll closes the card (it would be left pointing at nothing).
  const link = p.getByRole('table', { name: 'Dispositivos' }).getByRole('link', { name: truth.hosts.windows.name });
  await link.scrollIntoViewIfNeeded();
  await p.waitForTimeout(100);
  await link.hover();
  const card = p.getByRole('tooltip');
  await card.waitFor();
  assert.match(await card.innerText(), /Intel/);
  assert.match(await card.innerText(), new RegExp(truth.hosts.windows.mac));
  await link.click({ button: 'right' });
  await p.getByRole('menuitem', { name: 'Copiar a MAC' }).waitFor();
  await p.getByRole('menuitem', { name: `Abrir ${truth.hosts.windows.name}` }).click();
  await p.getByRole('heading', { name: truth.hosts.windows.name }).waitFor();
  assert.deepEqual(errors, []);
  await p.close();
});

test('Saving the last minutes: a capture, listed, and opened as it was, its links staying in it', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(`${app.base}/#/captures`);
  await p.getByRole('button', { name: 'Guardar os últimos minutos' }).click();
  await p.getByRole('heading', { name: /Captura de/ }).waitFor();
  await p.waitForFunction((n) => document.querySelectorAll('table[aria-label="Dispositivos"] tbody tr').length === n, 7);
  await p.getByRole('table', { name: 'Dispositivos' }).getByRole('link', { name: 'raspberrypi' }).click();
  await p.getByRole('heading', { name: 'raspberrypi' }).waitFor();
  assert.match(p.url(), /\?c=/);
  assert.match(await p.locator('.source').innerText(), /Da captura de/);
  await p.goto(`${app.base}/#/captures`);
  // The one saved now, and the recording brought in at the start.
  assert.equal(await p.getByRole('table', { name: 'Capturas' }).locator('tbody tr').count(), 2);
  assert.deepEqual(errors, []);
  await p.close();
});

test('On a phone: the bar says it is listening, the ribbon slides in from the menu and closes on a place', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page({ width: 390, height: 844 });
  await p.goto(app.base);
  await p.locator('.listening-m').waitFor();
  assert.ok((await p.locator('.ribbon-col').boundingBox())!.x < 0);
  await p.getByRole('button', { name: 'Abrir o menu' }).click();
  await p.waitForFunction(() => document.querySelector('.ribbon-col')!.getBoundingClientRect().x >= 0);
  await p.getByRole('navigation', { name: 'Sítios' }).getByRole('link', { name: 'Internet' }).click();
  await p.getByRole('heading', { name: 'Na internet' }).waitFor();
  // Nothing wider than the screen.
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  assert.deepEqual(errors, []);
  await p.close();
});
