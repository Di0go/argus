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
//
// Which network each frame was on is a fact kept here and read by the server (shared/networks.ts): the interface's
// stays (`Segment`). A stay begins where this PC joined a network afresh: it asked DHCP for an address from nothing
// (0.0.0.0, as on every join and return), the system said another SSID (`ssid`), or its frames for the internet went
// through another MAC while the one before had been quiet for VIA_GAP seconds (a move with a fixed address). Each stay
// keeps the MACs this PC's internet frames went through (its way out) and the SSIDs said during it; every flow and
// every device's presence (`heard`) says which stay it was in. What makes two stays one network is the server's to say.

import type { Link } from '@organon/core/shared/entities';
import { CLEAR, tlsVersion } from '../shared/security.ts';
import { serviceOf, serviceOfProtocol } from '../shared/services.ts';
import type { Conversation, Device, Heard, HttpRequest, NameSource, Network, Remote, Segment } from '../shared/types.ts';
import { REQUEST_FIELDS, Requests } from './requests.ts';

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
  'frame.protocols',
  // What a device says of what it is (shared/identify.ts), and how safe a conversation is (shared/security.ts).
  'dhcp.option.vendor_class_id',
  'dhcp.option.request_list_item',
  'http.user_agent',
  'http.host',
  'http.authorization',
  'ftp.request.command',
  'pop.request.command',
  'imap.request.command',
  'smtp.req.command',
  'tls.handshake.type',
  'tls.handshake.version',
  'tls.handshake.extensions.supported_version',
  'tls.handshake.ja4',
  'dns.ptr.domain_name',
  // The HTTP requests that went by, in the clear or inside TLS read with its keys (server/requests.ts).
  ...REQUEST_FIELDS,
] as const;
type Field = (typeof FIELDS)[number];
/** Between a field's repeats, in tshark's output (-E aggregator). */
export const SEP = '\x1f';

const NAMES = 12;
const ADDRESSES = 16;
const NAME_LENGTH = 100;
const DNS_NAMES = 8;
const SNI_NAMES = 4;
const SSDP_ASKERS = 64;
/** Per device: user agents, JA4 fingerprints, mDNS services, DHCP vendor classes kept. */
const CLUES = 6;
const SERVICES = 12;
/** The commands that log in, on the mail and file protocols that carry them in the clear. */
const LOGIN = /^(PASS|APOP|LOGIN|AUTHENTICATE|AUTH)$/i;
/** Past this many MACs that carried another network's address, only the likeliest routers are kept. */
const MAYBE_ROUTERS = 256;
/**
 * A way out is not only the busiest: after a move to another network (a laptop between home and office) the old router
 * stays the busiest of the session for hours, and the new one would read as a device talking to "hosts with no name".
 * So a MAC that frames were sent through to this many other networks' addresses is a way out too: a router is sent
 * frames for the whole internet, a host with a public address of its own only for that one address, and a device that
 * makes up addresses can make up what it sends, not where the others send theirs. This PC is never one.
 */
const WAY_OUT_HOSTS = 8;
/**
 * Seconds without this PC's internet frames through its way out after which frames through another MAC begin another
 * stay (a move with a fixed address); within them, the other MAC is a second way out of the same stay (IPv4 through one
 * router and IPv6 through another).
 */
const VIA_GAP = 30;
/** Stays kept, the oldest forgotten past it (a year of nights asleep), and per device the stays it is said in. */
const SEGMENTS = 1000;
const HEARD = 12;

/**
 * The fields asked for: all of FIELDS that this tshark knows. An older one without a field (JA4 came in Wireshark
 * 4.2) refuses to start when asked for it, so what it does not know is left out (useFields) and reads as empty.
 */
let asked: readonly Field[] = FIELDS;

/** Leaves out the fields this tshark does not know (`known`: the names `tshark -G fields` lists); returns those left out. */
export function useFields(known: Set<string>): Field[] {
  const missing = FIELDS.filter((f) => !known.has(f));
  asked = known.size ? FIELDS.filter((f) => known.has(f)) : FIELDS;
  return known.size ? missing : [];
}

/**
 * tshark's arguments for the fields, one line per frame, tab between fields; with `keylog`, the TLS key log file it
 * reads the sessions' keys from (it need not exist yet: tshark reads it as it grows), so what is inside the TLS of the
 * programs that write it is dissected too (server/requests.ts).
 */
export function fieldArgs(keylog?: string): string[] {
  const args = [...(keylog ? ['-o', `tls.keylog_file:${keylog}`] : []), '-n', '-T', 'fields', '-E', 'separator=/t', '-E', 'occurrence=a', '-E', `aggregator=${SEP}`, '-E', 'quote=n'];
  for (const f of asked) args.push('-e', f);
  return args;
}

/** One frame's fields, each as the list of its values. */
export type Row = Record<Field, string[]>;

export function parseLine(line: string): Row {
  const cols = line.split('\t');
  const row = {} as Row;
  for (const f of FIELDS) row[f] = [];
  asked.forEach((f, i) => {
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
  /** The stays on each interface, oldest first: which network each frame was on is read from them (shared/networks.ts). */
  segments?: Segment[];
  /** The interfaces being listened on now (the live session only). */
  listening?: string[];
  /** The server's reading of the stays (shared/networks.ts): never the sensor's. */
  networks?: Network[];
  /** The HTTP requests read, oldest first (server/requests.ts). */
  requests?: HttpRequest[];
}

/** One way of a conversation: from a MAC and address to a MAC and address. */
interface Flow {
  /** The interface it was heard on: each has its own way out. */
  iface?: string;
  /** The stay on that interface it was heard in (Segment.id). */
  segment?: string;
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
  /** Server names TLS handshakes in it asked for, and plain HTTP's Host. */
  sni?: string[];
  httpHost?: string[];
  /** What tshark recognised it as, above TCP or UDP ("wg", "stun", "quic"): what the port alone may not say. */
  protocol?: string;
  /** A protocol that carries content in the clear (shared/security.ts: "HTTP"), and whether a login went by in it. */
  clear?: string;
  credentials?: boolean;
  /** TLS was seen in it (STARTTLS turns a mail conversation safe), and the version the server agreed. */
  tlsSeen?: boolean;
  tls?: string;
  /** Inside its TLS was dissected, with the session's keys: HTTP was read in it. */
  read?: boolean;
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
  /** The HTTP requests kept, the newest (server/requests.ts). */
  maxRequests?: number;
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
  /** The stays, oldest first, and each interface's current one. */
  private segments: Segment[] = [];
  private readonly current = new Map<string, Segment>();
  /** How many stays each interface has had: the next one's number. */
  private readonly counts = new Map<string, number>();
  private readonly flows = new Map<string, Flow>();
  /** Per MAC, how many frames carried IPv4 addresses of other networks: the router carries the most. */
  private readonly carriesRemote = new Map<string, number>();
  /** Per interface and MAC, a few of the other networks' addresses frames were sent to through it (WAY_OUT_HOSTS). */
  private readonly sentThrough = new Map<string, Set<string>>();
  /** Names remote addresses got from DNS answers. */
  private readonly dnsNames = new Map<string, string[]>();
  /**
   * The addresses and ports that asked SSDP who is there (M-SEARCH to port 1900): the answers come back to them from
   * any port, and are SSDP too, though neither port says so. Only the newest SSDP_ASKERS.
   */
  private readonly ssdpAskers = new Set<string>();
  readonly fine: Series;
  readonly coarse: Series;
  private readonly fineByDevice = new Map<string, Series>();
  private readonly coarseByDevice = new Map<string, Series>();
  /** Each interface's last minutes, for how fast each network moves now (not kept across restarts: it is only now). */
  private readonly fineByInterface = new Map<string, Series>();
  private readonly options: Required<Omit<TallyOptions, 'ownMacs'>>;
  readonly requests: Requests;

  constructor(options: TallyOptions = {}) {
    this.own = new Set((options.ownMacs ?? []).map((m) => m.toLowerCase()));
    this.options = {
      maxFlows: options.maxFlows ?? 20_000,
      maxDevices: options.maxDevices ?? 500,
      maxDnsNames: options.maxDnsNames ?? 50_000,
      fine: options.fine ?? { step: 1, count: 600 },
      coarse: options.coarse ?? { step: 60, count: 1440 },
      deviceCoarse: options.deviceCoarse ?? { step: 600, count: 144 },
      maxRequests: options.maxRequests ?? 2000,
    };
    this.requests = new Requests(this.options.maxRequests);
    this.fine = new Series(this.options.fine.step, this.options.fine.count);
    this.coarse = new Series(this.options.coarse.step, this.options.coarse.count);
  }

  /** This machine's MACs, every one it had while this tally counted. */
  ownMacs(): string[] {
    return [...this.own];
  }

  /** MACs that are this machine's too (a Wi-Fi that makes one up per network, a dock plugged in): kept from then on. */
  addOwn(macs: string[]) {
    for (const m of macs) if (m) this.own.add(m.toLowerCase());
  }

  /**
   * What the system says the Wi-Fi on `iface` is associated with now (nothing: not associated). Another SSID than the
   * current stay's begins another stay.
   */
  ssid(iface: string, name: string | undefined, time: number) {
    if (!name) return;
    let seg = this.current.get(iface);
    if (seg?.ssids && !(name in seg.ssids)) seg = this.newSegment(iface, time, 'ssid');
    seg ??= this.newSegment(iface, time);
    (seg.ssids ??= {})[name] = (seg.ssids[name] ?? 0) + 1;
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
    if (dst && d4 && !isLocal(d4) && isUnicastIp(d4)) {
      this.maybeRouter(iface, dst);
      this.through(iface, dst, d4);
    }
    const seg = this.stay(r, iface, time, len, src, dst, ipSrc, ipDst);

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
      this.heard(sender, seg, time, len, 0);
    }
    if (receiver) {
      receiver.packets++;
      receiver.bytesReceived += len;
      if (iface && !receiver.interfaces.includes(iface)) receiver.interfaces.push(iface);
      this.series(receiver.id, time, 0, len);
      this.heard(receiver, seg, time, 0, len);
    }

    // The conversation, for what depends on the router: hosts out on the internet, addresses, links.
    if (ipSrc || ipDst) {
      const service = this.ssdp(r, ipSrc, ipDst) ?? frameService(r);
      const key = flowKey({ iface, segment: seg.id, src, dst, ipSrc, ipDst, service });
      let f = this.flows.get(key);
      if (!f) {
        f = { iface, segment: seg.id, src, dst, ipSrc, ipDst, service, sender: sender?.id, receiver: receiver?.id, packets: 0, bytes: 0, first: time, last: time };
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
      // The name plain HTTP asked for (its Host, without the port): what the connection was for, as SNI is for TLS.
      for (const host of r['http.host']) {
        const name = clip(host.replace(/:\d+$/, ''));
        if (name && !/^[\d.]+$|^\[/.test(name) && !f.httpHost?.includes(name) && (f.httpHost?.length ?? 0) < SNI_NAMES) (f.httpHost ??= []).push(name);
      }
      f.protocol ??= frameProtocol(r);
      this.security(r, f, sender);
      const layers = r['frame.protocols'][0]?.split(':') ?? [];
      if (layers.includes('http') || layers.includes('http2')) {
        if (layers.includes('tls')) f.read = true;
        const port = (k: Field) => Number(r[k][0]) || undefined;
        this.requests.add((k) => r[k as Field] ?? [], {
          time,
          iface,
          segment: seg.id,
          sender: sender?.id,
          // The one that answered is named only when it is here (a NAS): out there it is the router's MAC that carried it.
          receiver: ipDst && isLocal(ipDst) ? receiver?.id : undefined,
          ipSrc,
          ipDst,
          srcPort: port('tcp.srcport'),
          dstPort: port('tcp.dstport'),
          layers,
        });
      }
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
      // What it asks with says what system it runs: option 60, and the list of options it wants (55), in its order.
      // Only from the device's own requests (an answer carries the server's).
      if (sender === d) {
        const clues = (d.clues ??= {});
        for (const c of r['dhcp.option.vendor_class_id']) if (!clues.dhcpClass?.includes(c) && (clues.dhcpClass?.length ?? 0) < CLUES) (clues.dhcpClass ??= []).push(clip(c));
        if (r['dhcp.option.request_list_item'].length) clues.dhcpParams = r['dhcp.option.request_list_item'].slice(0, 40).join(',');
      }
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
      (sender.clues ??= {}).netbios = true;
    }
  }

  /**
   * What a frame says of how safe its conversation is: content in the clear, a login in it (that one went by, never
   * what it was), the TLS version a server agreed; and what its sender says of itself (User-Agent, its TLS client's
   * JA4). The values of Authorization and of the login commands' arguments are never kept.
   */
  private security(r: Row, f: Flow, sender: Counted | undefined) {
    const layers = r['frame.protocols'][0]?.split(':') ?? [];
    // Inside TLS read with its keys (HTTPS decrypted) is not in the clear, and a login in it went encrypted.
    const inTls = layers.includes('tls');
    if (inTls) f.tlsSeen = true;
    const clear = inTls ? undefined : layers.map((l) => CLEAR[l]).find(Boolean);
    if (clear && !f.clear) f.clear = clear;
    if (
      !inTls &&
      (r['http.authorization'].length ||
        [...r['ftp.request.command'], ...r['pop.request.command'], ...r['imap.request.command'], ...r['smtp.req.command']].some((c) => LOGIN.test(c)))
    )
      f.credentials = true;
    const types = r['tls.handshake.type'];
    // A ServerHello (2): the version it chose, in supported_versions for TLS 1.3, else in the hello itself.
    if (types.includes('2')) f.tls = tlsVersion(r['tls.handshake.extensions.supported_version'].at(-1) ?? r['tls.handshake.version'][0]) ?? f.tls;
    if (!sender) return;
    for (const ua of r['http.user_agent']) addClue(sender, 'userAgents', clip(ua));
    if (types.includes('1')) for (const j of r['tls.handshake.ja4']) addClue(sender, 'ja4', clip(j));
  }

  /**
   * The stay a frame on `iface` belongs to, begun afresh where this PC joined a network (the header says when), with the
   * way out its internet frames went through noted.
   */
  private stay(r: Row, iface: string, time: number, len: number, src?: string, dst?: string, ipSrc?: string, ipDst?: string): Segment {
    let seg = this.current.get(iface) ?? this.newSegment(iface, time);
    const mine = (m?: string) => Boolean(m && this.own.has(m));
    // This PC asking for an address from nothing: it is joining a network (a new one, or this one again after a sleep).
    if (mine(src) && ipSrc === '0.0.0.0' && r['udp.dstport'][0] === '67' && (seg.vias.length || seg.ssids)) seg = this.newSegment(iface, time, 'dhcp');
    // Its way out: the MAC it sent frames for the internet to (where this PC sends is its own doing: no one else on the
    // network can make it up). One host's frames may go to a neighbour with a public address of its own; a way out is
    // sent frames for two hosts or more.
    const via = mine(src) && dst && isUnicastMac(dst) && !mine(dst) && ipDst && isUnicastIp(ipDst) && !isLocal(ipDst) ? dst : undefined;
    let v = via ? seg.vias.find((x) => x.mac === via) : undefined;
    if (via && !v) {
      const one = (seg.once ??= {})[via];
      if (!one) seg.once[via] = ipDst!;
      else if (one !== ipDst) {
        if (seg.vias.length && Math.max(...seg.vias.map((x) => x.last)) < time - VIA_GAP) seg = this.newSegment(iface, time, 'via');
        delete seg.once?.[via];
        seg.vias.push((v = { mac: via, frames: 1, last: time }));
      }
    }
    if (v) {
      v.frames++;
      v.last = Math.max(v.last, time);
    }
    seg.packets++;
    seg.bytes += len;
    seg.first = Math.min(seg.first, time);
    seg.last = Math.max(seg.last, time);
    return seg;
  }

  private newSegment(iface: string, time: number, began?: Segment['began']): Segment {
    const n = (this.counts.get(iface) ?? 0) + 1;
    this.counts.set(iface, n);
    const seg: Segment = { id: `${iface}#${n}`, iface, first: time, last: time, packets: 0, bytes: 0, vias: [], ...(began ? { began } : {}) };
    this.segments.push(seg);
    this.current.set(iface, seg);
    if (this.segments.length > SEGMENTS) this.segments.shift();
    return seg;
  }

  /** A device heard in a stay; past HEARD stays, those of the same way out become one (the newest), else the oldest goes. */
  private heard(d: Counted, seg: Segment, time: number, sent: number, received: number) {
    const list = (d.heard ??= []);
    let h = list.find((x) => x.segment === seg.id);
    if (!h) {
      h = { segment: seg.id, first: time, last: time, packets: 0, sent: 0, received: 0 };
      list.push(h);
      if (list.length > HEARD) this.fold(list);
    }
    h.packets++;
    h.sent += sent;
    h.received += received;
    h.first = Math.min(h.first, time);
    h.last = Math.max(h.last, time);
  }

  private fold(list: Heard[]) {
    const byId = new Map(this.segments.map((s) => [s.id, s]));
    const way = (h: Heard) => byId.get(h.segment)?.vias[0]?.mac;
    for (let i = 0; i < list.length - 1; i++) {
      const w = way(list[i]!);
      const j = w ? list.findIndex((x, k) => k > i && way(x) === w) : -1;
      if (j < 0) continue;
      const [a, b] = [list[i]!, list[j]!];
      b.first = Math.min(a.first, b.first);
      b.last = Math.max(a.last, b.last);
      b.packets += a.packets;
      b.sent += a.sent;
      b.received += a.received;
      list.splice(i, 1);
      return;
    }
    list.splice(list.reduce((o, x, k) => (x.last < list[o]!.last ? k : o), 0), 1);
  }

  /**
   * The MACs that are the way out to the internet on each interface: where this PC sent its frames for it, and any
   * other sent frames for many addresses; on an interface where this PC sent none, the busiest carrier too.
   */
  gateways(): Map<string, Set<string>> {
    const best = new Map<string, [string, number]>();
    const out = new Map<string, Set<string>>();
    for (const [key, count] of this.carriesRemote) {
      const [iface = '', mac = ''] = key.split('|');
      const b = best.get(iface);
      if (!b || count > b[1]) best.set(iface, [mac, count]);
      if ((this.sentThrough.get(key)?.size ?? 0) >= WAY_OUT_HOSTS && !this.own.has(mac)) out.set(iface, (out.get(iface) ?? new Set()).add(mac));
    }
    // Each stay's: where this PC sent its frames for the internet. Where it did, that is the way out, and the busiest
    // carrier is not (a neighbour with a public address it talks to a lot would be); where it never did (a mirror
    // port, this PC's Docker bridge), the busiest is.
    const known = new Set<string>();
    for (const g of this.segments)
      for (const v of g.vias) {
        out.set(g.iface, (out.get(g.iface) ?? new Set()).add(v.mac));
        known.add(g.iface);
      }
    for (const [iface, [mac]] of best) if (!known.has(iface)) out.set(iface, (out.get(iface) ?? new Set()).add(mac));
    return out;
  }

  /** "udp/1900" for an SSDP question, and for an answer to one; else nothing. */
  private ssdp(r: Row, ipSrc?: string, ipDst?: string): string | undefined {
    const [sp, dp] = [r['udp.srcport'][0], r['udp.dstport'][0]];
    if (!sp || !dp) return undefined;
    if (dp === '1900' && ipSrc) {
      const key = `${ipSrc}|${sp}`;
      this.ssdpAskers.delete(key);
      this.ssdpAskers.add(key);
      if (this.ssdpAskers.size > SSDP_ASKERS) this.ssdpAskers.delete(this.ssdpAskers.values().next().value!);
      return 'udp/1900';
    }
    return ipDst && this.ssdpAskers.has(`${ipDst}|${dp}`) ? 'udp/1900' : undefined;
  }

  /** Notes an address of another network a frame was sent to through a MAC, up to as many as tell a way out. */
  private through(iface: string, mac: string, ip: string) {
    const key = `${iface}|${mac}`;
    const s = this.sentThrough.get(key);
    if (s) {
      if (s.size < WAY_OUT_HOSTS) s.add(ip);
      return;
    }
    this.sentThrough.set(key, new Set([ip]));
    // Bounded like the routers: the MACs with the most addresses stay.
    if (this.sentThrough.size <= MAYBE_ROUTERS) return;
    const keep = [...this.sentThrough].sort((a, b) => b[1].size - a[1].size).slice(0, MAYBE_ROUTERS / 8);
    this.sentThrough.clear();
    for (const [k, v] of keep) this.sentThrough.set(k, v);
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
    const routers = new Set([...gateways.values()].flatMap((g) => [...g]));
    /**
     * Whether `ip`, on the side of the frame whose MAC is `mac`, is a host out on the internet: an address of another
     * network that came through the way out. The same address behind another MAC is that device's own (this PC's
     * global IPv6), and with no Ethernet at all (a VPN) any address not of a private range is out there.
     */
    const outside = (ip: string | undefined, mac: string | undefined, iface: string | undefined) => {
      const gateway = gateways.get(iface ?? '');
      return Boolean(ip && isUnicastIp(ip) && !isLocal(ip) && (!mac || !gateway || gateway.has(mac)));
    };
    const ips = new Map<string, string[]>();
    const remotes = new Map<string, Remote>();
    const links = new Map<string, Link>();
    const conversations = new Map<string, Conversation>();
    /** A flow's share of the conversation between a device here and `b`: `out` when the device is the one sending. */
    // One per pair, service and stay (the server joins the stays of one network: shared/networks.ts).
    const talk = (a: string, b: string, f: Flow, out: boolean) => {
      const service = f.service ?? '';
      const stay = f.segment ? ` ${f.segment}` : '';
      // Between two devices here, one conversation whichever way: under the pair as it was first met.
      const back = conversations.get(`${b} ${a} ${service}${stay}`);
      if (back && b.startsWith('device:')) [a, b, out] = [b, a, !out];
      const id = `${a} ${b} ${service}${stay}`;
      let c = conversations.get(id);
      if (!c) {
        c = { id, a, b, service, interfaces: [], sent: 0, received: 0, packets: 0, first: f.first, last: f.last, ...(f.segment ? { segment: f.segment } : {}) };
        conversations.set(id, c);
      }
      if (f.protocol && !c.protocol) c.protocol = f.protocol;
      // In the clear unless TLS was seen in it (a mail conversation that went on to STARTTLS).
      if (f.clear && !f.tlsSeen) c.clear = { proto: f.clear, ...(f.credentials || c.clear?.credentials ? { credentials: true } : {}) };
      if (f.tls) c.tls = f.tls;
      if (f.read) c.read = true;
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
        for (const host of f.httpHost ?? []) addName(h.names, host, 'HTTP');
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
      if (c.heard) d.heard = c.heard.map((h) => ({ ...h }));
      if (c.clues) d.clues = structuredClone(c.clues);
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
      segments: this.segments.map((g) => ({ ...g, vias: g.vias.map((v) => ({ ...v })), ...(g.ssids ? { ssids: { ...g.ssids } } : {}) })),
      // Copies: the server reads them (their network) without touching what the sensor keeps.
      requests: this.requests.all().map((q) => ({ ...q })),
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
      sentThrough: [...this.sentThrough].map(([k, v]) => [k, [...v]]),
      dnsNames: [...this.dnsNames],
      fine: this.fine.sparse(),
      coarse: this.coarse.sparse(),
      fineByDevice: [...this.fineByDevice].map(([id, s]) => [id, s.sparse()]),
      coarseByDevice: [...this.coarseByDevice].map(([id, s]) => [id, s.sparse()]),
      segments: this.segments,
      current: Object.fromEntries([...this.current].map(([iface, g]) => [iface, g.id])),
      counts: Object.fromEntries(this.counts),
      own: [...this.own],
      requests: this.requests.save(),
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
    for (const [k, v] of d.sentThrough ?? []) t.sentThrough.set(k, new Set(v.slice(0, WAY_OUT_HOSTS)));
    // A session kept before the hosts sent through were: the router it had stays a way out, whoever is busiest later.
    if (!d.sentThrough) for (const [iface, macs] of t.gateways()) for (const mac of macs) t.sentThrough.set(`${iface}|${mac}`, new Set(Array.from({ length: WAY_OUT_HOSTS }, (_, i) => `kept ${i}`)));
    for (const [k, v] of d.dnsNames) t.dnsNames.set(k, v);
    t.addOwn(d.own ?? []);
    if (Array.isArray(d.requests)) t.requests.load(d.requests);
    if (d.segments) {
      t.segments = d.segments;
      for (const [iface, n] of Object.entries(d.counts ?? {})) t.counts.set(iface, n);
      for (const [iface, id] of Object.entries(d.current ?? {})) {
        const g = t.segments.find((x) => x.id === id);
        if (g) t.current.set(iface, g);
      }
    } else t.stays();
    const fine = t.options.fine.count;
    const coarse = t.options.coarse.count;
    Object.assign(t, { fine: Series.from(d.fine, fine), coarse: Series.from(d.coarse, coarse) });
    for (const [id, s] of d.fineByDevice) t.fineByDevice.set(id, Series.from(s, fine));
    // A day kept at the network's step (before devices had their own) is read at its own step, and moves on to the new one.
    for (const [id, s] of d.coarseByDevice) t.coarseByDevice.set(id, Series.from(s, s.step === t.options.deviceCoarse.step ? t.options.deviceCoarse.count : coarse));
    return t;
  }

  /**
   * A session kept before stays were: each told from its routers. A flow through a way out was in the stay of that
   * router, on its interface, over the times its flows ran (joined where less than STAY_GAP apart); any other flow, and
   * each device, in the stay that holds its time (else the nearest) on its interface. Where no router was seen (a VPN),
   * the interface is one stay. What was said in which stay is so read from where the frames went, never guessed.
   */
  private stays() {
    const STAY_GAP = 1800;
    const gateways = this.gateways();
    const out = (ip?: string) => Boolean(ip && isUnicastIp(ip) && !isLocal(ip));
    const viaOf = (f: Flow) => {
      const g = gateways.get(f.iface ?? '');
      return g && f.dst && g.has(f.dst) && out(f.ipDst) ? f.dst : g && f.src && g.has(f.src) && out(f.ipSrc) ? f.src : undefined;
    };
    const spans = new Map<string, { iface: string; mac?: string; first: number; last: number; frames: number }[]>();
    const flows = [...this.flows.values()].sort((a, b) => a.first - b.first);
    for (const f of flows) {
      const mac = viaOf(f);
      if (!mac) continue;
      const k = `${f.iface ?? ''}|${mac}`;
      const list = spans.get(k) ?? spans.set(k, []).get(k)!;
      const s = list.at(-1);
      if (s && f.first <= s.last + STAY_GAP) {
        s.last = Math.max(s.last, f.last);
        s.frames += f.packets;
      } else list.push({ iface: f.iface ?? '', mac, first: f.first, last: f.last, frames: f.packets });
    }
    // An interface with flows but no router: one stay.
    for (const f of flows) {
      const iface = f.iface ?? '';
      if ([...spans.keys()].some((k) => k.startsWith(`${iface}|`))) continue;
      const k = `${iface}|`;
      const list = spans.get(k) ?? spans.set(k, [{ iface, first: f.first, last: f.last, frames: 0 }]).get(k)!;
      list[0]!.first = Math.min(list[0]!.first, f.first);
      list[0]!.last = Math.max(list[0]!.last, f.last);
    }
    for (const s of [...spans.values()].flat().sort((a, b) => a.first - b.first)) {
      const g = this.newSegment(s.iface, s.first);
      g.last = s.last;
      if (s.mac) g.vias.push({ mac: s.mac, frames: s.frames, last: s.last });
    }
    const on = (iface: string, mac: string | undefined, t: number) => {
      const list = this.segments.filter((g) => g.iface === iface && (!mac || g.vias.some((v) => v.mac === mac)));
      const gap = (g: Segment) => (t < g.first ? g.first - t : t > g.last ? t - g.last : 0);
      return list.sort((a, b) => gap(a) - gap(b))[0];
    };
    for (const g of this.segments) {
      g.packets = 0;
      g.bytes = 0;
    }
    for (const d of this.devices.values()) d.heard = [];
    for (const f of flows) {
      const g = on(f.iface ?? '', viaOf(f), f.first) ?? on(f.iface ?? '', undefined, f.first);
      if (!g) continue;
      const key = flowKey(f);
      this.flows.delete(key);
      f.segment = g.id;
      this.flows.set(flowKey(f), f);
      g.packets += f.packets;
      g.bytes += f.bytes;
      for (const [id, sent] of [
        [f.sender, true],
        [f.receiver, false],
      ] as const) {
        const d = id ? this.devices.get(id) : undefined;
        if (!d) continue;
        const h = d.heard!.find((x) => x.segment === g.id) ?? (d.heard!.push({ segment: g.id, first: f.first, last: f.last, packets: 0, sent: 0, received: 0 }), d.heard!.at(-1)!);
        h.first = Math.min(h.first, f.first);
        h.last = Math.max(h.last, f.last);
        h.packets += f.packets;
        if (sent) h.sent += f.bytes;
        else h.received += f.bytes;
      }
    }
    for (const d of this.devices.values()) {
      if (d.heard?.length) continue;
      const g = on(d.interfaces[0] ?? '', undefined, d.lastSeen);
      d.heard = g ? [{ segment: g.id, first: d.firstSeen, last: d.lastSeen, packets: d.packets, sent: d.bytesSent, received: d.bytesReceived }] : [];
      if (!g) delete d.heard;
    }
    for (const d of this.devices.values()) while ((d.heard?.length ?? 0) > HEARD) this.fold(d.heard!);
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
  /** Absent in a session kept before it was: then only the busiest is a way out, as it was. */
  sentThrough?: [string, string[]][];
  dnsNames: [string, string[]][];
  fine: SeriesData | SparseSeries;
  coarse: SeriesData | SparseSeries;
  fineByDevice: [string, SeriesData | SparseSeries][];
  coarseByDevice: [string, SeriesData | SparseSeries][];
  /** Absent in a session kept before stays were: then they are told from its routers (Tally.stays). */
  segments?: Segment[];
  current?: Record<string, string>;
  counts?: Record<string, number>;
  /** The MACs that were this machine's (a Wi-Fi's made-up one stays its own after it changes). */
  own?: string[];
  /** The HTTP requests kept (server/requests.ts); absent in a session kept before they were read. */
  requests?: HttpRequest[];
}

function flowKey(f: Pick<Flow, 'iface' | 'segment' | 'src' | 'dst' | 'ipSrc' | 'ipDst' | 'service'>): string {
  return `${f.iface ?? ''}|${f.segment ?? ''}|${f.src ?? ''}|${f.dst ?? ''}|${f.ipSrc ?? ''}|${f.ipDst ?? ''}|${f.service ?? ''}`;
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

/**
 * What tshark recognised a frame as, above TCP or UDP: "eth:ethertype:ip:udp:wg" → "wg". Not "data" (it did not
 * know), and only a name of its own kind, never anything else that came in the frame.
 */
function frameProtocol(r: Row): string | undefined {
  const layers = (r['frame.protocols'][0] ?? '').split(':');
  const i = layers.findIndex((l) => l === 'tcp' || l === 'udp');
  const p = i < 0 ? undefined : layers[i + 1];
  return p && p !== 'data' && /^[a-z0-9._-]{1,32}$/.test(p) ? p : undefined;
}

/** A name from the network, at most NAME_LENGTH characters, its control characters out. */
function clip(name: string): string {
  const clean = name.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  return clean.length > NAME_LENGTH ? `${clean.slice(0, NAME_LENGTH - 1)}…` : clean;
}

/** Adds up a whole file's lines at once (a recording, a capture saved from the live one): the facts, unread. */
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
    if ((k === 'md' || k === 'model') && value) d.model ??= clip(value);
  }
  // The services it offers: the PTR records' names that are service types (_googlecast._tcp.local), and the types
  // its instances belong to (Living Room._googlecast._tcp.local).
  for (const name of [...r['dns.resp.name'], ...r['dns.ptr.domain_name']]) {
    const type = /(?:^|\.)(_[a-z0-9-]{1,30}\._(?:tcp|udp))\.local$/i.exec(name)?.[1]?.toLowerCase();
    if (!type || type === '_services._dns-sd._udp' || type.startsWith('_sub')) continue;
    const services = ((d.clues ??= {}).services ??= []);
    if (!services.includes(type) && services.length < SERVICES) services.push(type);
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
  if (d.role === 'self') return d.names[0]?.name ? `${d.names[0].name} (this PC)` : d.mac?.startsWith('02:42:') ? 'This PC (Docker bridge)' : 'This PC';
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

/** A clue a device gave, at most CLUES of each kind. */
function addClue(d: Counted, key: 'userAgents' | 'ja4', v: string) {
  const list = ((d.clues ??= {})[key] ??= []);
  if (v && !list.includes(v) && list.length < CLUES) list.push(v);
}

function addTo(list: string[], v: string) {
  if (!list.includes(v)) list.push(v);
}

function addCapped(list: string[], v: string) {
  if (list.length < ADDRESSES) addTo(list, v);
}

const RANK: Record<NameSource, number> = { DHCP: 0, mDNS: 1, NetBIOS: 2, DNS: 3, TLS: 4, HTTP: 4 };

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
