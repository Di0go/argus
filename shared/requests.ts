// The HTTP requests read (server/requests.ts) as the page and the agent ask for them: by device, by domain, by method,
// on the networks shown; and the TLS conversations in which none could be read, said as such.

import type { Conversation, HttpRequest } from './types.ts';

export interface RequestFilter {
  /** A device's id: the one that asked. */
  device?: string;
  /** A name: the host itself, or any host under it ("example.com" takes "www.example.com"). */
  host?: string;
  /** GET, POST…, in any case. */
  method?: string;
  /** The networks shown; none: all of them. */
  networks?: Set<string>;
}

export function matches(r: HttpRequest, f: RequestFilter): boolean {
  if (f.device && r.device !== f.device) return false;
  if (f.method && r.method.toUpperCase() !== f.method.toUpperCase()) return false;
  if (f.host) {
    const h = f.host.toLowerCase().replace(/^\*?\./, '');
    if (r.host !== h && !r.host.endsWith(`.${h}`)) return false;
  }
  if (f.networks && !(r.network && f.networks.has(r.network))) return false;
  return true;
}

/** Whether a conversation is one TLS (or QUIC) carries: by what it agreed, what tshark said it was, or HTTPS's port. */
export function encrypted(c: Conversation): boolean {
  return Boolean(c.tls) || c.protocol === 'tls' || c.protocol === 'quic' || c.service === 'tcp/443' || c.service === 'udp/443';
}

/** The encrypted conversations in which nothing was read, by the device that held them (or only `device`'s), the busiest first. */
export function unreadOf(conversations: Conversation[], device?: string): { device: string; conversations: number; bytes: number }[] {
  const by = new Map<string, { device: string; conversations: number; bytes: number }>();
  for (const c of conversations) {
    if (c.read || !encrypted(c) || !c.a.startsWith('device:')) continue;
    const id = c.a.slice('device:'.length);
    if (device && id !== device) continue;
    const u = by.get(id) ?? { device: id, conversations: 0, bytes: 0 };
    u.conversations++;
    u.bytes += c.sent + c.received;
    by.set(id, u);
  }
  return [...by.values()].sort((a, b) => b.bytes - a.bytes);
}
