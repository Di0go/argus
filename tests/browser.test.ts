// In a headless Chromium, on the built interface, with the pretend dumpcap and tshark (the fixture played back as if
// it were coming in now): turning the Wi-Fi on fills the page live, without a reload; a device opens its page and
// walks to the company it talks to and back; its conversations say with whom, by what service and how much, and lead
// to the other end; search, the hover card and the menu reach the entities; a reload loses nothing; a saved capture
// opens as it was; on a phone the ribbon slides in. With the demo's networks (a café on the Wi-Fi, then the house on
// it, and containers on Docker): each device says its networks, the one of now is said by its Wi-Fi's name, and one
// chosen shows only its own devices, remembered across a reload.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Running, findChromium, startServer } from '@organon/core/testing';
import { type Browser, chromium, type Page } from 'playwright-core';
import { fakeRouter } from './fake-router.ts';
import { DEVICES, FIXTURE, fakeCapture, fakeTshark, ROOT } from './helpers.ts';

/** The made-up router's password (tests/fake-router.ts): made up too. */
const ROUTER_PASSWORD = 'willow-test-pw';

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
  await p.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Devices' }).click();
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

test('Two Wi-Fi networks, a café and the house: each shows only its own devices, the one of now said; remembered; conversations move live', { skip: !CHROMIUM }, async () => {
  const fake = await fakeCapture();
  const ssid = path.join(await mkdtemp(path.join(tmpdir(), 'argus-ssid-')), 'ssid');
  const fakeHouseRouter = await fakeRouter({ password: ROUTER_PASSWORD });
  const demo = await startServer(ROOT, {
    env: {
      TSHARK: path.join(ROOT, 'scripts/demo-tshark.ts'),
      DUMPCAP: fake.dumpcap,
      SYS_NET: fake.sysNet,
      EMIT_MS: '250',
      POLL_MS: '300',
      IW: path.join(ROOT, 'scripts/demo-iw.ts'),
      DEMO_SSID_FILE: ssid,
      DEMO_CAFE: '4',
      // The house's neighbour table and a scan of it, made up (scripts/demo-ip.ts, scripts/demo-nmap.ts).
      IP: path.join(ROOT, 'scripts/demo-ip.ts'),
      NMAP: path.join(ROOT, 'scripts/demo-nmap.ts'),
      NEIGH: '1',
      SCAN: '1',
      LEASES: 'none',
      SOURCES_MS: '300',
      // The router of the house, made up (tests/fake-router.ts); its password kept beside the test's data.
      ROUTER: '1',
      ROUTER_URL: fakeHouseRouter.base,
      ROUTER_KEYS: path.join(path.dirname(ssid), 'router-keys.json'),
    },
  });
  try {
    for (const i of ['wlan0', 'docker0'])
      await fetch(`${demo.base}/api/live/${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"on":true}' });
    const { p, errors } = await page();
    await p.goto(`${demo.base}/#/devices`);
    const shown = () => devices(p).evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-device')).sort());
    const choose = async (name: RegExp) => {
      await p.getByRole('button', { name: /^Showing: / }).click();
      await p.getByRole('menuitemradio', { name }).click();
    };
    // The café first (four seconds), then home: the network of now is the house's Wi-Fi, by its name, and Docker.
    await p.getByRole('button', { name: /^Showing: Docker and Willow House/ }).waitFor({ timeout: 20_000 });
    assert.match(await p.getByRole('switch', { name: /Wi-Fi/ }).innerText(), /Willow House/);
    const ME = '3c:a9:f4:10:20:30';
    const CAFE = ['00:04:3c:5e:a1:40', '00:1b:21:5e:a1:20', 'da:7e:11:5e:a1:31', 'f0:9f:c2:5e:a1:01', ME].sort();
    // The house (the router, this PC, eight others) and Docker's four; nothing of the café's, though its 192.168.1.x
    // devices were heard on the same Wi-Fi a moment ago.
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 14, null, { timeout: 15_000 });
    assert.ok((await shown()).every((id) => !CAFE.includes(id!) || id === ME));
    const net = (id: string) => p.locator(`tr[data-device="${id}"] td.net`).innerText();
    assert.match(await net('02:42:ac:1e:00:03'), /Docker/);
    assert.match(await net('3c:22:fb:ab:cd:ef'), /Willow House/);

    // The café: its five, this PC among them, and nothing else; remembered across a reload.
    await choose(/^Harbour Café/);
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 5);
    assert.deepEqual(await shown(), CAFE);
    // This PC was at both: the café's list names the café, and says the house apart, as elsewhere.
    assert.match(await net(ME), /^Harbour Café\s*\+1 elsewhere$/);
    assert.equal(await p.locator(`tr[data-device="${ME}"] td.net .also`).getAttribute('title'), 'Also heard on Willow House');
    await p.reload();
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 5, null, { timeout: 15_000 });
    assert.deepEqual(await shown(), CAFE);
    assert.match(await p.getByRole('button', { name: /^Showing: / }).innerText(), /Harbour Café/);
    // Who is using the network, on Now, follows the same choice: nobody of the house.
    await p.goto(`${demo.base}/#/`);
    await p.waitForTimeout(1500);
    for (const id of await p.getByRole('list', { name: 'Who is using the network' }).locator('li[data-device]').evaluateAll((els) => els.map((e) => e.getAttribute('data-device'))))
      assert.ok(CAFE.includes(id ?? ''), id ?? '');

    // The house alone: its ten, none of the café's; then every network: all eighteen (this PC once).
    await p.goto(`${demo.base}/#/devices`);
    await choose(/^Willow House/);
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 10);
    assert.ok((await shown()).every((id) => !CAFE.includes(id!) || id === ME));
    await choose(/^All networks/);
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 18);

    // Found, not heard: asked for on the Scan page, never from Devices (which only points there). A scan of the house
    // (it sends, said so) adds a plug and a NAS to the house's list, apart, and says what Argus knew of each before.
    await choose(/^Willow House/);
    const found = () => p.locator('.found-band tr[data-device]').evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-device')).sort());
    assert.deepEqual(await found(), []);
    assert.match(await p.locator('.found-band').innerText(), /Scan of the LAN\s*active[\s\S]*on the Scan page/);
    assert.equal(await p.locator('.found-band').getByRole('button').count(), 0, 'no second way to scan');
    await p.getByRole('navigation', { name: 'Places' }).getByRole('link', { name: 'Scan' }).click();
    await p.getByRole('heading', { name: 'Scan', exact: true }).waitFor();
    assert.match(await p.getByRole('group', { name: 'Which network' }).getByRole('button', { pressed: true }).innerText(), /^Willow House\s*here now$/);
    assert.match(await p.getByRole('region', { name: /Scan the LAN/ }).innerText(), /active · sends packets[\s\S]*Sends packets, only when asked/);
    assert.match(await p.getByRole('region', { name: /Read the router/ }).innerText(), /active · logs in to it[\s\S]*Changes nothing on the router[\s\S]*none saved/);
    await p.getByRole('button', { name: 'Scan wlan0 now' }).click();
    const byScan = p.getByRole('table', { name: 'Found by Scan of the LAN' }).locator('tbody tr');
    await byScan.nth(3).waitFor({ timeout: 15_000 });
    const known = async (rows: typeof byScan) =>
      Object.fromEntries(await rows.evaluateAll((trs) => trs.map((tr) => [tr.getAttribute('data-found'), tr.querySelector('.known')?.textContent])));
    assert.deepEqual(await known(byScan), {
      '50:c7:bf:12:34:56': 'Heard',
      'f4:f5:d8:c0:ff:ee': 'Heard',
      '24:0a:c4:5e:b0:61': 'New',
      '00:11:32:5e:b0:62': 'New',
    });

    // The router, its password typed once: the field says where the factory one is; a wrong one is refused and says
    // how many tries are left; then its list, how each is connected, what the scan had found; the password saved, and
    // never in the page.
    await p.getByRole('button', { name: 'Read the router now' }).click();
    await p.getByLabel(/The router’s password/).waitFor();
    assert.match(await p.locator('form.pw').innerText(), /Wi-Fi key on the label/);
    await p.getByLabel(/The router’s password/).fill('guess');
    await p.getByRole('button', { name: 'Save and read' }).click();
    await p.getByText(/refused this password\. It allows 4 more tries/).waitFor();
    await p.getByLabel(/The router’s password/).fill(ROUTER_PASSWORD);
    await p.getByRole('button', { name: 'Save and read' }).click();
    const byRouter = p.getByRole('table', { name: /^Found by The router/ }).locator('tbody tr');
    await byRouter.nth(3).waitFor({ timeout: 15_000 });
    await p.getByLabel(/The router’s password/).waitFor({ state: 'detached' });
    assert.match(await p.getByRole('region', { name: /Read the router/ }).innerText(), /MEO Fiber Gateway[\s\S]*saved on this PC for admin/);
    assert.equal((await known(byRouter))['24:0a:c4:5e:b0:61'], 'Found before');
    assert.match(await byRouter.filter({ hasText: 'nas' }).innerText(), /Cable, LAN 2/);
    assert.match(await byRouter.filter({ hasText: '78:4f:43:5e:b0:80' }).innerText(), /not connected/);
    assert.ok(!(await p.content()).includes(ROUTER_PASSWORD));

    // Back on Devices: the house's found devices, the router's three connected among them; the café has none, and on the
    // Scan page cannot be asked: it says why, with no button.
    await p.goto(`${demo.base}/#/devices`);
    await p.waitForFunction(() => document.querySelectorAll('.found-band tr[data-device]').length === 3, null, { timeout: 15_000 });
    assert.deepEqual(await found(), ['00:11:32:5e:b0:62', '24:0a:c4:5e:b0:61', 'd0:c2:4e:5e:b0:71']);
    assert.match(await p.locator('.found-band tr[data-device="24:0a:c4:5e:b0:61"]').innerText(), /plug-hall[\s\S]*Willow House[\s\S]*not heard/);
    await choose(/^Harbour Café/);
    await p.waitForFunction(() => document.querySelectorAll('table[aria-label="Devices"] tbody tr[data-device]').length === 5);
    assert.deepEqual(await found(), []);
    await p.goto(`${demo.base}/#/scan`);
    await p.getByRole('heading', { name: 'Not on Harbour Café now' }).waitFor();
    assert.equal(await p.getByRole('button', { name: /^Scan |Read the router/ }).count(), 0);
    assert.match(await p.getByRole('note').innerText(), /cannot be reached\. This PC is on Willow House now/);
    // On a phone, the page fits: nothing wider than the screen.
    await p.setViewportSize({ width: 390, height: 844 });
    await p.getByRole('button', { name: /^Willow House/ }).first().click();
    await p.getByRole('button', { name: 'Scan wlan0 now' }).waitFor();
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= 390), 'no sideways scroll at 390');
    await p.setViewportSize({ width: 1440, height: 900 });

    // The Docker interface's page: its conversations, both ends, moving as they come (no reload).
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
    await fakeHouseRouter.close();
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
  const quietText = await p.locator('.quiet, .more-busy').innerText().catch(() => '0 more');
  // "12 more devices, quiet now", or "And 2 more in use, 12 quiet".
  const quiet = Number(quietText.match(/(\d+) more devices?, quiet|(\d+) quiet$/)?.slice(1).find(Boolean) ?? 0);
  const busy = Number(quietText.match(/And (\d+) more in use/)?.[1] ?? 0);
  assert.equal((await rows.count()) + busy + quiet, total, `${await rows.count()} rows, ${busy} more busy, ${quietText}`);
  assert.doesNotMatch(await rows.allInnerTexts().then((t) => t.join(' ')), /Router/);
  assert.deepEqual(errors, []);
  await p.close();
});

/** "1.8 MB/s" → bytes a second; "—" → 0. */
function perSecond(s: string): number {
  const m = s.trim().match(/^([\d.,]+)\s*(B|KB|MB|GB)\/s$/);
  if (!m) return 0;
  return Number(m[1]!.replace(',', '')) * { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2] as 'B'];
}

test('A busy network: the busiest few lines and how many more; the order follows the number shown; rates said as rates', { skip: !CHROMIUM }, async () => {
  const fake = await fakeCapture();
  const demo = await startServer(ROOT, {
    // The house alone, from the start: no café first (it would move every line at once mid-test).
    env: { TSHARK: path.join(ROOT, 'scripts/demo-tshark.ts'), DUMPCAP: fake.dumpcap, SYS_NET: fake.sysNet, EMIT_MS: '250', DEMO_CAFE: '0' },
  });
  try {
    for (const i of ['wlan0', 'docker0'])
      await fetch(`${demo.base}/api/live/${i}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{"on":true}' });
    const { p, errors } = await page();
    await p.goto(`${demo.base}/#/`);
    const rows = p.getByRole('list', { name: 'Who is using the network' }).locator(':scope > li');
    await p.locator('.more-busy').waitFor({ timeout: 20_000 });
    // The demo's house has nine or so in use: five lines, and the rest (and the quiet ones) in one.
    assert.ok((await rows.count()) <= 5, `${await rows.count()} lines`);
    assert.match(await p.locator('.more-busy').innerText(), /^And \d+ more in use, \d+ quiet$/);
    // Thirty looks over fifteen seconds: no line moves more than twice as much as the one above it.
    for (let k = 0; k < 30; k++) {
      const rates = (await rows.locator('.rt').allInnerTexts()).map(perSecond);
      for (let i = 1; i < rates.length; i++) assert.ok(rates[i]! <= 2 * rates[i - 1]! + 1024, `look ${k}: ${rates.join(' > ')}`);
      await p.waitForTimeout(500);
    }
    // No bar without a scale on the lines; a name told apart by the end of its MAC says so.
    assert.equal(await p.locator('ul[aria-label="Who is using the network"] .bar').count(), 0);
    await p.goto(`${demo.base}/#/devices`);
    const twin = p.getByRole('table', { name: 'Devices' }).getByRole('link', { name: /Docker container ·/ }).first();
    await twin.waitFor({ timeout: 15_000 });
    await p.goto(`${demo.base}/#/`);
    const suffix = p.locator('ul[aria-label="Who is using the network"] .name [data-tip*="end of its MAC"]');
    await suffix.first().waitFor({ timeout: 15_000 });
    // A device's chart says rates, a second at a time, as rates.
    await p.goto(`${demo.base}/#/device/${encodeURIComponent('f4:f5:d8:c0:ff:ee')}`);
    const chart = p.getByRole('img', { name: /Bandwidth of .*, last minutes/ });
    await chart.waitFor({ timeout: 15_000 });
    const ticks = await chart.locator('text').allTextContents();
    const amounts = ticks.filter((t) => /\d\s*(B|KB|MB)/.test(t));
    assert.ok(amounts.length && amounts.every((t) => t.endsWith('/s')), amounts.join(' | '));
    assert.deepEqual(errors, []);
    await p.close();
  } finally {
    await demo.stop();
  }
});

test('Listening stopped: the home page says so, and shows nothing of before as if it were now', { skip: !CHROMIUM }, async () => {
  const { p, errors } = await page();
  const put = (on: boolean) => fetch(`${app.base}/api/live/wlan0`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
  await put(true);
  await p.goto(app.base);
  // Live first (whether anyone is busy by then depends on how far the recording has played).
  await p.getByText('Live, every second').waitFor({ timeout: 15_000 });
  await put(false);
  try {
    await p.getByRole('heading', { name: 'Not listening now' }).waitFor({ timeout: 10_000 });
    assert.equal(await p.getByRole('list', { name: 'Who is using the network' }).count(), 0);
    assert.equal(await p.getByRole('table', { name: 'Talking to now' }).count(), 0);
    assert.equal(await p.getByText('Live, every second').count(), 0);
  } finally {
    await put(true);
  }
  assert.deepEqual(errors, []);
  await p.close();
});
