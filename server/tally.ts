// What tshark's fields add up to: the devices on the local network, the hosts out on the internet they talk to, and
// who talks to whom. Incremental: frames go in one at a time (`add`), from a file read whole or from a capture that
// never stops, and `view()` says what they add up to so far, as often as asked.
//
// Two things can only be decided once enough has been seen. Which MAC is the way out to the internet (the router):
// the one that carries the most IPv4 addresses of other networks. And so whether a global address is a host out there
// (it came through the router) or a device's own (this PC's global IPv6). So what depends on them is kept as
// conversations (MAC and address at each end, how much, when) and worked out in `view()`, with the router as it
// stands then. Everything else (who sent how much, names, makers, the bandwidth over time) is counted as it comes.
//
// Where the names come from, in the order trusted: DHCP (the hostname a device gives when asking for an address),
// mDNS (what it announces as <name>.local), NetBIOS (Windows' name on the network). The maker comes from the MAC's
// first half (Wireshark's OUI list). Hosts out on the internet are named by the DNS answers this network got for
// them and by the server name a TLS handshake asked for (SNI). What is encrypted is not read: only who, when, how much.
//
// Bounded, because anyone on the network can talk to it (mDNS and ARP reach every PC): past `maxFlows` conversations
// the ones quiet longest are forgotten (their hosts with them), past `maxDevices` devices the quietest; each device
// keeps at most NAMES names and ADDRESSES addresses, each name at most NAME_LENGTH characters, each address at most
// DNS_NAMES names from DNS, each conversation SNI_NAMES server names; the MACs that might be a router are pruned to the
// likeliest. The bandwidth over time is kept only for the seconds and minutes that had traffic.
//
// The router is decided per interface: two uplinks (the Wi-Fi and a phone on USB) each have their own.

import type { Link } from '@organon/core/shared/entities';
import { serviceOf, serviceOfProtocol } from '../shared/services.ts';
import type { Conversation, Device, NameSource, Remote } from '../shared/types.ts';

export const FIELDS = [
  'frame.time_epoch',
  'frame.len',
  'frame.interface_name',
  'eth.src',
  'eth.dst',
  'eth.src.oui_resolved',
  'eth.dst.oui_resolved',
  'ip.src',
  'ip.dst',
  'ipv6.src',
  'ipv6.dst',
  'arp.src.hw_mac',
  'arp.src.proto_ipv4',
  'dhcp.option.hostname',
  'dhcp.option.requested_ip_address',
  'dhcp.hw.mac_addr',
  'dhcp.ip.your',
  'dns.flags.response',
  'dns.qry.name',
  'dns.resp.name',
  'dns.resp.type',
  'dns.txt',
  'dns.a',
  'dns.aaaa',
  'nbns.name',
  'nbns.addr',
  'tls.handshake.extensions_server_name',
  'tcp.srcport',
  'tcp.dstport',
  'udp.srcport',
  'udp.dstport',
  'ip.proto',
  'ipv6.nxt',
] as const;
type Field = (typeof FIELDS)[number];
/** Between a field's repeats, in tshark's output (-E aggregator). */
export const SEP = '\x1f';

const NAMES = 12;
const ADDRESSES = 16;
const NAME_LENGTH = 100;
const DNS_NAMES = 8;
const SNI_NAMES = 4;
/** Past this many MACs that carried another network's address, only the likeliest routers are kept. */
const MAYBE_ROUTERS = 256;

/** tshark's arguments for the fields, one line per frame, tab between fields. */
export function fieldArgs(): string[] {
  const args = ['-n', '-T', 'fields', '-E', 'separator=/t', '-E', 'occurrence=a', '-E', `aggregator=${SEP}`, '-E', 'quote=n'];
  for (const f of FIELDS) args.push('-e', f);
  return args;
}

/** One frame's fields, each as the list of its values. */
export type Row = Record<Field, string[]>;

export function parseLine(line: string): Row {
  const cols = line.split('\t');
  const row = {} as Row;
  FIELDS.forEach((f, i) => {
    const v = cols[i] ?? '';
    row[f] = v ? v.split(SEP).filter(Boolean) : [];
  });
  return row;
}

export interface Dissected {
  packets: number;
  bytes: number;
  devices: Device[];
  remotes: Remote[];
  links: Link[];
  conversations: Conversation[];
}

/** One way of a conversation: from a MAC and address to a MAC and address. */
interface Flow {
  /** The interface it was heard on: each has its own way out. */
  iface?: string;
  src?: string;
  dst?: string;
  ipSrc?: string;
  ipDst?: string;
  /** What it is for, by the server's port ("tcp/443"), or the protocol ("icmp"): shared/services.ts. */
  service?: string;
  /** The device ids at each end, decided as it came (a unicast MAC, or a local address with no MAC). */
  sender?: string;
  receiver?: string;
  packets: number;
  bytes: number;
  first: number;
  last: number;
  /** Server names TLS handshakes in it asked for. */
  sni?: string[];
}

/** A device as counted so far: everything but what depends on which MAC is the router. */
type Counted = Omit<Device, 'ips' | 'name' | 'summary' | 'aka' | 'role'> & { fixedIps: string[] };

export interface TallyOptions {
  /** This machine's own MAC addresses: the device with one of them is "this PC". */
  ownMacs?: string[];
  maxFlows?: number;
  maxDevices?: number;
  maxDnsNames?: number;
  /** The bandwidth over time: seconds per bucket, and how many buckets are kept, fine and coarse. */
  fine?: { step: number; count: number };
  coarse?: { step: number; count: number };
  /** Each device's day, coarser than the network's (10 minutes a bucket): 500 devices heard once a minute stay small. */
  deviceCoarse?: { step: number; count: number };
}

/**
 * Bytes over time, in buckets of `step` seconds, sent and received, the newest `count`. Only the buckets that had
 * traffic are kept (a device heard once a day costs a few numbers, not 2 × 1440), and given dense to the page.
 */
export class Series {
  readonly step: number;
  readonly count: number;
  /** The bucket index (epoch seconds / step) of the newest bucket. */
  end = 0;
  private readonly buckets = new Map<number, [number, number]>();

  constructor(step: number, count: number) {
    this.step = step;
    this.count = count;
  }

  add(time: number, sent: number, received: number) {
    const b = Math.floor(time / this.step);
    if (b > this.end) this.advance(b);
    if (b <= this.end - this.count) return;
    const v = this.buckets.get(b);
    if (v) {
      v[0] += sent;
      v[1] += received;
    } else this.buckets.set(b, [sent, received]);
  }

  /** Moves the newest bucket to `b`, dropping what falls out. */
  advance(b: number) {
    if (b <= this.end) return;
    this.end = b;
    for (const k of this.buckets.keys()) if (k <= b - this.count) this.buckets.delete(k);
  }

  /** Whether any of the newest `n` buckets had traffic. */
  active(n: number): boolean {
    for (const k of this.buckets.keys()) if (k > this.end - n) return true;
    return false;
  }

  /** The newest `n` buckets, dense, as plain data. */
  tail(n = this.count): SeriesData {
    const sent = new Array<number>(n).fill(0);
    const received = new Array<number>(n).fill(0);
    for (const [k, [s, r]] of this.buckets) {
      const i = n - 1 - (this.end - k);
      if (i < 0 || i >= n) continue;
      sent[i] = s;
      received[i] = r;
    }
    return { step: this.step, end: this.end, sent, received };
  }

  /** What is kept on disk: only the buckets with traffic. */
  sparse(): SparseSeries {
    return { step: this.step, end: this.end, buckets: [...this.buckets].map(([k, [s, r]]) => [k, s, r]) };
  }

  static from(d: SeriesData | SparseSeries, count: number): Series {
    const s = new Series(d.step, count);
    s.end = d.end;
    if ('buckets' in d) for (const [k, a, b] of d.buckets) s.buckets.set(k, [a, b]);
    else
      d.sent.forEach((v, i) => {
        const r = d.received[i] ?? 0;
        if (v || r) s.buckets.set(d.end - (d.sent.length - 1 - i), [v, r]);
      });
    s.advance(s.end + 0);
    return s;
  }
}

export interface SparseSeries {
  step: number;
  end: number;
  buckets: [number, number, number][];
}

/** A series as sent to the page and kept on disk: the newest bucket's index (epoch seconds / step), oldest first. */
export interface SeriesData {
  step: number;
  end: number;
  sent: number[];
  received: number[];
}

export class Tally {
  packets = 0;
  bytes = 0;
  /** The newest frame's time, in epoch seconds. */
  last = 0;
  private readonly own: Set<string>;
  private readonly devices = new Map<string, Counted>();
  private readonly flows = new Map<string, Flow>();
  /** Per MAC, how many frames carried IPv4 addresses of other networks: the router carries the most. */
  private readonly carriesRemote = new Map<string, number>();
  /** Names remote addresses got from DNS answers. */
  private readonly dnsNames = new Map<string, string[]>();
  readonly fine: Series;
  readonly coarse: Series;
  private readonly fineByDevice = new Map<string, Series>();
  private readonly coarseByDevice = new Map<string, Series>();
  /** Each interface's last minutes, for how fast each network moves now (not kept across restarts: it is only now). */
  private readonly fineByInterface = new Map<string, Series>();
  private readonly options: Required<Omit<TallyOptions, 'ownMacs'>>;

  constructor(options: TallyOptions = {}) {
    this.own = new Set((options.ownMacs ?? []).map((m) => m.toLowerCase()));
    this.options = {
      maxFlows: options.maxFlows ?? 20_000,
      maxDevices: options.maxDevices ?? 500,
      maxDnsNames: options.maxDnsNames ?? 50_000,
      fine: options.fine ?? { step: 1, count: 600 },
      coarse: options.coarse ?? { step: 60, count: 1440 },
      deviceCoarse: options.deviceCoarse ?? { step: 600, count: 144 },
    };
    this.fine = new Series(this.options.fine.step, this.options.fine.count);
    this.coarse = new Series(this.options.coarse.step, this.options.coarse.count);
  }

  /** Adds tshark's lines (a whole file's output). */
  addText(text: string): this {
    for (const line of text.split('\n')) if (line.trim()) this.add(parseLine(line));
    return this;
  }

  add(r: Row): void {
    const time = Number(r['frame.time_epoch'][0] ?? 0);
    const len = Number(r['frame.len'][0] ?? 0);
    this.packets++;
    this.bytes += len;
    this.last = Math.max(this.last, time);
    this.fine.add(time, len, 0);
    this.coarse.add(time, len, 0);
    const iface = r['frame.interface_name'][0] ?? '';
    if (iface) {
      let s = this.fineByInterface.get(iface);
      if (!s) this.fineByInterface.set(iface, (s = new Series(this.options.fine.step, this.options.fine.count)));
      s.add(time, len, 0);
    }
    const src = r['eth.src'][0];
    const dst = r['eth.dst'][0];
    const ipSrc = r['ip.src'][0] ?? r['ipv6.src'][0];
    const ipDst = r['ip.dst'][0] ?? r['ipv6.dst'][0];
    const s4 = r['ip.src'][0];
    const d4 = r['ip.dst'][0];
    if (src && s4 && !isLocal(s4) && isUnicastIp(s4)) this.maybeRouter(iface, src);
    if (dst && d4 && !isLocal(d4) && isUnicastIp(d4)) this.maybeRouter(iface, dst);

    // Who sent it and who it was for, on the local network.
    let sender: Counted | undefined;
    if (src && isUnicastMac(src)) sender = this.device(src, time, r['eth.src.oui_resolved'][0]);
    else if (!src && ipSrc && isLocal(ipSrc)) sender = this.deviceByIp(ipSrc, time);
    let receiver: Counted | undefined;
    if (dst && isUnicastMac(dst)) receiver = this.device(dst, time, r['eth.dst.oui_resolved'][0]);
    else if (!dst && ipDst && isLocal(ipDst)) receiver = this.deviceByIp(ipDst, time);
    if (sender) {
      sender.packets++;
      sender.bytesSent += len;
      if (iface && !sender.interfaces.includes(iface)) sender.interfaces.push(iface);
      this.series(sender.id, time, len, 0);
    }
    if (receiver) {
      receiver.packets++;
      receiver.bytesReceived += len;
      if (iface && !receiver.interfaces.includes(iface)) receiver.interfaces.push(iface);
      this.series(receiver.id, time, 0, len);
    }

    // The conversation, for what depends on the router: hosts out on the internet, addresses, links.
    if (ipSrc || ipDst) {
      const service = frameService(r);
      const key = flowKey({ iface, src, dst, ipSrc, ipDst, service });
      let f = this.flows.get(key);
      if (!f) {
        f = { iface, src, dst, ipSrc, ipDst, service, sender: sender?.id, receiver: receiver?.id, packets: 0, bytes: 0, first: time, last: time };
        this.flows.set(key, f);
        if (this.flows.size > this.options.maxFlows) this.forgetFlows();
      } else {
        // Most recently heard last, so the ones quiet longest are first in line to be forgotten.
        this.flows.delete(key);
        this.flows.set(key, f);
      }
      f.packets++;
      f.bytes += len;
      f.first = Math.min(f.first, time);
      f.last = Math.max(f.last, time);
      for (const sni of r['tls.handshake.extensions_server_name'])
        if (!f.sni?.includes(sni) && (f.sni?.length ?? 0) < SNI_NAMES) (f.sni ??= []).push(clip(sni));
    }

    // ARP: a MAC saying which address is its own.
    const arpMac = r['arp.src.hw_mac'][0];
    const arpIp = r['arp.src.proto_ipv4'][0];
    if (arpMac && arpIp && isUnicastMac(arpMac) && arpIp !== '0.0.0.0') addCapped(this.device(arpMac, time).fixedIps, arpIp);

    // DHCP: the name a device gives when it asks for an address, and the address it gets.
    const dhcpMac = r['dhcp.hw.mac_addr'][0];
    if (dhcpMac && isUnicastMac(dhcpMac)) {
      const d = this.device(dhcpMac, time);
      for (const n of r['dhcp.option.hostname']) addName(d.names, n, 'DHCP');
      const got = r['dhcp.ip.your'][0];
      if (got && got !== '0.0.0.0') addCapped(d.fixedIps, got);
      const asked = r['dhcp.option.requested_ip_address'][0];
      if (asked && asked !== '0.0.0.0' && !d.fixedIps.length) addCapped(d.fixedIps, asked);
    }

    // DNS and mDNS answers.
    if (r['dns.flags.response'][0] === 'True' || r['dns.flags.response'][0] === '1') {
      if (r['dns.resp.name'].some((n) => n.endsWith('.local'))) {
        if (sender) mdnsNames(sender, r);
      } else {
        const asked = r['dns.qry.name'][0];
        if (asked) {
          for (const ip of [...r['dns.a'], ...r['dns.aaaa']]) {
            const list = this.dnsNames.get(ip);
            if (list) {
              if (!list.includes(asked) && list.length < DNS_NAMES) list.push(clip(asked));
            } else {
              this.dnsNames.set(ip, [clip(asked)]);
              if (this.dnsNames.size > this.options.maxDnsNames) this.dnsNames.delete(this.dnsNames.keys().next().value!);
            }
          }
        }
      }
    }

    // NetBIOS: Windows' name, said by broadcast ("DESKTOP-STUDY<00>").
    if (r['nbns.name'].length && sender) {
      for (const n of r['nbns.name']) {
        const name = /^([^<]+)<00>/.exec(n)?.[1]?.trim();
        if (name && name !== '*' && !/^WORKGROUP$/i.test(name)) addName(sender.names, name, 'NetBIOS');
      }
    }
  }

  /** The MAC that is the way out to the internet on each interface, as things stand. */
  gateways(): Map<string, string> {
    const best = new Map<string, [string, number]>();
    for (const [key, count] of this.carriesRemote) {
      const [iface = '', mac = ''] = key.split('|');
      const b = best.get(iface);
      if (!b || count > b[1]) best.set(iface, [mac, count]);
    }
    return new Map([...best].map(([iface, [mac]]) => [iface, mac]));
  }

  /** Counts a MAC that carried another network's address, on an interface; prunes to the likeliest past the ceiling. */
  private maybeRouter(iface: string, mac: string) {
    const key = `${iface}|${mac}`;
    this.carriesRemote.set(key, (this.carriesRemote.get(key) ?? 0) + 1);
    if (this.carriesRemote.size <= MAYBE_ROUTERS) return;
    const keep = [...this.carriesRemote].sort((a, b) => b[1] - a[1]).slice(0, MAYBE_ROUTERS / 8);
    this.carriesRemote.clear();
    for (const [k, v] of keep) this.carriesRemote.set(k, v);
  }

  /** What it all adds up to so far. */
  view(): Dissected {
    const gateways = this.gateways();
    const routers = new Set(gateways.values());
    /**
     * Whether `ip`, on the side of the frame whose MAC is `mac`, is a host out on the internet: an address of another
     * network that came through the way out. The same address behind another MAC is that device's own (this PC's
     * global IPv6), and with no Ethernet at all (a VPN) any address not of a private range is out there.
     */
    const outside = (ip: string | undefined, mac: string | undefined, iface: string | undefined) => {
      const gateway = gateways.get(iface ?? '');
      return Boolean(ip && isUnicastIp(ip) && !isLocal(ip) && (!mac || !gateway || mac === gateway));
    };
    const ips = new Map<string, string[]>();
    const remotes = new Map<string, Remote>();
    const links = new Map<string, Link>();
    const conversations = new Map<string, Conversation>();
    /** A flow's share of the conversation between a device here and `b`: `out` when the device is the one sending. */
    const talk = (a: string, b: string, f: Flow, out: boolean) => {
      const service = f.service ?? '';
      // Between two devices here, one conversation whichever way: under the pair as it was first met.
      const back = conversations.get(`${b} ${a} ${service}`);
      if (back && b.startsWith('device:')) [a, b, out] = [b, a, !out];
      const id = `${a} ${b} ${service}`;
      let c = conversations.get(id);
      if (!c) {
        c = { id, a, b, service, interfaces: [], sent: 0, received: 0, packets: 0, first: f.first, last: f.last };
        conversations.set(id, c);
      }
      if (out) c.sent += f.bytes;
      else c.received += f.bytes;
      c.packets += f.packets;
      c.first = Math.min(c.first, f.first);
      c.last = Math.max(c.last, f.last);
      if (f.iface && !c.interfaces.includes(f.iface)) c.interfaces.push(f.iface);
    };
    const remote = (ip: string, f: Flow): Remote => {
      let h = remotes.get(ip);
      if (!h) {
        h = { kind: 'remote', id: ip, name: ip, ip, names: [], packets: 0, bytesSent: 0, bytesReceived: 0, firstSeen: f.first, lastSeen: f.last };
        remotes.set(ip, h);
      }
      h.firstSeen = Math.min(h.firstSeen, f.first);
      h.lastSeen = Math.max(h.lastSeen, f.last);
      return h;
    };
    const link = (from: string, to: string, bytes: number) => {
      const key = `${from}>${to}`;
      const l = links.get(key) ?? { from, to, rel: 'talks-to', weight: 0 };
      l.weight = (l.weight ?? 0) + bytes;
      links.set(key, l);
    };
    const ipOf = (id: string, ip: string) => {
      const list = ips.get(id) ?? [];
      if (!list.includes(ip) && list.length < ADDRESSES) list.push(ip);
      ips.set(id, list);
    };

    for (const f of this.flows.values()) {
      const srcOut = outside(f.ipSrc, f.src, f.iface);
      const dstOut = outside(f.ipDst, f.dst, f.iface);
      if (f.sender && f.ipSrc && !srcOut && isUnicastIp(f.ipSrc)) ipOf(f.sender, f.ipSrc);
      if (f.receiver && f.ipDst && !dstOut && isUnicastIp(f.ipDst)) ipOf(f.receiver, f.ipDst);
      if (f.ipSrc && srcOut) {
        const h = remote(f.ipSrc, f);
        h.packets += f.packets;
        h.bytesSent += f.bytes;
        if (f.receiver) {
          link(`device:${f.receiver}`, `remote:${h.id}`, f.bytes);
          talk(`device:${f.receiver}`, `remote:${h.id}`, f, false);
        }
      }
      if (f.ipDst && dstOut) {
        const h = remote(f.ipDst, f);
        h.packets += f.packets;
        h.bytesReceived += f.bytes;
        if (f.sender) {
          link(`device:${f.sender}`, `remote:${h.id}`, f.bytes);
          talk(`device:${f.sender}`, `remote:${h.id}`, f, true);
        }
        for (const sni of f.sni ?? []) addName(h.names, sni, 'TLS');
      }
      // Two local devices talking to each other (not through the way out to the internet).
      if (f.sender && f.receiver && f.ipSrc && f.ipDst && !srcOut && !dstOut) {
        link(`device:${f.sender}`, `device:${f.receiver}`, f.bytes);
        talk(`device:${f.sender}`, `device:${f.receiver}`, f, true);
      }
    }

    for (const [ip, names] of this.dnsNames) {
      const h = remotes.get(ip);
      if (h) for (const n of names) addName(h.names, n, 'DNS');
    }
    const devices: Device[] = [];
    for (const c of this.devices.values()) {
      const { fixedIps, ...rest } = c;
      const d: Device = { ...rest, names: [...c.names], interfaces: [...c.interfaces], ips: [...(ips.get(c.id) ?? [])], name: '' };
      for (const ip of fixedIps) if (d.ips.length < ADDRESSES) addTo(d.ips, ip);
      if (d.mac && this.own.has(d.mac)) d.role = 'self';
      else if (d.mac && routers.has(d.mac)) d.role = 'gateway';
      d.ips.sort(compareIp);
      d.name = deviceName(d);
      d.aka = [...d.names.map((n) => n.name), ...d.ips, ...(d.mac ? [d.mac] : [])];
      d.summary = deviceSummary(d);
      devices.push(d);
    }
    for (const h of remotes.values()) {
      h.name = h.names[0]?.name ?? h.ip;
      h.aka = [h.ip, ...h.names.map((n) => n.name)];
      h.summary = h.names.length ? h.ip : 'No name seen';
    }
    const byTraffic = <T extends { bytesSent: number; bytesReceived: number }>(a: T, b: T) =>
      b.bytesSent + b.bytesReceived - (a.bytesSent + a.bytesReceived);
    return {
      packets: this.packets,
      bytes: this.bytes,
      devices: devices.sort(byTraffic),
      remotes: [...remotes.values()].sort(byTraffic),
      links: [...links.values()],
      conversations: [...conversations.values()],
    };
  }

  /** A device's bandwidth over time, fine (the last minutes) and coarse (the day); only the newest `fine` buckets if asked. */
  deviceSeries(id: string, fine?: number): { fine?: SeriesData; coarse?: SeriesData } {
    return { fine: this.fineByDevice.get(id)?.tail(fine), coarse: fine ? undefined : this.coarseByDevice.get(id)?.tail() };
  }

  /** Each interface's fine series, whole, or only its newest `n` buckets. */
  byInterface(n?: number): Record<string, SeriesData> {
    return Object.fromEntries([...this.fineByInterface].map(([id, s]) => [id, s.tail(n)]));
  }

  /** The newest `n` fine buckets of the devices that had traffic in them: what the page is sent each second. */
  recentByDevice(n: number): Record<string, SeriesData> {
    const out: Record<string, SeriesData> = {};
    for (const [id, s] of this.fineByDevice) if (s.active(n)) out[id] = s.tail(n);
    return out;
  }

  /** The fine series of the devices that had traffic in the last `seconds`: what a page loads. */
  activeByDevice(seconds: number): Record<string, SeriesData> {
    const out: Record<string, SeriesData> = {};
    for (const [id, s] of this.fineByDevice) if (s.active(Math.ceil(seconds / s.step))) out[id] = s.tail();
    return out;
  }

  /** Moves every series to `now` (epoch seconds), so a quiet second reads as zero rather than as the last busy one. */
  tick(now: number) {
    for (const s of [this.fine, ...this.fineByDevice.values(), ...this.fineByInterface.values()]) s.advance(Math.floor(now / s.step));
    for (const s of [this.coarse, ...this.coarseByDevice.values()]) s.advance(Math.floor(now / s.step));
  }

  /** Everything, as plain data: kept on disk so a restart (a release) picks up where it was. */
  save(): TallyData {
    return {
      packets: this.packets,
      bytes: this.bytes,
      last: this.last,
      devices: [...this.devices.values()],
      flows: [...this.flows.values()],
      carriesRemote: [...this.carriesRemote],
      dnsNames: [...this.dnsNames],
      fine: this.fine.sparse(),
      coarse: this.coarse.sparse(),
      fineByDevice: [...this.fineByDevice].map(([id, s]) => [id, s.sparse()]),
      coarseByDevice: [...this.coarseByDevice].map(([id, s]) => [id, s.sparse()]),
    };
  }

  static load(d: TallyData, options: TallyOptions = {}): Tally {
    const t = new Tally(options);
    t.packets = d.packets;
    t.bytes = d.bytes;
    t.last = d.last;
    for (const c of d.devices) t.devices.set(c.id, c);
    for (const f of d.flows) t.flows.set(flowKey(f), f);
    // A session from before routers were per interface: its MACs were keyed alone.
    for (const [k, v] of d.carriesRemote) t.carriesRemote.set(k.includes('|') ? k : `${d.flows[0]?.iface ?? ''}|${k}`, v);
    for (const [k, v] of d.dnsNames) t.dnsNames.set(k, v);
    const fine = t.options.fine.count;
    const coarse = t.options.coarse.count;
    Object.assign(t, { fine: Series.from(d.fine, fine), coarse: Series.from(d.coarse, coarse) });
    for (const [id, s] of d.fineByDevice) t.fineByDevice.set(id, Series.from(s, fine));
    // A day kept at the network's step (before devices had their own) is read at its own step, and moves on to the new one.
    for (const [id, s] of d.coarseByDevice) t.coarseByDevice.set(id, Series.from(s, s.step === t.options.deviceCoarse.step ? t.options.deviceCoarse.count : coarse));
    return t;
  }

  private device(mac: string, time: number, vendor?: string): Counted {
    let d = this.devices.get(mac);
    if (!d) {
      d = {
        kind: 'device',
        id: mac,
        mac,
        fixedIps: [],
        vendor,
        randomMac: isRandomMac(mac),
        names: [],
        interfaces: [],
        packets: 0,
        bytesSent: 0,
        bytesReceived: 0,
        firstSeen: time,
        lastSeen: time,
      };
      this.devices.set(mac, d);
      if (this.devices.size > this.options.maxDevices) this.forgetDevice();
    }
    if (!d.vendor && vendor) d.vendor = vendor;
    d.firstSeen = Math.min(d.firstSeen, time);
    d.lastSeen = Math.max(d.lastSeen, time);
    return d;
  }

  /** A local device with no MAC on the wire (a VPN, loopback): by its address. */
  private deviceByIp(ip: string, time: number): Counted {
    const d = this.device(`ip:${ip}`, time);
    d.mac = undefined;
    d.randomMac = false;
    addTo(d.fixedIps, ip);
    return d;
  }

  private series(id: string, time: number, sent: number, received: number) {
    let f = this.fineByDevice.get(id);
    if (!f) this.fineByDevice.set(id, (f = new Series(this.options.fine.step, this.options.fine.count)));
    let c = this.coarseByDevice.get(id);
    if (!c) this.coarseByDevice.set(id, (c = new Series(this.options.deviceCoarse.step, this.options.deviceCoarse.count)));
    f.add(time, sent, received);
    c.add(time, sent, received);
  }

  /** The tenth of the conversations quiet longest (the map keeps them in the order they were last heard). */
  private forgetFlows() {
    const n = Math.ceil(this.options.maxFlows / 10);
    let i = 0;
    for (const key of this.flows.keys()) {
      if (i++ >= n) break;
      this.flows.delete(key);
    }
  }

  /** The device quiet longest, with its series. */
  private forgetDevice() {
    let oldest: Counted | undefined;
    for (const d of this.devices.values()) if (!oldest || d.lastSeen < oldest.lastSeen) oldest = d;
    if (!oldest) return;
    this.devices.delete(oldest.id);
    this.fineByDevice.delete(oldest.id);
    this.coarseByDevice.delete(oldest.id);
  }
}

export interface TallyData {
  packets: number;
  bytes: number;
  last: number;
  devices: Counted[];
  flows: Flow[];
  carriesRemote: [string, number][];
  dnsNames: [string, string[]][];
  fine: SeriesData | SparseSeries;
  coarse: SeriesData | SparseSeries;
  fineByDevice: [string, SeriesData | SparseSeries][];
  coarseByDevice: [string, SeriesData | SparseSeries][];
}

function flowKey(f: Pick<Flow, 'iface' | 'src' | 'dst' | 'ipSrc' | 'ipDst' | 'service'>): string {
  return `${f.iface ?? ''}|${f.src ?? ''}|${f.dst ?? ''}|${f.ipSrc ?? ''}|${f.ipDst ?? ''}|${f.service ?? ''}`;
}

/** A frame's service: by its TCP or UDP ports, else by IP's protocol number (ICMP), else none. */
function frameService(r: Row): string | undefined {
  const port = (f: Field) => Number(r[f][0] ?? Number.NaN);
  const [ts, td, us, ud] = [port('tcp.srcport'), port('tcp.dstport'), port('udp.srcport'), port('udp.dstport')];
  if (ts >= 0 && td >= 0) return serviceOf('tcp', ts, td);
  if (us >= 0 && ud >= 0) return serviceOf('udp', us, ud);
  // IPv6's next header may be an extension header before the protocol: the last one listed is the protocol's.
  const proto = Number(r['ip.proto'][0] ?? r['ipv6.nxt'].at(-1) ?? Number.NaN);
  return Number.isFinite(proto) ? serviceOfProtocol(proto) : undefined;
}

/** A name from the network, at most NAME_LENGTH characters, its control characters out. */
function clip(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return clean.length > NAME_LENGTH ? `${clean.slice(0, NAME_LENGTH - 1)}…` : clean;
}

/** Adds up a whole file's lines at once (a recording, a capture saved from the live one). */
export function tally(text: string, ownMacs: string[]): Dissected {
  return new Tally({ ownMacs }).addText(text).view();
}

/**
 * What a device says of itself over mDNS. Google Cast and others put the name people gave it in a TXT record (fn=)
 * and the model in md=; a host record (A, AAAA) names it by <host>.local, unless the host is a UUID. Service names
 * (_googlecast._tcp) and the instance names built on them are what it offers, not what it is called.
 */
function mdnsNames(d: Counted, r: Row) {
  for (const txt of r['dns.txt']) {
    const [k, ...v] = txt.split('=');
    const value = v.join('=').trim();
    if (k === 'fn' && value) addName(d.names, value, 'mDNS');
    if (k === 'md' && value) d.model ??= value;
  }
  r['dns.resp.name'].forEach((name, i) => {
    const type = r['dns.resp.type'][i];
    if (type !== '1' && type !== '28') return;
    const host = name.replace(/\.local$/, '');
    if (host.startsWith('_') || /^[0-9a-f]{8}(-?[0-9a-f]{4}){3}-?[0-9a-f]{12}$/i.test(host) || host.includes('._')) return;
    addName(d.names, host, 'mDNS');
  });
}

/** The name he would give it: its own name first, else what it is. */
function deviceName(d: Device): string {
  if (d.role === 'self') return d.names[0]?.name ? `${d.names[0].name} (this PC)` : 'This PC';
  // A device may call itself anything, "Router" or "This PC" too: then the end of its MAC says it is another one.
  if (d.names[0]) return /^(router|this pc)\b/i.test(d.names[0].name) ? `${d.names[0].name} ·${(d.mac ?? d.ips[0] ?? '').slice(-5)}` : d.names[0].name;
  if (d.role === 'gateway') return d.vendor ? `Router ${shortVendor(d.vendor)}` : 'Router';
  const tail = d.mac ? d.mac.slice(-5) : (d.ips[0] ?? '');
  if (d.vendor) return `${shortVendor(d.vendor)} ·${tail}`;
  if (d.randomMac) return `Private device ·${tail}`;
  return `Device ·${tail}`;
}

function deviceSummary(d: Device): string {
  const parts = [d.role === 'gateway' ? 'The way out to the internet' : d.role === 'self' ? 'This computer' : ''];
  if (d.model) parts.push(d.model);
  if (d.vendor) parts.push(`made by ${d.vendor}`);
  else if (d.randomMac) parts.push('Random MAC (the maker cannot be seen)');
  if (d.ips.length) parts.push(d.ips.join(', '));
  return parts.filter(Boolean).join('; ');
}

/** "Tp-Link Technologies Co.,Ltd." → "Tp-Link". */
export function shortVendor(v: string): string {
  return (
    v
      .replace(/[,.]?\s*(Inc|Ltd|Co|Corp|Corporation|Corporate|Technologies|Technology|Electronics|Foundation|GmbH|S\.?A|LLC|Limited)\b\.?/gi, '')
      .replace(/[\s,.]+$/, '')
      .trim() || v
  );
}

function addTo(list: string[], v: string) {
  if (!list.includes(v)) list.push(v);
}

function addCapped(list: string[], v: string) {
  if (list.length < ADDRESSES) addTo(list, v);
}

const RANK: Record<NameSource, number> = { DHCP: 0, mDNS: 1, NetBIOS: 2, DNS: 3, TLS: 4 };

/** A name, in the order trusted (DHCP, mDNS, NetBIOS, then DNS and TLS), at most NAMES of them. */
function addName(names: { name: string; source: NameSource }[], name: string, source: NameSource) {
  const n = clip(name);
  if (!n || names.length >= NAMES || names.some((x) => x.name.toLowerCase() === n.toLowerCase())) return;
  const at = names.findIndex((x) => RANK[x.source] > RANK[source]);
  names.splice(at === -1 ? names.length : at, 0, { name: n, source });
}

/** Not a group address (broadcast, multicast: the first byte's lowest bit). */
export function isUnicastMac(mac: string): boolean {
  const b = Number.parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(b) && (b & 1) === 0 && mac !== '00:00:00:00:00:00';
}

/** A MAC made up by the device (locally administered: the first byte's second bit), as phones do per network. */
export function isRandomMac(mac: string): boolean {
  const b = Number.parseInt(mac.slice(0, 2), 16);
  return Number.isFinite(b) && (b & 2) === 2;
}

/** On this network: private, link-local, carrier-grade NAT (Tailscale), loopback; IPv6 link-local and unique local. */
export function isLocal(ip: string): boolean {
  if (ip.includes(':')) return /^(fe[89ab]|f[cd]|::1$)/i.test(ip);
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b < 128) || a === 0;
}

/** Not broadcast or multicast, and not "no address yet". */
export function isUnicastIp(ip: string): boolean {
  if (ip.includes(':')) return !/^ff/i.test(ip) && ip !== '::';
  const [a = 0, , , d = 0] = ip.split('.').map(Number);
  return ip !== '0.0.0.0' && ip !== '255.255.255.255' && !(a >= 224 && a < 240) && !(isLocal(ip) && d === 255);
}

function compareIp(a: string, b: string): number {
  const v4 = (s: string) => (s.includes(':') ? Number.MAX_SAFE_INTEGER : s.split('.').reduce((n, p) => n * 256 + Number(p), 0));
  return v4(a) - v4(b) || a.localeCompare(b);
}
