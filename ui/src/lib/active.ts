// Who in the house is using the network now: doing something that is not the network's own chatter, or moving at least
// 2 KB/s in a conversation with someone (announcements to everyone, a printer's or a speaker's, are not someone using
// it). Once in, a device stays ten seconds after it last was, so a line does not blink in and out. A call comes ahead
// of anything else, whatever the bytes. The rest are quiet.

import type { Conversation, Device, Interface } from '../../../shared/types.ts';
import { BACKGROUND, doing } from '../../../shared/words.ts';
import { house } from './house.ts';

const HOLD = 10_000;
const until = new Map<string, number>();

function using(d: Device, meter: number, talking: Set<string>): boolean {
  return (d.doing ?? []).some((x) => !BACKGROUND.has(x.what?.category ?? '')) || (meter >= 2048 && talking.has(`device:${d.id}`));
}

/** The devices heard in a conversation in the last `seconds`, either end. */
export function talkers(conversations: Conversation[], seconds = 20, now = Date.now() / 1000): Set<string> {
  const out = new Set<string>();
  for (const c of conversations)
    if (c.last >= now - seconds) {
      out.add(c.a);
      out.add(c.b);
    }
  return out;
}

export function score(d: Device, meter: number): number {
  return meter + ((d.doing ?? []).some((x) => x.what?.category === 'calls') ? 5e6 : 0);
}

export function split(
  devices: Device[],
  interfaces: Interface[],
  meters: Record<string, number>,
  talking: Set<string>,
  now = Date.now(),
): { active: Device[]; quiet: Device[] } {
  const users = house(devices, interfaces);
  const active: Device[] = [];
  const quiet: Device[] = [];
  for (const d of users) {
    if (using(d, meters[d.id] ?? 0, talking)) until.set(d.id, now + HOLD);
    ((until.get(d.id) ?? 0) > now ? active : quiet).push(d);
  }
  return { active, quiet };
}

/** What it is doing, in words: the headline and up to two more ("Talking to Claude, using GitHub"). */
export function saying(d: Device): { now: string; since?: number } {
  const all = (d.doing ?? []).filter((x) => !BACKGROUND.has(x.what?.category ?? ''));
  const top = all[0] ?? d.doing?.[0];
  if (!top) return { now: 'Moving data' };
  const rest = all.slice(1, 3).map((x) => doing(x.what).replace(/^./, (c) => c.toLowerCase()));
  return { now: [doing(top.what), ...rest].join(', '), since: top.since };
}
