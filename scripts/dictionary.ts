// Brings the dictionary's open sources in, each at a pinned version, into shared/dictionary/ (docs/dicionario.md says
// which sources and why, with their licences). `pnpm dictionary` to rebuild from the pins below; `--latest` to move
// the pins to what the sources publish today (then read the diff before committing it).
//
// - v2fly/domain-list-community (MIT): which service each domain is, as lists by service ("youtube", "whatsapp") and
//   by category ("category-ads-all", "category-games"). Kept: the domain → the list that names it, its attributes
//   (@ads), and which lists include which, so shared/dictionary/apps.ts can say who a list is.
// - The Public Suffix List (MPL-2.0): where the registrable part of a name starts ("example.co.uk", "x.pages.dev").
// - iptoasn.com (PDDL): the address ranges of the networks (AS) shared/dictionary/apps.ts names, for a host whose
//   name was never seen. Only those, not the whole table.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { ASNS, LISTS } from '../shared/dictionary/apps.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'shared/dictionary');
const PINS = {
  v2fly: '664598567e92d797bea11bb83cf939d1f37e9512',
  psl: '8437e5262f13305f94087abe699b4fe2be1d1de8',
};
const latest = process.argv.includes('--latest');

async function get(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

async function head(repo: string): Promise<string> {
  const r = JSON.parse((await get(`https://api.github.com/repos/${repo}/commits/HEAD`)).toString()) as { sha: string };
  return r.sha;
}

// v2fly ---------------------------------------------------------------------------------------------------------------

/** A list's own lines: domains (with their attributes) and the lists it includes (with the attribute they select). */
interface List {
  domains: { domain: string; full: boolean; attrs: string[] }[];
  includes: { list: string; attr?: string }[];
}

function parseList(text: string): List {
  const l: List = { domains: [], includes: [] };
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [rule = '', ...rest] = line.split(/\s+/);
    const attrs = rest.filter((a) => a.startsWith('@')).map((a) => a.slice(1));
    const m = /^(\w+):(.*)$/.exec(rule);
    const [type, value] = m ? [m[1], m[2] ?? ''] : ['domain', rule];
    if (type === 'include') l.includes.push({ list: value, attr: attrs[0] });
    else if (type === 'domain' || type === 'full') l.domains.push({ domain: value.toLowerCase(), full: type === 'full', attrs });
    // regexp: and keyword: are left out: few, and a dictionary by suffix cannot hold them.
  }
  return l;
}

/** Lists for China only: their domains are not this house's, and they are most of the source. */
const chinese = (name: string) => name === 'cn' || /-cn$|^cn-|@cn/.test(name);

async function v2fly(sha: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'argus-v2fly-'));
  try {
    const tar = path.join(dir, 'v2fly.tar.gz');
    writeFileSync(tar, await get(`https://codeload.github.com/v2fly/domain-list-community/tar.gz/${sha}`));
    execFileSync('tar', ['-xzf', tar, '-C', dir, '--wildcards', '*/data/*', '*/LICENSE']);
    const top = readdirSync(dir).find((f) => f.startsWith('domain-list-community-'))!;
    const data = path.join(dir, top, 'data');
    const lists = new Map<string, List>();
    for (const f of readdirSync(data)) if (!chinese(f)) lists.set(f, parseList(readFileSync(path.join(data, f), 'utf8')));
    const license = readFileSync(path.join(dir, top, 'LICENSE'), 'utf8').trim();

    // Each domain under the list that names it; named by two, under the smaller (the more particular: googlevideo.com
    // is in "youtube", which "google" includes).
    const size = new Map<string, number>();
    const sizeOf = (name: string, seen = new Set<string>()): number => {
      if (size.has(name)) return size.get(name)!;
      if (seen.has(name)) return 0;
      seen.add(name);
      const l = lists.get(name);
      const n = l ? l.domains.length + l.includes.reduce((a, i) => a + sizeOf(i.list, seen), 0) : 0;
      size.set(name, n);
      return n;
    };
    const domains: Record<string, [string, number]> = {};
    for (const [name, l] of lists) {
      for (const d of l.domains) {
        if (d.attrs.includes('cn')) continue;
        // 1: an ad or tracker; 2: this name only, not what is under it; 4: telemetry.
        const flags = (d.attrs.includes('ads') ? 1 : 0) | (d.full ? 2 : 0) | (d.attrs.includes('telemetry') ? 4 : 0);
        const had = domains[d.domain];
        if (!had || sizeOf(name) < sizeOf(had[0])) domains[d.domain] = [name, flags | (had ? had[1] & 5 : 0)];
        else had[1] |= flags & 5;
      }
    }
    // Who includes whom: a list no app names is said by the one that includes it (google-ads by google), and its
    // category by the category lists that include it. An include with an attribute selects part of a list: kept with it.
    const parents: Record<string, string[]> = {};
    for (const [name, l] of lists) {
      for (const i of l.includes) {
        if (!lists.has(i.list)) continue;
        const key = i.attr ? `${name}@${i.attr}` : name;
        (parents[i.list] ??= []).includes(key) || parents[i.list]!.push(key);
      }
    }
    // Only what someone is: a domain whose list, or a list that includes it, apps.ts names. The rest would say nothing.
    const said = new Map<string, boolean>();
    const known = (name: string, seen = new Set<string>()): boolean => {
      if (said.has(name)) return said.get(name)!;
      if (seen.has(name)) return false;
      seen.add(name);
      const k = name in LISTS || (parents[name] ?? []).some((p) => !p.includes('@') && known(p, seen));
      said.set(name, k);
      return k;
    };
    const kept = Object.fromEntries(Object.entries(domains).filter(([, [list]]) => known(list)));
    // And of who includes whom, only the ways up to a list that is named.
    const ways = Object.entries(parents)
      .filter(([l]) => known(l))
      .map(([l, ps]) => [l, ps.filter((p) => !p.includes('@') && known(p))] as const)
      .filter(([, ps]) => ps.length);
    return { license, domains: kept, parents: Object.fromEntries(ways) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// The Public Suffix List --------------------------------------------------------------------------------------------

async function psl(sha: string) {
  const text = (await get(`https://raw.githubusercontent.com/publicsuffix/list/${sha}/public_suffix_list.dat`)).toString();
  const rules = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('//'))
    .map((l) => l.split(/\s/)[0]!.toLowerCase());
  return { rules };
}

// iptoasn -----------------------------------------------------------------------------------------------------------

async function asns() {
  const want = new Set(Object.keys(ASNS).map(Number));
  const tsv = gunzipSync(await get('https://iptoasn.com/data/ip2asn-combined.tsv.gz')).toString();
  const v4: [string, string, number][] = [];
  const v6: [string, string, number][] = [];
  for (const line of tsv.split('\n')) {
    const [start, end, asn] = line.split('\t');
    if (!start || !end || !want.has(Number(asn))) continue;
    const list = start.includes(':') ? v6 : v4;
    // Ranges of the same network one after the other are one (the table is sorted by start).
    const last = list.at(-1);
    if (last && last[2] === Number(asn) && next(last[1]) === start) last[1] = end;
    else list.push([start, end, Number(asn)]);
  }
  return { fetched: new Date().toISOString().slice(0, 10), v4, v6 };
}

/** The address after `ip`, written as iptoasn writes them (IPv4 dotted, IPv6 shortened). */
function next(ip: string): string {
  if (!ip.includes(':')) {
    const n = ip.split('.').reduce((a, o) => a * 256 + Number(o), 0) + 1;
    return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
  }
  const [head = '', tail] = ip.split('::');
  const a = head ? head.split(':') : [];
  const b = tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  const n = groups.reduce((acc, g) => (acc << 16n) + BigInt(Number.parseInt(g || '0', 16)), 0n) + 1n;
  const hex = n.toString(16).padStart(32, '0').match(/.{4}/g)!.map((g: string) => g.replace(/^0+(?=.)/, ''));
  // Shortened as URL writes it: the longest run of zeros as "::".
  return new URL(`http://[${hex.join(':')}]`).hostname.slice(1, -1);
}

// -------------------------------------------------------------------------------------------------------------------

const pins = latest ? { v2fly: await head('v2fly/domain-list-community'), psl: await head('publicsuffix/list') } : PINS;
const [v, p, a] = await Promise.all([v2fly(pins.v2fly), psl(pins.psl), asns()]);
const write = (name: string, value: object) => writeFileSync(path.join(OUT, name), `${JSON.stringify(value)}\n`);
write('v2fly.json', {
  source: `https://github.com/v2fly/domain-list-community/tree/${pins.v2fly}/data`,
  license: v.license,
  domains: v.domains,
  parents: v.parents,
});
write('psl.json', {
  source: `https://github.com/publicsuffix/list/blob/${pins.psl}/public_suffix_list.dat`,
  license: 'This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.',
  rules: p.rules,
});
write('asn.json', {
  source: 'https://iptoasn.com/data/ip2asn-combined.tsv.gz',
  license: 'Public Domain (PDDL v1.0), iptoasn.com',
  ...a,
});
console.log(
  `v2fly ${pins.v2fly.slice(0, 7)}: ${Object.keys(v.domains).length} domains · PSL ${pins.psl.slice(0, 7)}: ${p.rules.length} rules · ` +
    `${a.v4.length + a.v6.length} ranges of ${Object.keys(ASNS).length} networks`,
);
if (latest) console.log(`New pins: ${JSON.stringify(pins)} (write them in PINS)`);
