// What a device is doing, in a verb: "Watching Netflix", "On a WhatsApp call", "Updating Windows"; and what it did,
// in the past, for the diary: "watched Netflix". From the dictionary's words (shared/classify.ts): its category says
// the verb, its app (or company, or site) the object. Used by the pages and by the agent alike.

import type { Classification } from './classify.ts';

/** The categories that are the network at work, not someone doing something: never the headline of a device. */
export const BACKGROUND = new Set(['network', 'accounts', 'ads', 'telemetry', 'cdn']);

/** What a classification is called: its app, else its company, else its site. */
export function subject(w: Pick<Classification, 'app' | 'company' | 'site'> | undefined): string | undefined {
  return w?.app ?? w?.company ?? w?.site;
}

/** `up`: the activity says it was mostly sent (server/interpret.ts: uploading to a CDN or cloud). */
type Verb = (x: string | undefined, up?: boolean) => [now: string, past: string];

const VERBS: Record<string, Verb> = {
  video: (x) => [x ? `Watching ${x}` : 'Watching video', x ? `watched ${x}` : 'watched video'],
  music: (x) => [x ? `Listening to ${x}` : 'Listening to music', x ? `listened to ${x}` : 'listened to music'],
  calls: (x) => [x ? `On a ${x} call` : 'On a call', x ? `was on a ${x} call` : 'was on a call'],
  messaging: (x) => [x ? `Messaging on ${x}` : 'Messaging', x ? `messaged on ${x}` : 'messaged'],
  social: (x) => [x ? `On ${x}` : 'On social media', x ? `was on ${x}` : 'was on social media'],
  games: (x) => [x ? `Playing ${x}` : 'Playing', x ? `played ${x}` : 'played'],
  updates: (x) => {
    const what = x?.replace(/ (Update|updates)$/i, '');
    return [what ? `Updating ${what}` : 'Updating software', what ? `updated ${what}` : 'updated software'];
  },
  cloud: (x) => [x ? `Syncing with ${x}` : 'Syncing with the cloud', x ? `synced with ${x}` : 'synced with the cloud'],
  work: (x) => [x ? `Using ${x}` : 'Working', x ? `used ${x}` : 'worked'],
  ai: (x) => [x ? `Using ${x}` : 'Talking to an AI assistant', x ? `used ${x}` : 'talked to an AI assistant'],
  'smart-home': (x) => [x ? `Talking to ${x}` : 'Talking to its cloud', x ? `talked to ${x}` : 'talked to its cloud'],
  web: (x) => [x ? `Browsing ${x}` : 'Browsing', x ? `browsed ${x}` : 'browsed'],
  search: (x) => [x ? `Searching on ${x}` : 'Searching', x ? `searched on ${x}` : 'searched'],
  email: (x) => [x ? `On ${x} mail` : 'On email', x ? `used ${x} mail` : 'used email'],
  news: (x) => [x ? `Reading ${x}` : 'Reading the news', x ? `read ${x}` : 'read the news'],
  shopping: (x) => [x ? `Shopping on ${x}` : 'Shopping', x ? `shopped on ${x}` : 'shopped'],
  finance: (x) => [x ? `Banking or paying (${x})` : 'Banking or paying', x ? `banked or paid (${x})` : 'banked or paid'],
  accounts: (x) => [x ? `Signing in to ${x}` : 'Signing in', x ? `signed in to ${x}` : 'signed in'],
  vpn: (x) => [x ? `Through ${x}` : 'Through a VPN', x ? `went through ${x}` : 'went through a VPN'],
  ads: (x) => [x ? `Talking to ${x}'s ads and tracking` : 'Talking to ads and trackers', x ? `talked to ${x}'s ads and tracking` : 'talked to ads and trackers'],
  telemetry: (x) => [x ? `Sending telemetry to ${x}` : 'Sending telemetry', x ? `sent telemetry to ${x}` : 'sent telemetry'],
  cdn: (x, up) =>
    up ? [x ? `Uploading to ${x}` : 'Uploading', x ? `uploaded to ${x}` : 'uploaded'] : [x ? `Downloading from ${x}` : 'Downloading', x ? `downloaded from ${x}` : 'downloaded'],
  network: (x) => [x ? `${x}: the network at work` : 'The network at work', x ? `talked to ${x}` : 'kept the network going'],
  adult: () => ['On adult sites', 'was on adult sites'],
};

/**
 * "Watching Netflix" (now) or "watched Netflix" (past); a site the dictionary does not know, by its name ("Using
 * example.org"); traffic to addresses with no name at all, said as that.
 */
export function doing(w: Classification | undefined, tense: 'now' | 'past' = 'now'): string {
  if (!w) return tense === 'now' ? 'Talking to hosts with no name' : 'talked to hosts with no name';
  if (w.by === 'site') return tense === 'now' ? `Using ${w.site}` : `used ${w.site}`;
  const verb = VERBS[w.category];
  const x = w.carrier ? w.company : subject(w);
  if (!verb) return tense === 'now' ? capital(w.activity) : w.activity;
  return verb(x, w.activity.startsWith('uploading'))[tense === 'now' ? 0 : 1];
}

/**
 * Video that is not yet a stream: a visit to the site ("Browsing YouTube"). Watching is said only of minutes on end of
 * streaming (server/history.ts): one fetch of a home page is a megabyte, and no one watched anything.
 */
export function visit(w: Classification, label = 'Web'): Classification {
  return { ...w, category: 'web', label, activity: 'browsing' };
}

/** Several things at once: "On a Google Meet call, using npm"; at most three. */
export function doingList(ws: (Classification | undefined)[]): string {
  const said = [...new Set(ws.slice(0, 3).map((w) => doing(w)))];
  return said.map((s, i) => (i ? s.charAt(0).toLowerCase() + s.slice(1) : s)).join(', ');
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Traffic the dictionary has no word for, to a host with a name: said by its site (the registrable name), and never
 * given a category (the day's chart says "Not named").
 */
export function siteOnly(site: string): Classification {
  // The history's keys are joined by "|": a name that came in off the network loses any.
  const name = site.replaceAll('|', '');
  return { category: 'web', label: 'Not named', activity: 'using', tracking: false, site: name, by: 'site', rule: name };
}

/** The key a stretch of traffic is added up under in the history: what it is, in the dictionary's words. */
export function keyOf(w: Classification | undefined): string {
  if (!w) return '';
  // A site only: no category, its name last.
  if (w.by === 'site') return ['', '', '', 'using', '', '', w.site ?? ''].join('|');
  return [w.category, w.company ?? '', w.carrier ? '' : (w.app ?? ''), w.activity, w.tracking ? 't' : '', w.carrier ? 'c' : ''].join('|');
}

/** A key read back into the words it was made of (the label is the category's, given by the caller). */
export function fromKey(key: string, label: (category: string) => string): Classification | undefined {
  if (!key) return undefined;
  const [category = 'web', company, app, activity = '', t, c, site] = key.split('|');
  if (site) return siteOnly(site);
  return {
    category: category as Classification['category'],
    label: label(category),
    activity,
    tracking: t === 't',
    ...(company ? { company } : {}),
    ...(app ? { app } : {}),
    ...(c === 'c' ? { carrier: true } : {}),
    by: 'name',
    rule: '',
  };
}

/** What a stretch of traffic is grouped under for "doing" and the diary: its app, else company, else category. */
export function groupOf(w: Classification | undefined): string {
  if (w?.by === 'site') return `site:${w.site ?? ''}`;
  return w ? (w.carrier ? `carrier:${w.company ?? ''}` : (w.app ?? w.company ?? `category:${w.category}`)) : 'unknown';
}
