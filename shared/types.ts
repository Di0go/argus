// What Argus knows, as entities (the core's EntityGraph: a kind, an id, a name, links). The kinds are Argus's own.
// Today: the devices on the local network, the hosts out on the internet they talk to, the interfaces it listens on,
// and the captures saved. To come: domains and companies (DNS, the TLS SNI), services and apps, conversations.
//
// And what the live session is: the interfaces being listened on, what they add up to, and the bandwidth over time.

import type { EntityRef, Link } from '@organon/core/shared/entities';

export type Kind = 'device' | 'remote' | 'site' | 'interface' | 'capture';

/** Where a device's name came from, as he would say it. */
export type NameSource = 'DHCP' | 'mDNS' | 'NetBIOS' | 'DNS' | 'TLS';

export interface Traffic {
  packets: number;
  /** Bytes in frames it sent, and in frames sent to it. */
  bytesSent: number;
  bytesReceived: number;
  /** Seconds since the epoch. */
  firstSeen: number;
  lastSeen: number;
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
}

/** A host out on the internet, by address, named by what this network asked of DNS or said in TLS. */
export interface Remote extends EntityRef, Traffic {
  kind: 'remote';
  ip: string;
  names: { name: string; source: NameSource }[];
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

export interface HostsView {
  capture: Capture;
  devices: Device[];
  remotes: Remote[];
  links: Link[];
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
  session: Session;
  devices: Device[];
  remotes: Remote[];
  links: Link[];
  /** The whole network: fine (a second per bucket, the last minutes) and coarse (a minute per bucket, the day). */
  total: { fine: SeriesData; coarse: SeriesData };
  /** Each device's fine series. */
  byDevice: Record<string, SeriesData>;
}

/**
 * On the live stream, once a second while something changes: the session, every device, the hosts and links that
 * changed, and the newest buckets of each series (to lay over what the page has).
 */
export interface LiveEvent {
  type: 'live';
  session: Session;
  devices: Device[];
  remotes: Remote[];
  links: Link[];
  /** Hosts forgotten (past the ceiling) since the last event. */
  gone: string[];
  total: { fine: SeriesData; coarse: SeriesData };
  byDevice: Record<string, SeriesData>;
}

/** The session began again: the page loads it whole. */
export interface ResetEvent {
  type: 'reset';
}

export type ArgusEvent = LiveEvent | ResetEvent | { type: 'captures'; captures: Capture[] };
