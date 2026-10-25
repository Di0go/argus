// The Argus server through its HTTP API and its MCP endpoint, on throwaway folders, with a pretend dumpcap.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { type Running, startServer } from '@organon/core/testing';
import type { HostsView, Interface } from '../shared/types.ts';
import { FIXTURE, fakeCapture, ROOT, TSHARK } from './helpers.ts';

const running: Running[] = [];
after(async () => {
  for (const r of running) await r.stop();
});
const truth = JSON.parse(readFileSync(path.join(ROOT, 'tests/fixtures/lan.truth.json'), 'utf8'));

async function start(env: Record<string, string> = {}) {
  const fake = await fakeCapture();
  const app = await startServer(ROOT, { env: { TSHARK, DUMPCAP: fake.dumpcap, SYS_NET: fake.sysNet, ...env } });
  running.push(app);
  return { app, fake };
}
const post = (base: string, route: string, body: unknown) =>
  fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

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

test('With a recording brought in, /api/hosts shows its devices and internet hosts', async () => {
  const { app } = await start({ SEED_PCAP: FIXTURE });
  const v = (await (await fetch(`${app.base}/api/hosts`)).json()) as HostsView;
  assert.equal(v.capture.status, 'done');
  assert.equal(v.capture.packets, truth.packets);
  assert.equal(v.devices.length, 7);
  assert.ok(v.devices.some((d) => d.name === truth.hosts.phone.name && d.ips.includes(truth.hosts.phone.ip)));
  assert.ok(v.remotes.some((r) => r.name === truth.hosts.web.name));
});

test('MCP: get_hosts gives the agent the same devices; get_device walks to who it talked to', async () => {
  const { app } = await start({ SEED_PCAP: FIXTURE });
  const list = await mcp(app.base, 'tools/list');
  assert.deepEqual(list.result?.tools?.map((t) => t.name).sort(), ['get_device', 'get_hosts', 'list_captures']);
  const hosts = await mcp(app.base, 'tools/call', { name: 'get_hosts', arguments: {} });
  const body = JSON.parse(hosts.result?.content?.[0]?.text ?? '{}') as { devices: { name: string; vendor?: string; role?: string }[] };
  assert.equal(body.devices.length, 7);
  assert.ok(body.devices.some((d) => d.name === 'raspberrypi' && d.vendor === 'Raspberry Pi Foundation'));
  assert.ok(body.devices.some((d) => d.role?.startsWith('router')));
  const pc = await mcp(app.base, 'tools/call', { name: 'get_device', arguments: { device: truth.hosts.me.ip } });
  const one = JSON.parse(pc.result?.content?.[0]?.text ?? '{}') as { talkedTo: { name: string }[] };
  assert.ok(one.talkedTo.some((t) => t.name === truth.hosts.web.name));
  const none = await mcp(app.base, 'tools/call', { name: 'get_device', arguments: { device: 'toaster' } });
  assert.equal(none.result?.isError, true);
});

test('No capture yet: get_hosts says how to make one; /api/hosts is a 404 that says so', async () => {
  const { app } = await start();
  const r = await mcp(app.base, 'tools/call', { name: 'get_hosts', arguments: {} });
  assert.equal(r.result?.isError, true);
  assert.match(r.result?.content?.[0]?.text ?? '', /No capture yet/);
  const res = await fetch(`${app.base}/api/hosts`);
  assert.equal(res.status, 404);
});

test('Interfaces from dumpcap, named as he would, sources that are not network interfaces left out', async () => {
  const { app } = await start();
  const { interfaces } = (await (await fetch(`${app.base}/api/interfaces`)).json()) as { interfaces: Interface[] };
  assert.deepEqual(
    interfaces.map((i) => [i.id, i.label, i.capturable]),
    [
      ['wlan0', 'Wi-Fi', true],
      ['enp3s0', 'Cabo', true],
      ['tailscale0', 'VPN', true],
      ['docker0', 'Docker', true],
      ['lo', 'Loopback (este PC)', true],
      ['any', 'Todas', true],
    ],
  );
});

test('A capture on two interfaces at once: dumpcap is asked for both and the duration, and it ends with its hosts', async () => {
  const { app, fake } = await start();
  const res = await post(app.base, '/api/captures', { interfaces: ['wlan0', 'docker0'], seconds: 10 });
  assert.equal(res.status, 202);
  const c = (await res.json()) as { id: string; status: string };
  assert.equal(c.status, 'running');
  // Only one at a time.
  assert.equal((await post(app.base, '/api/captures', { interfaces: ['wlan0'] })).status, 400);
  let v: HostsView | undefined;
  for (let i = 0; i < 60; i++) {
    v = (await (await fetch(`${app.base}/api/captures/${c.id}`)).json()) as HostsView;
    if (v.capture.status !== 'running') break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(v?.capture.status, 'done');
  assert.equal(v?.devices.length, 7);
  assert.match(readFileSync(fake.argsFile, 'utf8'), /-i wlan0 -i docker0 -a duration:10 -q -w \S+\.pcapng/);
  assert.ok((await readdir(path.join(app.dataDir, 'captures'))).some((f) => f === `${c.id}.json`));
});

test('A capture is refused on an interface not offered, for too long, or on none', async () => {
  const { app } = await start();
  assert.equal((await post(app.base, '/api/captures', { interfaces: ['eth9'] })).status, 400);
  assert.equal((await post(app.base, '/api/captures', { interfaces: ['wlan0'], seconds: 3600 })).status, 400);
  assert.equal((await post(app.base, '/api/captures', { interfaces: [] })).status, 400);
});

test('Without dumpcap (before scripts/install-capture.sh), capturing is refused and says what is missing', async () => {
  const { app } = await start({ DUMPCAP: '/nonexistent/dumpcap' });
  const res = await post(app.base, '/api/captures', { interfaces: ['wlan0'] });
  assert.equal(res.status, 409);
  assert.match(((await res.json()) as { error: string }).error, /install-capture/);
  const { interfaces } = (await (await fetch(`${app.base}/api/interfaces`)).json()) as { interfaces: Interface[] };
  assert.ok(interfaces.length > 0 && interfaces.every((i) => !i.capturable));
});
