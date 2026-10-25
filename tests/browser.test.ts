// In a headless Chromium, on the built interface, with the pretend dumpcap and tshark (the fixture played back as if
// it were coming in now): turning the Wi-Fi on fills the page live, without a reload; a device opens its page and
// walks to the company it talks to and back; its conversations say with whom, by what service and how much, and lead
// to the other end; search, the hover card and the menu reach the entities; a reload loses nothing; a saved capture
// opens as it was; on a phone the ribbon slides in. With the demo's two networks (the house on Wi-Fi, containers on
// Docker): each device says its network, and one network can be chosen, the others' devices put after or left out,
// remembered across a reload.

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
  await p.getByRole('table', { name: 'Quem lhe falou' }).getByRole('link', { name: 'Este PC' }).click();
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

test('A name as long as the network allows never widens a page, at 1440 or on a phone', { skip: !CHROMIUM }, async () => {
  const fake = await fakeCapture();
  const long = await startServer(ROOT, {
    env: { TSHARK: path.join(ROOT, 'tests/fixtures/long-names-tshark.ts'), DUMPCAP: fake.dumpcap, SYS_NET: fake.sysNet, EMIT_MS: '250' },
  });
  try {
    await fetch(`${long.base}/api/live/wlan0`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"on":true}' });
    for (const width of [1440, 390]) {
      const { p, errors } = await page({ width, height: 900 });
      for (const hash of ['#/', '#/devices', `#/device/${encodeURIComponent('9a:11:22:33:44:77')}`, `#/device/${encodeURIComponent('00:04:3c:11:22:33')}`]) {
        await p.goto(`${long.base}/${hash}`);
        await p.locator('.page-title').first().waitFor();
        await p.waitForTimeout(400);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${width} ${hash}`);
      }
      assert.deepEqual(errors, []);
      await p.close();
    }
  } finally {
    await long.stop();
  }
});

test('The devices and hosts tables show their Total column whole, on every page they are on, at 1440 and on a phone', { skip: !CHROMIUM }, async () => {
  // Found by the reviewer: the table sat in a box that scrolled sideways, and Total was cut off at both widths. Here
  // with the fixture, and with names and makers as long as the network gives them.
  const fake = await fakeCapture();
  const long = await startServer(ROOT, {
    env: { TSHARK: path.join(ROOT, 'tests/fixtures/long-names-tshark.ts'), DUMPCAP: fake.dumpcap, SYS_NET: fake.sysNet, EMIT_MS: '250' },
  });
  try {
    for (const base of [app.base, long.base]) {
      await fetch(`${base}/api/live/wlan0`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"on":true}' });
      for (const width of [1440, 390]) {
        const { p, errors } = await page({ width, height: 900 });
        for (const [hash, label] of [
          ['#/', 'Dispositivos'],
          ['#/devices', 'Dispositivos'],
          ['#/internet', 'Anfitriões'],
        ] as const) {
          await p.goto(`${base}/${hash}`);
          await p.getByRole('table', { name: label }).locator('tbody tr').first().waitFor();
          await p.waitForTimeout(300);
          const fit = await p.evaluate((label) => {
            const table = document.querySelector(`table[aria-label="${label}"]`)!;
            const wrap = table.closest('.records-wrap')!;
            const total = [...table.querySelectorAll('th')].find((th) => th.textContent?.trim() === 'Total')!;
            return {
              scrolls: wrap.scrollWidth - wrap.clientWidth,
              totalRight: total.getBoundingClientRect().right,
              wrapRight: wrap.getBoundingClientRect().right,
              page: document.documentElement.scrollWidth - innerWidth,
            };
          }, label);
          const where = `${base === app.base ? 'fixture' : 'long names'} ${width} ${hash}`;
          assert.ok(fit.scrolls <= 0, `${where}: the table scrolls sideways by ${fit.scrolls}px`);
          assert.ok(fit.totalRight <= fit.wrapRight + 0.5, `${where}: Total ends at ${fit.totalRight}, past ${fit.wrapRight}`);
          assert.equal(fit.page, 0, `${where}: the page is wider than the screen`);
        }
        assert.deepEqual(errors, []);
        await p.close();
      }
    }
  } finally {
    await long.stop();
  }
});

test("A device's conversations: with whom, by what service, how much each way, and the other end a click away", { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(`${app.base}/#/device/${encodeURIComponent(truth.hosts.me.mac)}`);
  const table = p.getByRole('table', { name: 'Ligações' });
  const web = table.locator('tr', { hasText: truth.hosts.web.name });
  await web.waitFor();
  // The truth worked these out from the packets' headers: this PC and the web server, over HTTPS (tcp 443).
  const c = truth.conversations.find((x: { b: string }) => x.b === truth.hosts.web.ip);
  const text = await web.innerText();
  assert.match(text, /HTTPS/);
  assert.match(text, /tcp 443/);
  assert.match(text, new RegExp(`${c.sent} B`));
  assert.match(text, /2,9 KB/, `${c.received} bytes received`);
  // DNS with the router is a conversation too, with a device here.
  assert.match(await table.locator('tr', { hasText: 'Router' }).innerText(), /DNS/);
  await web.getByRole('link', { name: truth.hosts.web.name }).click();
  await p.getByRole('heading', { name: truth.hosts.web.name }).waitFor();
  const back = p.getByRole('table', { name: 'Quem lhe falou' }).locator('tr', { hasText: 'Este PC' });
  // From the host's side, what it sent is what this PC received.
  assert.match(await back.innerText(), /2,9 KB\s+462 B/);
  await back.getByRole('link', { name: 'Este PC' }).click();
  await p.getByRole('heading', { name: 'Este PC' }).waitFor();
  assert.deepEqual(errors, []);
  await p.close();
});

test('Two networks: each device says its network; one chosen puts the others after, or leaves them out, remembered; conversations move live', { skip: !CHROMIUM }, async () => {
  const fake = await fakeCapture();
  const demo = await startServer(ROOT, {
    env: { TSHARK: path.join(ROOT, 'scripts/demo-tshark.ts'), DUMPCAP: fake.dumpcap, SYS_NET: fake.sysNet, EMIT_MS: '250' },
  });
  try {
    for (const i of ['wlan0', 'docker0'])
      await fetch(`${demo.base}/api/live/${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"on":true}' });
    const { p, errors } = await page();
    await p.goto(`${demo.base}/#/devices`);
    const rows = devices(p);
    // The house (the router, this PC, eight others) on Wi-Fi; on Docker, this PC's bridge and three containers.
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Dispositivos"] tbody tr[data-device]').length === 14, null, { timeout: 15_000 });
    const net = (id: string) => p.locator(`tr[data-device="${id}"] td.net`).innerText();
    assert.match(await net('02:42:ac:1e:00:03'), /Docker/);
    assert.match(await net('3c:22:fb:ab:cd:ef'), /Wi-Fi/);

    // Docker chosen: its four first, the others after a line, faded.
    await p.getByRole('button', { name: /Rede: Todas as redes/ }).click();
    await p.getByRole('menuitemradio', { name: /Docker/ }).click();
    await p.locator('tr.others-h').waitFor();
    const order = await rows.evaluateAll((trs) => trs.map((tr) => (tr.classList.contains('others-h') ? '|' : tr.classList.contains('other') ? 'o' : 'm')).join(''));
    assert.equal(order, `mmmm|${'o'.repeat(10)}`);

    // The others left out altogether, and so after a reload.
    await p.getByRole('button', { name: /Rede: Docker/ }).click();
    await p.getByRole('menuitemcheckbox', { name: /Esconder os das outras redes/ }).click();
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Dispositivos"] tbody tr').length === 4);
    await p.reload();
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Dispositivos"] tbody tr[data-device]').length === 4, null, { timeout: 15_000 });
    await p.waitForTimeout(500);
    assert.equal(await rows.count(), 4);
    assert.match(await p.getByRole('button', { name: /Rede: Docker/ }).innerText(), /só esta/);
    // Agora's table follows the same choice.
    await p.goto(`${demo.base}/#/`);
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Dispositivos"] tbody tr[data-device]').length === 4, null, { timeout: 15_000 });

    // Every network again: all fourteen.
    await p.goto(`${demo.base}/#/devices`);
    await p.getByRole('button', { name: /Rede: Docker/ }).click();
    await p.getByRole('menuitemradio', { name: /Todas as redes/ }).click();
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Dispositivos"] tbody tr[data-device]').length === 14);
    assert.equal(await p.locator('tr.others-h').count(), 0);

    // The Docker network's page: its conversations, both ends, moving as they come (no reload).
    await p.goto(`${demo.base}/#/interface/docker0`);
    const talk = p.getByRole('table', { name: 'Ligações' }).locator('tr', { hasText: 'PostgreSQL' });
    await talk.waitFor({ timeout: 15_000 });
    const before = await talk.locator('td.num').nth(1).innerText();
    await p.waitForFunction(
      ([b]) => document.querySelector('tr[data-conversation*="tcp/5432"] td.num:nth-of-type(4)')?.textContent?.trim() !== b,
      [before],
      { timeout: 15_000 },
    );
    assert.deepEqual(errors, []);
    await p.close();
  } finally {
    await demo.stop();
  }
});
