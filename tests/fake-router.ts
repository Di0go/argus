// A pretend MEO Fiber Gateway (server/routers/altice-fgw.ts) on 127.0.0.1, for the tests and the demo: its login page,
// its nonce per session, the HMAC login, the tries it counts down before it locks, the list of devices, and logout, as
// the box's own scripts ask them. Nothing of a real router: made-up devices on a private LAN, real makers' OUIs with
// invented halves, and a password the test chooses. Every request is written down, to check what Argus asked and sent.

import { createHash, createHmac, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeDevice {
  intf: string;
  name: string;
  mac: string;
  ipv4: string;
  ssid?: string;
  status: number;
}

/** The made-up house the pretend router serves (the demo's, scripts/demo-ip.ts): two by Wi-Fi, one by cable, one gone. */
export const FAKE_DEVICES: FakeDevice[] = [
  { intf: 'wl1', name: 'Galaxy-S23', mac: 'D0:C2:4E:5E:B0:71', ipv4: '192.168.50.71', ssid: 'Willow House', status: 1 },
  { intf: 'wl0', name: 'plug-hall', mac: '24:0A:C4:5E:B0:61', ipv4: '192.168.50.61', ssid: 'Willow House', status: 1 },
  { intf: 'eth1.0', name: 'nas', mac: '00:11:32:5E:B0:62', ipv4: '192.168.50.62', status: 1 },
  { intf: 'wl1', name: '78:4F:43:5E:B0:80', mac: '78:4F:43:5E:B0:80', ipv4: '192.168.50.80', ssid: 'Willow House', status: 0 },
];

export interface FakeRouter {
  base: string;
  /** Every request: its path, and every header it carried. */
  requests: { path: string; headers: http.IncomingHttpHeaders }[];
  /** Tries left before the page locks (the box starts at five). */
  attempts: number;
  /** Sessions logged in and not logged out. */
  open(): number;
  close(): Promise<void>;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: string, s: string) => createHmac('sha256', k).update(s).digest('hex');

export async function fakeRouter(o: { password: string; user?: string; devices?: FakeDevice[]; attempts?: number }): Promise<FakeRouter> {
  const user = o.user ?? 'admin';
  const sessions = new Map<string, { nonce: string; in: boolean }>();
  const requests: FakeRouter['requests'] = [];
  const state = { attempts: o.attempts ?? 5 };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://router');
    requests.push({ path: url.pathname, headers: req.headers });
    const sid = /SESSIONID=(\w+)/.exec(req.headers.cookie ?? '')?.[1];
    let s = sid ? sessions.get(sid) : undefined;
    const head: Record<string, string> = { Server: 'micro_httpd', 'Cache-Control': 'no-cache' };
    if (!s) {
      const id = randomBytes(16).toString('hex');
      s = { nonce: randomBytes(16).toString('base64url').slice(0, 32), in: false };
      sessions.set(id, s);
      head['Set-Cookie'] = `SESSIONID=${id}; SameSite=Strict; Path=/; Max-Age=600; HttpOnly`;
    }
    const send = (status: number, body: string, type = 'application/json', more: Record<string, string> = {}) =>
      res.writeHead(status, { ...head, 'Content-Type': type, ...more }).end(body);
    switch (url.pathname) {
      case '/':
        return send(
          401,
          '<!doctype html><html><head><script src="basepack/requirejs-2.1.15/js/require.min.js" data-main="require.login.js"></script></head><body><div class="fgw-logo-brand"></div><form id="login"></form></body></html>',
          'text/html',
        );
      case '/ss-json/fgw.nonce.json':
        return send(200, `{\n   "nonce":        "${s.nonce}",\n"pad":null}`);
      case '/ss-json/fgw.login.json':
        return send(200, `{\n   "remAttempts":        "${state.attempts}",\n"pad":null}`);
      case '/index.html': {
        const auth = /^Digest ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '')?.[1];
        const good = sha256(hmac(s.nonce, sha256(user)) + hmac(s.nonce, sha256(o.password)));
        if (state.attempts <= 0) return send(403, '', 'text/html');
        if (auth !== good) {
          state.attempts--;
          return send(401, '', 'text/html');
        }
        s.in = true;
        state.attempts = o.attempts ?? 5;
        return send(200, '<!doctype html><html></html>', 'text/html', { 'X-XSRF-TOKEN': randomBytes(8).toString('hex') });
      }
      case '/ss-json/fgw.common/fgw.common.devicesAll.json':
        if (!s.in) return send(401, '', 'text/html');
        // As the box writes it: a template, so a comma may be left before a closing brace.
        return send(
          200,
          `{"devices":[${(o.devices ?? FAKE_DEVICES)
            .map((d) => `{"intf":"${d.intf}","name":"${d.name}","mac":"${d.mac}","ipv4":"${d.ipv4}","ipv6":"","ipv6LL":"","lease":"86400",${d.ssid ? `"ssid":"${d.ssid}",` : ''}"status":${d.status},"ipType":1,"type":0,}`)
            .join(',')}],"pad":null}`,
        );
      case '/logout.cmd':
        s.in = false;
        return send(200, '{}');
      default:
        return send(404, '', 'text/html');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    requests,
    get attempts() {
      return state.attempts;
    },
    set attempts(n: number) {
      state.attempts = n;
    },
    open: () => [...sessions.values()].filter((x) => x.in).length,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
