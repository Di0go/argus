// A capture file read into the devices and hosts it shows. tshark does the dissection and reports fields
// (-T fields, one line per frame, tab between fields, \x1f between a field's repeats); this file only adds them up:
// who sent and received how much, which addresses each MAC uses, and what each device calls itself.
//
// Where the names come from, in the order trusted: DHCP (the hostname a device gives when asking for an address),
// mDNS (what it announces as <name>.local), NetBIOS (Windows' name on the network). The maker comes from the MAC's
// first half (Wireshark's OUI list). Hosts out on the internet are named by the DNS answers this network got for
// them and by the server name a TLS handshake asked for (SNI). What is encrypted is not read: only who, when, how much.

import { spawn } from 'node:child_process';
import type { Link } from '@organon/core/shared/entities';
import type { Device, NameSource, Remote } from '../shared/types.ts';

const FIELDS = [
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
] as const;
type Field = (typeof FIELDS)[number];
const SEP = '\x1f';

export interface Dissected {
  packets: number;
  bytes: number;
  devices: Device[];
  remotes: Remote[];
  links: Link[];
}

export interface DissectOptions {
  tshark: string;
  /** This machine's own MAC addresses: the device with one of them is "this PC". */
  ownMacs?: string[];
}

export class DissectError extends Error {}

/** Runs tshark over `file` and adds up what it saw. */
export async function dissect(file: string, options: DissectOptions): Promise<Dissected> {
  const args = ['-r', file, '-n', '-T', 'fields', '-E', 'separator=/t', '-E', 'occurrence=a', '-E', `aggregator=${SEP}`, '-E', 'quote=n'];
  for (const f of FIELDS) args.push('-e', f);
  const out = await run(options.tshark, args);
  return tally(out, options.ownMacs ?? []);
}

function run(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let err = '';
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', (e) => reject(new DissectError(`tshark could not run (${cmd}): ${e.message}`)));
    child.on('close', (code) => {
      // tshark exits 2 on a capture cut short (the last packet half written): what it read is still good.
      if (code !== 0 && !(code === 2 && out.length)) return reject(new DissectError(`tshark failed (${code}): ${err.trim().slice(0, 500)}`));
      resolve(Buffer.concat(out).toString('utf8'));
    });
  });
}

/** One frame's fields, each as the list of its values. */
type Row = Record<Field, string[]>;

function parse(line: string): Row {
  const cols = line.split('\t');
  const row = {} as Row;
  FIELDS.forEach((f, i) => {
    const v = cols[i] ?? '';
    row[f] = v ? v.split(SEP).filter(Boolean) : [];
  });
  return row;
}

/** Adds up tshark's lines. Exported for the tests, which feed it lines of their own. */
export function tally(text: string, ownMacs: string[]): Dissected {
  const own = new Set(ownMacs.map((m) => m.toLowerCase()));
  const devices = new Map<string, Device>();
  const remotes = new Map<string, Remote>();
  const links = new Map<string, Link>();
  /** MACs that carried addresses of other networks: the way out. */
  const carriesRemote = new Map<string, number>();
  let packets = 0;
  let bytes = 0;

  const device = (mac: string, time: number, vendor?: string): Device => {
    let d = devices.get(mac);
    if (!d) {
      d = {
        kind: 'device',
        id: mac,
        name: '',
        mac,
        ips: [],
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
      devices.set(mac, d);
    }
    if (!d.vendor && vendor) d.vendor = vendor;
    d.firstSeen = Math.min(d.firstSeen, time);
    d.lastSeen = Math.max(d.lastSeen, time);
    return d;
  };
  /** A local device with no MAC on the wire (a VPN, loopback): by its address. */
  const deviceByIp = (ip: string, time: number) => {
    const d = device(`ip:${ip}`, time);
    d.mac = undefined;
    d.randomMac = false;
    addIp(d, ip);
    return d;
  };
  const remote = (ip: string, time: number): Remote => {
    let r = remotes.get(ip);
    if (!r) {
      r = { kind: 'remote', id: ip, name: ip, ip, names: [], packets: 0, bytesSent: 0, bytesReceived: 0, firstSeen: time, lastSeen: time };
      remotes.set(ip, r);
    }
    r.firstSeen = Math.min(r.firstSeen, time);
    r.lastSeen = Math.max(r.lastSeen, time);
    return r;
  };
  const link = (from: string, to: string, len: number) => {
    const key = `${from}>${to}`;
    const l = links.get(key) ?? { from, to, rel: 'talks-to', weight: 0 };
    l.weight = (l.weight ?? 0) + len;
    links.set(key, l);
  };
  /** Names a remote address got from DNS answers, kept until its traffic shows up (often just after). */
  const dnsNames = new Map<string, Set<string>>();

  const rows = text
    .split('\n')
    .filter((l) => l.trim())
    .map(parse);
  // First, the way out: the MAC that carries the most IPv4 addresses of other networks (IPv4 alone can say so, since
  // a global IPv6 address may as well be a device's own here).
  for (const r of rows) {
    const [src, dst] = [first(r['eth.src']), first(r['eth.dst'])];
    const [s4, d4] = [first(r['ip.src']), first(r['ip.dst'])];
    if (src && s4 && !isLocal(s4) && isUnicastIp(s4)) carriesRemote.set(src, (carriesRemote.get(src) ?? 0) + 1);
    if (dst && d4 && !isLocal(d4) && isUnicastIp(d4)) carriesRemote.set(dst, (carriesRemote.get(dst) ?? 0) + 1);
  }
  const gateway = [...carriesRemote.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  /**
   * Whether `ip`, on the side of the frame whose MAC is `mac`, is a host out on the internet: an address of another
   * network that came through the way out. The same address behind another MAC is that device's own (this PC's
   * global IPv6), and with no Ethernet at all (a VPN) any address not of a private range is out there.
   */
  const outside = (ip: string | undefined, mac: string | undefined) =>
    Boolean(ip && isUnicastIp(ip) && !isLocal(ip) && (!mac || !gateway || mac === gateway));

  for (const r of rows) {
    const time = Number(r['frame.time_epoch'][0] ?? 0);
    const len = Number(r['frame.len'][0] ?? 0);
    packets++;
    bytes += len;
    const iface = r['frame.interface_name'][0];
    const src = first(r['eth.src']);
    const dst = first(r['eth.dst']);
    const ipSrc = first(r['ip.src']) ?? first(r['ipv6.src']);
    const ipDst = first(r['ip.dst']) ?? first(r['ipv6.dst']);

    // Who sent it, on the local network.
    let sender: Device | undefined;
    if (src && isUnicastMac(src)) sender = device(src, time, first(r['eth.src.oui_resolved']));
    else if (!src && ipSrc && isLocal(ipSrc)) sender = deviceByIp(ipSrc, time);
    let receiver: Device | undefined;
    if (dst && isUnicastMac(dst)) receiver = device(dst, time, first(r['eth.dst.oui_resolved']));
    else if (!dst && ipDst && isLocal(ipDst)) receiver = deviceByIp(ipDst, time);
    const srcOut = outside(ipSrc, src);
    const dstOut = outside(ipDst, dst);
    if (sender) {
      sender.packets++;
      sender.bytesSent += len;
      if (iface && !sender.interfaces.includes(iface)) sender.interfaces.push(iface);
      if (ipSrc && !srcOut && isUnicastIp(ipSrc)) addIp(sender, ipSrc);
    }
    if (receiver) {
      receiver.packets++;
      receiver.bytesReceived += len;
      if (iface && !receiver.interfaces.includes(iface)) receiver.interfaces.push(iface);
      if (ipDst && !dstOut && isUnicastIp(ipDst)) addIp(receiver, ipDst);
    }

    // Hosts out on the internet, and which local device carried them.
    if (ipSrc && srcOut) {
      const h = remote(ipSrc, time);
      h.packets++;
      h.bytesSent += len;
      if (receiver) link(`device:${receiver.id}`, `remote:${h.id}`, len);
    }
    if (ipDst && dstOut) {
      const h = remote(ipDst, time);
      h.packets++;
      h.bytesReceived += len;
      if (sender) link(`device:${sender.id}`, `remote:${h.id}`, len);
      // The server name a TLS handshake asks for names the host it goes to.
      for (const sni of r['tls.handshake.extensions_server_name']) addName(h.names, sni, 'TLS');
    }
    // Two local devices talking to each other (not through the way out to the internet).
    if (sender && receiver && ipSrc && ipDst && !srcOut && !dstOut) link(`device:${sender.id}`, `device:${receiver.id}`, len);

    // ARP: a MAC saying which address is its own.
    const arpMac = first(r['arp.src.hw_mac']);
    const arpIp = first(r['arp.src.proto_ipv4']);
    if (arpMac && arpIp && isUnicastMac(arpMac) && arpIp !== '0.0.0.0') addIp(device(arpMac, time), arpIp);

    // DHCP: the name a device gives when it asks for an address, and the address it gets.
    const dhcpMac = first(r['dhcp.hw.mac_addr']);
    if (dhcpMac && isUnicastMac(dhcpMac)) {
      const d = device(dhcpMac, time);
      for (const n of r['dhcp.option.hostname']) addName(d.names, n, 'DHCP');
      const got = first(r['dhcp.ip.your']);
      if (got && got !== '0.0.0.0') addIp(d, got);
      const asked = first(r['dhcp.option.requested_ip_address']);
      if (asked && asked !== '0.0.0.0' && !d.ips.length) addIp(d, asked);
    }

    // DNS and mDNS answers.
    if (r['dns.flags.response'][0] === 'True' || r['dns.flags.response'][0] === '1') {
      const answers = [...r['dns.a'], ...r['dns.aaaa']];
      if (r['dns.resp.name'].some((n) => n.endsWith('.local'))) {
        if (sender) mdnsNames(sender, r);
      } else {
        const asked = first(r['dns.qry.name']);
        if (asked) {
          for (const ip of answers) {
            const set = dnsNames.get(ip) ?? new Set<string>();
            set.add(asked);
            dnsNames.set(ip, set);
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

  for (const [ip, names] of dnsNames) {
    const h = remotes.get(ip);
    if (h) for (const n of names) addName(h.names, n, 'DNS');
  }
  for (const d of devices.values()) {
    if (d.mac && own.has(d.mac)) d.role = 'self';
    else if (d.mac && d.mac === gateway) d.role = 'gateway';
    d.ips.sort(compareIp);
    d.name = deviceName(d);
    d.aka = [...d.names.map((n) => n.name), ...d.ips, ...(d.mac ? [d.mac] : [])];
    d.summary = deviceSummary(d);
  }
  for (const h of remotes.values()) {
    h.name = h.names[0]?.name ?? h.ip;
    h.aka = [h.ip, ...h.names.map((n) => n.name)];
    h.summary = h.names.length ? `${h.ip} na internet` : 'Na internet, sem nome visto';
  }
  const byTraffic = <T extends { bytesSent: number; bytesReceived: number }>(a: T, b: T) =>
    b.bytesSent + b.bytesReceived - (a.bytesSent + a.bytesReceived);
  return {
    packets,
    bytes,
    devices: [...devices.values()].sort(byTraffic),
    remotes: [...remotes.values()].sort(byTraffic),
    links: [...links.values()],
  };
}

/**
 * What a device says of itself over mDNS. Google Cast and others put the name people gave it in a TXT record (fn=)
 * and the model in md=; a host record (A, AAAA) names it by <host>.local, unless the host is a UUID. Service names
 * (_googlecast._tcp) and the instance names built on them are what it offers, not what it is called.
 */
function mdnsNames(d: Device, r: Row) {
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
  if (d.role === 'self') return d.names[0]?.name ? `${d.names[0].name} (este PC)` : 'Este PC';
  if (d.names[0]) return d.names[0].name;
  if (d.role === 'gateway') return d.vendor ? `Router ${shortVendor(d.vendor)}` : 'Router';
  const tail = d.mac ? d.mac.slice(-5) : (d.ips[0] ?? '');
  if (d.vendor) return `${shortVendor(d.vendor)} ·${tail}`;
  if (d.randomMac) return `Dispositivo privado ·${tail}`;
  return `Dispositivo ·${tail}`;
}

function deviceSummary(d: Device): string {
  const parts = [d.role === 'gateway' ? 'A saída para a internet' : d.role === 'self' ? 'Este computador' : ''];
  if (d.model) parts.push(d.model);
  if (d.vendor) parts.push(`fabricante ${d.vendor}`);
  else if (d.randomMac) parts.push('MAC aleatória (o fabricante não se vê)');
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

function first(values: string[]): string | undefined {
  return values[0];
}

function addIp(d: Device, ip: string) {
  if (!d.ips.includes(ip)) d.ips.push(ip);
}

function addName(names: { name: string; source: NameSource }[], name: string, source: NameSource) {
  const n = name.trim();
  if (n && !names.some((x) => x.name.toLowerCase() === n.toLowerCase())) names.push({ name: n, source });
  // Keep the order trusted: DHCP, mDNS, NetBIOS, then DNS and TLS.
  const rank: Record<NameSource, number> = { DHCP: 0, mDNS: 1, NetBIOS: 2, DNS: 3, TLS: 4 };
  names.sort((a, b) => rank[a.source] - rank[b.source]);
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
