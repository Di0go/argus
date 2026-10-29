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
//   GET    /api/sources                where devices are found besides listening, and how each source is going
//   GET    /api/sources/here           where this PC is now: its way out, the router's MAC, its network, its model
//   POST   /api/sources/scan           { network? } asks the LAN this PC is on who is there (nmap -sn: sends packets)
//   POST   /api/sources/router         { network?, password?, user? } logs in to the router and reads its devices
//   DELETE /api/sources/router         forgets the password saved for the router of here

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
import type { Here, SourceState } from '../shared/types.ts';
import { classify, listInterfaces, ownMacs, selfSystem, ssidOf, tsharkFields } from './capture.ts';
import { useFields } from './tally.ts';
import { Captures } from './captures.ts';
import { DissectError } from './dissect.ts';
import { loadHouse } from './dictionary.ts';
import { app, CAPTURES_DIR, CAPTURES_MB, DUMPCAP, EDITCAP, HISTORY, IW, LIVE_DIR, MERGECAP, RING, ROUTER, SEED_PCAP, SOURCES, SYS_NET, TSHARK } from './config.ts';
import { Geo, geoFile } from './geo.ts';
import { interpret, type Reading } from './interpret.ts';
import { History } from './history.ts';
import { Live, LiveError } from './live.ts';
import { readRouter, RouterKeys } from './routers.ts';
import { ADAPTERS } from './routers/all.ts';
import { machineAddresses, Sources } from './sources.ts';
import { networkAt, tell } from '../shared/networks.ts';
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
// What the router, the kernel and a scan know of the LAN (server/sources.ts): added to the live view, never to a
// capture, and never sent as if the sensor had heard it (`foundOnly`).
const sources = await new Sources({ ...SOURCES, own: () => ({ macs: own.macs(), ips: machineAddresses().ips }) }).load();
// The passwords of his routers, outside the repository and the data folder (server/routers.ts).
const keys = new RouterKeys(ROUTER.keys);
/** The model each router was last read as, by its MAC: said on the page before its password is asked again. */
const models = new Map<string, string>();
let readingRouter: Promise<unknown> | undefined;
const live = await new Live({ tshark: TSHARK, editcap: EDITCAP, dir: LIVE_DIR, store, events, ownMacs: () => ownMacs(SYS_NET),
  ssid: (id) => ssidOf(IW, id, SYS_NET),
  // The server reads the sensor's facts: the dictionary, identity, DNS, where (interpret.ts), and what each device is
  // doing now (the history). The line between the two (docs/sensor.md). The other sources are merged after that read,
  // so a device they found has a network and a name but is not counted as heard.
  read: (v) => {
    const stays = v.segments;
    const read = interpret(v, reading);
    sources.attach(read, stays ? networkAt(stays, tell(stays).of) : undefined);
    for (const d of read.devices) d.doing = history.doing(`device:${d.id}`);
    return read;
  },
  ...RING,
}).load();
own.macs = () => live.ownMacs();

// Every few seconds, a look at what the session adds up to: what grew is now's traffic, kept by the minute. Only what
// was heard: a device another source found is not news of the day, nor one the history knows.
const heard = () => {
  const h = live.hosts();
  return { ...h, devices: h.devices.filter((d) => !d.foundOnly), session: live.session() };
};
let observing = false;
const looking = setInterval(() => {
  if (observing || !live.on().length) return;
  observing = true;
  history
    .observe(heard())
    .then(() => {
      if (history.full) warnings.set('history', 'Today’s history reached its ceiling (ARGUS_HISTORY_MB) and is no longer written until midnight.');
    })
    .catch((err) => warnings.set('history', `The day could not be kept: ${(err as Error).message}`))
    .finally(() => (observing = false));
}, HISTORY.every);

await serve(app, {
  warnings,
  accent: () => settings.accent,
  state: () => ({
    captures: captures.all(),
    session: live.session(),
    geo: reading.geo?.ready ?? false,
    networks: history.networks(),
    sources: sources.status(),
    runs: sources.runs(),
  }),
  mcp: createMcpHandler(app, { instructions, tools: () => argusTools(captures, live, history), core: ['get_hosts'] }),
  stop: async () => {
    clearInterval(looking);
    sources.stop();
    await live.stop();
    await history.observe(heard()).catch(() => {});
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
  if (req.method === 'GET' && route === '/api/sources') return json(res, 200, sources.status());
  if (req.method === 'GET' && route === '/api/sources/here') return json(res, 200, (await where()) ?? null);
  if (req.method === 'POST' && route === '/api/sources/scan') {
    const body = (await readJson(req)) as { network?: unknown } | undefined;
    const here = await askable(body?.network);
    const state = await sources.scan(here, live.hosts().devices).catch((err: Error) => {
      throw new ApiError(409, err.message);
    });
    sourcesAttached(state);
    return json(res, 200, { sources: state, runs: sources.runs() });
  }
  if (req.method === 'POST' && route === '/api/sources/router') {
    if (!sources.routerOn) throw new ApiError(409, 'Reading the router is turned off');
    if (readingRouter) throw new ApiError(409, 'The router is being read already');
    const body = (await readJson(req)) as { network?: unknown; password?: unknown; user?: unknown } | undefined;
    const here = await askable(body?.network);
    if (!here.mac) throw new ApiError(409, `The router's MAC is not in this PC's neighbour table yet: its password is kept by it, so it is not asked without it.`);
    const password = typeof body?.password === 'string' && body.password.length > 0 && body.password.length <= 256 ? body.password : undefined;
    const user = typeof body?.user === 'string' && /^[\w.@-]{1,64}$/.test(body.user) ? body.user : undefined;
    const before = live.hosts().devices;
    const job = readRouter({ base: ROUTER.url ?? `http://${here.gateway}`, mac: here.mac, password, user }, keys, ADAPTERS);
    readingRouter = job;
    const out = await job.finally(() => (readingRouter = undefined));
    if (out.model) models.set(here.mac, out.model);
    const run = out.ok
      ? sources.fromRouter(here, { model: out.model, factory: out.factory, clients: out.clients }, before)
      : out.need
        ? undefined
        : sources.fromRouter(here, { model: out.model ?? 'Unknown router', error: out.error }, before);
    if (run) sourcesAttached(sources.status());
    const { ok, ...rest } = out;
    return json(res, 200, { ok, ...(ok ? { model: out.model, factory: out.factory } : rest), run, here: await where(), sources: sources.status(), runs: sources.runs() });
  }
  if (req.method === 'DELETE' && route === '/api/sources/router') {
    const here = await where();
    if (!here?.mac) throw new ApiError(409, 'This PC is on no network with a router it knows the MAC of');
    return json(res, 200, { forgotten: await keys.forget(here.mac), here: await where() });
  }

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

/** A source looked again (or scanned): its state goes to the page, and the view is sent again with what it found. */
function sourcesAttached(state: SourceState[]) {
  events.send({ type: 'sources', sources: state, runs: sources.runs() });
  live.publish();
}

/**
 * Where this PC is now (Sources.here: its way out, the router's address and MAC), with the network that router is of
 * (the session's networks, else one the history remembers, by its router's MAC) and what is kept of it.
 */
async function where(): Promise<Here | undefined> {
  const at = await sources.here();
  if (!at) return undefined;
  if (!at.mac) return at;
  const network =
    live.hosts().networks.find((n) => n.routers.includes(at.mac!))?.id ?? history.networks().find((n) => n.id === `net:${at.mac}`)?.id;
  const key = await keys.get(at.mac);
  const model = key?.model ?? models.get(at.mac);
  return { ...at, ...(network ? { network } : {}), router: { ...(model ? { model } : {}), saved: Boolean(key), ...(key ? { user: key.user } : {}) } };
}

/** Where this PC is, when the network asked is that one: what is asked of a network can only be asked of the one it is on. */
async function askable(network: unknown): Promise<Here> {
  const here = await where();
  if (!here) throw new ApiError(409, 'This PC is on no network with a way out: there is nothing to ask');
  if (typeof network === 'string' && network && network !== here.network)
    throw new ApiError(409, 'Argus can only ask the network this PC is on now: from here the others cannot be reached');
  return here;
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
