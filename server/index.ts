// The Argus server: the core's (the interface, health and state, the checks in front, MCP at /mcp, the live event
// stream) with Argus's routes: the interfaces, the live session, and the captures saved from it.
//
//   GET    /api/events                 the live stream (the core's): once a second, what changed
//   GET    /api/interfaces             the interfaces, named as he would, and whether this user can capture on them
//   GET    /api/live                   the live session: what is being listened on, its devices, hosts, bandwidth
//   PUT    /api/live/<iface>           { on } listens on it, or stops
//   POST   /api/live/reset             begins the session again
//   POST   /api/live/save              { interfaces? } saves what the ring buffer holds as a capture
//   GET    /api/live/devices/<id>      one device's bandwidth over time, fine and coarse
//   GET    /api/day[?date=&device=&network=…]  a day kept (server/history.ts): by hour and category, by device, the
//                                      diary; of the networks given (each `network=` one), or of all
//   GET    /api/captures               every capture saved, newest first
//   GET    /api/captures/<id>          one, with its devices, internet hosts and links
//   DELETE /api/captures/<id>          removes it and its file
//   GET    /api/hosts[?capture=<id>]   the live session's view (or that capture's)

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { EventHub } from '@organon/core/server/events';
import { ApiError, json, type Route, readJson, serve } from '@organon/core/server/http';
import { createMcpHandler } from '@organon/core/server/mcp';
import { createSettings } from '@organon/core/server/settings';
import { createStore } from '@organon/core/server/store';
import { Warnings } from '@organon/core/server/warnings';
import { classify, listInterfaces, ownMacs, selfSystem, ssidOf, tsharkFields } from './capture.ts';
import { useFields } from './tally.ts';
import { Captures } from './captures.ts';
import { DissectError } from './dissect.ts';
import { loadHouse } from './dictionary.ts';
import { app, CAPTURES_DIR, CAPTURES_MB, DUMPCAP, EDITCAP, HISTORY, IW, LIVE_DIR, MERGECAP, RING, SEED_PCAP, SYS_NET, TSHARK } from './config.ts';
import { Geo, geoFile } from './geo.ts';
import { interpret, type Reading } from './interpret.ts';
import { History } from './history.ts';
import { Live, LiveError } from './live.ts';
import { argusTools, instructions } from './tools.ts';

const warnings = new Warnings();
// Only the fields this tshark knows: an older one, asked for one it lacks, would not start at all.
const missing = useFields(await tsharkFields(TSHARK));
if (missing.length) warnings.set('tshark', `This tshark does not know ${missing.join(', ')}: what they say is not read (a newer Wireshark has them).`);
const settings = createSettings({ file: app.settingsFile, warnings, apiKey: app.apiKey });
const store = createStore({ dataDir: app.dataDir, warnings });
const events = new EventHub();
// The house's own words for the dictionary, on top of its own (server/dictionary.ts): data/dicionario.json, if any.
const house = loadHouse(path.join(app.dataDir, 'dicionario.json'));
if (house.problems.length) warnings.set('dicionario', `Some entries of the house's dictionary were not read: ${house.problems.slice(0, 5).join('; ')}`);
// How the facts are read (server/interpret.ts): this PC's system, and the geo table, loaded once the server is up.
const reading: Reading = { self: selfSystem(), label: (id) => classify(id, SYS_NET).label };
// A capture saved from the session is read knowing every MAC this PC had in it (the live session, below, keeps them).
const own = { macs: (): string[] => [] };
const tools = { dumpcap: DUMPCAP, tshark: TSHARK, sysNet: SYS_NET, reading, own: () => own.macs() };
const captures = await new Captures(CAPTURES_DIR, store, tools).load();
if (!captures.all().length && SEED_PCAP) {
  try {
    await captures.import(SEED_PCAP, ['exemplo']);
  } catch (err) {
    warnings.set('seed', `The sample recording could not be read: ${(err as Error).message}`);
  }
}
// The day, kept as aggregates (server/history.ts): what each device did, minute by minute, and the diary.
const history = await new History({ dir: path.join(app.dataDir, 'history'), store, days: HISTORY.days, mb: HISTORY.mb }).load();
const live = await new Live({ tshark: TSHARK, editcap: EDITCAP, dir: LIVE_DIR, store, events, ownMacs: () => ownMacs(SYS_NET),
  ssid: (id) => ssidOf(IW, id, SYS_NET),
  // The server reads the sensor's facts: the dictionary, identity, DNS, where (interpret.ts), and what each device is
  // doing now (the history). The line between the two (docs/sensor.md).
  read: (v) => {
    interpret(v, reading);
    for (const d of v.devices) d.doing = history.doing(`device:${d.id}`);
    return v;
  },
  ...RING,
}).load();
own.macs = () => live.ownMacs();

// Every few seconds, a look at what the session adds up to: what grew is now's traffic, kept by the minute.
let observing = false;
const looking = setInterval(() => {
  if (observing || !live.on().length) return;
  observing = true;
  history
    .observe({ ...live.hosts(), session: live.session() })
    .then(() => {
      if (history.full) warnings.set('history', 'Today’s history reached its ceiling (ARGUS_HISTORY_MB) and is no longer written until midnight.');
    })
    .catch((err) => warnings.set('history', `The day could not be kept: ${(err as Error).message}`))
    .finally(() => (observing = false));
}, HISTORY.every);

await serve(app, {
  warnings,
  accent: () => settings.accent,
  state: () => ({ captures: captures.all(), session: live.session(), geo: reading.geo?.ready ?? false, networks: history.networks() }),
  mcp: createMcpHandler(app, { instructions, tools: () => argusTools(captures, live, history), core: ['get_hosts'] }),
  stop: async () => {
    clearInterval(looking);
    await live.stop();
    await history.observe({ ...live.hosts(), session: live.session() }).catch(() => {});
    await history.flush();
    events.close();
  },
  api: (req, res, route, params) =>
    routes(req, res, route, params).catch((err) => {
      // tshark missing or failing is said, not a bare server error.
      if (err instanceof DissectError) throw new ApiError(503, err.message);
      if (err instanceof LiveError) throw new ApiError(400, err.message);
      throw err;
    }),
});

async function routes(...[req, res, route, params]: Parameters<Route>): Promise<boolean> {
  const tail = (prefix: string) => decodeURIComponent(route.slice(prefix.length));
  if (req.method === 'GET' && route === '/api/events') return events.stream(req, res);
  if (req.method === 'GET' && route === '/api/interfaces') return json(res, 200, await listInterfaces(tools));

  if (req.method === 'GET' && route === '/api/live') return json(res, 200, live.view());
  if (req.method === 'GET' && route === '/api/day') {
    const date = params.get('date') ?? undefined;
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(400, 'A day is YYYY-MM-DD');
    const nets = params.getAll('network').filter(Boolean);
    return json(res, 200, await history.dayView(date, params.get('device') ?? undefined, nets.length ? new Set(nets) : undefined));
  }
  if (req.method === 'POST' && route === '/api/live/reset') {
    await live.reset();
    return json(res, 200, live.session());
  }
  if (req.method === 'POST' && route === '/api/live/save') {
    const body = (await readJson(req)) as { interfaces?: unknown } | undefined;
    const ids = Array.isArray(body?.interfaces) ? body.interfaces.filter((i): i is string => typeof i === 'string') : undefined;
    return json(res, 200, await saveRing(ids));
  }
  if (req.method === 'GET' && route.startsWith('/api/live/devices/')) return json(res, 200, live.deviceSeries(tail('/api/live/devices/')));
  if (req.method === 'PUT' && route.startsWith('/api/live/')) {
    const id = tail('/api/live/');
    const body = (await readJson(req)) as { on?: unknown } | undefined;
    if (typeof body?.on !== 'boolean') throw new ApiError(400, 'Say { "on": true } or { "on": false }');
    if (body.on) {
      const { interfaces, problem } = await listInterfaces(tools);
      if (problem && !interfaces.some((i) => i.capturable)) throw new ApiError(409, `Cannot listen yet: ${problem}`);
      return json(res, 200, await live.set(id, true, interfaces.filter((i) => i.capturable).map((i) => i.id)));
    }
    return json(res, 200, await live.set(id, false, []));
  }

  if (req.method === 'GET' && route === '/api/captures') return json(res, 200, captures.all());
  if (route.startsWith('/api/captures/')) {
    const c = captures.get(tail('/api/captures/'));
    if (!c) throw new ApiError(404, 'There is no such capture');
    if (req.method === 'DELETE') {
      await captures.remove(c.id);
      events.send({ type: 'captures', captures: captures.all() });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET') return json(res, 200, c.status === 'done' ? await captures.hosts(c) : { capture: c });
  }
  if (req.method === 'GET' && route === '/api/hosts') {
    const id = params.get('capture');
    if (!id) return json(res, 200, { session: live.session(), ...live.hosts() });
    const c = captures.get(id);
    if (!c) throw new ApiError(404, 'There is no such capture');
    return json(res, 200, c.status === 'done' ? await captures.hosts(c) : { capture: c });
  }
  return false;
}

/**
 * What the ring buffers hold (the last minutes of each interface listened on), merged in time order into one capture
 * and cut at the session's start. Refused past the ceiling for all captures saved (ARGUS_CAPTURES_MB).
 */
async function saveRing(ids?: string[]) {
  const files = await live.ringFiles(ids);
  if (!files.length) throw new ApiError(409, 'Nothing in the ring buffer to save yet: turn an interface on first');
  const used = await captures.diskBytes();
  if (used > CAPTURES_MB * 1024 * 1024)
    throw new ApiError(409, `The saved captures already take ${Math.round(used / 1048576)} MB (the ceiling is ${CAPTURES_MB} MB): delete one first`);
  const dir = await mkdtemp(path.join(tmpdir(), 'argus-save-'));
  try {
    const merged = path.join(dir, 'merged.pcapng');
    const out = path.join(dir, 'saved.pcapng');
    const fail = (what: string) => (err: Error & { stderr?: string }) => {
      throw new ApiError(503, `${what} did not write the capture: ${(err.stderr || err.message).slice(0, 300)}`);
    };
    await promisify(execFile)(MERGECAP, ['-w', merged, ...files], { timeout: 120_000 }).catch(fail('mergecap'));
    await live.cut(merged, out).catch(fail('editcap'));
    const names = ids ?? live.session().listening.map((l) => l.id);
    const c = await captures.import(out, names, 'live');
    events.send({ type: 'captures', captures: captures.all() });
    return c;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// The table of networks for "where the data goes" (server/geo.ts), read once the server answers: 2 s of parsing.
setTimeout(() => {
  reading.geo = Geo.load(geoFile(process.env));
  if (!reading.geo.ready) warnings.set('geo', 'Where the data goes is unknown: run pnpm geo once (it downloads the table of networks).');
}, 50);
