// What a device is, from what it says of itself and what it does: "iPhone, iOS", "TV, LG webOS", "Linux laptop".
// Said as an analyst says a judgement: with how sure, in three words tied to the evidence, and the evidence kept apart.
//
//   sure      the device said it itself (a DHCP vendor class, an mDNS model or service, a User-Agent), or two clues of
//             different kinds agree with a strong one;
//   likely    one strong clue (a default name like "Alexs-iPhone"), or two indirect ones that agree;
//   possibly  one indirect clue: the maker from the MAC, or what it talks to.
//
// When clues disagree, it says only what they share ("Apple device"), or nothing. It never makes a name up: no clue,
// no identity.

import type { DeviceKind } from './kinds.ts';

export type Confidence = 'sure' | 'likely' | 'possibly';

export interface Clue {
  /** What it says, in words ("an iPhone", "Android"). */
  says: string;
  /** Where it came from ("DHCP vendor class android-dhcp-14"). */
  from: string;
  /** How much it tells alone: direct (the device said it), strong, or weak (indirect). */
  strength: 'direct' | 'strong' | 'weak';
  /** What it is evidence of: any of the three. */
  kind?: DeviceKind;
  os?: string;
  product?: string;
  /** The maker or family it implies ("Apple"), for when the rest disagrees. */
  family?: string;
}

export interface Identity {
  /** "iPhone, iOS". */
  label: string;
  kind: DeviceKind;
  os?: string;
  product?: string;
  confidence: Confidence;
  clues: Clue[];
}

/** What identify reads: a device's facts, its own words, and what it talks to. */
export interface Facts {
  role?: 'gateway' | 'self';
  mac?: string;
  vendor?: string;
  model?: string;
  randomMac?: boolean;
  names: { name: string; source: string }[];
  clues?: {
    dhcpClass?: string[];
    dhcpParams?: string;
    services?: string[];
    userAgents?: string[];
    ja4?: string[];
    netbios?: boolean;
  };
  /** The apps and companies it talked to, with bytes (the dictionary's words). */
  talksTo?: { app?: string; company?: string; bytes: number }[];
  /** For this PC: the system it runs and whether it has a battery (server/capture.ts says). */
  self?: { os: string; laptop?: boolean };
}

type Rule = [RegExp, Omit<Clue, 'from' | 'strength' | 'says'> & { says?: string }];

/** DHCP option 60, as systems send it. */
const DHCP_CLASS: Rule[] = [
  [/^android-dhcp/i, { os: 'Android', family: 'Android' }],
  [/^MSFT/i, { os: 'Windows', kind: 'computer' }],
  [/^dhcpcd.*linux/i, { os: 'Linux' }],
  [/^udhcp/i, { os: 'embedded Linux', kind: 'board' }],
  [/^ubnt/i, { product: 'Ubiquiti', family: 'Ubiquiti' }],
  [/^(HUAWEI|ZTE|Nokia)/i, { kind: 'router' }],
  [/^PS[45]/i, { product: 'PlayStation', kind: 'console', family: 'Sony' }],
  [/^XBOX/i, { product: 'Xbox', kind: 'console', family: 'Microsoft' }],
];

/** Names systems give by default: renamed easily, so strong but not sure on their own. */
const NAMES: Rule[] = [
  [/iphone/i, { product: 'iPhone', os: 'iOS', kind: 'phone', family: 'Apple' }],
  [/ipad/i, { product: 'iPad', os: 'iPadOS', kind: 'tablet', family: 'Apple' }],
  [/macbook/i, { product: 'MacBook', os: 'macOS', kind: 'computer', family: 'Apple' }],
  [/imac|mac-?mini|mac-?studio/i, { product: 'Mac', os: 'macOS', kind: 'computer', family: 'Apple' }],
  [/apple-?tv/i, { product: 'Apple TV', os: 'tvOS', kind: 'tv', family: 'Apple' }],
  [/apple-?watch/i, { product: 'Apple Watch', os: 'watchOS', kind: 'watch', family: 'Apple' }],
  [/^android[-_]/i, { os: 'Android', family: 'Android' }],
  [/galaxy-?watch/i, { product: 'Galaxy Watch', kind: 'watch', family: 'Samsung' }],
  [/galaxy-?(tab|tab-s)/i, { product: 'Galaxy Tab', os: 'Android', kind: 'tablet', family: 'Samsung' }],
  [/galaxy|^SM-[A-Z]\d/i, { product: 'Galaxy', os: 'Android', kind: 'phone', family: 'Samsung' }],
  [/pixel/i, { product: 'Pixel', os: 'Android', kind: 'phone', family: 'Google' }],
  [/^(redmi|poco)[-_ ]?(note)?[-_ ]?\d/i, { os: 'Android', kind: 'phone', family: 'Xiaomi' }],
  [/oneplus|oppo|realme|motorola|moto-g/i, { os: 'Android', kind: 'phone' }],
  [/^(DESKTOP|LAPTOP)-[A-Z0-9]{5,}/i, { os: 'Windows', kind: 'computer' }],
  [/webos/i, { product: 'LG TV', os: 'webOS', kind: 'tv', family: 'LG' }],
  [/^\[TV\] Samsung|tizen|^samsung[-_ ].*\btv\b/i, { product: 'Samsung TV', os: 'Tizen', kind: 'tv', family: 'Samsung' }],
  // Samsung's TVs name themselves by size and a range only Samsung calls so: '50" Crystal UHD', '55" Neo QLED', 'The
  // Frame (55)'. QLED and OLED alone are other makers' too.
  [/^\d{2,3}" (Crystal UHD|Neo QLED)$|^Samsung .*Series \(\d{2,3}\)$|^The (Frame|Serif|Sero)( \(\d{2,3}\))?$/i, { product: 'Samsung TV', os: 'Tizen', kind: 'tv', family: 'Samsung' }],
  [/chromecast/i, { product: 'Chromecast', kind: 'tv', family: 'Google' }],
  [/^raspberrypi$|raspberry/i, { product: 'Raspberry Pi', os: 'Linux', kind: 'board' }],
  [/^ESP[-_]|^esp32|^esp8266|tasmota|shelly/i, { product: 'ESP board', kind: 'board' }],
  [/playstation|^PS[45]-/i, { product: 'PlayStation', kind: 'console', family: 'Sony' }],
  [/xbox/i, { product: 'Xbox', kind: 'console', family: 'Microsoft' }],
  [/nintendo/i, { product: 'Nintendo Switch', kind: 'console', family: 'Nintendo' }],
  [/kindle/i, { product: 'Kindle', kind: 'tablet', family: 'Amazon' }],
  [/^echo[-_ ]?(dot|show|studio|pop)?([-_]|$)|amazon-?echo|alexa/i, { product: 'Echo', kind: 'speaker', family: 'Amazon' }],
  [/fire-?tv|firestick/i, { product: 'Fire TV', os: 'Fire OS', kind: 'tv', family: 'Amazon' }],
  [/sonos/i, { product: 'Sonos', kind: 'speaker', family: 'Sonos' }],
  [/printer|laserjet|deskjet|officejet|^EPSON|^BRN|^Canon/i, { kind: 'printer' }],
];

/** The model a device announces over mDNS (md=, model=). */
const MODELS: Rule[] = [
  [/^iPhone\d/i, { product: 'iPhone', os: 'iOS', kind: 'phone', family: 'Apple' }],
  [/^iPad\d/i, { product: 'iPad', os: 'iPadOS', kind: 'tablet', family: 'Apple' }],
  [/^MacBook/i, { product: 'MacBook', os: 'macOS', kind: 'computer', family: 'Apple' }],
  [/^(iMac|Macmini|MacStudio|MacPro|Mac\d)/i, { product: 'Mac', os: 'macOS', kind: 'computer', family: 'Apple' }],
  [/^AppleTV/i, { product: 'Apple TV', os: 'tvOS', kind: 'tv', family: 'Apple' }],
  [/^AudioAccessory|HomePod/i, { product: 'HomePod', kind: 'speaker', family: 'Apple' }],
  [/chromecast|google tv/i, { product: 'Chromecast', kind: 'tv', family: 'Google' }],
  [/nest (audio|mini)|google home/i, { product: 'Google speaker', kind: 'speaker', family: 'Google' }],
  [/sonos/i, { product: 'Sonos', kind: 'speaker', family: 'Sonos' }],
  [/laserjet|deskjet|officejet|envy|epson|brother|canon|pixma/i, { kind: 'printer' }],
  [/\bTV\b|bravia|webos|tizen/i, { kind: 'tv' }],
];

/** mDNS service types: what a device offers says what it is. */
const SERVICES: Rule[] = [
  [/^_googlecast\._tcp$/, { says: 'offers Google Cast', kind: 'tv', family: 'Google' }],
  [/^_(ipp|ipps|printer|pdl-datastream)\._tcp$/, { says: 'offers printing', kind: 'printer' }],
  [/^_scanner\._tcp$|^_uscan\._tcp$/, { says: 'offers scanning', kind: 'printer' }],
  [/^_companion-link\._tcp$/, { says: 'speaks Apple Continuity', family: 'Apple' }],
  [/^_(airplay|raop)\._tcp$/, { says: 'receives AirPlay', family: 'Apple' }],
  [/^_hap\._(tcp|udp)$/, { says: 'a HomeKit accessory', kind: 'board' }],
  [/^_sonos\._tcp$/, { says: 'speaks Sonos', kind: 'speaker', family: 'Sonos' }],
  [/^_spotify-connect\._tcp$/, { says: 'plays Spotify Connect', kind: 'speaker' }],
  [/^_workstation\._tcp$/, { says: 'announces a workstation (Avahi)', os: 'Linux', kind: 'computer' }],
  [/^_(ssh|sftp-ssh)\._tcp$/, { says: 'offers SSH', kind: 'computer' }],
  [/^_smb\._tcp$/, { says: 'shares files', kind: 'computer' }],
  [/^_amzn-wplay\._tcp$/, { says: 'Amazon casting', kind: 'tv', family: 'Amazon' }],
];

/** User-Agent headers, as browsers and systems write them. */
const AGENTS: Rule[] = [
  [/iPhone; CPU iPhone OS|\biPhone\b.*Mobile/, { product: 'iPhone', os: 'iOS', kind: 'phone', family: 'Apple' }],
  [/iPad; CPU OS/, { product: 'iPad', os: 'iPadOS', kind: 'tablet', family: 'Apple' }],
  // A Mac, or an iPad (Safari on iPadOS says it is a Mac): only the family is sure.
  [/Macintosh; Intel Mac OS X|Darwin\/\d/, { says: 'a Mac or an iPad', family: 'Apple' }],
  [/CrKey/, { product: 'Chromecast', kind: 'tv', family: 'Google' }],
  [/Web0S|webOS/, { product: 'LG TV', os: 'webOS', kind: 'tv', family: 'LG' }],
  [/Tizen/, { product: 'Samsung TV', os: 'Tizen', kind: 'tv', family: 'Samsung' }],
  [/AFT[A-Z]|Fire TV/, { product: 'Fire TV', os: 'Fire OS', kind: 'tv', family: 'Amazon' }],
  [/Roku/, { product: 'Roku', kind: 'tv' }],
  [/PlayStation/, { product: 'PlayStation', kind: 'console', family: 'Sony' }],
  [/Xbox/, { product: 'Xbox', kind: 'console', family: 'Microsoft' }],
  [/Android [\d.]+;.*Mobile/, { os: 'Android', kind: 'phone' }],
  [/Android [\d.]+/, { os: 'Android' }],
  [/Windows NT|Microsoft-CryptoAPI|Windows-Update-Agent|Microsoft-Delivery-Optimization/, { os: 'Windows', kind: 'computer' }],
  [/CrOS/, { os: 'ChromeOS', kind: 'computer' }],
  [/X11; (Ubuntu; )?Linux|Linux x86_64/, { os: 'Linux', kind: 'computer' }],
];

/** The maker from the MAC: says the family, and for some makers the kind. Weak: makers make many things. */
const MAKERS: Rule[] = [
  [/^Apple/i, { family: 'Apple' }],
  [/Raspberry Pi/i, { product: 'Raspberry Pi', kind: 'board', os: 'Linux' }],
  [/Espressif/i, { product: 'ESP board', kind: 'board' }],
  [/Sonos/i, { product: 'Sonos', kind: 'speaker', family: 'Sonos' }],
  [/Hewlett|HP Inc|Seiko Epson|Brother|Canon|Kyocera|Lexmark|Xerox/i, { kind: 'printer' }],
  [/Nintendo/i, { product: 'Nintendo console', kind: 'console', family: 'Nintendo' }],
  [/Sony Interactive/i, { product: 'PlayStation', kind: 'console', family: 'Sony' }],
  [/Roku/i, { product: 'Roku', kind: 'tv' }],
  [/Amazon/i, { family: 'Amazon' }],
  [/^Google/i, { family: 'Google' }],
  [/^LG Electronics|^LG Innotek/i, { family: 'LG' }],
  [/^Samsung/i, { family: 'Samsung' }],
  [/Xiaomi/i, { family: 'Xiaomi' }],
  [/Ubiquiti/i, { family: 'Ubiquiti' }],
  [/TP-Link|Netgear|ASUSTek|AVM|Zyxel|Technicolor|Sagemcom|Huawei|ZTE|MitraStar|Arcadyan|Askey/i, {}],
  [/Intel Corporate|Realtek|Liteon|AzureWave|Hon Hai|Qualcomm Atheros|Killer|Micro-Star|Dell|Lenovo|ASRock|Gigabyte/i, { kind: 'computer' }],
];

/** What it talks to: an app that runs on one system only says the system. Weak: a host may be asked by anything. */
const TALKS: Rule[] = [
  [/^Windows Update$|^Microsoft Store$/, { os: 'Windows', kind: 'computer' }],
  [/^LG TV$/, { product: 'LG TV', os: 'webOS', kind: 'tv', family: 'LG' }],
  [/^Samsung TV$/, { product: 'Samsung TV', os: 'Tizen', kind: 'tv', family: 'Samsung' }],
  [/^Roku$/, { product: 'Roku', kind: 'tv' }],
  [/^Apple notifications$|^iCloud$|^App Store$/, { family: 'Apple' }],
  [/^Android notifications$|^Google Play$|^Android$/, { os: 'Android', family: 'Android' }],
  [/^Arch Linux$|^Ubuntu$|^Fedora$|^Debian$/, { os: 'Linux', kind: 'computer' }],
  [/^PlayStation$/, { product: 'PlayStation', kind: 'console', family: 'Sony' }],
  [/^Xbox( Live)?$/, { product: 'Xbox', kind: 'console', family: 'Microsoft' }],
];

const match = (rules: Rule[], text: string | undefined) => (text ? rules.find(([re]) => re.test(text))?.[1] : undefined);

/** Every clue a device's facts give, each with where it came from. */
export function clues(f: Facts): Clue[] {
  const out: Clue[] = [];
  const add = (r: Rule[1] | undefined, strength: Clue['strength'], from: string, says?: string) => {
    if (!r || !(r.kind || r.os || r.product || r.family)) return;
    const { says: own, ...rest } = r;
    const line = { says: says ?? own ?? describe(rest), from, strength, ...rest };
    // Two User-Agents that differ only past what a clue shows of them read the same: one line.
    if (!out.some((c) => c.from === line.from && c.says === line.says)) out.push(line);
  };
  if (f.role === 'gateway') out.push({ says: 'the way out to the internet', from: 'it carries the traffic of other networks', strength: 'direct', kind: 'router', product: 'Router' });
  if (f.role === 'self' && f.self)
    out.push({ says: `${f.self.os}${f.self.laptop ? ' laptop' : ' computer'}`, from: 'this computer, as its own system says', strength: 'direct', kind: 'this', os: f.self.os, product: f.self.laptop ? 'laptop' : 'computer' });
  // Docker gives its containers MACs that begin 02:42 (locally administered, its own convention).
  if (f.mac?.startsWith('02:42:') && f.role !== 'self') out.push({ says: 'a Docker container', from: 'MAC 02:42:… (Docker’s own)', strength: 'direct', kind: 'container', product: 'Docker container' });
  for (const c of f.clues?.dhcpClass ?? []) add(match(DHCP_CLASS, c), 'direct', `DHCP vendor class “${c}”`);
  for (const ua of f.clues?.userAgents ?? []) add(match(AGENTS, ua), 'direct', `User-Agent “${ua.length > 80 ? `${ua.slice(0, 79)}…` : ua}”`);
  if (f.model) add(match(MODELS, f.model), 'direct', `model “${f.model}”, announced over mDNS`);
  for (const s of f.clues?.services ?? []) add(match(SERVICES, s), 'direct', `mDNS service ${s}`);
  for (const n of f.names) if (n.source === 'DHCP' || n.source === 'mDNS' || n.source === 'NetBIOS') add(match(NAMES, n.name), 'strong', `name “${n.name}” (${n.source})`);
  if (f.clues?.netbios) add({ os: 'Windows', kind: 'computer' }, 'weak', 'answers NetBIOS (Windows, or a Samba share)');
  if (f.vendor) add(match(MAKERS, f.vendor), 'weak', `maker from the MAC: ${f.vendor}`);
  const seen = new Set<string>();
  for (const t of [...(f.talksTo ?? [])].sort((a, b) => b.bytes - a.bytes)) {
    const name = t.app ?? '';
    if (seen.has(name)) continue;
    seen.add(name);
    add(match(TALKS, name), 'weak', `talks to ${name}`);
  }
  return out;
}

/** What one claim says, in words. */
function describe(r: { kind?: DeviceKind; os?: string; product?: string; family?: string }): string {
  return [r.product, r.os].filter(Boolean).join(', ') || (r.family ? `${r.family} device` : r.kind ? KIND_NOUN[r.kind] : '');
}

const KIND_NOUN: Record<DeviceKind, string> = {
  router: 'router',
  this: 'this PC',
  phone: 'phone',
  computer: 'computer',
  tv: 'TV or box',
  speaker: 'speaker',
  board: 'small board or sensor',
  printer: 'printer',
  console: 'game console',
  camera: 'camera',
  watch: 'watch',
  tablet: 'tablet',
  container: 'container',
  other: 'device',
};

const WEIGHT = { direct: 3, strong: 2, weak: 1 };

/**
 * The judgement: for each of what it is (kind), its system (os) and the product, the value with the most weight
 * behind it, unless another value has as much (a disagreement: then none). How sure: from the clues behind the label.
 */
export function identify(f: Facts): Identity | undefined {
  const all = clues(f);
  if (!all.length) return undefined;
  // The router and this PC are known by what they do and what this system says: no other clue argues with that.
  const own = all.find((c) => c.kind === 'router' || c.kind === 'this');
  if (own) return { label: label(own.kind!, own.os, own.product, undefined, f), kind: own.kind!, os: own.os, product: own.product === 'laptop' || own.product === 'computer' ? undefined : own.product, confidence: 'sure', clues: all };
  const pick = <K extends 'kind' | 'os' | 'product' | 'family'>(key: K) => {
    const by = new Map<string, number>();
    for (const c of all) if (c[key]) by.set(c[key] as string, (by.get(c[key] as string) ?? 0) + WEIGHT[c.strength]);
    const ranked = [...by].sort((a, b) => b[1] - a[1]);
    if (!ranked[0] || (ranked[1] && ranked[1][1] === ranked[0][1])) return undefined;
    return ranked[0][0] as NonNullable<Clue[K]>;
  };
  let kind = pick('kind');
  let os = pick('os');
  const family = pick('family');
  // Two clues that each tell much (said by the device itself, or a default name) and disagree: neither is said, and
  // the judgement is at most "likely" (the red team's Linux DHCP with an iPhone User-Agent).
  let contested = false;
  const contest = <K extends 'kind' | 'os'>(key: K, value: Clue[K] | undefined): Clue[K] | undefined => {
    if (key === 'kind' && value === 'this') return value;
    const strong = all.filter((c) => WEIGHT[c.strength] >= 2 && c[key]);
    if (new Set(strong.map((c) => c[key])).size > 1) {
      contested = true;
      return undefined;
    }
    return value;
  };
  kind = contest('kind', kind);
  os = contest('os', os);
  // The product only from clues that agree with the system and the kind (a Pi's maker does not make a Windows PC a Pi).
  const fits = (c: Clue) => (!c.os || !os || c.os === os) && (!c.kind || !kind || c.kind === kind || kind === 'this');
  const products = all.filter((c) => c.product && fits(c));
  let product: string | undefined;
  {
    const by = new Map<string, number>();
    for (const c of products) by.set(c.product!, (by.get(c.product!) ?? 0) + WEIGHT[c.strength]);
    const ranked = [...by].sort((a, b) => b[1] - a[1]);
    product = ranked[0] && !(ranked[1] && ranked[1][1] === ranked[0][1]) ? ranked[0][0] : undefined;
    if (ranked[1]) contested ||= all.some((c) => c.product === ranked[1]![0] && WEIGHT[c.strength] >= 2);
  }
  // What contradicts the winner leaves the identity: a product of another family, a system of another product.
  const agrees = (c: Clue) =>
    (!c.kind || !kind || c.kind === kind || (kind === 'this' && c.kind === 'computer')) &&
    (!c.os || !os || c.os === os || (c.os === 'Linux' && os === 'embedded Linux')) &&
    (!c.product || !product || c.product === product) &&
    // The family counts only for a clue that says nothing else: an LG TV offers Google Cast and AirPlay too.
    (c.kind || c.os || c.product || !c.family || !family || c.family === family);
  const behind = all.filter((c) => agrees(c) && (c.kind === kind || c.os === os || c.product === product || c.family === family));
  if (!behind.length) return undefined;
  const best = Math.max(...behind.map((c) => WEIGHT[c.strength]));
  // Sure: the device said it itself, or a strong clue and another of a different source agree on what it is (its
  // kind, system or product: a maker that only says the family does not count).
  const telling = (c: Clue) => (kind && c.kind === kind) || (os && c.os === os) || (product && c.product === product);
  const strongs = behind.filter((c) => WEIGHT[c.strength] >= 2 && telling(c));
  const seconded = strongs.some((s) => behind.some((c) => c !== s && telling(c) && c.from.split(' ')[0] !== s.from.split(' ')[0]));
  let confidence: Confidence =
    behind.some((c) => c.strength === 'direct' && (telling(c) || (!kind && !os && !product))) || (strongs.length && seconded)
      ? 'sure'
      : best >= 2 || behind.length > 1
        ? 'likely'
        : 'possibly';
  if (contested && confidence === 'sure') confidence = 'likely';
  // A product says its system and kind when nothing else does (an iPhone runs iOS), unless they were disputed.
  const fromProduct = all.find((c) => c.product === product);
  if (product && fromProduct && !contested) {
    if (!os && fromProduct.os) os = fromProduct.os;
    if (!kind && fromProduct.kind) kind = fromProduct.kind;
  }
  if (product === 'laptop' || product === 'computer') product = undefined;
  const k: DeviceKind = kind ?? 'other';
  // Disputed: the family of one side is not said either ("Android computer" from an Android DHCP and a Windows agent).
  return { label: label(k, os, product, contested ? undefined : family, f), kind: k, os, product, confidence, clues: all };
}

/** "iPhone, iOS"; "TV, LG webOS"; "Linux laptop"; "Windows computer"; "Apple device". */
function label(kind: DeviceKind, os: string | undefined, product: string | undefined, family: string | undefined, f: Facts): string {
  if (kind === 'router') return 'Router';
  if (kind === 'this') return f.self ? `${f.self.os} ${f.self.laptop ? 'laptop' : 'computer'}` : 'This PC';
  if (product === 'LG TV' || product === 'Samsung TV') return `TV, ${product.replace(' TV', '')} ${os ?? ''}`.trim();
  if (product) return os && !product.includes(os) ? `${product}, ${os}` : product;
  if (os && kind !== 'other') return `${os} ${KIND_NOUN[kind]}`;
  if (os) return `${os} device`;
  if (kind !== 'other') return capital(family ? `${family} ${KIND_NOUN[kind]}` : KIND_NOUN[kind]);
  return family ? `${family} device` : 'Device';
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
