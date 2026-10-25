// The page from the address, each with ?c=<capture> to look at a saved capture instead of the live session:
//
//   #/                    Agora: the live session (what is being listened on, the bandwidth, who is busy)
//   #/devices             every device         #/device/<id>     one device
//   #/internet            the hosts out there, by company        #/site/<name>  one company or site
//   #/remote/<ip>         one host             #/interface/<id>  one interface
//   #/captures            the captures saved   #/capture/<id>    one, as it was

import { createRouter, hashParts, hashQuery } from '@organon/core/ui/router';
import { createTabs } from '@organon/core/ui/tabs';

export type Route =
  | { page: 'now' }
  | { page: 'devices' }
  | { page: 'device'; id: string }
  | { page: 'internet' }
  | { page: 'site'; id: string }
  | { page: 'remote'; id: string }
  | { page: 'interface'; id: string }
  | { page: 'captures' }
  | { page: 'capture'; id: string };

export type Located = Route & { capture?: string };

function parse(hash: string): Located {
  const [first, ...rest] = hashParts(hash);
  const id = rest.join('/');
  const capture = hashQuery(hash).get('c') ?? undefined;
  const r = (route: Route): Located => ({ ...route, capture });
  if ((first === 'device' || first === 'remote' || first === 'site' || first === 'interface') && id) return r({ page: first, id });
  if (first === 'capture' && id) return { page: 'capture', id, capture: id };
  if (first === 'devices' || first === 'internet' || first === 'captures') return r({ page: first });
  return r({ page: 'now' });
}

export const router = createRouter(parse);
export const tabs = createTabs({ key: 'argus.tabs' });

const q = (capture?: string) => (capture ? `?c=${encodeURIComponent(capture)}` : '');
const e = encodeURIComponent;

export const link = {
  now: () => '#/',
  devices: (c?: string) => `#/devices${q(c)}`,
  device: (id: string, c?: string) => `#/device/${e(id)}${q(c)}`,
  internet: (c?: string) => `#/internet${q(c)}`,
  site: (id: string, c?: string) => `#/site/${e(id)}${q(c)}`,
  remote: (id: string, c?: string) => `#/remote/${e(id)}${q(c)}`,
  interface: (id: string) => `#/interface/${e(id)}`,
  captures: () => '#/captures',
  capture: (id: string) => `#/capture/${e(id)}`,
};

/** An entity's page, by its kind. */
export function entityHref(kind: string, id: string, capture?: string): string {
  if (kind === 'device') return link.device(id, capture);
  if (kind === 'remote') return link.remote(id, capture);
  if (kind === 'site') return link.site(id, capture);
  if (kind === 'interface') return link.interface(id);
  if (kind === 'capture') return link.capture(id);
  return link.now();
}
