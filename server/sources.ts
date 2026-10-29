// Where Argus finds devices besides its own listening: the kernel's neighbour table, DHCP leases (a local dnsmasq, or
// one Argus can read), and, asked for by hand on the Scan page, a scan of the LAN and a reading of the router
// (server/routers.ts). The sensor still only listens; these are other witnesses, and what they add is said as such (a
// device this PC never saw a frame from is `foundOnly`).
//
// What they give is merged into the live view after the server has read it (server/interpret.ts), so a device the
// router knows about but this PC never hears still has a name, an address and a network: the one its interface was on
// when it was last found there (shared/networks.ts networkAt, the rule for what was heard), else none; what a scan or
// the router found is on the network that was asked, the router's. Reading the neighbour table and a lease file are
// local reads: nothing goes out. The scan sends packets and reading the router logs in to it: each only when he presses
// its button, only on the network this PC is on then (`here`), and the page says what each does (docs/sources.md).
// Each time is kept as a run: when, where, what it found and what Argus knew of each before.
//
// A source is not the sensor: docs/sensor.md. The next ones (SNMP, a remote sensor, a DNS server's log) answer the
// same `Found` shape and add a name to `DeviceOrigin`; another model of router is an adapter (server/routers/).

import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import type { Device, DeviceOrigin, Here, RunDevice, SourceRun, SourceState } from '../shared/types.ts';
import type { RouterClient } from './routers.ts';

export interface Found {
  mac?: string;
  ip?: string;
  hostname?: string;
  iface?: string;
  /** The network it was found on, when the one asked is known (a scan, the router); else by its interface and time. */
  network?: string;
  /** Epoch seconds when it ends, for a lease; absent for the others. */
  expires?: number;
  origins: Partial<Record<DeviceOrigin, { first: number; last: number }>>;
}

export interface SourcesOptions {
  /** Lease files to read; by default the usual places. `[]` turns it off. */
  leases?: string[];
  /** The kernel's neighbour table (on by default). */
  neigh?: boolean;
  /** A scan of the LAN when asked (on by default; it needs nmap). */
  scan?: boolean;
  /** Reading the router when asked (on by default). */
  router?: boolean;
  nmap?: string;
  ip?: string;
  /** Milliseconds between looks at the neighbour table and the leases (15 000). */
  pollEvery?: number;
  now?: () => number;
  /** This machine's MACs and addresses, never reported as another device. */
  own?: () => { macs: string[]; ips: string[] };
  /** For tests: run a command. */
  run?: (cmd: string, args: string[], timeout?: number) => Promise<string>;
}

/** A device another source found, as it goes into the view. */
export interface Discovered {
  mac?: string;
  ip?: string;
  hostname?: string;
  iface?: string;
  network?: string;
  origins: DeviceOrigin[];
  firstSeen: number;
  lastSeen: number;
}

const LEASE_FILES = ['/var/lib/misc/dnsmasq.leases', '/tmp/dhcp.leases', '/var/lib/dhcp/dhcpd.leases', '/var/lib/kea/kea-leases4.csv'];
const LEASE_GLOBS: [string, RegExp][] = [['/var/lib/NetworkManager', /^dnsmasq-.*\.leases$/]];
const HOUR = 3600;
const KEEP = { neigh: HOUR, scan: 30 * 60, router: 7 * 24 * HOUR } as const;
const SKIP_IP = /^(169\.254\.|0\.0\.0\.0$|255\.255\.255\.255$)/i;
/** The widest a scan goes: a /24, the one this PC is in, whatever the interface's mask (a /16 is 65 534 addresses). */
const SCAN_BITS = 24;
/** The interfaces that are not the LAN: loopback, Docker's bridges and containers, VPNs and tunnels. */
const NOT_LAN = /^(lo|docker|br-|veth|tun|tap|wg|tailscale|ppp)/;
/** How many runs are kept (in memory, as the devices they found are). */
const RUNS = 30;

export class Sources {
  private readonly o: Required<Pick<SourcesOptions, 'neigh' | 'scan' | 'router' | 'nmap' | 'ip' | 'pollEvery' | 'now' | 'run'>> &
    Pick<SourcesOptions, 'leases' | 'own'>;
  private readonly found = new Map<string, Found>();
  private files: string[] = [];
  private timer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private lastPoll = 0;
  private lastScan = 0;
  private lastRouter = 0;
  private scanError = '';
  private routerError = '';
  /** The devices the lease files held at the last look, and the router at its last reading: both are `router` marks. */
  private leaseCount = 0;
  private routerCount = 0;
  private readonly done: SourceRun[] = [];
  private leaseError = '';
  private scanning: Promise<SourceState[]> | undefined;

  constructor(options: SourcesOptions = {}) {
    this.o = {
      neigh: options.neigh ?? true,
      scan: options.scan ?? true,
      router: options.router ?? true,
      nmap: options.nmap ?? 'nmap',
      ip: options.ip ?? 'ip',
      pollEvery: options.pollEvery ?? 15_000,
      now: options.now ?? (() => Date.now() / 1000),
      run: options.run ?? run,
      leases: options.leases,
      own: options.own,
    };
  }

  /** Reads the first look and begins looking every few seconds. */
  async load(): Promise<this> {
    this.files = this.o.leases ?? (await this.leaseFiles());
    await this.poll();
    this.timer = setInterval(() => void this.poll(), this.o.pollEvery);
    return this;
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Every device the other sources know of, merged by MAC (else by address), the latest first. */
  devices(): Discovered[] {
    const now = this.o.now();
    const own = this.o.own?.();
    const ownMacs = new Set((own?.macs ?? []).map((m) => m.toLowerCase()));
    const ownIps = new Set(own?.ips ?? []);
    const out: Discovered[] = [];
    for (const f of this.found.values()) {
      // This machine is not a device of the LAN, whatever the kernel, a lease or a scan says of it.
      if (f.mac && ownMacs.has(f.mac)) continue;
      if (f.ip && ownIps.has(f.ip)) continue;
      const origins = (Object.entries(f.origins) as [DeviceOrigin, { first: number; last: number }][])
        .filter(([o, v]) => {
          const keep = o === 'scan' ? KEEP.scan : o === 'router' ? KEEP.router : KEEP.neigh;
          if (!v || now - v.last > keep) return false;
          // An expired lease says the router took the address back; what this PC saw itself still stands.
          return o !== 'router' || !f.expires || f.expires > now;
        })
        .map(([o]) => o);
      if (!origins.length) continue;
      const times = origins.map((o) => f.origins[o]!);
      out.push({
        ...(f.mac ? { mac: f.mac } : {}),
        ...(f.ip ? { ip: f.ip } : {}),
        ...(f.hostname ? { hostname: f.hostname } : {}),
        ...(f.iface ? { iface: f.iface } : {}),
        ...(f.network ? { network: f.network } : {}),
        origins,
        firstSeen: Math.min(...times.map((t) => t.first)),
        lastSeen: Math.max(...times.map((t) => t.last)),
      });
    }
    return out.sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /** What each source adds and how it is going, as the page says it. */
  status(): SourceState[] {
    const all = this.devices();
    const by = (o: DeviceOrigin) => all.filter((d) => d.origins.includes(o)).length;
    return [
      {
        id: 'neigh',
        name: 'This PC’s neighbour table',
        on: this.o.neigh,
        detail: 'The devices this PC exchanged frames with lately, as its kernel remembers them. A local read: nothing is sent.',
        ...(this.lastPoll ? { last: this.lastPoll } : {}),
        found: this.o.neigh ? by('neigh') : 0,
      },
      {
        id: 'leases',
        name: 'DHCP leases',
        on: this.files.length > 0,
        detail: this.files.length
          ? `Every device a DHCP server on this PC gave an address to, by the name it asked with: ${this.files.map((f) => path.basename(f)).join(', ')}. A local read: nothing is sent.`
          : 'None on this PC: it is not the router. A lease file (dnsmasq or ISC dhcpd) named in ARGUS_LEASES is read here.',
        ...(this.lastPoll ? { last: this.lastPoll } : {}),
        found: this.files.length ? this.leaseCount : 0,
        ...(this.leaseError ? { error: this.leaseError } : {}),
      },
      {
        id: 'scan',
        name: 'Scan of the LAN',
        on: this.o.scan,
        detail: SCAN_SENDS,
        ...(this.lastScan ? { last: this.lastScan } : {}),
        found: this.o.scan ? by('scan') : 0,
        ...(this.scanError ? { error: this.scanError } : {}),
      },
      {
        id: 'router',
        name: 'The router',
        on: this.o.router,
        detail: ROUTER_DOES,
        ...(this.lastRouter ? { last: this.lastRouter } : {}),
        found: this.routerCount,
        ...(this.routerError ? { error: this.routerError } : {}),
      },
    ];
  }

  /** Every time he asked, the latest first. */
  runs(): SourceRun[] {
    return [...this.done];
  }

  /** Whether reading the router can be asked for here (ARGUS_ROUTER=0 takes the button away). */
  get routerOn(): boolean {
    return this.o.router;
  }

  /**
   * Where this PC is now: the interface of its way out (the default route with the lowest metric, of a Wi-Fi or a
   * cable, not a VPN or Docker), the gateway's address and, from the neighbour table, its MAC. Local reads only.
   */
  async here(): Promise<Omit<Here, 'network' | 'router'> | undefined> {
    const routes = await this.o.run(this.o.ip, ['-4', 'route', 'show', 'default'], 5000).catch(() => '');
    const ways = routes
      .split('\n')
      .map((l) => /^default\s+via\s+(\d+\.\d+\.\d+\.\d+)\s+dev\s+(\S+)(?:.*\smetric\s+(\d+))?/.exec(l.trim()))
      .filter((m): m is RegExpExecArray => Boolean(m && !NOT_LAN.test(m[2]!)))
      .map((m) => ({ gateway: m[1]!, iface: m[2]!, metric: Number(m[3] ?? 0) }))
      .sort((a, b) => a.metric - b.metric);
    const way = ways[0];
    if (!way) return undefined;
    const neigh = parseNeigh(await this.o.run(this.o.ip, ['neigh', 'show', way.gateway, 'dev', way.iface], 5000).catch(() => ''), way.iface);
    const mac = neigh.find((n) => n.ip === way.gateway)?.mac;
    return { iface: way.iface, gateway: way.gateway, ...(mac ? { mac } : {}) };
  }

  /**
   * Asks the LAN who is there (nmap, then the neighbour table for the MACs), on the interface of where this PC is now;
   * what answers is on `at.network`. `before` is the view as it was: what Argus knew of each one.
   */
  async scan(at?: { iface: string; network?: string }, before: Device[] = []): Promise<SourceState[]> {
    if (!this.o.scan) throw new Error('The scan is turned off');
    if (this.scanning) return this.scanning;
    this.scanning = this.doScan(at ?? { iface: this.defaultIface() ?? '' }, before).finally(() => (this.scanning = undefined));
    return this.scanning;
  }

  /**
   * What the router said (server/routers.ts), as a run: the devices connected now join the found ones, on the router's
   * network; those it only remembers are listed in the run and nothing more.
   */
  fromRouter(at: { iface: string; network?: string }, r: { model: string; factory?: boolean; clients?: RouterClient[]; error?: string }, before: Device[] = []): SourceRun {
    const now = this.o.now();
    const clients = r.clients ?? [];
    const found: RunDevice[] = clients.map((c) => ({ ...knownOf(c, before), ...c }));
    for (const c of clients) {
      if (!c.connected) continue;
      this.add({ mac: c.mac, ip: c.ip, hostname: c.hostname, iface: at.iface, network: at.network, origin: 'router', last: now });
    }
    this.routerError = r.error ?? '';
    if (!r.error) {
      this.lastRouter = now;
      this.routerCount = clients.filter((c) => c.connected).length;
    }
    return this.record({ kind: 'router', at: now, iface: at.iface, network: at.network, router: { model: r.model, ...(r.factory ? { factory: true } : {}) }, error: r.error, found });
  }

  /**
   * Merges what the other sources found into the view, after the server has read it (server/interpret.ts). A device the
   * sensor heard gains its DHCP name, its other addresses and where else it was found, and keeps its own times: being in
   * a table is not being heard. One it never heard is added `foundOnly`, on the network its interface was on when it was
   * last found (`at`, shared/networks.ts networkAt), else on none: shown with every network, never guessed into one.
   */
  attach<V extends { devices: Device[] }>(v: V, at: (iface: string, t: number) => string | undefined = () => undefined): V {
    for (const f of this.devices()) {
      const had = v.devices.find((d) => (f.mac && d.mac?.toLowerCase() === f.mac) || (f.ip && d.ips.includes(f.ip)));
      const name = f.hostname ? { name: f.hostname, source: f.origins.includes('router') ? ('DHCP' as const) : ('DNS' as const) } : undefined;
      if (had) {
        had.origin = [...new Set([...(had.origin ?? []), ...f.origins])];
        if (f.ip && !had.ips.includes(f.ip)) had.ips.push(f.ip);
        if (name && !had.names.some((n) => n.name.toLowerCase() === name.name.toLowerCase())) {
          had.names.push(name);
          if (had.name === had.mac || had.name === had.ips[0]) had.name = name.name;
        }
        continue;
      }
      const iface = f.iface ?? this.ifaceForIp(f.ip);
      const net = f.network ?? (iface ? at(iface, f.lastSeen) : undefined);
      const id = f.mac ?? f.ip!;
      v.devices.push({
        kind: 'device',
        id,
        ...(f.mac ? { mac: f.mac } : {}),
        name: f.hostname ?? f.ip ?? id,
        ips: f.ip ? [f.ip] : [],
        randomMac: f.mac ? randomMac(f.mac) : false,
        names: name ? [name] : [],
        interfaces: iface ? [iface] : [],
        packets: 0,
        bytesSent: 0,
        bytesReceived: 0,
        firstSeen: f.firstSeen,
        lastSeen: f.lastSeen,
        origin: f.origins,
        foundOnly: true,
        networks: net ? [net] : [],
        aka: [...(f.hostname ? [f.hostname] : []), ...(f.ip ? [f.ip] : []), ...(f.mac ? [f.mac] : [])],
        summary: 'Found, not heard',
      });
    }
    return v;
  }

  private async doScan(at: { iface: string; network?: string }, before: Device[]): Promise<SourceState[]> {
    this.scanError = '';
    const iface = at.iface;
    const found: RunDevice[] = [];
    try {
      if (!iface) throw new Error('No network interface to scan: turn one on first');
      const cidr = await this.cidr(iface);
      if (!cidr) throw new Error(`No IPv4 address on ${iface}: there is no LAN to scan`);
      // Who answers: without root nmap tries a TCP connection to ports 80 and 443 of each address, and the kernel asks
      // for each one's MAC by ARP first; the names of those up are asked of the DNS server (their PTR records).
      const hosts = parseNmapXml(await this.o.run(this.o.nmap, ['-sn', '-T4', '--max-retries', '1', '--host-timeout', '5s', '-oX', '-', cidr], 90_000));
      // The ARP the scan needed left their MACs in the neighbour table: read, not asked again.
      const neigh = parseNeigh(await this.o.run(this.o.ip, ['neigh', 'show', 'dev', iface], 5000).catch(() => ''), iface);
      const byIp = new Map(neigh.map((n) => [n.ip, n.mac]));
      const now = this.o.now();
      const own = this.o.own?.();
      const ownMacs = new Set((own?.macs ?? []).map((m) => m.toLowerCase()));
      for (const h of hosts) {
        const mac = byIp.get(h.ip);
        // This machine answers its own scan: it is not a device of the LAN.
        if ((mac && ownMacs.has(mac)) || own?.ips.includes(h.ip)) continue;
        found.push({ ...knownOf({ mac, ip: h.ip }, before), ...(mac ? { mac } : {}), ip: h.ip, ...(h.hostname ? { hostname: h.hostname } : {}) });
        this.add({ ip: h.ip, mac, hostname: h.hostname, iface, network: at.network, origin: 'scan', last: now });
      }
      this.lastScan = now;
    } catch (err) {
      this.scanError = (err as Error).message;
    }
    this.record({ kind: 'scan', at: this.o.now(), iface, network: at.network, error: this.scanError || undefined, found });
    return this.status();
  }

  private record(r: Omit<SourceRun, 'id'>): SourceRun {
    const run: SourceRun = { id: `${r.kind}-${Math.round(r.at * 1000).toString(36)}-${this.done.length}`, ...r };
    if (!run.error) delete run.error;
    if (!run.network) delete run.network;
    this.done.unshift(run);
    this.done.length = Math.min(this.done.length, RUNS);
    return run;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      const now = this.o.now();
      if (this.o.neigh) {
        try {
          const out = await this.o.run(this.o.ip, ['neigh', 'show'], 5000);
          for (const n of parseNeigh(out)) {
            // A stale entry is a MAC the kernel still remembers, not one it has just used: kept, but not as "now".
            if (n.iface && NOT_LAN.test(n.iface)) continue;
            this.add({ ...n, origin: 'neigh', last: n.state === 'STALE' ? now - 300 : now });
          }
        } catch {
          // No `ip`: the neighbour table is simply not read.
        }
      }
      let leases = 0;
      for (const file of this.files) {
        try {
          const text = await readFile(file, 'utf8');
          const parsed = /^lease\s/m.test(text) ? parseIsc(text) : parseDnsmasq(text);
          for (const l of parsed) {
            if (l.expires && l.expires <= now) continue;
            this.add({ ...l, origin: 'router', last: now });
            leases++;
          }
        } catch (err) {
          this.leaseError = `${path.basename(file)}: ${(err as Error).message}`;
        }
      }
      this.leaseCount = leases;
      this.lastPoll = now;
      this.prune(now);
    } finally {
      this.polling = false;
    }
  }

  /** Adds or merges a fact; a MAC and an address that meet are one device, whichever source found them. */
  private add(f: { mac?: string; ip?: string; hostname?: string; iface?: string; network?: string; origin: DeviceOrigin; last: number; expires?: number }) {
    const mac = f.mac?.toLowerCase();
    if (mac && (mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff' || parseInt(mac.slice(0, 2), 16) & 1)) return;
    if (f.ip && (f.ip.includes(':') || SKIP_IP.test(f.ip))) return;
    let had = mac ? this.found.get(`m:${mac}`) : f.ip ? this.found.get(`i:${f.ip}`) : undefined;
    // A scan knows only the address, the neighbour table then gives its MAC: one device, not two. An address the
    // router has since given to another MAC is the other device's now.
    if (!had) {
      for (const [k, v] of this.found) {
        if (mac && v.mac === mac) {
          had = v;
          this.found.delete(k);
          break;
        }
        if (f.ip && v.ip === f.ip && (!v.mac || !mac || v.mac === mac)) {
          had = v;
          this.found.delete(k);
          break;
        }
      }
    }
    if (f.ip && mac) {
      for (const [k, v] of this.found) {
        if (v === had || v.ip !== f.ip || v.mac === mac) continue;
        delete v.ip;
        if (!v.mac || !Object.keys(v.origins).length) this.found.delete(k);
      }
    }
    if (!had) had = { origins: {} };
    if (mac) had.mac = mac;
    if (f.ip) had.ip = f.ip;
    if (f.hostname) had.hostname = f.hostname;
    if (f.iface) had.iface = f.iface;
    if (f.network) had.network = f.network;
    if (f.expires) had.expires = f.expires;
    // By its MAC once one is known (it stays the same device across addresses), else by its address.
    const key = had.mac ? `m:${had.mac}` : had.ip ? `i:${had.ip}` : '';
    if (key) this.found.set(key, had);
    const o = (had.origins[f.origin] ??= { first: f.last, last: f.last });
    o.first = Math.min(o.first, f.last);
    o.last = Math.max(o.last, f.last);
  }

  private prune(now: number): void {
    for (const [key, f] of this.found) {
      for (const [o, v] of Object.entries(f.origins) as [DeviceOrigin, { first: number; last: number }][]) {
        const keep = o === 'scan' ? KEEP.scan : o === 'router' ? KEEP.router : KEEP.neigh;
        if (now - v.last > keep) delete f.origins[o];
      }
      if (f.expires && f.expires < now - 300) delete f.origins.router;
      if (!Object.keys(f.origins).length) this.found.delete(key);
    }
  }

  private async cidr(iface: string): Promise<string | undefined> {
    try {
      const out = await this.o.run(this.o.ip, ['-o', '-4', 'addr', 'show', 'dev', iface], 5000);
      const m = /inet\s+(\d+)\.(\d+)\.(\d+)\.(\d+)\/(\d+)/.exec(out);
      if (!m) return undefined;
      const bits = Number(m[5]);
      return bits >= SCAN_BITS ? `${m[1]}.${m[2]}.${m[3]}.${m[4]}/${bits}` : `${m[1]}.${m[2]}.${m[3]}.0/${SCAN_BITS}`;
    } catch {
      return undefined;
    }
  }

  private ifaceForIp(ip?: string): string | undefined {
    if (!ip || ip.includes(':')) return undefined;
    const n = ip.split('.').map(Number);
    if (n.length !== 4) return undefined;
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      if (!addrs || NOT_LAN.test(name)) continue;
      for (const a of addrs) {
        if (a.family !== 'IPv4' || a.internal) continue;
        const [base, bits] = a.cidr?.split('/') ?? [];
        const m = base?.split('.').map(Number);
        const size = Number(bits);
        if (!m || m.length !== 4 || !Number.isInteger(size)) continue;
        const mask = size === 0 ? 0 : (0xffffffff << (32 - size)) >>> 0;
        const to = (x: number[]) => ((x[0]! << 24) | (x[1]! << 16) | (x[2]! << 8) | x[3]!) >>> 0;
        if ((to(n) & mask) === (to(m) & mask)) return name;
      }
    }
    return undefined;
  }

  /** The first real interface with an IPv4 address: what "scan this LAN" means when none is named. */
  private defaultIface(): string | undefined {
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      if (!addrs || NOT_LAN.test(name)) continue;
      if (addrs.some((a) => a.family === 'IPv4' && !a.internal)) return name;
    }
    return undefined;
  }

  private async leaseFiles(): Promise<string[]> {
    const out = new Set<string>();
    for (const f of LEASE_FILES) if (await exists(f)) out.add(f);
    for (const [dir, re] of LEASE_GLOBS) {
      try {
        for (const f of await readdir(dir)) if (re.test(f)) out.add(path.join(dir, f));
      } catch {
        // No such folder: no leases there.
      }
    }
    return [...out];
  }
}

/** What a scan sends, as the page and the docs say it (docs/sources.md). */
export const SCAN_SENDS =
  'Sends packets, only when asked: to every address of this LAN (up to 254), an ARP request and a TCP connection attempt to ports 80 and 443 (nmap -sn), then a DNS question for the names of those that answered.';

/** What reading the router does, as the page and the docs say it. */
export const ROUTER_DOES =
  'Logs in to the router, only when asked: opens its web page as its owner would, with the password saved for it, reads its list of devices (name, MAC, address, cable or Wi-Fi) and logs out. Changes nothing on the router.';

/** What Argus knew of a device before a run found it: heard by this PC, found before another way, or nothing. */
export function knownOf(f: { mac?: string; ip?: string }, before: Device[]): Pick<RunDevice, 'known' | 'device' | 'name'> {
  const mac = f.mac?.toLowerCase();
  const d = before.find((x) => (mac && x.mac?.toLowerCase() === mac) || (!mac && f.ip && x.ips.includes(f.ip))) ?? (f.ip ? before.find((x) => x.ips.includes(f.ip!) && (!mac || !x.mac)) : undefined);
  if (!d) return { known: 'new' };
  return { known: d.foundOnly ? 'found' : 'heard', device: d.id, ...(d.name && d.name !== d.id ? { name: d.name } : {}) };
}

/** A dnsmasq lease file: `<expiry> <mac> <ip> <hostname> <client-id>`, one per line. */
export function parseDnsmasq(text: string): { mac?: string; ip?: string; hostname?: string; expires?: number }[] {
  const out: { mac?: string; ip?: string; hostname?: string; expires?: number }[] = [];
  for (const line of text.split('\n')) {
    const [exp, mac, ip, hostname] = line.trim().split(/\s+/);
    if (!mac || !ip || !/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/i.test(mac) || !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) continue;
    const expires = Number(exp);
    out.push({ mac: mac.toLowerCase(), ip, ...(hostname && hostname !== '*' ? { hostname: clip(hostname) } : {}), ...(Number.isFinite(expires) && expires > 0 ? { expires } : {}) });
  }
  return out;
}

/** An ISC dhcpd lease file: `lease <ip> { hardware ethernet <mac>; client-hostname "<name>"; … }`. */
export function parseIsc(text: string): { mac?: string; ip?: string; hostname?: string; expires?: number }[] {
  const out: { mac?: string; ip?: string; hostname?: string; expires?: number }[] = [];
  for (const m of text.matchAll(/lease\s+(\d+\.\d+\.\d+\.\d+)\s*\{([\s\S]*?)\n\}/g)) {
    const body = m[2] ?? '';
    const mac = /hardware ethernet\s+([0-9a-f:]{17})/i.exec(body)?.[1]?.toLowerCase();
    const name = /client-hostname\s+"([^"]+)"/i.exec(body)?.[1];
    if (!mac && !name) continue;
    out.push({ ...(mac ? { mac } : {}), ip: m[1]!, ...(name ? { hostname: clip(name) } : {}) });
  }
  return out;
}

/**
 * `ip neigh show`: an address, its interface, its MAC and its state (only the ones with a MAC are devices). Asked of one
 * interface (`ip neigh show dev wlan0`), ip leaves the interface out of each line: it is `iface`.
 */
export function parseNeigh(text: string, iface?: string): { mac?: string; ip?: string; iface?: string; state?: string }[] {
  const out: { mac?: string; ip?: string; iface?: string; state?: string }[] = [];
  for (const line of text.split('\n')) {
    const m = /^(\S+)(?:\s+dev\s+(\S+))?(?:\s+lladdr\s+([0-9a-f:]{17}))?\s+(\S+)/i.exec(line.trim());
    if (!m?.[1] || !m[3]) continue;
    const state = m[4]?.toUpperCase();
    if (state === 'FAILED' || state === 'INCOMPLETE') continue;
    // Only IPv4: the address is what the LAN is scanned by, and a global IPv6 one would replace it and say less.
    if (m[1].includes(':') || SKIP_IP.test(m[1])) continue;
    const dev = m[2] ?? iface;
    out.push({ ip: m[1], ...(dev ? { iface: dev } : {}), mac: m[3].toLowerCase(), ...(state ? { state } : {}) });
  }
  return out;
}

/** `nmap -sn -oX -`: the hosts it found up, their addresses and the name their PTR gave. */
export function parseNmapXml(text: string): { ip: string; hostname?: string }[] {
  const out: { ip: string; hostname?: string }[] = [];
  for (const block of text.split('<host>').slice(1)) {
    const end = block.indexOf('</host>');
    const host = end >= 0 ? block.slice(0, end) : block;
    if (!/<status\s+state="up"/.test(host)) continue;
    const ip = /<address\s+addr="([^"]+)"\s+addrtype="ipv4"/.exec(host)?.[1];
    if (!ip) continue;
    const hostname = /<hostname\s+name="([^"]+)"/.exec(host)?.[1];
    out.push({ ip, ...(hostname ? { hostname: clip(hostname) } : {}) });
  }
  return out;
}

/** This machine's own MACs and IPv4 addresses: never reported as another device. */
export function machineAddresses(): { macs: string[]; ips: string[] } {
  const macs: string[] = [];
  const ips: string[] = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.mac && a.mac !== '00:00:00:00:00:00') macs.push(a.mac.toLowerCase());
      if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
    }
  }
  return { macs, ips };
}

/** A MAC a device made up (the locally administered bit): it names no maker and changes per network. */
function randomMac(mac: string): boolean {
  const first = parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(first) && (first & 2) === 2;
}

function clip(s: string): string {
  return s.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 128);
}

function run(cmd: string, args: string[], timeout = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (!err) return resolve(stdout);
      reject(new Error((err as NodeJS.ErrnoException).code === 'ENOENT' ? `${cmd} is not installed` : (stderr || err.message).trim().slice(0, 300)));
    });
  });
}

async function exists(file: string): Promise<boolean> {
  try {
    await readFile(file, { encoding: 'utf8', flag: 'r' });
    return true;
  } catch {
    return false;
  }
}
