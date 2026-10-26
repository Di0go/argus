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
import { DEVICES, FIXTURE, fakeCapture, fakeTshark, ROOT } from './helpers.ts';

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

const devices = (p: Page) => p.getByRole('table', { name: 'Devices' }).locator('tbody tr');

test('Before listening: the page says so, offers the interfaces as switches, and says once what can and cannot be seen', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await p.getByRole('heading', { name: 'Not listening yet' }).waitFor();
  const wifi = p.getByRole('switch', { name: /Wi-Fi/ });
  assert.equal(await wifi.getAttribute('aria-checked'), 'false');
  // The folded ones (Docker, loopback, all) are under "N more".
  assert.equal(await p.getByRole('switch', { name: /Docker/ }).count(), 0);
  await p.getByRole('button', { name: /^\d+ more/ }).click();
  await p.getByRole('switch', { name: /Docker/ }).waitFor();
  assert.equal(await p.getByText('What is encrypted is not read').count(), 1);
  assert.match(await p.locator('.statusline').innerText(), /Not listening/);
  assert.equal(await p.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Now' }).getAttribute('aria-current'), 'page');
  assert.deepEqual(errors, []);
  await p.close();
});

test('Turning the Wi-Fi on: who is using the network arrives live, moves without a reload, and a reload loses nothing', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(app.base);
  await p.getByRole('switch', { name: /Wi-Fi/ }).click();
  // The home page is the monitor: a line per device in use, and whom they are talking to now.
  const who = p.getByRole('list', { name: 'Who is using the network' });
  await who.locator('li[data-device]').first().waitFor({ timeout: 15_000 });
  await p.getByText('Live, every second').waitFor();
  await p.getByRole('table', { name: 'Talking to now' }).locator('tr').first().waitFor({ timeout: 15_000 });
  // Live: the numbers change with no reload (the pretend tshark plays the fixture back as it comes).
  const numbers = () => p.locator('main').evaluate((m) => [...m.querySelectorAll('.rt')].map((e) => e.textContent).join('|'));
  const first = await numbers();
  await p.waitForFunction((b) => [...document.querySelectorAll('main .rt')].map((e) => e.textContent).join('|') !== b, first, { timeout: 15_000 });
  // Nothing else on it: no day, no diary, no privacy box, no pill counting what went unencrypted.
  for (const gone of ['Today', 'What happened', 'Tracking and telemetry'])
    assert.equal(await p.getByRole('heading', { name: gone }).count(), 0, gone);
  assert.equal(await p.getByRole('region', { name: 'Without encryption' }).count(), 0);
  assert.equal(await p.getByText(/unencrypted in the last hour/).count(), 0);
  // A line is a door: one click to the device.
  await who.locator('li[data-device] a').first().click();
  await p.waitForURL(/#\/device\//);
  await p.getByRole('table', { name: /is talking to now/ }).waitFor({ timeout: 15_000 });
  await p.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Network' }).click();
  await p.waitForFunction((n) => document.querySelectorAll('table[aria-label="Devices"] tbody tr').length === n, DEVICES, { timeout: 15_000 });
  const phone = p.locator('tr', { hasText: truth.hosts.phone.name });
  assert.match(await phone.innerText(), new RegExp(truth.hosts.phone.ip.replaceAll('.', '\\.')));
  assert.match(await phone.innerText(), /iPhone, iOS/);
  assert.match(await p.locator('tr', { hasText: 'Router' }).innerText(), /Router/);
  // Reloaded, the session is the server's: the same devices, the switch still on in the bar.
  await p.reload();
  await p.waitForFunction((n) => document.querySelectorAll('table[aria-label="Devices"] tbody tr').length === n, DEVICES);
  assert.equal(await p.getByRole('switch', { name: /Wi-Fi/ }).getAttribute('aria-checked'), 'true');
  assert.deepEqual(errors, []);
  await p.close();
});

test('Where Argus listens is on every page, and stays in view as the page scrolls', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  for (const hash of ['#/', '#/devices', '#/internet', '#/privacy', '#/diary', '#/captures', `#/device/${encodeURIComponent(truth.hosts.me.mac)}`]) {
    await p.goto(`${app.base}/${hash}`);
    const bar = p.getByRole('group', { name: /Where Argus listens/ });
    await bar.getByRole('switch', { name: /Wi-Fi/ }).waitFor();
    await p.mouse.wheel(0, 3000);
    await p.waitForTimeout(200);
    const box = await bar.boundingBox();
    assert.ok(box && box.y >= 0 && box.y < 120, `${hash}: the bar at ${box?.y}`);
  }
  assert.deepEqual(errors, []);
  await p.close();
});

test('Without encryption is a small open padlock in the ink of the text, never a colour', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(`${app.base}/#/privacy`);
  const lock = p.getByRole('button', { name: /Unencrypted: FTP, a login in the clear/ }).first();
  await lock.waitFor({ timeout: 15_000 });
  assert.equal(await lock.evaluate((e) => getComputedStyle(e).backgroundColor), 'rgba(0, 0, 0, 0)');
  // The old colour for it (orange, light and dark) is nowhere: no row striped, no box tinted, no text.
  const orange = await p.evaluate(() =>
    [...document.querySelectorAll('main *')].filter((e) => {
      const c = getComputedStyle(e);
      return [c.color, c.backgroundColor, c.boxShadow, c.backgroundImage].some((v) => /194, 65, 12|251, 146, 60/.test(v));
    }).length,
  );
  assert.equal(orange, 0);
  assert.equal(await p.locator('.clear-row').count(), 0);
  assert.deepEqual(errors, []);
  await p.close();
});

test('A device opens its page; from there the company it talks to, and back; each page gets its own tab', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(`${app.base}/#/devices`);
  await devices(p).first().waitFor();
  await p.getByRole('table', { name: 'Devices' }).getByRole('link', { name: 'This PC' }).click();
  await p.getByRole('heading', { name: 'This PC' }).waitFor();
  assert.match(await p.locator('.props').innerText(), new RegExp(truth.hosts.me.mac));
  await p.getByRole('list', { name: 'Companies and sites' }).getByRole('link', { name: 'Google' }).click();
  await p.getByRole('heading', { name: 'Google' }).waitFor();
  await p.getByRole('list', { name: 'Hosts' }).getByRole('link', { name: truth.hosts.web.name }).first().click();
  await p.getByRole('heading', { name: truth.hosts.web.name }).waitFor();
  assert.match(await p.locator('.page-head').innerText(), new RegExp(truth.hosts.web.ip.replaceAll('.', '\\.')));
  await p.getByRole('table', { name: 'Who talked to it' }).getByRole('link', { name: 'This PC' }).click();
  await p.getByRole('heading', { name: 'This PC' }).waitFor();
  assert.ok((await p.getByRole('tab').count()) >= 3);
  assert.deepEqual(errors, []);
  await p.close();
});

test('Search finds a device by its maker; the hover card and the menu reach a device from its link', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(`${app.base}/#/devices`);
  await devices(p).first().waitFor();
  await p.keyboard.press('Control+k');
  await p.getByRole('dialog', { name: 'Search' }).getByRole('textbox').fill('raspberry');
  await p.getByRole('option', { name: /raspberrypi/ }).waitFor();
  await p.keyboard.press('Enter');
  await p.getByRole('heading', { name: 'raspberrypi' }).waitFor();
  await p.goto(`${app.base}/#/devices`);
  // Scrolled to first, as a person does: a scroll closes the card (it would be left pointing at nothing).
  const link = p.getByRole('table', { name: 'Devices' }).getByRole('link', { name: truth.hosts.windows.name });
  await link.scrollIntoViewIfNeeded();
  await p.waitForTimeout(100);
  await link.hover();
  const card = p.getByRole('tooltip');
  await card.waitFor();
  assert.match(await card.innerText(), /Intel/);
  assert.match(await card.innerText(), new RegExp(truth.hosts.windows.mac));
  await link.click({ button: 'right' });
  await p.getByRole('menuitem', { name: 'Copy the MAC' }).waitFor();
  await p.getByRole('menuitem', { name: `Open ${truth.hosts.windows.name}` }).click();
  await p.getByRole('heading', { name: truth.hosts.windows.name }).waitFor();
  assert.deepEqual(errors, []);
  await p.close();
});

test('Saving the last minutes: a capture, listed, and opened as it was, its links staying in it', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(`${app.base}/#/captures`);
  await p.getByRole('button', { name: 'Save the last minutes' }).click();
  await p.getByRole('heading', { name: /Capture of/ }).waitFor();
  await p.waitForFunction((n) => document.querySelectorAll('table[aria-label="Devices"] tbody tr').length === n, DEVICES);
  await p.getByRole('table', { name: 'Devices' }).getByRole('link', { name: 'raspberrypi' }).click();
  await p.getByRole('heading', { name: 'raspberrypi' }).waitFor();
  assert.match(p.url(), /\?c=/);
  assert.match(await p.locator('.source').innerText(), /From the capture of/);
  await p.goto(`${app.base}/#/captures`);
  // The one saved now, and the recording brought in at the start.
  assert.equal(await p.getByRole('table', { name: 'Captures' }).locator('tbody tr').count(), 2);
  assert.deepEqual(errors, []);
  await p.close();
});

test('On a phone: the bar says it is listening, the ribbon slides in from the menu and closes on a place', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page({ width: 390, height: 844 });
  await p.goto(app.base);
  await p.locator('.listening-m').waitFor();
  assert.ok((await p.locator('.ribbon-col').boundingBox())!.x < 0);
  await p.getByRole('button', { name: 'Open the menu' }).click();
  await p.waitForFunction(() => document.querySelector('.ribbon-col')!.getBoundingClientRect().x >= 0);
  await p.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Internet' }).click();
  await p.getByRole('heading', { name: 'On the internet' }).waitFor();
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
        const wide = await p.evaluate(() =>
          [...document.querySelectorAll('body *')]
            .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
            .slice(0, 3)
            .map((e) => `${e.tagName.toLowerCase()}.${e.className}`)
            .join(', '),
        );
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, `${width} ${hash}: ${wide}`);
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
          ['#/devices', 'Devices'],
          ['#/internet', 'Hosts'],
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
  const table = p.getByRole('table', { name: 'Conversations' });
  const web = table.locator('tr', { hasText: truth.hosts.web.name });
  await web.waitFor();
  // The truth worked these out from the packets' headers: this PC and the web server, over HTTPS (tcp 443).
  const c = truth.conversations.find((x: { b: string }) => x.b === truth.hosts.web.ip);
  const text = await web.innerText();
  assert.match(text, /HTTPS/);
  assert.match(text, /tcp 443/);
  assert.match(text, new RegExp(`${c.sent} B`));
  assert.match(text, /2\.9 KB/, `${c.received} bytes received`);
  // DNS with the router is a conversation too, with a device here.
  assert.match(await table.locator('tr', { hasText: 'Router' }).innerText(), /DNS/);
  await web.getByRole('link', { name: truth.hosts.web.name }).click();
  await p.getByRole('heading', { name: truth.hosts.web.name }).waitFor();
  const back = p.getByRole('table', { name: 'Who talked to it' }).locator('tr', { hasText: 'This PC' });
  // From the host's side, what it sent is what this PC received.
  assert.match(await back.innerText(), /2\.9 KB\s+462 B/);
  await back.getByRole('link', { name: 'This PC' }).click();
  await p.getByRole('heading', { name: 'This PC' }).waitFor();
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
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 14, null, { timeout: 15_000 });
    const net = (id: string) => p.locator(`tr[data-device="${id}"] td.net`).innerText();
    assert.match(await net('02:42:ac:1e:00:03'), /Docker/);
    assert.match(await net('3c:22:fb:ab:cd:ef'), /Wi-Fi/);

    // Docker chosen: its four first, the others after a line, faded.
    await p.getByRole('button', { name: /Network: All networks/ }).click();
    await p.getByRole('menuitemradio', { name: /Docker/ }).click();
    await p.locator('tr.others-h').waitFor();
    const order = await rows.evaluateAll((trs) => trs.map((tr) => (tr.classList.contains('others-h') ? '|' : tr.classList.contains('other') ? 'o' : 'm')).join(''));
    assert.equal(order, `mmmm|${'o'.repeat(10)}`);

    // The others left out altogether, and so after a reload.
    await p.getByRole('button', { name: /Network: Docker/ }).click();
    await p.getByRole('menuitemcheckbox', { name: /Hide the other networks/ }).click();
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr').length === 4);
    await p.reload();
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 4, null, { timeout: 15_000 });
    await p.waitForTimeout(500);
    assert.equal(await rows.count(), 4);
    assert.match(await p.getByRole('button', { name: /Network: Docker/ }).innerText(), /only this/);
    // Who is using the network, on Now, follows the same choice: only Docker's.
    await p.goto(`${demo.base}/#/`);
    const who = p.getByRole('list', { name: 'Who is using the network' }).locator('li[data-device]');
    await who.first().waitFor({ timeout: 15_000 });
    for (const id of await who.evaluateAll((els) => els.map((e) => e.getAttribute('data-device')))) assert.match(id ?? '', /^02:42:/);

    // Every network again: all fourteen.
    await p.goto(`${demo.base}/#/devices`);
    await p.getByRole('button', { name: /Network: Docker/ }).click();
    await p.getByRole('menuitemradio', { name: /All networks/ }).click();
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 14);
    assert.equal(await p.locator('tr.others-h').count(), 0);

    // The Docker network's page: its conversations, both ends, moving as they come (no reload).
    await p.goto(`${demo.base}/#/interface/docker0`);
    const talk = p.getByRole('table', { name: 'Conversations' }).locator('tr', { hasText: 'PostgreSQL' });
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

test('Privacy and the diary: every unencrypted conversation listed with its device, DNS and old TLS; the day kept', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(`${app.base}/#/privacy`);
  await p.getByRole('heading', { name: 'Privacy' }).waitFor();
  const box = p.getByRole('region', { name: 'Without encryption' });
  await box.getByText(truth.hosts.upload.name).waitFor({ timeout: 15_000 });
  assert.match(await box.innerText(), /Office|Hewlett|Printer/);
  // The harmless ones are listed apart, quietly.
  assert.match(await box.innerText(), /Harmless by design/);
  const names = p.getByRole('region', { name: 'Names and encryption' });
  assert.match(await names.innerText(), /Galaxy-Tab-S9\s+asks Google DNS directly/);
  assert.match(await names.innerText(), new RegExp(truth.hosts.legacy.name.replaceAll('.', '\\.')));
  await p.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Diary' }).click();
  await p.getByRole('heading', { name: 'Diary' }).waitFor();
  await p.getByRole('heading', { name: 'By hour' }).waitFor();
  assert.deepEqual(errors, []);
  await p.close();
});

test('A device says what it is, how sure, and why; its conversations mark the unencrypted', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  await p.goto(`${app.base}/#/device/${encodeURIComponent(truth.hosts.phone.mac)}`);
  await p.getByRole('heading', { name: truth.hosts.phone.name }).waitFor();
  const clues = p.getByRole('list', { name: 'Clues' });
  await clues.waitFor();
  assert.match(await clues.innerText(), /User-Agent/);
  assert.match(await p.locator('.props').innerText(), /iPhone, iOS\s+sure/);
  await p.goto(`${app.base}/#/device/${encodeURIComponent(truth.hosts.pi.mac)}`);
  // Without encryption is a small open padlock in the line, no colour; what it was is in its tip.
  const ftp = p.getByRole('table', { name: 'Conversations' }).getByRole('button', { name: /Unencrypted: FTP, a login in the clear/ });
  await ftp.first().waitFor();
  assert.match((await ftp.first().getAttribute('data-tip')) ?? '', /A login went by/);
  assert.equal(await p.locator('.clear-row').count(), 0);
  assert.deepEqual(errors, []);
  await p.close();
});

test('Every device page of the fixture opens whole, with no error in the console (this PC first: it once failed)', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  const v = (await (await fetch(`${app.base}/api/live`)).json()) as { devices: { id: string; name: string; role?: string }[] };
  assert.equal(v.devices.length, DEVICES);
  const ids = [...v.devices].sort((a, b) => Number(b.role === 'self') - Number(a.role === 'self')).map((d) => d);
  for (const d of ids) {
    await p.goto(`${app.base}/#/device/${encodeURIComponent(d.id)}`);
    await p.getByRole('heading', { name: d.name, exact: true }).waitFor({ timeout: 10_000 });
    await p.getByRole('heading', { name: 'Conversations' }).waitFor({ timeout: 10_000 });
    assert.deepEqual(errors, [], `${d.name}: ${errors.join('; ')}`);
  }
  await p.close();
});

test('Now: the lines and the quiet ones count the same house (the router in neither)', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  const { house } = await import('../ui/src/lib/house.ts');
  await p.goto(app.base);
  const rows = p.getByRole('list', { name: 'Who is using the network' }).locator(':scope > li');
  await p.locator('.quiet, .none').first().waitFor({ timeout: 15_000 });
  await p.waitForTimeout(1500);
  const v = (await (await fetch(`${app.base}/api/live`)).json()) as { devices: Parameters<typeof house>[0] };
  const ifaces = (await (await fetch(`${app.base}/api/interfaces`)).json()) as { interfaces: Parameters<typeof house>[1] };
  const total = house(v.devices, ifaces.interfaces).length;
  const quietText = await p.locator('.quiet').innerText().catch(() => '0 more');
  const quiet = Number(quietText.match(/(\d+) more/)?.[1] ?? 0);
  assert.equal((await rows.count()) + quiet, total, `${await rows.count()} rows, ${quietText}`);
  assert.doesNotMatch(await rows.allInnerTexts().then((t) => t.join(' ')), /Router/);
  assert.deepEqual(errors, []);
  await p.close();
});
