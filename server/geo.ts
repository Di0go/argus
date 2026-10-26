// Where a host's network is: the network (AS) its address belongs to, who runs it, and the country it is registered
// in, from iptoasn.com's table (Public Domain, PDDL v1.0). The country is where the network is registered, not where
// the server stands: a CDN registered in the US may answer from Lisbon. Said so on the page.
//
// The table (9 MB) is not in the repository: `pnpm geo` downloads it into ~/.cache/argus (ARGUS_GEO_FILE elsewhere),
// one copy for every instance. Without it, Argus says nothing of where, and says why.

import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Where } from '../shared/types.ts';

export const GEO_URL = 'https://iptoasn.com/data/ip2asn-combined.tsv.gz';

export function geoFile(env = process.env): string {
  return env.ARGUS_GEO_FILE ?? path.join(env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'argus', 'ip2asn-combined.tsv.gz');
}

const regions = new Intl.DisplayNames(['en'], { type: 'region' });

export class Geo {
  private v4s = new Uint32Array(0);
  private v4e = new Uint32Array(0);
  private v4i = new Uint32Array(0);
  /** IPv6 by its upper 64 bits: the table's ranges are /64 or wider. */
  private v6s = new BigUint64Array(0);
  private v6e = new BigUint64Array(0);
  private v6i = new Uint32Array(0);
  /** Per row index: AS number, its name, its country. */
  private readonly nets: { asn: number; org: string; cc: string }[] = [];
  /** When the table was fetched (epoch seconds), and how many networks it holds. */
  readonly fetched?: number;
  readonly size: number = 0;

  constructor(tsv?: string, fetched?: number) {
    this.fetched = fetched;
    if (!tsv) return;
    const v4: [number, number, number][] = [];
    const v6: [bigint, bigint, number][] = [];
    const netIndex = new Map<string, number>();
    for (const line of tsv.split('\n')) {
      const [start, end, asn, cc, org] = line.split('\t');
      if (!start || !end || !asn || asn === '0') continue;
      const key = `${asn}\t${cc}`;
      let i = netIndex.get(key);
      if (i === undefined) {
        i = this.nets.push({ asn: Number(asn), org: tidy(org ?? ''), cc: cc ?? '' }) - 1;
        netIndex.set(key, i);
      }
      if (start.includes(':')) v6.push([ipv6(start) >> 64n, ipv6(end) >> 64n, i]);
      else v4.push([ipv4(start), ipv4(end), i]);
    }
    v4.sort((a, b) => a[0] - b[0]);
    this.v4s = Uint32Array.from(v4, (r) => r[0]);
    this.v4e = Uint32Array.from(v4, (r) => r[1]);
    this.v4i = Uint32Array.from(v4, (r) => r[2]);
    v6.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    this.v6s = BigUint64Array.from(v6, (r) => r[0]);
    this.v6e = BigUint64Array.from(v6, (r) => r[1]);
    this.v6i = Uint32Array.from(v6, (r) => r[2]);
    this.size = netIndex.size;
  }

  static load(file = geoFile()): Geo {
    if (!existsSync(file)) return new Geo();
    try {
      const raw = readFileSync(file);
      const text = file.endsWith('.gz') ? gunzipSync(raw).toString() : raw.toString();
      return new Geo(text, statSync(file).mtimeMs / 1000);
    } catch {
      return new Geo();
    }
  }

  /** Whether there is a table at all. */
  get ready(): boolean {
    return this.size > 0;
  }

  where(ip: string): Where | undefined {
    const i = ip.includes(':') ? this.find6(ip) : this.find4(ip);
    const n = i === undefined ? undefined : this.nets[i];
    if (!n) return undefined;
    let country: string | undefined;
    try {
      country = n.cc && n.cc !== 'None' ? regions.of(n.cc) : undefined;
    } catch {
      country = undefined;
    }
    return { asn: n.asn, org: n.org, ...(country ? { cc: n.cc, country } : {}) };
  }

  private find4(ip: string): number | undefined {
    const x = ipv4(ip);
    let lo = 0;
    let hi = this.v4s.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.v4s[mid]! <= x) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi >= 0 && x <= this.v4e[hi]! ? this.v4i[hi] : undefined;
  }

  private find6(ip: string): number | undefined {
    let x: bigint;
    try {
      x = ipv6(ip) >> 64n;
    } catch {
      return undefined;
    }
    let lo = 0;
    let hi = this.v6s.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.v6s[mid]! <= x) lo = mid + 1;
      else hi = mid - 1;
    }
    return hi >= 0 && x <= this.v6e[hi]! ? this.v6i[hi] : undefined;
  }
}

/** "GOOGLE - Google LLC" → "Google LLC"; "AKAMAI-AS" stays. */
function tidy(org: string): string {
  const parts = org.split(' - ');
  return (parts.length > 1 ? parts.slice(1).join(' - ') : org).trim();
}

function ipv4(s: string): number {
  return s.split('.').reduce((n, o) => n * 256 + Number(o), 0) >>> 0;
}

function ipv6(s: string): bigint {
  const [head = '', tail = ''] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = s.includes('::') ? [...a, ...Array(8 - a.length - b.length).fill('0'), ...b] : a;
  if (groups.length !== 8) throw new Error(`not an IPv6 address: ${s}`);
  return groups.reduce((n, g) => (n << 16n) + BigInt(Number.parseInt(g || '0', 16)), 0n);
}
