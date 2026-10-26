// The dictionary, loaded: the open sources in shared/dictionary/ (scripts/dictionary.ts brings them) and its words
// (shared/dictionary/apps.ts), with the house's own on top when there are any (data/dicionario.json: names that are
// this house's alone, its work's domains or its devices' clouds, which never go in the repository). What it says of a
// host or a conversation is given to them by the tally (server/tally.ts); `classify` is for whoever else asks.
//
// data/dicionario.json, all optional: { "domains": { "example.com": { "company": "…", "app": "…", "category": "work",
// "activity": "a trabalhar" } }, "asns": { "64500": { … } }, "ports": { "tcp/8123": { … } } }, the fields of an Entry.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { type Classification, type Clue, Dictionary, type DictionaryData, type Words } from '../shared/classify.ts';
import { ASNS, CATEGORIES, DOMAINS, type Entry, LISTS, PORTS, PROTOCOLS } from '../shared/dictionary/apps.ts';

const DIR = path.resolve(import.meta.dirname, '../shared/dictionary');
const read = (name: string) => JSON.parse(readFileSync(path.join(DIR, name), 'utf8'));
const DATA: DictionaryData = { v2fly: read('v2fly.json'), psl: read('psl.json'), asn: read('asn.json') };
const WORDS: Words = { lists: LISTS, domains: DOMAINS, asns: ASNS, ports: PORTS, protocols: PROTOCOLS };

let dictionary = new Dictionary(DATA, WORDS);
/** What it said, by clue: a live session asks of the same hosts every second. */
let said = new Map<string, Classification | undefined>();
const SAID = 50_000;

/** What the house file adds, checked: an entry with a category that is not one is left out, and said. */
export function loadHouse(file: string): { entries: number; problems: string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    // No file (or one that does not read): the dictionary's own words only.
    dictionary = new Dictionary(DATA, WORDS);
    said = new Map();
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { entries: 0, problems: [] };
    return { entries: 0, problems: [`${file}: ${(err as Error).message}`] };
  }
  const problems: string[] = [];
  const section = (key: string): Record<string, Entry> => {
    const s = (raw as Record<string, unknown>)?.[key];
    if (!s || typeof s !== 'object') return {};
    const out: Record<string, Entry> = {};
    for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
      const e = v as Entry;
      if (!e || typeof e !== 'object' || (e.category && !(e.category in CATEGORIES))) {
        problems.push(`${key}.${k}: unknown category`);
        continue;
      }
      out[key === 'domains' ? k.toLowerCase().replace(/\.$/, '') : k] = e;
    }
    return out;
  };
  const house = { domains: section('domains'), asns: section('asns'), ports: section('ports') };
  dictionary = new Dictionary(DATA, {
    lists: LISTS,
    domains: { ...DOMAINS, ...house.domains },
    asns: { ...ASNS, ...house.asns },
    ports: { ...PORTS, ...house.ports },
    protocols: PROTOCOLS,
  });
  said = new Map();
  return { entries: Object.keys(house.domains).length + Object.keys(house.asns).length + Object.keys(house.ports).length, problems };
}

/** What a conversation or a host is, in plain words (shared/classify.ts). */
export function classify(clue: Clue): Classification | undefined {
  const key = `${clue.ip ?? ''}|${clue.service ?? ''}|${clue.protocol ?? ''}|${(clue.names ?? []).join(' ')}`;
  if (said.has(key)) return said.get(key);
  const c = dictionary.classify(clue);
  if (said.size >= SAID) said.clear();
  said.set(key, c);
  return c;
}

export function siteOf(name: string): string | undefined {
  return dictionary.siteOf(name.toLowerCase().replace(/\.$/, ''));
}

