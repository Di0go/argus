// What Argus knows, as entities (the core's EntityGraph: a kind, an id, a name, links). The kinds are Argus's own.
// Today: the devices on the local network, the hosts out on the internet they talk to, the interfaces a capture
// listened on, and the captures. To come: domains and companies (DNS, the TLS SNI), services and apps, conversations.

import type { EntityRef, Link } from '@organon/core/shared/entities';

export type Kind = 'device' | 'remote' | 'interface' | 'capture';

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
}

/** A host out on the internet, by address, named by what this network asked of DNS or said in TLS. */
export interface Remote extends EntityRef, Traffic {
  kind: 'remote';
  ip: string;
  names: { name: string; source: NameSource }[];
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
  /** live: captured here; file: a recording brought in (the demo, a fixture). */
  source: 'live' | 'file';
  packets?: number;
  bytes?: number;
}

export interface HostsView {
  capture: Capture;
  devices: Device[];
  remotes: Remote[];
  links: Link[];
}

export type ArgusEntity = Device | Remote | Interface;
