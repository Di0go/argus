// Reading the router (server/routers.ts, server/routers/altice-fgw.ts), against a pretend MEO Fiber Gateway
// (tests/fake-router.ts), never the real one: its page is told apart from another's; the login is the box's own (an
// HMAC with the session's nonce, so the password never crosses the network); the list is read whole (cable or Wi-Fi,
// where, connected or only remembered) and the session closed; a password that works is kept in a file only this user
// reads, by the router's MAC, and one that does not is never kept; the box's lock is never risked; a public factory
// password is tried first and said. Then the sources (server/sources.ts) and the server's route: what the router knows
// joins the found devices on the router's network, each run says what Argus knew of each device before, and no answer
// carries the password.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '@organon/core/testing';
import { readRouter, RouterHttp, RouterKeys, type RouterAdapter } from '../server/routers.ts';
import { alticeFiberGateway } from '../server/routers/altice-fgw.ts';
import { ADAPTERS } from '../server/routers/all.ts';
import { Sources } from '../server/sources.ts';
import type { Device, Here, SourceRun } from '../shared/types.ts';
import { fakeRouter } from './fake-router.ts';
import { fakeCapture, fakeTshark, ROOT } from './helpers.ts';

const PASSWORD = 'not-a-real-password-7Qx';
const ROUTER_MAC = '50:c7:bf:12:34:56';
const cleanup: (() => Promise<void>)[] = [];
after(async () => {
  for (const c of cleanup) await c();
});

async function router(o: Parameters<typeof fakeRouter>[0] = { password: PASSWORD }) {
  const r = await fakeRouter(o);
  cleanup.push(r.close);
  return r;
}
const keysIn = async () => new RouterKeys(path.join(await mkdtemp(path.join(tmpdir(), 'argus-keys-')), 'argus', 'routers.json'));
/** Whether anything Argus sent the router carries the password, in any form a server could read it. */
const carries = (requests: { path: string; headers: http.IncomingHttpHeaders }[], secret: string) =>
  requests.some((r) => JSON.stringify(r).includes(secret) || JSON.stringify(r).includes(Buffer.from(secret).toString('base64')));

test('The MEO Fiber Gateway is told by its own login page; another page is not taken for it', async () => {
  const r = await router();
  assert.equal(await alticeFiberGateway.detect(new RouterHttp(), r.base), true);
  assert.equal(await alticeFiberGateway.attemptsLeft!(new RouterHttp(), r.base), 5);
  const other = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<html><title>Some other router</title></html>'));
  await new Promise<void>((resolve) => other.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise((resolve) => other.close(() => resolve())));
  const base = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;
  assert.equal(await alticeFiberGateway.detect(new RouterHttp(), base), false);
  const out = await readRouter({ base, mac: ROUTER_MAC, password: PASSWORD }, await keysIn(), ADAPTERS);
  assert.equal(out.ok, false);
  assert.match(!out.ok ? out.error : '', /not one Argus can read yet\. It reads: MEO Fiber Gateway/);
});

test('With no password saved and none public, it asks for one, says where the factory one is, and sends no login', async () => {
  const r = await router();
  const out = await readRouter({ base: r.base, mac: ROUTER_MAC }, await keysIn(), ADAPTERS);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.need, 'password');
  assert.equal(out.model, 'MEO Fiber Gateway (Altice Labs)');
  assert.match(out.hint ?? '', /Wi-Fi key on the label/);
  assert.equal(r.requests.filter((q) => q.path === '/index.html').length, 0, 'no login tried');
  assert.equal(r.attempts, 5);
});

test('His password: the box’s login, the list read whole, logged out; kept at 600 by the router’s MAC; never sent as it is', async () => {
  const r = await router();
  const keys = await keysIn();
  const out = await readRouter({ base: r.base, mac: ROUTER_MAC.toUpperCase(), password: PASSWORD }, keys, ADAPTERS);
  assert.equal(out.ok, true);
  if (!out.ok) return;
  assert.equal(out.factory, false);
  assert.deepEqual(out.clients, [
    { mac: 'd0:c2:4e:5e:b0:71', ip: '192.168.50.71', hostname: 'Galaxy-S23', link: 'wifi', port: '5GHz', ssid: 'Willow House', connected: true },
    { mac: '24:0a:c4:5e:b0:61', ip: '192.168.50.61', hostname: 'plug-hall', link: 'wifi', port: '2.4GHz', ssid: 'Willow House', connected: true },
    { mac: '00:11:32:5e:b0:62', ip: '192.168.50.62', hostname: 'nas', link: 'cable', port: 'LAN 2', connected: true },
    // Named by its MAC is no name; remembered, not connected.
    { mac: '78:4f:43:5e:b0:80', ip: '192.168.50.80', link: 'wifi', port: '5GHz', ssid: 'Willow House', connected: false },
  ]);
  assert.equal(r.open(), 0, 'logged out');
  assert.equal(r.requests.at(-1)?.path, '/logout.cmd');
  assert.ok(!carries(r.requests, PASSWORD), 'the password never crosses the network: only its HMAC with the nonce');
  // Kept, by the MAC, in a file only this user can read, in a folder only this user can enter.
  assert.equal((await stat(keys.file)).mode & 0o777, 0o600);
  assert.equal((await stat(path.dirname(keys.file))).mode & 0o777, 0o700);
  const kept = await keys.get(ROUTER_MAC);
  assert.equal(kept?.password, PASSWORD);
  assert.equal(kept?.user, 'admin');
  assert.ok(!JSON.stringify(out).includes(PASSWORD), 'the answer does not carry it');

  // The next time, no typing: the saved one.
  const again = await readRouter({ base: r.base, mac: ROUTER_MAC }, keys, ADAPTERS);
  assert.equal(again.ok && again.saved, true);
});

test('A wrong password is refused and not kept; a saved one that stopped working says so; the lock is never risked', async () => {
  const r = await router();
  const keys = await keysIn();
  const wrong = await readRouter({ base: r.base, mac: ROUTER_MAC, password: 'guess' }, keys, ADAPTERS);
  assert.equal(wrong.ok, false);
  assert.match(!wrong.ok ? wrong.error : '', /refused this password\. It allows 4 more tries/);
  assert.equal(!wrong.ok && wrong.attemptsLeft, 4);
  assert.equal(await keys.get(ROUTER_MAC), undefined);

  // He changed it on the router since: the saved one is said to no longer work, and is not tried twice.
  await keys.set(ROUTER_MAC, { user: 'admin', password: 'the-old-one', model: alticeFiberGateway.name, saved: 1 });
  const stale = await readRouter({ base: r.base, mac: ROUTER_MAC }, keys, ADAPTERS);
  assert.match(!stale.ok ? stale.error : '', /saved for this router no longer lets Argus in/);
  assert.equal(r.attempts, 3);

  // Two tries left: a saved password is not risked. One left: nor is a typed one. No login is sent.
  r.attempts = 2;
  const logins = () => r.requests.filter((q) => q.path === '/index.html').length;
  const before = logins();
  const saved = await readRouter({ base: r.base, mac: ROUTER_MAC }, keys, ADAPTERS);
  assert.match(!saved.ok ? saved.error : '', /allows 2 more tries before it locks its page: Argus does not risk it/);
  r.attempts = 1;
  const typed = await readRouter({ base: r.base, mac: ROUTER_MAC, password: PASSWORD }, keys, ADAPTERS);
  assert.match(!typed.ok ? typed.error : '', /one more try/);
  assert.equal(logins(), before);
  assert.equal(r.attempts, 1);
});

test('A model whose factory password is public: tried first, and said (it is a warning); a changed one is asked for', async () => {
  const r = await router({ password: 'factory-1234' });
  const publicDefault: RouterAdapter = { ...alticeFiberGateway, id: 'test-public', name: 'A box with a public password', defaults: ['factory-1234'] };
  const keys = await keysIn();
  const out = await readRouter({ base: r.base, mac: ROUTER_MAC }, keys, [publicDefault]);
  assert.equal(out.ok && out.factory, true);
  assert.equal(await keys.get(ROUTER_MAC), undefined, 'a public password is not his to keep');
  const changed = await router({ password: 'his-own' });
  const no = await readRouter({ base: changed.base, mac: ROUTER_MAC }, keys, [publicDefault]);
  assert.equal(!no.ok && no.need, 'password');
  assert.match(!no.ok ? no.error : '', /factory password does not let Argus in/);
});

const device = (mac: string, over: Partial<Device> = {}): Device => ({
  kind: 'device',
  id: mac,
  mac,
  name: mac,
  ips: [],
  randomMac: false,
  names: [],
  interfaces: ['wlan0'],
  packets: 10,
  bytesSent: 100,
  bytesReceived: 100,
  firstSeen: 1,
  lastSeen: 2,
  ...over,
});

test('What the router knows joins the found devices on its network; the run says what Argus knew of each before', async () => {
  const s = await new Sources({ neigh: false, scan: false, leases: [], now: () => 1_800_000_000, run: async () => '' }).load();
  s.stop();
  const r = await router();
  const out = await readRouter({ base: r.base, mac: ROUTER_MAC, password: PASSWORD }, await keysIn(), ADAPTERS);
  assert.ok(out.ok);
  const before = [device('d0:c2:4e:5e:b0:71', { name: 'Galaxy-S23', ips: ['192.168.50.71'] }), device('00:11:32:5e:b0:62', { foundOnly: true })];
  const run = s.fromRouter({ iface: 'wlan0', network: `net:${ROUTER_MAC}` }, { model: out.model, clients: out.clients }, before);
  assert.equal(run.kind, 'router');
  assert.equal(run.network, `net:${ROUTER_MAC}`);
  assert.deepEqual(
    run.found.map((d) => [d.mac, d.known, d.connected]),
    [
      ['d0:c2:4e:5e:b0:71', 'heard', true],
      ['24:0a:c4:5e:b0:61', 'new', true],
      ['00:11:32:5e:b0:62', 'found', true],
      ['78:4f:43:5e:b0:80', 'new', false],
    ],
  );
  // Only the connected ones are found devices, origin "router", on the router's network whatever the interface did.
  const found = s.attach({ devices: [] as Device[] }, () => 'net:somewhere-else').devices;
  assert.deepEqual(found.map((d) => d.mac).sort(), ['00:11:32:5e:b0:62', '24:0a:c4:5e:b0:61', 'd0:c2:4e:5e:b0:71']);
  assert.ok(found.every((d) => d.foundOnly && d.origin?.includes('router') && d.networks?.[0] === `net:${ROUTER_MAC}`));
  assert.equal(found.find((d) => d.mac === '24:0a:c4:5e:b0:61')?.name, 'plug-hall');
  assert.deepEqual(s.runs(), [run]);
  assert.equal(s.status().find((x) => x.id === 'router')?.found, 3);
});

test('Where this PC is: the default route of a Wi-Fi or a cable (not a VPN’s), and the router’s MAC from the neighbour table', async () => {
  const asked: string[] = [];
  const s = new Sources({
    neigh: false,
    scan: false,
    leases: [],
    run: async (_cmd, args) => {
      asked.push(args.join(' '));
      if (args.includes('route')) return 'default dev tailscale0 scope link metric 5\ndefault via 192.168.50.1 dev wlan0 proto dhcp src 192.168.50.10 metric 600\n';
      // Asked with `dev`, ip leaves the interface out of the line, as the real one does.
      if (args[0] === 'neigh') return `192.168.50.1 lladdr ${ROUTER_MAC} REACHABLE `;
      return '';
    },
  });
  assert.deepEqual(await s.here(), { iface: 'wlan0', gateway: '192.168.50.1', mac: ROUTER_MAC });
  assert.deepEqual(asked, ['-4 route show default', 'neigh show 192.168.50.1 dev wlan0'], 'local reads only');
  const nowhere = new Sources({ neigh: false, scan: false, leases: [], run: async () => '' });
  assert.equal(await nowhere.here(), undefined);
});

test('The server: only the network of here is asked; the password is kept, never answered back; a run the page can show', async () => {
  const r = await router();
  const fake = await fakeCapture();
  const ts = await fakeTshark();
  const dir = await mkdtemp(path.join(tmpdir(), 'argus-router-'));
  const ssid = path.join(dir, 'ssid');
  const { writeFile } = await import('node:fs/promises');
  await writeFile(ssid, 'Willow House\n');
  const keysFile = path.join(dir, 'keys', 'routers.json');
  const app = await startServer(ROOT, {
    env: {
      TSHARK: ts.tshark,
      DUMPCAP: fake.dumpcap,
      SYS_NET: fake.sysNet,
      IP: path.join(ROOT, 'scripts/demo-ip.ts'),
      DEMO_SSID_FILE: ssid,
      ROUTER: '1',
      ROUTER_URL: r.base,
      ROUTER_KEYS: keysFile,
      LEASES: 'none',
    },
  });
  cleanup.push(() => app.stop());
  const post = (route: string, body: unknown) =>
    fetch(`${app.base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  const here = (await (await fetch(`${app.base}/api/sources/here`)).json()) as Here;
  assert.equal(here.iface, 'wlan0');
  assert.equal(here.gateway, '192.168.50.1');
  assert.equal(here.mac, ROUTER_MAC);
  assert.deepEqual(here.router, { saved: false });

  // Another network than the one of here: refused, nothing sent to the router.
  const elsewhere = await post('/api/sources/router', { network: 'net:00:1b:21:00:00:02', password: PASSWORD });
  assert.equal(elsewhere.status, 409);
  assert.match(((await elsewhere.json()) as { error: string }).error, /only ask the network this PC is on now/);
  assert.equal(r.requests.length, 0);

  // No password yet: asked for, with the model and where the factory one is.
  const ask = (await (await post('/api/sources/router', {})).json()) as { ok: boolean; need?: string; model?: string; hint?: string; run?: SourceRun };
  assert.deepEqual([ask.ok, ask.need, ask.model, ask.run], [false, 'password', 'MEO Fiber Gateway (Altice Labs)', undefined]);

  const res = await post('/api/sources/router', { password: PASSWORD });
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.ok(!text.includes(PASSWORD), 'the answer never carries the password');
  const done = JSON.parse(text) as { ok: boolean; run: SourceRun; here: Here; runs: SourceRun[] };
  assert.equal(done.ok, true);
  assert.equal(done.run.found.length, 4);
  assert.deepEqual(done.here.router, { model: 'MEO Fiber Gateway (Altice Labs)', saved: true, user: 'admin' });
  assert.equal((await stat(keysFile)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(keysFile, 'utf8'))[ROUTER_MAC].password, PASSWORD);
  for (const route of ['/api/state', '/api/sources', '/api/sources/here', '/api/live'])
    assert.ok(!(await (await fetch(`${app.base}${route}`)).text()).includes(PASSWORD), route);
  // The three connected are found devices, from the router.
  const live = (await (await fetch(`${app.base}/api/live`)).json()) as { devices: Device[] };
  assert.deepEqual(
    live.devices.filter((d) => d.origin?.includes('router')).map((d) => d.mac).sort(),
    ['00:11:32:5e:b0:62', '24:0a:c4:5e:b0:61', 'd0:c2:4e:5e:b0:71'],
  );

  // Forgotten on his word: the file no longer holds it, and the page is told.
  const forgot = (await (await fetch(`${app.base}/api/sources/router`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })).json()) as { forgotten: boolean; here: Here };
  assert.equal(forgot.forgotten, true);
  assert.equal(forgot.here.router?.saved, false);
  assert.ok(!(await readFile(keysFile, 'utf8')).includes(PASSWORD));
});
