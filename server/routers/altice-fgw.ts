// The MEO Fiber Gateway (Altice Labs: the GR241AG family and the boxes after it, its page an AngularJS app on
// micro_httpd), as its own login page and scripts do it (login.js, fgw.common.dao.js), read from the box itself:
//
//   GET /                                    401, the login page: require.login.js and the "fgw" look
//   GET /ss-json/fgw.nonce.json              { nonce }: the session's (its SESSIONID cookie)
//   GET /ss-json/fgw.login.json              { remAttempts }: tries left before the page locks
//   GET /index.html                          Authorization: Digest sha256(hmac(nonce, sha256(user)) + hmac(nonce, sha256(password)))
//                                            200 and an X-XSRF-TOKEN: in; 401 or 403: refused
//   GET /ss-json/fgw.common/fgw.common.devicesAll.json   { devices: [{ intf, name, mac, ipv4, ssid?, status, … }] }
//   GET /logout.cmd                          out
//
// The password never crosses the network: only the HMAC of its hash with the session's nonce. Its factory password is
// not public: the login page itself says it is the Wi-Fi key on the label under the box, a different one per box.

import { createHash, createHmac } from 'node:crypto';
import { Refused, type RouterAdapter, type RouterClient } from '../routers.ts';

// As node-forge, which the box's page logs in with, hashes a string: a byte per character (its "raw"), not UTF-8. A
// password with an accent then gives what the box's own page gives.
const sha256 = (s: string) => createHash('sha256').update(Buffer.from(s, 'latin1')).digest('hex');
const hmac256 = (key: string, s: string) => createHmac('sha256', Buffer.from(key, 'latin1')).update(Buffer.from(s, 'latin1')).digest('hex');

/** The interface a device is on, as the box's own page names it (fgw.common.dao.js). */
const PORTS: Record<string, [RouterClient['link'], string]> = {
  wl0: ['wifi', '2.4GHz'],
  'wl0.3': ['wifi', '2.4GHz'],
  wl1: ['wifi', '5GHz'],
  'wl1.3': ['wifi', '5GHz'],
  wl2: ['wifi', '6GHz'],
  'wl2.3': ['wifi', '6GHz'],
  'eth0.0': ['cable', 'LAN 1'],
  'eth1.0': ['cable', 'LAN 2'],
  'eth2.0': ['cable', 'LAN 3'],
  'eth3.0': ['cable', 'LAN 4'],
  'eth4.0': ['cable', 'LAN 5'],
};

export const alticeFiberGateway: RouterAdapter = {
  id: 'altice-fgw',
  name: 'MEO Fiber Gateway (Altice Labs)',
  user: 'admin',
  defaults: [],
  factory: 'The user is admin; the factory password is the Wi-Fi key on the label under the box, a different one per box.',

  async detect(http, base) {
    const page = await http.get(`${base}/`);
    if (!/require\.login\.js/.test(page.text) || !/fgw-/.test(page.text)) return false;
    const nonce = await http.json(`${base}/ss-json/fgw.nonce.json`);
    return typeof (nonce.data as { nonce?: unknown } | undefined)?.nonce === 'string';
  },

  async attemptsLeft(http, base) {
    const r = await http.json(`${base}/ss-json/fgw.login.json`);
    const n = Number((r.data as { remAttempts?: unknown } | undefined)?.remAttempts);
    return Number.isFinite(n) ? n : undefined;
  },

  async read(http, base, user, password) {
    await http.get(`${base}/`);
    const nonce = (await http.json(`${base}/ss-json/fgw.nonce.json`)).data as { nonce?: unknown } | undefined;
    if (typeof nonce?.nonce !== 'string') throw new Error('the router gave no nonce to log in with');
    const n = nonce.nonce;
    const digest = sha256(hmac256(n, sha256(user)) + hmac256(n, sha256(password)));
    const login = await http.get(`${base}/index.html`, { Authorization: `Digest ${digest}` });
    if (login.status === 401 || login.status === 403) throw new Refused('refused');
    if (login.status !== 200) throw new Error(`its page answered ${login.status} to the login`);
    const xsrf = login.headers.get('x-xsrf-token');
    const headers = xsrf ? { 'X-XSRF-TOKEN': xsrf } : undefined;
    try {
      const r = await http.json(`${base}/ss-json/fgw.common/fgw.common.devicesAll.json`, headers);
      if (r.status !== 200) throw new Error(`the list of devices answered ${r.status}`);
      const devices = (r.data as { devices?: unknown } | undefined)?.devices;
      if (!Array.isArray(devices)) throw new Error('the list of devices was not in the form expected');
      return devices.flatMap((d): RouterClient[] => client(d as Record<string, unknown>));
    } finally {
      // Out again, whatever happened: the box keeps few sessions, and his own page should not find one taken.
      await http.get(`${base}/logout.cmd`, headers).catch(() => undefined);
    }
  },
};

function client(d: Record<string, unknown>): RouterClient[] {
  const mac = typeof d.mac === 'string' ? d.mac.toLowerCase() : '';
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) return [];
  const ip = typeof d.ipv4 === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(d.ipv4) && d.ipv4 !== '0.0.0.0' ? d.ipv4 : undefined;
  const name = typeof d.name === 'string' ? d.name.trim().replace(/[\u0000-\u001f]/g, '').slice(0, 128) : '';
  const [link, port] = PORTS[String(d.intf ?? '')] ?? [undefined, undefined];
  const ssid = typeof d.ssid === 'string' && d.ssid ? d.ssid.slice(0, 64) : undefined;
  return [
    {
      mac,
      ...(ip ? { ip } : {}),
      // The box names a device it has no name for by its MAC: that is no name.
      ...(name && name.toLowerCase() !== mac ? { hostname: name } : {}),
      ...(link ? { link } : {}),
      ...(port ? { port } : {}),
      ...(ssid ? { ssid } : {}),
      connected: Number(d.status) === 1,
    },
  ];
}
