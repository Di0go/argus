// What Argus knows, as entities (the core's EntityGraph: a kind, an id, a name, links). The kinds are Argus's own.
// Today: the devices on the local network, the hosts out on the internet they talk to, the interfaces it listens on,
// and the captures saved. To come: domains and companies (DNS, the TLS SNI), services and apps, conversations.
//
// And what the live session is: the interfaces being listened on, what they add up to, and the bandwidth over time.

import type { EntityRef, Link } from '@organon/core/shared/entities';
import type { Classification } from './classify.ts';
import type { Identity } from './identify.ts';
import type { DnsUse } from './security.ts';

export type Kind = 'device' | 'remote' | 'site' | 'interface' | 'capture';

/** Where a device's name came from, as he would say it. */
export type NameSource = 'DHCP' | 'mDNS' | 'NetBIOS' | 'DNS' | 'TLS' | 'HTTP';

/**
 * Where a device was found besides this PC's own listening: the router (its list of devices, read from its page, or a
 * DHCP lease file on this PC), the kernel's neighbour table, a scan of the LAN, or a DNS server's log. The sensor (tshark) is not one of these: what it heard is the device's own traffic.
 */
export type DeviceOrigin = 'router' | 'neigh' | 'scan' | 'dns';

export interface Traffic {
  packets: number;
  /** Bytes in frames it sent, and in frames sent to it. */
  bytesSent: number;
  bytesReceived: number;
  /** Seconds since the epoch. */
  firstSeen: number;
  lastSeen: number;
}

/**
 * A stay on an interface: from where this PC joined a network on it to where it joined another (the header says when
 * one begins). What makes it a network (the way out, the SSID) is in it; which stays are one network, the server says.
 */
export interface Segment {
  /** `${iface}#${n}`, n counting up per interface. */
  id: string;
  iface: string;
  /** Epoch seconds: its first and last frame. */
  first: number;
  last: number;
  packets: number;
  bytes: number;
  /** The MACs this PC sent its frames for the internet to (for two hosts or more): how many frames, and when last. */
  vias: { mac: string; frames: number; last: number }[];
  /** A MAC it sent frames for only one host out there so far, and that host: a way out once a second goes. */
  once?: Record<string, string>;
  /** The SSIDs the system said while it lasted, and how many times (once each poll). */
  ssids?: Record<string, number>;
  /** What began it: this PC asking DHCP from nothing, another SSID, another way out after a quiet one; none for the first. */
  began?: 'dhcp' | 'ssid' | 'via';
}

/** Where a device was heard: in which stay, from when to when, how much each way. */
export interface Heard {
  segment: string;
  first: number;
  last: number;
  packets: number;
  sent: number;
  received: number;
}

/**
 * A network, as the server tells it from the stays (shared/networks.ts): a way out (a router's MAC) and every stay that
 * went through it, by cable or Wi-Fi, named by its SSID when the system said one. Without a way out, an interface's
 * stays of one SSID (or of none) are one.
 */
export interface Network {
  /** `net:<the router's MAC>` (the first seen, when it has two), or `if:<interface>[:<SSID>]` without one. */
  id: string;
  name: string;
  ssid?: string;
  /** The routers' MACs, the busiest first. */
  routers: string[];
  interfaces: string[];
  /** Epoch seconds. */
  first: number;
  last: number;
  bytes: number;
  /** Being listened on now: the latest stay of an interface that is on. */
  now?: boolean;
  /** The interfaces it is the network of now. */
  nowOn?: string[];
  /** Just joined: no way out seen yet, so which network it is will be known in a moment. */
  pending?: boolean;
}

/** A device on the local network, by its MAC address (or by its address, on an interface with no Ethernet). */
export interface Device extends EntityRef, Traffic {
  kind: 'device';
  mac?: string;
  ips: string[];
  /** The maker, from the first half of the MAC (the OUI), as Wireshark's list names it. */
  vendor?: string;
  /** The model, when it says it (mDNS md=, as Google Cast does). */
  model?: string;
  /** A locally administered MAC: phones and laptops make one up per network, so it names no maker. */
  randomMac: boolean;
  names: { name: string; source: NameSource }[];
  /** gateway: the way out to the internet (other networks' addresses travel through its MAC). self: this PC. */
  role?: 'gateway' | 'self';
  /** The interfaces it was seen on. */
  interfaces: string[];
  /** Bytes a second, sent and received, over the last few seconds (the live session only). */
  rate?: { sent: number; received: number };
  /** What it says of itself that tells what it is (shared/identify.ts reads them). Never a password, never content. */
  clues?: Clues;
  /** What it is, how sure, and why (shared/identify.ts). */
  identity?: Identity;
  /** How it looks up names: the house's resolver, another, or encrypted. */
  dns?: DnsUse[];
  /** What it is doing now, busiest first (the live session only: server/observer.ts). */
  doing?: Doing[];
  /** The sensor's fact: the stays it was heard in (the server reads them into `networks`, and drops them). */
  heard?: Heard[];
  /** The networks it was heard on, the latest first (shared/networks.ts). */
  networks?: string[];
  /** On more than one: its traffic on each, so a network's view says its share (this PC's, above all). */
  perNetwork?: Record<string, { packets: number; bytesSent: number; bytesReceived: number; firstSeen: number; lastSeen: number }>;
  /** Where it was found besides this PC's own listening (the router's leases, a scan…). Absent: only the sensor saw it. */
  origin?: DeviceOrigin[];
  /** This PC never saw a frame from it: another source found it, and it may be on the network without talking to us. */
  foundOnly?: boolean;
  /** In a network's view: the other networks it was heard on (the chosen one is not among them). */
  elsewhere?: string[];
}

/** A device's own words about itself, as the network carried them. */
export interface Clues {
  /** DHCP option 60 ("android-dhcp-14", "MSFT 5.0"). */
  dhcpClass?: string[];
  /** DHCP option 55, the options it asks for, in its order ("1,3,6,15,119,252"). */
  dhcpParams?: string;
  /** mDNS service types it offers ("_googlecast._tcp", "_airplay._tcp"). */
  services?: string[];
  /** User-Agent headers it sent in the clear. */
  userAgents?: string[];
  /** Its TLS clients' JA4 fingerprints. */
  ja4?: string[];
  /** It answered NetBIOS (Windows, or Samba). */
  netbios?: boolean;
}

/** One thing a device is doing: what (the dictionary's words) and how much in the last minute. */
export interface Doing {
  what: Classification;
  /** Bytes, both ways, in the last minute. */
  bytes: number;
  /** Epoch seconds: since when, without a pause of more than a few minutes. */
  since: number;
}

/** A host out on the internet, by address, named by what this network asked of DNS or said in TLS. */
export interface Remote extends EntityRef, Traffic {
  kind: 'remote';
  ip: string;
  names: { name: string; source: NameSource }[];
  /** Who runs it and what it is for, as the dictionary says (shared/classify.ts); absent when it says nothing. */
  app?: Classification;
  /** Where its network is registered (server/geo.ts), when the table is there. */
  where?: Where;
}

/** The network an address belongs to (its AS) and the country it is registered in: not a street, not a proof. */
export interface Where {
  asn?: number;
  org?: string;
  /** ISO 3166 code, and the country as he would say it. */
  cc?: string;
  country?: string;
}

/** Who runs a set of hosts out on the internet: a company everyone meets (Google, Meta), or a site by its name. */
export interface Site extends EntityRef {
  kind: 'site';
  /** The sites (registrable names) its hosts were named by. */
  sites: string[];
  /** Its hosts' ids (their addresses). */
  hosts: string[];
  bytesSent: number;
  bytesReceived: number;
  lastSeen: number;
}

export interface Interface extends EntityRef {
  kind: 'interface';
  /** As he would say it: Wi-Fi, Cabo, Docker, VPN, Loopback, Todas. */
  label: string;
  type: 'wifi' | 'cable' | 'docker' | 'vpn' | 'loopback' | 'any' | 'other';
  /** dumpcap lists it, and this user can capture on it. */
  capturable: boolean;
  up?: boolean;
}

export interface Capture {
  id: string;
  /** Seconds since the epoch. */
  started: number;
  seconds: number;
  interfaces: string[];
  status: 'running' | 'done' | 'failed';
  error?: string;
  /** live: saved from the live session; file: a recording brought in (the demo, a fixture). */
  source: 'live' | 'file';
  packets?: number;
  bytes?: number;
  /** The file's extension, pcapng or pcap (as the file brought in had it). */
  ext?: 'pcapng' | 'pcap';
}

/**
 * Who talked to whom, by what service: a device here and the other end (a host out on the internet, or another device
 * here), both ways added up. One per pair and service (HTTPS and DNS with the same host are two).
 */
export interface Conversation {
  /** `${a} ${b} ${service}`: entity keys hold no spaces. */
  id: string;
  /** Entity keys: a device here, and whom it talked to. Between two devices here, the one that spoke first. */
  a: string;
  b: string;
  /** By the server's port, "tcp/443"; "icmp"; "" when not IP (shared/services.ts names it). */
  service: string;
  /** The interfaces it was heard on. */
  interfaces: string[];
  /** Bytes from a to b, and from b to a. */
  sent: number;
  received: number;
  packets: number;
  /** Epoch seconds. */
  first: number;
  last: number;
  /** What tshark recognised it as, above TCP or UDP ("wg", "stun", "quic"), when it did. */
  protocol?: string;
  /** What it is, in plain words: the app, the category, the activity (shared/classify.ts); absent when unknown. */
  app?: Classification;
  /** When `app` is absent but the other end has a name: its site (the registrable name), said as "using <site>". */
  site?: string;
  /** What it carried in the clear (shared/security.ts): the protocol, and whether a password went with it. */
  clear?: { proto: string; credentials?: boolean; harmless?: boolean };
  /** The TLS version it agreed ("1.0" … "1.3"), when its handshake was seen. */
  tls?: string;
  /** The sensor's fact: the stay it was in (the server joins a network's stays into one, and drops it). */
  segment?: string;
  /** The network it was on (shared/networks.ts). */
  network?: string;
  /** Its stay was just joined: which network it is on is not known yet (the history waits for it). */
  pending?: boolean;
}

export interface HostsView {
  capture: Capture;
  devices: Device[];
  remotes: Remote[];
  links: Link[];
  conversations: Conversation[];
  networks?: Network[];
}

export type ArgusEntity = Device | Remote | Site | Interface;

/** Bytes over time in buckets of `step` seconds; `end` is the newest bucket (epoch seconds / step); oldest first. */
export interface SeriesData {
  step: number;
  end: number;
  sent: number[];
  received: number[];
}

/** One interface of the live session: whether it is being listened on, and how that is going. */
export interface Listening {
  id: string;
  /** He turned it on (and it is remembered across restarts). */
  on: boolean;
  /** starting: tshark is opening it; listening: frames are coming in; failed: it stopped, `error` says why. */
  status: 'off' | 'starting' | 'listening' | 'failed';
  error?: string;
  /** Epoch seconds, since it is on. */
  since?: number;
  packets: number;
  /** What its ring buffer holds on disk now. */
  ringBytes: number;
  /** Bytes a second over the last few seconds, on this interface. */
  rate?: number;
}

/**
 * A place Argus finds devices besides listening: the kernel's neighbour table, the router's (or a local) DHCP leases,
 * and, on demand, a scan of the LAN and a reading of the router. What each adds, and how it is going, as the page says it.
 */
export interface SourceState {
  id: 'neigh' | 'leases' | 'scan' | 'router';
  name: string;
  /** Whether it is adding anything now (scan: whether it can be asked to). */
  on: boolean;
  /** What it adds, in words. */
  detail: string;
  /** Epoch seconds of the last look or scan. */
  last?: number;
  /** How many devices it found (whole, before merging). */
  found: number;
  /** Why it is off, or what failed at the last look. */
  error?: string;
}

/** One time he asked the network who is there (a scan) or the router what it knows (Scan page): when, where, what. */
export interface SourceRun {
  id: string;
  kind: 'scan' | 'router';
  /** Epoch seconds. */
  at: number;
  iface: string;
  /** The network it asked: the router's, by its MAC (shared/networks.ts ids). */
  network?: string;
  /** Reading the router: its model, and whether its public factory password let Argus in (a warning). */
  router?: { model: string; factory?: boolean };
  error?: string;
  found: RunDevice[];
}

/** A device a run found, and what Argus knew of it just before. */
export interface RunDevice {
  mac?: string;
  ip?: string;
  hostname?: string;
  /** From the router: by cable or Wi-Fi, where ("LAN 2", "5GHz"), on which SSID, and whether connected now. */
  link?: 'cable' | 'wifi';
  port?: string;
  ssid?: string;
  connected?: boolean;
  /** Heard by this PC already, found before by another source (or an earlier run), or new to Argus. */
  known: 'heard' | 'found' | 'new';
  /** Its device's id and the name it had then, when it was known. */
  device?: string;
  name?: string;
}

/**
 * Where this PC is now, for what can only be asked of the network it is on: the interface of its way out, the gateway
 * (its address and MAC), the network that is (when Argus knows it), and what is kept of its router.
 */
export interface Here {
  iface: string;
  gateway: string;
  mac?: string;
  network?: string;
  /** The router's model, once read, and whether a password is saved for it (never the password). */
  router?: { model?: string; saved: boolean; user?: string };
}

export interface Session {
  /** Epoch seconds: when this session began (the first interface turned on, or a reset). */
  started?: number;
  packets: number;
  bytes: number;
  listening: Listening[];
  /** The ceilings: the ring buffer per interface (files × size), and how much is kept in memory. */
  limits: { ringFiles: number; ringFileMB: number; ringSeconds: number; maxFlows: number; maxDevices: number };
  /** Bytes a second over the last few seconds, the whole network as seen here. */
  rate: number;
}

/** GET /api/live: the session and everything it saw, with the bandwidth over time. */
export interface LiveView {
  /** The number of the last event this view includes. */
  seq: number;
  session: Session;
  devices: Device[];
  remotes: Remote[];
  links: Link[];
  conversations: Conversation[];
  /** The networks the session was on, the latest first. */
  networks: Network[];
  /** The whole network: fine (a second per bucket, the last minutes) and coarse (a minute per bucket, the day). */
  total: { fine: SeriesData; coarse: SeriesData };
  /** The fine series of each device heard in the last ten minutes. */
  byDevice: Record<string, SeriesData>;
  /** Each interface's fine series. */
  byInterface: Record<string, SeriesData>;
}

/**
 * On the live stream, once a second while something changes: the session, the devices, hosts and links that changed,
 * and the newest buckets of the series that had traffic (to lay over what the page has).
 */
export interface LiveEvent {
  type: 'live';
  /** Numbered, so a page that loads the view whole skips the events it already includes. */
  seq: number;
  session: Session;
  /** The devices that changed, and those forgotten (past the ceiling). */
  devices: Device[];
  goneDevices: string[];
  remotes: Remote[];
  links: Link[];
  /** Hosts forgotten (past the ceiling) since the last event. */
  gone: string[];
  /** The conversations that changed, and those forgotten with their flows. */
  conversations: Conversation[];
  goneConversations: string[];
  /** The networks, whole (a few): which is now, and their names. */
  networks: Network[];
  total: { fine: SeriesData; coarse: SeriesData };
  byDevice: Record<string, SeriesData>;
  byInterface: Record<string, SeriesData>;
}

/** The session began again: the page loads it whole. */
export interface ResetEvent {
  type: 'reset';
}

export type ArgusEvent = LiveEvent | ResetEvent | { type: 'captures'; captures: Capture[] } | { type: 'sources'; sources: SourceState[]; runs: SourceRun[] };

/** One episode of the diary: a device doing one thing, from when it began to when it stopped, and how much. */
export interface Episode {
  /** Epoch seconds. */
  start: number;
  end: number;
  device: string;
  /** The device's name and what it is, as they were then (it may be forgotten since). */
  deviceName: string;
  deviceLabel?: string;
  /** What, in the dictionary's words (absent: traffic nobody named). */
  what?: Classification;
  /** What else the device did at the same time, busiest first (one story, not five lines). */
  also?: Classification[];
  bytes: number;
  /** Still going on (heard in the last minutes). */
  ongoing?: boolean;
}

/** Something worth a line of its own: a device seen for the first time, traffic in the clear, old TLS. */
export interface DayEvent {
  t: number;
  type: 'new' | 'clear' | 'old-tls';
  device: string;
  deviceName: string;
  /** clear and old-tls: whom with (entity key), its name, the protocol or TLS version, and whether a login went by. */
  with?: string;
  withName?: string;
  proto?: string;
  credentials?: boolean;
  /** clear: inside the house (device to device) rather than out to the internet. */
  local?: boolean;
  /** The network it happened on (absent: kept before networks were told apart). */
  network?: string;
}

/** GET /api/day: a day as it was kept (server/history.ts): by hour, by device, the diary. */
export interface DayView {
  /** YYYY-MM-DD, local time. */
  date: string;
  /** Kept days, newest first. */
  days: string[];
  /** Bytes per hour (0–23) by category; "" is traffic nobody named. */
  hours: Record<string, number>[];
  /** The day's categories, busiest first, with their words. */
  categories: { category: string; label: string; bytes: number }[];
  devices: { id: string; name: string; label?: string; kind?: string; bytes: number; top: { what?: Classification; bytes: number }[] }[];
  diary: Episode[];
  events: DayEvent[];
  /** Today: events not kept past the day's ceilings (a neighbour announcing hundreds of made-up devices). */
  dropped?: number;
  /** Today: the day's file reached its ceiling, and is no longer written. */
  full?: boolean;
  /** The networks the day was kept on (whatever was asked), busiest first, with their names as last seen. */
  networks: { id: string; name: string; bytes: number }[];
  /** Kept before networks were told apart (whatever was asked): how much, and until when; left out of a network's view. */
  untold?: { bytes: number; until: number };
  /** Total bytes the day kept, and from when to when it was listened to. */
  bytes: number;
  first?: number;
  last?: number;
}
