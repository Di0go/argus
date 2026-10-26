// The day kept (server/history.ts): looks at the live session's counters become minutes on disk, "doing now", and a
// diary of episodes; a restart loses nothing and makes nothing up; counters that go down count from zero; the oldest
// days go past the ceiling. A clock of its own, conversations made up here.

import assert from 'node:assert/strict';
import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStore } from '@organon/core/server/store';
import { Warnings } from '@organon/core/server/warnings';
import type { Classification } from '../shared/classify.ts';
import type { Conversation, Device } from '../shared/types.ts';
import { History } from '../server/history.ts';
import { doing as say, siteOnly } from '../shared/words.ts';

const YOUTUBE: Classification = { company: 'Google', app: 'YouTube', category: 'video', label: 'Video', activity: 'watching video', tracking: false, by: 'name', rule: 'googlevideo.com' };
const CALL: Classification = { company: 'Meta', app: 'WhatsApp', category: 'calls', label: 'Calls', activity: 'on a call', tracking: false, by: 'pattern', rule: 'udp/3478' };

const device = (id: string, name: string): Device =>
  ({ kind: 'device', id, name, mac: id, ips: [], randomMac: false, names: [], interfaces: ['wlan0'], packets: 0, bytesSent: 0, bytesReceived: 0, firstSeen: 0, lastSeen: 0 }) as Device;
const talk = (a: string, b: string, sent: number, received: number, app?: Classification, extra: Partial<Conversation> = {}): Conversation => ({
  id: `device:${a} remote:${b} tcp/443`,
  a: `device:${a}`,
  b: `remote:${b}`,
  service: 'tcp/443',
  interfaces: ['wlan0'],
  sent,
  received,
  packets: 1,
  first: 0,
  last: 0,
  ...(app ? { app } : {}),
  ...extra,
});

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), 'argus-history-'));
  const store = createStore({ dataDir: dir, warnings: new Warnings() });
  // 25 October 2026, 20:00 local time.
  let now = new Date(2026, 9, 25, 20, 0, 0).getTime() / 1000;
  const clock = { now: () => now, set: (t: number) => (now = t), add: (s: number) => (now += s) };
  const make = () => new History({ dir: path.join(dir, 'history'), store, now: clock.now }).load();
  return { dir, clock, make };
}

test('Minutes kept, doing now, the diary: ten minutes of YouTube are one episode, a short burst is none', async () => {
  const { dir, clock, make } = await setup();
  // A house already known (the TV), so a device turning up is news; a history that knows nobody learns first.
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(dir, 'history'), { recursive: true });
  await writeFile(path.join(dir, 'history', 'devices.json'), JSON.stringify({ 'device:aa:aa:aa:aa:aa:01': { name: 'Living Room TV', first: 0, last: 0 } }));
  const h = await make();
  const tv = device('aa:aa:aa:aa:aa:01', 'Living Room TV');
  const phone = device('aa:aa:aa:aa:aa:02', 'Alexs-iPhone');
  let yt = 0;
  // A first look: what there is already is the baseline (the session may have been going before).
  await h.observe({ devices: [tv], conversations: [talk(tv.id, '203.0.113.1', 0, 999_999, YOUTUBE)] });
  yt = 999_999;
  for (let i = 0; i < 120; i++) {
    clock.add(5);
    yt += 50_000;
    const burst = talk(phone.id, '203.0.113.3', 0, i >= 60 ? 1_500_000 : 0, { ...YOUTUBE, app: 'Instagram', category: 'social', company: 'Meta' });
    await h.observe({ devices: [tv, phone], conversations: [talk(tv.id, '203.0.113.1', 0, yt, YOUTUBE), talk(phone.id, '203.0.113.2', i * 1_000, i * 2_000, CALL), burst] });
  }
  const doing = h.doing(`device:${tv.id}`);
  assert.equal(doing?.[0]?.what.app, 'YouTube');
  // Ten minutes on end of streaming: watching.
  assert.equal(say(doing?.[0]?.what), 'Watching YouTube');
  // The last minute: twelve looks of 50 kB.
  assert.equal(doing?.[0]?.bytes, 600_000);
  assert.equal(doing?.[0]?.since, new Date(2026, 9, 25, 20, 0, 5).getTime() / 1000);
  await h.flush();
  const day = await h.dayView();
  assert.equal(day.date, '2026-10-25');
  const ep = day.diary.find((e) => e.device === `device:${tv.id}`);
  assert.ok(ep, 'the TV watched YouTube');
  assert.equal(ep.what?.app, 'YouTube');
  assert.equal(say(ep.what, 'past'), 'watched YouTube');
  assert.equal(ep.bytes, 120 * 50_000);
  assert.equal(ep.deviceName, 'Living Room TV');
  // The baseline was never counted: only what grew.
  assert.equal(day.bytes, 120 * 50_000 + 119 * 3_000 + 1_500_000);
  // The call, light but long, is an episode; the burst on Instagram, one minute and 1.5 MB, is not.
  assert.deepEqual(day.diary.map((e) => [e.deviceName, e.what?.app]).sort(), [
    ['Alexs-iPhone', 'WhatsApp'],
    ['Living Room TV', 'YouTube'],
  ]);
  assert.equal(day.hours[20]?.video, 120 * 50_000);
  // The phone appeared after the first look: a new device, said once.
  assert.deepEqual(
    day.events.filter((e) => e.type === 'new').map((e) => e.deviceName),
    ['Alexs-iPhone'],
  );
});

test("One visit to YouTube's home page is browsing it, not watching: watching takes three minutes on end of streaming", async () => {
  const { clock, make } = await setup();
  const h = await make();
  const laptop = device('aa:aa:aa:aa:aa:04', 'laptop');
  const home = (i: number) => ({ ...talk(laptop.id, '203.0.113.5', 20_000, 933_687, YOUTUBE), id: `home ${i}`, first: clock.now() });
  await h.observe({ devices: [laptop], conversations: [] });
  // The reviewer's case: one fetch of the home page (953 687 bytes, no video), then quiet.
  const seen: Conversation[] = [];
  clock.add(5);
  seen.push(home(0));
  await h.observe({ devices: [laptop], conversations: seen });
  assert.equal(say(h.doing(`device:${laptop.id}`)?.[0]?.what), 'Browsing YouTube');
  // Thirteen more over the next hour, one every four minutes: 13 MB, one episode, never a video.
  for (let i = 1; i <= 13; i++) {
    clock.add(240);
    seen.push(home(i));
    await h.observe({ devices: [laptop], conversations: seen });
    assert.equal(say(h.doing(`device:${laptop.id}`)?.[0]?.what), 'Browsing YouTube');
  }
  clock.add(60);
  await h.observe({ devices: [laptop], conversations: seen });
  await h.flush();
  const day = await h.dayView();
  assert.deepEqual(day.diary.map((e) => say(e.what, 'past')), ['browsed YouTube']);
  assert.deepEqual(day.devices[0]?.top.map((t) => say(t.what, 'past')), ['browsed YouTube']);
});

test('A host the dictionary does not know is said by its site; it never heads what a device is doing over a named app', async () => {
  const { clock, make } = await setup();
  const h = await make();
  const laptop = device('aa:aa:aa:aa:aa:05', 'laptop');
  const SPOTIFY: Classification = { company: 'Spotify', app: 'Spotify', category: 'music', label: 'Music', activity: 'listening to music', tracking: false, by: 'name', rule: 'spotify.com' };
  await h.observe({ devices: [laptop], conversations: [] });
  for (let i = 1; i <= 72; i++) {
    clock.add(5);
    await h.observe({
      devices: [laptop],
      conversations: [
        { ...talk(laptop.id, '203.0.113.7', 0, i * 400_000), site: 'example.net' },
        talk(laptop.id, '203.0.113.8', 0, i * 20_000, SPOTIFY),
        talk(laptop.id, '192.0.2.9', 0, i * 900_000),
      ],
    });
  }
  const now = (h.doing(`device:${laptop.id}`) ?? []).map((x) => say(x.what));
  // The named app first, though the least; then the site by its name; the address with no name last.
  assert.deepEqual(now, ['Listening to Spotify', 'Using example.net', 'Talking to hosts with no name']);
  await h.flush();
  const day = await h.dayView();
  const story = day.diary.find((e) => e.device === `device:${laptop.id}`);
  assert.equal(say(story?.what, 'past'), 'listened to Spotify');
  assert.ok(story?.also?.some((w) => say(w, 'past') === 'used example.net'), JSON.stringify(story?.also));
  assert.equal(say(siteOnly('example.net')), 'Using example.net');
});

test('A restart: the day reads back, the first look after it is a baseline, and counters that went down count from zero', async () => {
  const { clock, make } = await setup();
  const tv = device('aa:aa:aa:aa:aa:01', 'Living Room TV');
  let h = await make();
  await h.observe({ devices: [tv], conversations: [talk(tv.id, '203.0.113.1', 0, 0, YOUTUBE)] });
  for (let i = 1; i <= 24; i++) {
    clock.add(5);
    await h.observe({ devices: [tv], conversations: [talk(tv.id, '203.0.113.1', 0, i * 100_000, YOUTUBE)] });
  }
  await h.flush();
  const before = (await h.dayView()).bytes;
  assert.equal(before, 2_400_000);
  // The server stops and starts: the session's counters come back from disk, a little further on.
  h = await make();
  clock.add(60);
  // What began since the restart is counted at the first look, whole; what began before is the baseline.
  const fresh = { ...talk(tv.id, '203.0.113.9', 0, 70_000, YOUTUBE), id: 'fresh', first: clock.now() };
  await h.observe({ devices: [tv], conversations: [talk(tv.id, '203.0.113.1', 0, 2_900_000, YOUTUBE), fresh] });
  clock.add(5);
  // A flow of it forgotten past the tally's ceiling: the total goes down, and nothing new happened.
  await h.observe({ devices: [tv], conversations: [talk(tv.id, '203.0.113.1', 0, 2_000_000, YOUTUBE)], session: { started: 1 } });
  clock.add(5);
  // The session began again: its counters start from zero, and what is there now is all new.
  await h.observe({ devices: [tv], conversations: [talk(tv.id, '203.0.113.1', 0, 40_000, YOUTUBE)], session: { started: 2 } });
  clock.add(60);
  await h.observe({ devices: [tv], conversations: [] });
  const after = await h.dayView();
  assert.equal(after.bytes, before + 70_000 + 40_000);
});

test('Traffic in the clear and old TLS are events, once a day each; harmless checks are not', async () => {
  const { clock, make } = await setup();
  const h = await make();
  const printer = device('aa:aa:aa:aa:aa:03', 'Office Printer');
  const post = (n: number) => talk(printer.id, '198.51.100.77', n, n, undefined, { id: 'p', clear: { proto: 'HTTP', credentials: true } });
  const check = (n: number) => talk(printer.id, '203.0.113.30', n, n, undefined, { id: 'c', clear: { proto: 'HTTP', harmless: true } });
  const old = (n: number) => talk(printer.id, '203.0.113.90', n, n, undefined, { id: 'o', tls: '1.0' });
  await h.observe({ devices: [printer], conversations: [] });
  for (let i = 1; i <= 3; i++) {
    clock.add(5);
    await h.observe({ devices: [printer], conversations: [post(i * 100), check(i * 100), old(i * 100)], remotes: [] });
  }
  const day = await h.dayView();
  assert.deepEqual(
    day.events.map((e) => [e.type, e.with, e.proto, e.credentials ?? false]).sort(),
    [
      ['clear', 'remote:198.51.100.77', 'HTTP', true],
      ['old-tls', 'remote:203.0.113.90', 'TLS 1.0', false],
    ],
  );
});

test('The oldest days go past the days kept; today never', async () => {
  const { dir, make } = await setup();
  const hist = path.join(dir, 'history');
  const { mkdir } = await import('node:fs/promises');
  await mkdir(hist, { recursive: true });
  for (let d = 1; d <= 40; d++) await writeFile(path.join(hist, `2026-08-${String(d % 31 || 31).padStart(2, '0')}.jsonl.gz`), 'x');
  await writeFile(path.join(hist, '2026-10-25.jsonl'), '{"t":1,"a":[]}\n');
  const h = await make();
  const days = await h.days();
  assert.equal(days.length, 31);
  assert.equal(days[0], '2026-10-25');
  assert.ok((await readdir(hist)).includes('2026-10-25.jsonl'));
});
