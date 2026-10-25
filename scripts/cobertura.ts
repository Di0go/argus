// How much of a capture the dictionary says in plain words: the share of the bytes and of the conversations whose app
// is known (shared/classify.ts), and the busiest that are not, to see what to add. Run on a real capture of a
// house, never committed: `node scripts/cobertura.ts <file.pcapng> [--top 40] [--json]`.
//
// A conversation is a device here and a host out on the internet (or another device here) by service, as the tally
// adds them up (server/tally.ts); what the dictionary says of each is what the tally gave it.

import { dissect } from '../server/dissect.ts';
import { ownMacs } from '../server/capture.ts';
import { loadHouse } from '../server/dictionary.ts';
import type { Conversation, Remote } from '../shared/types.ts';
import { serviceName } from '../shared/services.ts';
import { companyOf, siteOf } from '../shared/sites.ts';

const args = process.argv.slice(2);
const file = args.find((a, i) => !a.startsWith('--') && !/^\d+$/.test(a) && args[i - 1] !== '--casa');
if (!file) {
  console.error('node scripts/cobertura.ts <capture.pcapng> [--top 40] [--casa data/dicionario.json] [--antes] [--json]');
  process.exit(2);
}
const top = Number(args[args.indexOf('--top') + 1]) || 40;
// --casa <file>: the house's own words on top (data/dicionario.json), measured apart from the dictionary's.
const house = args.includes('--casa') ? args[args.indexOf('--casa') + 1] : undefined;
if (house) console.log(`The house's words: ${JSON.stringify(loadHouse(house))}`);
const r = await dissect(file, { tshark: process.env.TSHARK ?? 'tshark', ownMacs: ownMacs() });
const remotes = new Map<string, Remote>(r.remotes.map((h) => [`remote:${h.id}`, h]));

interface Share {
  bytes: number;
  conversations: number;
}
const zero = (): Share => ({ bytes: 0, conversations: 0 });
const scopes = { internet: { all: zero(), app: zero(), company: zero() }, all: { all: zero(), app: zero(), company: zero() } };
const missing = new Map<string, { bytes: number; conversations: number; what: string }>();

for (const c of r.conversations as Conversation[]) {
  const bytes = c.sent + c.received;
  const h = remotes.get(c.b);
  // --antes: what the code said before the dictionary, a company by the site's name (shared/sites.ts) and no app.
  const site = h?.names.map((n) => siteOf(n.name)).find(Boolean);
  const before = { app: undefined, company: site && companyOf(site) !== site ? companyOf(site) : undefined };
  // A carrier (a CDN, a cloud) says who carries the bytes, not the app: it counts for the company, never for the app.
  const known = args.includes('--antes') ? before : c.app && { app: c.app.carrier ? undefined : c.app.app, company: c.app.company };
  for (const [scope, s] of Object.entries(scopes)) {
    if (scope === 'internet' && !h) continue;
    s.all.bytes += bytes;
    s.all.conversations++;
    if (known?.app) {
      s.app.bytes += bytes;
      s.app.conversations++;
    }
    if (known?.company) {
      s.company.bytes += bytes;
      s.company.conversations++;
    }
  }
  if (!known?.app) {
    const what = h
      ? `${h.names.map((n) => n.name).slice(0, 3).join(', ') || `${h.ip} (no name)`} · ${serviceName(c.service)}${c.protocol ? ` (${c.protocol})` : ''}${known?.company ? ` · ${known.company}` : ''}`
      : `${c.b} · ${serviceName(c.service)}${c.protocol ? ` (${c.protocol})` : ''}`;
    const m = missing.get(what) ?? { bytes: 0, conversations: 0, what };
    m.bytes += bytes;
    m.conversations++;
    missing.set(what, m);
  }
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');
const mb = (n: number) => `${(n / 1e6).toFixed(1)} MB`;
const report = Object.fromEntries(
  Object.entries(scopes).map(([k, s]) => [
    k,
    {
      bytes: s.all.bytes,
      conversations: s.all.conversations,
      appBytes: s.app.bytes / (s.all.bytes || 1),
      appConversations: s.app.conversations / (s.all.conversations || 1),
      companyBytes: s.company.bytes / (s.all.bytes || 1),
      companyConversations: s.company.conversations / (s.all.conversations || 1),
    },
  ]),
);
if (args.includes('--json')) {
  console.log(JSON.stringify(report));
} else {
  console.log(`${file}: ${r.packets} packets, ${mb(r.bytes)}, ${r.remotes.length} hosts, ${r.conversations.length} conversations`);
  for (const [k, s] of Object.entries(scopes)) {
    console.log(
      `${k === 'internet' ? 'With the internet' : 'All'}: ${s.all.conversations} conversations, ${mb(s.all.bytes)}` +
        ` · app known: ${pct(s.app.bytes, s.all.bytes)} of the bytes, ${pct(s.app.conversations, s.all.conversations)} of the conversations` +
        ` · company: ${pct(s.company.bytes, s.all.bytes)} of the bytes, ${pct(s.company.conversations, s.all.conversations)} of the conversations`,
    );
  }
  // What it said, by app: to read whether it is right, not only whether it said something.
  const apps = new Map<string, { bytes: number; conversations: number }>();
  for (const c of r.conversations) {
    const a = c.app;
    const key = a ? `${a.company ?? '—'} · ${a.carrier ? '(carrier)' : (a.app ?? '—')} · ${a.activity} [${a.by} ${a.rule}]` : '(nothing)';
    const e = apps.get(key) ?? { bytes: 0, conversations: 0 };
    e.bytes += c.sent + c.received;
    e.conversations++;
    apps.set(key, e);
  }
  console.log(`\nWhat it said, by bytes (the first ${top}):`);
  for (const [k, e] of [...apps].sort((x, y) => y[1].bytes - x[1].bytes).slice(0, top)) console.log(`${mb(e.bytes).padStart(10)} ${String(e.conversations).padStart(4)}× ${k}`);
  console.log(`\nNo app, by bytes (the first ${top}):`);
  for (const m of [...missing.values()].sort((a, b) => b.bytes - a.bytes).slice(0, top)) {
    console.log(`${mb(m.bytes).padStart(10)} ${String(m.conversations).padStart(4)}× ${m.what}`);
  }
}
