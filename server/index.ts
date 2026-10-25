// The Argus server: the core's (the interface, health and state, the checks in front, MCP at /mcp) with Argus's routes:
// the interfaces, the captures and what each one saw.
//
//   GET  /api/interfaces            the interfaces, named as he would, and whether this user can capture on them
//   GET  /api/captures              every capture, newest first
//   POST /api/captures              { interfaces: [...], seconds } starts one (30 s by default)
//   GET  /api/captures/<id>         one capture, and once it is done, its devices, internet hosts and links
//   DELETE /api/captures/<id>       removes it and its file
//   GET  /api/hosts[?capture=<id>]  the newest finished capture's view (or that one's)

import { ApiError, json, type Route, readJson, serve } from '@organon/core/server/http';
import { createMcpHandler } from '@organon/core/server/mcp';
import { createSettings } from '@organon/core/server/settings';
import { createStore } from '@organon/core/server/store';
import { Warnings } from '@organon/core/server/warnings';
import { listInterfaces } from './capture.ts';
import { CaptureError, Captures } from './captures.ts';
import { DissectError } from './dissect.ts';
import { app, CAPTURES_DIR, DUMPCAP, SEED_PCAP, SYS_NET, TSHARK } from './config.ts';
import { argusTools, instructions } from './tools.ts';

const warnings = new Warnings();
const settings = createSettings({ file: app.settingsFile, warnings, apiKey: app.apiKey });
const store = createStore({ dataDir: app.dataDir, warnings });
const tools = { dumpcap: DUMPCAP, tshark: TSHARK, sysNet: SYS_NET };
const captures = await new Captures(CAPTURES_DIR, store, tools).load();
if (!captures.all().length && SEED_PCAP) {
  try {
    await captures.import(SEED_PCAP, ['exemplo']);
  } catch (err) {
    warnings.set('seed', `A gravação de exemplo não se leu: ${(err as Error).message}`);
  }
}

await serve(app, {
  warnings,
  accent: () => settings.accent,
  state: () => ({ captures: captures.all(), running: captures.all().some((c) => c.status === 'running') }),
  mcp: createMcpHandler(app, { instructions, tools: () => argusTools(captures), core: ['get_hosts'] }),
  stop: async () => {
    await captures.idle();
  },
  api: (req, res, route, params) =>
    routes(req, res, route, params).catch((err) => {
      // tshark missing or failing is said, not a bare server error.
      if (err instanceof DissectError) throw new ApiError(503, err.message);
      throw err;
    }),
});

async function routes(...[req, res, route, params]: Parameters<Route>): Promise<boolean> {
    const tail = (prefix: string) => decodeURIComponent(route.slice(prefix.length));
    if (req.method === 'GET' && route === '/api/interfaces') return json(res, 200, await listInterfaces(tools));
    if (req.method === 'GET' && route === '/api/captures') return json(res, 200, captures.all());
    if (req.method === 'POST' && route === '/api/captures') {
      const body = (await readJson(req)) as { interfaces?: unknown; seconds?: unknown } | undefined;
      const interfaces = Array.isArray(body?.interfaces) ? body.interfaces.filter((i): i is string => typeof i === 'string') : [];
      const { interfaces: known, problem } = await listInterfaces(tools);
      if (problem && !known.some((i) => i.capturable)) throw new ApiError(409, `Ainda não dá para capturar: ${problem}`);
      try {
        const seconds = body?.seconds === undefined ? 30 : Number(body.seconds);
        return json(res, 202, await captures.start(interfaces, seconds, known.filter((i) => i.capturable).map((i) => i.id)));
      } catch (err) {
        if (err instanceof CaptureError) throw new ApiError(400, err.message);
        throw err;
      }
    }
    if (route.startsWith('/api/captures/')) {
      const c = captures.get(tail('/api/captures/'));
      if (!c) throw new ApiError(404, 'Essa captura não existe');
      if (req.method === 'DELETE') return json(res, (await captures.remove(c.id)) ? 200 : 409, { ok: true });
      if (req.method === 'GET') return json(res, 200, c.status === 'done' ? await captures.hosts(c) : { capture: c });
    }
    if (req.method === 'GET' && route === '/api/hosts') {
      const id = params.get('capture');
      const c = id ? captures.get(id) : captures.latest();
      if (!c) throw new ApiError(404, id ? 'Essa captura não existe' : 'Ainda não há capturas');
      if (c.status !== 'done') return json(res, 200, { capture: c });
      return json(res, 200, await captures.hosts(c));
    }
    return false;
}
