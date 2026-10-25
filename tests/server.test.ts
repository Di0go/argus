// The Argus server through its HTTP API, its live stream and its MCP endpoint, on throwaway folders, with a pretend
// dumpcap (which lists the interfaces) and a pretend tshark (which, asked to listen, plays the fixture back as if it
// were coming in now).

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { type Running, startServer } from '@organon/core/testing';
import type { Capture, HostsView, Interface, LiveEvent, LiveView, Session } from '../shared/types.ts';
import { FIXTURE, fakeCapture, fakeTshark, ROOT, TSHARK } from './helpers.ts';

const running: Running[] = [];
after(async () => {
  for (const r of running) await r.stop();
});
const truth = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lan.truth.json'), 'utf8'));

async function start(env: Record<string, string> = {}, dataDir?: string) {
  const fake = await fakeCapture();
  const ts = await fakeTshark();
  const app = await startServer(ROOT, { dataDir, env: { TSHARK: ts.tshark, DUMPCAP: fake.dumpcap, SYS_NET: fake.sysNet, EMIT_MS: '200', ...env } });
  running.push(app);
  return { app, fake, ts };
}
const send = (base: string, route: string, body: unknown, method = 'POST') =>
  fetch(`${base}${route}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const listen = (base: string, id: string, on = true) => send(base, `/api/live/${id}`, { on }, 'PUT');
const liveView = async (base: string) => (await (await fetch(`${base}/api/live`)).json()) as LiveView;

/** Waits until `check` passes on the live view (up to 8 s). */
async function until(base: string, check: (v: LiveView) => boolean): Promise<LiveView> {
  let v = await liveView(base);
  for (let i = 0; i < 80 && !check(v); i++) {
    await new Promise((r) => setTimeout(r, 100));
    v = await liveView(base);
  }
  assert.ok(check(v), JSON.stringify(v.session));
  return v;
}

/** One MCP request, as the bridge sends it. */
async function mcp(base: string, method: string, params: unknown = {}) {
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const text = await res.text();
  const data = text.split('\n').find((l) => l.startsWith('data:'));
  return JSON.parse(data ? data.slice(5) : text) as { result?: { content?: { text: string }[]; isError?: boolean; tools?: { name: string }[] } };
}

test('Listening on the Wi-Fi: tshark is asked for a bounded ring buffer and fields as they come; the session adds up to the truth', async () => {
  const { app, ts } = await start();
  assert.equal((await listen(app.base, 'wlan0')).status, 200);
  const v = await until(app.base, (x) => x.session.packets === truth.packets);
  assert.equal(v.session.bytes, truth.bytes);
  assert.equal(v.devices.length, 7);
  for (const [mac, sent] of Object.entries(truth.sentByMac as Record<string, { bytes: number }>)) {
    assert.equal(v.devices.find((d) => d.mac === mac)?.bytesSent, sent.bytes, mac);
  }
  assert.ok(v.devices.some((d) => d.name === truth.hosts.phone.name));
  assert.ok(v.remotes.some((r) => r.name === truth.hosts.web.name));
  assert.deepEqual(
    v.session.listening.map((l) => [l.id, l.on, l.status]),
    [['wlan0', true, 'listening']],
  );
  // The whole network's bandwidth, a second per bucket, adds up to what was seen.
  const fine = v.total.fine;
  assert.equal(fine.step, 1);
  assert.equal(fine.sent.length, 600);
  assert.equal(fine.sent.reduce((a, b) => a + b, 0) + fine.received.reduce((a, b) => a + b, 0), truth.bytes);
  // And each device's own.
  const phone = v.devices.find((d) => d.mac === truth.hosts.phone.mac)!;
  const s = v.byDevice[phone.id]!;
  assert.equal(s.sent.reduce((a, b) => a + b, 0), phone.bytesSent);
  const args = readFileSync(ts.argsFile, 'utf8');
  assert.match(args, /-i wlan0 -w \S+\/live\/ring\/wlan0\/ring\.pcapng -b files:20 -b filesize:10240 -b duration:30 -P -l -M 100000 -n -T fields/);
  assert.match(args, /-e tls\.handshake\.extensions_server_name/);
});

test('The live stream: a page gets what changed, once in a while, as aggregates (never a packet)', async () => {
  const { app } = await start();
  const ac = new AbortController();
  const res = await fetch(`${app.base}/api/events`, { signal: ac.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  await listen(app.base, 'wlan0');
  const reader = res.body!.getReader();
  let text = '';
  const events: LiveEvent[] = [];
  while (!events.some((e) => e.session.packets === truth.packets)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += new TextDecoder().decode(value);
    const frames = text.split('\n\n');
    text = frames.pop() ?? '';
    for (const f of frames) if (f.startsWith('data: ')) events.push(JSON.parse(f.slice(6)) as LiveEvent);
  }
  ac.abort();
  const last = events.at(-1)!;
  assert.equal(last.type, 'live');
  // Each event carries the devices that changed; across them, all seven arrived.
  assert.equal(new Set(events.flatMap((e) => e.devices.map((d) => d.id))).size, 7);
  assert.ok(events.every((e, i) => i === 0 || e.seq === events[i - 1]!.seq + 1), 'numbered in order');
  // Fewer events than frames: the page is told at most every EMIT_MS, not per packet.
  assert.ok(events.length < truth.packets, `${events.length} events for ${truth.packets} packets`);
  // Hosts are sent when they change, and only then; across the events, each one arrived.
  const hosts = new Set(events.flatMap((e) => e.remotes.map((r) => r.id)));
  assert.ok(hosts.has(truth.hosts.web.ip));
  assert.equal(last.total.fine.sent.length, 5);
  assert.ok(!/"frame\.|"eth\.src"/.test(JSON.stringify(events)), 'no packet fields reach the page');
});

test('Three interfaces at once, each on and off on its own', async () => {
  const { app } = await start();
  await listen(app.base, 'wlan0');
  await listen(app.base, 'enp3s0');
  await listen(app.base, 'docker0');
  let v = await until(app.base, (x) => x.session.packets === 3 * truth.packets);
  assert.equal(v.session.listening.filter((l) => l.status === 'listening').length, 3);
  assert.equal((await listen(app.base, 'docker0', false)).status, 200);
  v = await liveView(app.base);
  assert.deepEqual(
    v.session.listening.map((l) => [l.id, l.on, l.status]),
    [
      ['wlan0', true, 'listening'],
      ['enp3s0', true, 'listening'],
      ['docker0', false, 'off'],
    ],
  );
  assert.ok(v.devices.every((d) => d.interfaces.every((i) => ['wlan0', 'enp3s0', 'docker0'].includes(i))));
});

test('An interface that cannot be opened is said, with what tshark said, and is tried again; one not offered is refused', async () => {
  const { app, ts } = await start();
  await listen(app.base, 'tailscale0');
  const v = await until(app.base, (x) => x.session.listening[0]?.status === 'failed');
  assert.match(v.session.listening[0]?.error ?? '', /could not be initiated/);
  // Tried again after a pause (2 s, doubling up to a minute).
  for (let i = 0; i < 40 && (readFileSync(ts.argsFile, 'utf8').match(/-i tailscale0/g) ?? []).length < 2; i++)
    await new Promise((r) => setTimeout(r, 100));
  assert.equal((readFileSync(ts.argsFile, 'utf8').match(/-i tailscale0/g) ?? []).length, 2);
  assert.equal((await listen(app.base, 'eth9')).status, 400);
  assert.equal((await send(app.base, '/api/live/wlan0', { on: 'yes' }, 'PUT')).status, 400);
});

test('Saving: what the ring buffer holds becomes a capture, with its devices, listed and readable', async () => {
  const { app } = await start();
  assert.equal((await send(app.base, '/api/live/save', {})).status, 409, 'nothing to save before listening');
  await listen(app.base, 'wlan0');
  await until(app.base, (x) => x.session.packets > 0);
  const res = await send(app.base, '/api/live/save', {});
  assert.equal(res.status, 200);
  const c = (await res.json()) as Capture;
  assert.equal(c.source, 'live');
  assert.deepEqual(c.interfaces, ['wlan0']);
  assert.equal(c.packets, truth.packets);
  const v = (await (await fetch(`${app.base}/api/captures/${c.id}`)).json()) as HostsView;
  assert.equal(v.devices.length, 7);
  assert.ok((await readdir(path.join(app.dataDir, 'captures'))).includes(`${c.id}.pcapng`));
  assert.equal((await fetch(`${app.base}/api/captures/${c.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await fetch(`${app.base}/api/captures/${c.id}`)).status, 404);
});

test('A restart (a release) picks up the session where it was, and listens again on what was on', async () => {
  const first = await start();
  await listen(first.app.base, 'wlan0');
  await until(first.app.base, (x) => x.session.packets === truth.packets);
  await first.app.stop();
  const second = await start({}, first.app.dataDir);
  const v = await until(second.app.base, (x) => x.session.packets === 2 * truth.packets);
  assert.equal(v.devices.length, 7);
  assert.deepEqual(
    v.session.listening.map((l) => [l.id, l.on]),
    [['wlan0', true]],
  );
  // Beginning again forgets what was seen and keeps listening.
  const reset = await send(second.app.base, '/api/live/reset', {});
  assert.equal(((await reset.json()) as Session).packets, 0);
  assert.deepEqual((await liveView(second.app.base)).session.listening.map((l) => l.on), [true]);
});

test('With a recording brought in, the capture shows its devices; the live session starts empty and says so', async () => {
  const { app } = await start({ SEED_PCAP: FIXTURE });
  const list = (await (await fetch(`${app.base}/api/captures`)).json()) as Capture[];
  assert.equal(list.length, 1);
  const v = (await (await fetch(`${app.base}/api/hosts?capture=${list[0]!.id}`)).json()) as HostsView;
  assert.equal(v.capture.packets, truth.packets);
  assert.equal(v.devices.length, 7);
  const live = (await (await fetch(`${app.base}/api/hosts`)).json()) as { session: Session; devices: unknown[] };
  assert.equal(live.session.packets, 0);
  assert.equal(live.devices.length, 0);
});

test('MCP: get_hosts reads the live session (or a capture); get_device walks to who it talked to', async () => {
  const { app } = await start({ SEED_PCAP: FIXTURE });
  const list = await mcp(app.base, 'tools/list');
  assert.deepEqual(list.result?.tools?.map((t) => t.name).sort(), ['get_device', 'get_hosts', 'list_captures']);
  const idle = await mcp(app.base, 'tools/call', { name: 'get_hosts', arguments: {} });
  assert.equal(idle.result?.isError, true);
  assert.match(idle.result?.content?.[0]?.text ?? '', /Not listening/);
  await listen(app.base, 'wlan0');
  await until(app.base, (x) => x.session.packets === truth.packets);
  const hosts = await mcp(app.base, 'tools/call', { name: 'get_hosts', arguments: {} });
  const body = JSON.parse(hosts.result?.content?.[0]?.text ?? '{}') as {
    live: { listeningOn: { interface: string }[] };
    devices: { name: string; vendor?: string; role?: string }[];
  };
  assert.deepEqual(body.live.listeningOn.map((l) => l.interface), ['wlan0']);
  assert.equal(body.devices.length, 7);
  assert.ok(body.devices.some((d) => d.name === 'raspberrypi' && d.vendor === 'Raspberry Pi Foundation'));
  assert.ok(body.devices.some((d) => d.role?.startsWith('router')));
  const pc = await mcp(app.base, 'tools/call', { name: 'get_device', arguments: { device: truth.hosts.me.ip } });
  const one = JSON.parse(pc.result?.content?.[0]?.text ?? '{}') as { talkedTo: { name: string }[] };
  assert.ok(one.talkedTo.some((t) => t.name === truth.hosts.web.name));
  const captures = JSON.parse((await mcp(app.base, 'tools/call', { name: 'list_captures', arguments: {} })).result?.content?.[0]?.text ?? '[]');
  const saved = await mcp(app.base, 'tools/call', { name: 'get_hosts', arguments: { capture: captures[0].id } });
  assert.equal(JSON.parse(saved.result?.content?.[0]?.text ?? '{}').devices.length, 7);
  const none = await mcp(app.base, 'tools/call', { name: 'get_device', arguments: { device: 'toaster' } });
  assert.equal(none.result?.isError, true);
});

test('Interfaces from dumpcap, named as he would, sources that are not network interfaces left out', async () => {
  const { app } = await start();
  const { interfaces } = (await (await fetch(`${app.base}/api/interfaces`)).json()) as { interfaces: Interface[] };
  assert.deepEqual(
    interfaces.map((i) => [i.id, i.label, i.capturable]),
    [
      ['wlan0', 'Wi-Fi', true],
      ['enp3s0', 'Cable', true],
      ['tailscale0', 'VPN', true],
      ['docker0', 'Docker', true],
      ['lo', 'Loopback (this PC)', true],
      ['any', 'All', true],
    ],
  );
});

test('Without dumpcap (before scripts/install-capture.sh), listening is refused and says what is missing', async () => {
  const { app } = await start({ DUMPCAP: '/nonexistent/dumpcap' });
  const res = await listen(app.base, 'wlan0');
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /install-capture/);
  const { interfaces } = (await (await fetch(`${app.base}/api/interfaces`)).json()) as { interfaces: Interface[] };
  assert.ok(interfaces.length > 0 && interfaces.every((i) => !i.capturable));
});

/** The pretend tsharks still running, of those started. */
function alive(pidsFile: string): number[] {
  let pids: number[] = [];
  try {
    pids = readFileSync(pidsFile, 'utf8').split('\n').filter(Boolean).map(Number);
  } catch {}
  return pids.filter((pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  });
}

test('Clicked twice at once, or off and on again at once: one tshark per interface, every packet counted once', async () => {
  const { app, ts } = await start();
  // Two at once (two tabs, a double click, the agent): found by the red team to start two and count twice.
  const both = await Promise.all([listen(app.base, 'wlan0'), listen(app.base, 'wlan0')]);
  assert.deepEqual(
    both.map((r) => r.status),
    [200, 200],
  );
  await until(app.base, (x) => x.session.packets === truth.packets);
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal((await liveView(app.base)).session.packets, truth.packets, 'counted once');
  assert.equal(alive(ts.pidsFile).length, 1);
  // Off and on again at once: the one before is gone before the next starts, and none is left behind.
  await listen(app.base, 'wlan0', false);
  await listen(app.base, 'wlan0');
  const v = await until(app.base, (x) => x.session.packets === 2 * truth.packets);
  assert.equal(v.session.listening[0]?.status, 'listening');
  await new Promise((r) => setTimeout(r, 2500));
  assert.equal((await liveView(app.base)).session.packets, 2 * truth.packets);
  assert.equal(alive(ts.pidsFile).length, 1);
  await app.stop();
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(alive(ts.pidsFile), [], 'none left running after the server stops');
});

test('Two interfaces turned on at the same moment: both answered, both saved, no write failing on the other', async () => {
  const { app } = await start();
  const res = await Promise.all(['wlan0', 'enp3s0', 'docker0', 'lo'].map((id) => listen(app.base, id)));
  assert.deepEqual(
    res.map((r) => r.status),
    [200, 200, 200, 200],
  );
  const state = JSON.parse(readFileSync(path.join(app.dataDir, 'live/state.json'), 'utf8')) as { on: string[] };
  assert.deepEqual([...state.on].sort(), ['docker0', 'enp3s0', 'lo', 'wlan0']);
});

test('The ring survives a restart, is cut to the ceiling, and a save after a reset holds nothing from before it', async () => {
  const first = await start({ RING_FILES: '2' });
  await listen(first.app.base, 'wlan0');
  await until(first.app.base, (x) => x.session.packets === truth.packets);
  await first.app.stop();
  // The pretend tshark writes one ring file per run: three runs, a ceiling of two.
  const second = await start({ RING_FILES: '2' }, first.app.dataDir);
  await until(second.app.base, (x) => x.session.packets === 2 * truth.packets);
  await second.app.stop();
  const third = await start({ RING_FILES: '2' }, first.app.dataDir);
  await until(third.app.base, (x) => x.session.packets === 3 * truth.packets);
  await new Promise((r) => setTimeout(r, 1500));
  const ring = await readdir(path.join(first.app.dataDir, 'live/ring/wlan0'));
  assert.equal(ring.filter((f) => f.endsWith('.pcapng')).length, 2, ring.join(' '));
  // After a reset, a save holds only what the ring has from then on: each packet's time checked in the file itself,
  // and their number against the ring's own, counted apart.
  const reset = (await (await send(third.app.base, '/api/live/reset', {})).json()) as Session;
  const res = await send(third.app.base, '/api/live/save', {});
  assert.equal(res.status, 200);
  const c = (await res.json()) as Capture;
  const times = (file: string) =>
    execFileSync(TSHARK, ['-r', file, '-T', 'fields', '-e', 'frame.time_epoch'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
  const saved = times(path.join(third.app.dataDir, 'captures', `${c.id}.pcapng`));
  assert.ok(saved.every((t) => t >= reset.started! - 1e-6), 'nothing from before the reset');
  const ringDir = path.join(first.app.dataDir, 'live/ring/wlan0');
  const inRing = (await readdir(ringDir)).flatMap((f) => times(path.join(ringDir, f))).filter((t) => t >= reset.started! - 1e-6);
  assert.equal(saved.length, inRing.length);
  assert.equal(c.packets, saved.length);
});
