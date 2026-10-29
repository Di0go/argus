// pnpm check:leaks [--history] [--listen <seconds>]: nothing in the repository says whose network this is.
//
// It fails on:
// - a value of this machine's network: an address, MAC or interface name of this PC, a neighbour it knows (ip addr,
//   ip link, ip neigh), a device the live session saw (data/live/session.json: its MACs, addresses and names), the
//   name of a Wi-Fi it has been on (the session's and the history's, NetworkManager's saved ones, the one of now), and
//   with --listen the names the network announces for that many seconds (DHCP, mDNS, NetBIOS); also the device half
//   of a real MAC under another maker, an address on one of this PC's own subnets, the /48 its IPv6 addresses are
//   under, or its interface ID at the end of another address; the user's name, home path and e-mail (git config);
// - a private address (10/8, 172.16/12, 192.168/16, 100.64/10, IPv6 unique local) outside the fixtures (tests/, the
//   fixture and the demo), which use those and the documentation ranges (192.0.2.0/24, 198.51.100.0/24,
//   203.0.113.0/24, 2001:db8::/32);
// - with --history, the same in every file of every commit of every ref, in every commit message, and an author or
//   committer e-mail that is not a noreply one; each finding says which refs reach it (a local tag is not on GitHub).
//
// The real values are read from the machine each time and never written anywhere: on a machine without them (or
// without `ip`) only the rules on private and public addresses apply. Captures (pcap, pcapng) are read with tshark
// -V; pictures with tesseract when it is there, else only their bytes.

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isIPv4, isIPv6 } from 'node:net';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const HISTORY = args.includes('--history');
const LISTEN = Number(args[args.indexOf('--listen') + 1]) || 0;
const repo = args.includes('--repo') ? path.resolve(args[args.indexOf('--repo') + 1]!) : ROOT;

/** Where an address may be private: the made-up networks of the tests, the fixture and the demo. */
const FIXTURES = [/^tests\//, /^scripts\/make-fixture\.ts$/, /^scripts\/demo(-tshark|-ip|-nmap)?\.ts$/];
/** Interface names every Linux machine has, or that say nothing of this one. */
const GENERIC_IFACE = /^(lo|any|eth\d|wlan\d|docker0|tailscale0|virbr0)$/;

const run = (cmd: string, a: string[], input?: Buffer) => {
  const r = spawnSync(cmd, a, { cwd: repo, input, maxBuffer: 1 << 30 });
  return r.status === 0 ? r.stdout : undefined;
};
const json = (cmd: string, a: string[]): any[] => {
  try {
    return JSON.parse(run(cmd, a)?.toString() || '[]');
  } catch {
    return [];
  }
};

// ---- IPv4 and IPv6 as numbers, to compare and to test ranges.

const v4 = (s: string) => s.split('.').reduce((n, p) => n * 256 + Number(p), 0);
const in4 = (ip: string, net: string, bits: number) => bits === 0 || Math.floor(v4(ip) / 2 ** (32 - bits)) === Math.floor(v4(net) / 2 ** (32 - bits));
/** Eight groups of four hex digits. */
function expand6(s: string): string[] {
  const t = s.toLowerCase().split('%')[0]!;
  const [head = '', tail = ''] = t.split('::');
  const a = head ? head.split(':') : [];
  const b = t.includes('::') && tail ? tail.split(':') : [];
  const groups = t.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  return groups.map((g) => g.padStart(4, '0'));
}
/** 10/8, 172.16/12, 192.168/16, 100.64/10 (written as numbers, so this file has no address in it). */
const PRIVATE4 = [[[10, 0], 8], [[172, 16], 12], [[192, 168], 16], [[100, 64], 10]] as const;
const private4 = (ip: string) => PRIVATE4.some(([[a, b], bits]) => in4(ip, `${a}.${b}.0.0`, bits));
const global6 = (g: string[]) => (Number.parseInt(g[0]!, 16) & 0xe000) === 0x2000;
const ula6 = (g: string[]) => (Number.parseInt(g[0]!, 16) & 0xfe00) === 0xfc00;

// ---- What this machine knows of its network, read now.

type Real = {
  ip4: Set<string>;
  nets4: { net: string; bits: number }[];
  ip6: Set<string>;
  prefixes6: Set<string>;
  iids6: Set<string>;
  macs: Set<string>;
  macTails: Set<string>;
  ifaces: Set<string>;
  names: { why: string; re: RegExp }[];
};

function readReal(): Real {
  const r: Real = { ip4: new Set(), nets4: [], ip6: new Set(), prefixes6: new Set(), iids6: new Set(), macs: new Set(), macTails: new Set(), ifaces: new Set(), names: [] };
  const mac = (m?: string) => {
    if (!m || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(m) || /^(00:){5}00$|^ff:/i.test(m)) return;
    r.macs.add(m.toLowerCase());
    r.macTails.add(m.toLowerCase().slice(9));
  };
  const ip = (a?: string, bits?: number) => {
    if (!a) return;
    if (isIPv4(a) && !a.startsWith('127.') && a !== '0.0.0.0') {
      r.ip4.add(a);
      if (bits !== undefined && bits < 32 && private4(a)) r.nets4.push({ net: a, bits: Math.max(bits, 16) });
    } else if (isIPv6(a)) {
      const g = expand6(a);
      if (g.join(':') === '0000:0000:0000:0000:0000:0000:0000:0001') return;
      r.ip6.add(g.join(':'));
      // A Tailscale address is under a prefix every Tailscale user shares: only the address itself is his.
      if (global6(g)) r.prefixes6.add(g.slice(0, 3).join(':'));
      // An interface ID set by hand (::1, ::2: a router's fe80::1) is everyone's, not his.
      if ((global6(g) || g[0] === 'fe80') && !/^(0000:){3}/.test(g.slice(4).join(':'))) r.iids6.add(g.slice(4).join(':'));
    }
  };
  for (const i of json('ip', ['-j', 'addr'])) {
    if (i.ifname && !GENERIC_IFACE.test(i.ifname)) r.ifaces.add(i.ifname);
    mac(i.address);
    for (const a of i.addr_info ?? []) ip(a.local, a.prefixlen);
  }
  for (const n of json('ip', ['-j', 'neigh'])) {
    ip(n.dst);
    mac(n.lladdr);
  }
  const named = (n: string, why: string) => {
    // A reverse lookup is an address written backwards: checked as the address.
    const v4 = n.match(/^((?:\d{1,3}\.){4})in-addr\.arpa\.?$/i);
    if (v4) return ip(v4[1]!.slice(0, -1).split('.').reverse().join('.'));
    const v6 = n.match(/^((?:[0-9a-f]\.){32})ip6\.arpa\.?$/i);
    if (v6) return ip(v6[1]!.replaceAll('.', '').split('').reverse().join('').replace(/(.{4})(?!$)/g, '$1:'));
    names(r, n, why);
  };
  const session = path.join(ROOT, 'data/live/session.json');
  if (existsSync(session)) {
    try {
      const s = JSON.parse(readFileSync(session, 'utf8'));
      for (const d of s.devices ?? []) {
        mac(d.mac);
        for (const a of [...(d.ips ?? []), ...(d.fixedIps ?? [])]) ip(a);
        for (const n of d.names ?? []) named(n.name, 'the name of a device on his network');
      }
    } catch {}
  }
  // The Wi-Fis he has been on: their names say where he lives, works and goes.
  const wifi = (n: unknown) => typeof n === 'string' && n && names(r, n, 'the name of a Wi-Fi he has been on');
  if (existsSync(session)) {
    try {
      for (const g of JSON.parse(readFileSync(session, 'utf8')).segments ?? []) for (const n of Object.keys(g.ssids ?? {})) wifi(n);
    } catch {}
  }
  const known = path.join(ROOT, 'data/history/networks.json');
  if (existsSync(known)) {
    try {
      for (const n of Object.values(JSON.parse(readFileSync(known, 'utf8')) as { ssid?: string }[])) wifi(n.ssid);
    } catch {}
  }
  for (const l of run('nmcli', ['-t', '-f', 'NAME,TYPE', 'connection', 'show'])?.toString().split('\n') ?? []) {
    const [name = '', type = ''] = l.split(/(?<!\\):/);
    if (type === '802-11-wireless') wifi(name.replace(/\\:/g, ':'));
  }
  for (const i of json('ip', ['-j', 'link'])) wifi(/^\s*SSID: (.*)$/m.exec(run('iw', ['dev', i.ifname, 'link'])?.toString() ?? '')?.[1]);
  if (LISTEN) for (const n of listen(LISTEN)) named(n, 'a name his network announces');
  // Who he is: his user name, home and e-mail; the GitHub account (with a zero) is public and stays.
  const user = os.userInfo();
  const people = new Set([user.username, ...(os.userInfo().homedir ? [path.basename(user.homedir)] : [])]);
  const gecos = readFileSync('/etc/passwd', 'utf8').split('\n').find((l) => l.startsWith(`${user.username}:`))?.split(':')[4]?.split(',')[0];
  for (const p of [gecos, git(['config', '--global', 'user.name'])]) if (p && p.length >= 4) people.add(p);
  for (const p of people) r.names.push({ why: 'his name', re: new RegExp(escape(p).replace(/\\? /g, '[\\s._-]*'), 'i') });
  r.names.push({ why: 'his home folder', re: new RegExp(`/home/${escape(user.username)}\\b`) });
  for (const e of [git(['config', '--global', 'user.email']), git(['config', 'user.email'])])
    if (e && !/noreply/.test(e)) {
      r.names.push({ why: 'his e-mail', re: new RegExp(escape(e), 'i') });
      r.names.push({ why: 'his e-mail domain', re: new RegExp(`\\b${escape(e.split('@')[1] ?? e)}\\b`, 'i') });
    }
  for (const i of r.ifaces) r.names.push({ why: 'an interface name of this PC', re: new RegExp(`(?<![\\w-])${escape(i)}(?![\\w-])`) });
  return r;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const git = (a: string[]) => run('git', a)?.toString().trim() || undefined;

/**
 * A device's name, as patterns: every run of three words of it (two- and three-word names whole), however they are
 * joined ("Living Room TV", "Living-Room-TV"), and any word of it that is a model number (letters and digits, five or more).
 * A name of one plain word ("Samsung", "thinkpad") is what every such device is called: it says nothing of his.
 */
function names(r: Real, name: string, why: string) {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length <= 1 && !/\d/.test(name)) return;
  // A reverse lookup (…ip6.arpa, …in-addr.arpa) is an address, checked as one where it is read (`named`): as words it
  // is a run of digits ("0 0 0") found in every lock file and picture.
  if (/\.arpa\.?$/i.test(name)) return;
  const n = Math.min(3, words.length);
  for (let i = 0; i + n <= words.length; i++)
    r.names.push({ why, re: new RegExp(`(?<![\\p{L}\\p{N}])${words.slice(i, i + n).map(escape).join('[^\\p{L}\\p{N}]*')}(?![\\p{L}\\p{N}])`, 'iu') });
  for (const w of words) if (w.length >= 5 && /\d/.test(w) && /\p{L}/u.test(w)) r.names.push({ why, re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(w)}(?![\\p{L}\\p{N}])`, 'iu') });
}

/** The names the network announces while we listen: dumpcap on each interface that is up. */
function listen(seconds: number): string[] {
  const up = json('ip', ['-j', 'link']).filter((i) => i.operstate === 'UP' && !/^(lo|docker|br-|veth)/.test(i.ifname));
  const out: string[] = [];
  for (const i of up) {
    const a = ['-i', i.ifname, '-a', `duration:${seconds}`, '-f', 'udp port 5353 or udp port 67 or udp port 68 or udp port 137', '-T', 'fields', '-E', 'separator=\t'];
    for (const f of ['dhcp.option.hostname', 'dns.resp.name', 'dns.txt', 'nbns.name', 'dns.srv.target']) a.push('-e', f);
    const text = spawnSync('tshark', a, { timeout: (seconds + 20) * 1000 }).stdout?.toString() ?? '';
    for (const v of text.split(/[\t\n,]/)) {
      const s = v.replace(/^(fn|md)=/, '').replace(/<..>$/, '').replace(/\.local$/, '').trim();
      if (s && !s.startsWith('_')) out.push(s);
    }
  }
  return [...new Set(out)];
}

// ---- Reading a file.

/** `commits`: in the history, the commits it is in (to say which refs reach it). */
type Finding = { where: string; line: number; why: string; text: string; commits?: string[] };

function check(file: string, data: Buffer, real: Real): Finding[] {
  const binary = data.subarray(0, 8000).includes(0);
  const magic = data.subarray(0, 4).toString('hex');
  let text: string;
  let kind: 'text' | 'capture' | 'picture' = 'text';
  if (['d4c3b2a1', 'a1b2c3d4', '0a0d0d0a', '4d3cb2a1'].includes(magic)) {
    text = withTemp(data, (f) => run('tshark', ['-r', f, '-V', '-n'])?.toString() ?? '');
    kind = 'capture';
  } else if (binary || /\.(webp|png|jpe?g|gif)$/i.test(file)) {
    text = data.toString('latin1');
    if (/\.(webp|png|jpe?g)$/i.test(file)) text += `\n${ocr(data)}`;
    kind = 'picture';
  } else text = data.toString('utf8');
  const fixture = FIXTURES.some((re) => re.test(file));
  const found: Finding[] = [];
  const lines = text.split('\n');
  lines.forEach((l, i) => {
    const say = (why: string, t: string) => found.push({ where: file, line: kind === 'text' ? i + 1 : 0, why, text: t });
    for (const m of l.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g)) {
      const a = m[0];
      if (!isIPv4(a)) continue;
      if (real.ip4.has(a)) say('an address of his network', a);
      else if (real.nets4.some((n) => in4(a, n.net, n.bits))) say("an address on one of this PC's own subnets", a);
      else if (private4(a) && !fixture && kind === 'text') say('a private address outside the fixtures', a);
    }
    for (const m of l.matchAll(/(?<![\w:.])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi)) {
      const a = m[0];
      if (!isIPv6(a) || !/[0-9a-f]/i.test(a)) continue;
      const g = expand6(a);
      if (real.ip6.has(g.join(':'))) say('an IPv6 address of his network', a);
      else if (real.prefixes6.has(g.slice(0, 3).join(':'))) say("his network's IPv6 prefix", a);
      else if (real.iids6.has(g.slice(4).join(':')) || [...real.iids6].some((iid) => iid.slice(-4) === g[7] && g[7] !== '0000' && g[7] !== '0001')) say("this PC's IPv6 interface ID", a);
      else if (ula6(g) && !fixture && kind === 'text') say('a private address outside the fixtures', a);
    }
    for (const m of l.matchAll(/(?<![0-9a-f:])(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}(?![0-9a-f:])/gi)) {
      const a = m[0].toLowerCase().replaceAll('-', ':');
      if (real.macs.has(a)) say('a MAC of his network', m[0]);
      else if (real.macTails.has(a.slice(9))) say('the device half of a real MAC', m[0]);
    }
    for (const n of real.names) {
      const m = l.match(n.re);
      if (m && !(n.why === 'his name' && file === 'LICENSE')) say(n.why, m[0]);
    }
  });
  return found;
}

function withTemp<T>(data: Buffer, f: (file: string) => T): T {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-leaks-'));
  try {
    const file = path.join(dir, 'blob');
    writeFileSync(file, data);
    return f(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

let tesseract: boolean | undefined;
function ocr(data: Buffer): string {
  tesseract ??= spawnSync('tesseract', ['--version']).status === 0;
  if (!tesseract) return '';
  return withTemp(data, (f) => spawnSync('tesseract', [f, '-', '--psm', '11'], { maxBuffer: 1 << 26 }).stdout?.toString() ?? '');
}

// ---- The tree, or the whole history.

const real = readReal();
const found: Finding[] = [];
let read = 0;
if (!HISTORY) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo }).toString().split('\0').filter(Boolean);
  for (const f of files) {
    const p = path.join(repo, f);
    if (!existsSync(p) || !lstatSync(p).isFile()) continue;
    found.push(...check(f, readFileSync(p), real));
    read++;
  }
} else {
  const commits = git(['rev-list', '--all'])?.split('\n').filter(Boolean) ?? [];
  // Each version of each file, with every commit it is in.
  const seen = new Map<string, string[]>();
  for (const c of commits) {
    for (const row of git(['ls-tree', '-r', '-z', c])?.split('\0').filter(Boolean) ?? []) {
      const [meta = '', file = ''] = row.split('\t');
      const blob = meta.split(' ')[2]!;
      const key = `${blob} ${file}`;
      const cs = seen.get(key);
      if (cs) cs.push(c);
      else seen.set(key, [c]);
    }
    const [who = '', ...message] = (git(['show', '-s', '--format=%ae %ce%n%B', c]) ?? '').split('\n');
    for (const e of who.split(' ')) if (e && !/noreply/.test(e)) found.push({ where: `${c.slice(0, 7)} author`, line: 0, why: 'an e-mail that is not noreply', text: e, commits: [c] });
    for (const f of check(`${c.slice(0, 7)} message`, Buffer.from(message.join('\n')), real)) found.push({ ...f, commits: [c] });
  }
  for (const [key, cs] of seen) {
    const blob = key.slice(0, key.indexOf(' '));
    const file = key.slice(key.indexOf(' ') + 1);
    const data = run('git', ['cat-file', 'blob', blob]);
    if (!data) continue;
    for (const f of check(file, data, real)) found.push({ ...f, where: `${cs[0]!.slice(0, 7)}:${f.where}`, commits: cs });
    read++;
  }
  console.log(`${commits.length} commits, ${read} versions of files`);
}

const known = `${real.ip4.size} IPv4, ${real.ip6.size} IPv6, ${real.macs.size} MACs, ${real.names.length} names and patterns of this machine`;
if (!found.length) {
  console.log(`check-leaks: nothing of this network in ${HISTORY ? 'the history' : `${read} files`} (${known})`);
  process.exit(0);
}
const unique = [...new Map(found.map((f) => [`${f.where}:${f.line}:${f.why}:${f.text}`, f])).values()];
// In the history, which refs reach each finding: a local tag or a stash is not on GitHub, a branch is pushed with it.
const contains = new Map<string, string[]>();
const refsOf = (c: string) => {
  if (!contains.has(c)) {
    const refs = git(['for-each-ref', '--contains', c, '--format=%(refname)'])?.split('\n').filter(Boolean) ?? [];
    contains.set(c, refs.map((r) => r.replace(/^refs\/heads\//, '').replace(/^refs\/tags\//, 'tag ').replace(/^refs\/remotes\//, '')));
  }
  return contains.get(c)!;
};
const reach = (f: Finding) => (f.commits ? `  (reached from: ${[...new Set(f.commits.flatMap(refsOf))].sort().join(', ') || 'no ref, only HEAD'})` : '');
for (const f of unique) console.log(`${f.where}${f.line ? `:${f.line}` : ''}  ${f.why}: ${f.text}${reach(f)}`);
console.log(`check-leaks: ${unique.length} found (${known})`);
process.exit(1);
