// The tools an agent uses to ask Argus what it sees, over MCP (the core's handler, server/index.ts). They only read:
// he turns listening on and off, and saves captures, on the page. The descriptions are all a client knows of each
// tool, so they carry what the answers can and cannot say.

import { defineTools, error, json, READ_ONLY, z } from '@organon/core/server/mcp';
import { EntityGraph, keyOf } from '@organon/core/shared/entities';
import type { Link } from '@organon/core/shared/entities';
import type { Capture, Device, Remote, Session } from '../shared/types.ts';
import type { Captures } from './captures.ts';
import type { Live } from './live.ts';

const LIMITS =
  'What is encrypted is not read: only who talked to whom, when and how much. On a PC on a switched network, the capture sees ' +
  "mostly this PC's own traffic and the broadcast and multicast of the others, not what other devices send to each other.";

export function instructions(): string {
  return (
    'Argus is a readable network spy on tshark: it listens, live, on the interfaces he turns on, and says which devices are on ' +
    'the local network (name, address, maker, how much they send, how fast right now) and which hosts out on the internet they ' +
    'talk to. He turns listening on and saves captures on the page (https://argus.test); you read. ' +
    `Start with get_hosts. ${LIMITS}`
  );
}

/** A device as the agent reads it: what he would ask about, without the counters' noise. */
function deviceLine(d: Device) {
  return {
    id: d.id,
    name: d.name,
    ...(d.role ? { role: d.role === 'gateway' ? 'router (the way out to the internet)' : 'this PC' } : {}),
    ips: d.ips,
    mac: d.mac,
    vendor: d.vendor ?? (d.randomMac ? 'unknown: a random (private) MAC' : undefined),
    names: d.names.map((n) => `${n.name} (${n.source})`),
    sent: d.bytesSent,
    received: d.bytesReceived,
    ...(d.rate ? { bytesPerSecondNow: d.rate.sent + d.rate.received } : {}),
    lastSeen: new Date(d.lastSeen * 1000).toISOString(),
    interfaces: d.interfaces,
  };
}

function remoteLine(r: Remote) {
  return { ip: r.ip, name: r.name, names: r.names.map((n) => `${n.name} (${n.source})`), sent: r.bytesSent, received: r.bytesReceived };
}

function captureLine(c: Capture) {
  return {
    id: c.id,
    started: new Date(c.started * 1000).toISOString(),
    seconds: c.seconds,
    interfaces: c.interfaces,
    status: c.status,
    ...(c.error ? { error: c.error } : {}),
    source: c.source,
    packets: c.packets,
  };
}

function sessionLine(s: Session) {
  return {
    since: s.started ? new Date(s.started * 1000).toISOString() : undefined,
    listeningOn: s.listening.filter((l) => l.on).map((l) => ({ interface: l.id, status: l.status, ...(l.error ? { error: l.error } : {}) })),
    packets: s.packets,
    bytesPerSecondNow: s.rate,
  };
}

type View = { devices: Device[]; remotes: Remote[]; links: Link[]; capture?: Capture; session?: Session };

export function argusTools(captures: Captures, live: Live) {
  /** The capture asked for, or the live session. */
  const view = async (id?: string): Promise<View | string> => {
    if (!id) {
      const session = live.session();
      if (!session.packets)
        return session.listening.some((l) => l.on)
          ? 'Listening, but nothing seen yet: give it a few seconds.'
          : 'Not listening: he turns an interface on at https://argus.test. list_captures has the captures saved.';
      return { session, ...live.hosts() };
    }
    const c = captures.get(id);
    if (!c) return `No capture "${id}". list_captures lists them.`;
    if (c.status !== 'done') return `Capture ${c.id} is ${c.status}${c.error ? `: ${c.error}` : ''}.`;
    return captures.hosts(c);
  };
  const where = (v: View) => (v.capture ? { capture: captureLine(v.capture) } : { live: sessionLine(v.session!) });

  return defineTools((mcp) => {
    mcp.registerTool(
      'get_hosts',
      {
        annotations: READ_ONLY,
        title: 'The hosts a capture saw',
        description:
          'The devices on the local network that a capture saw (name and where it came from: DHCP, mDNS, NetBIOS; IP and MAC ' +
          'addresses; maker from the MAC; bytes sent and received; which is the router and which is this PC), and the hosts out on ' +
          'the internet, named by DNS answers or TLS SNI when seen. Without `capture`, the live session: what is being listened ' +
          'on now, since it began, with how fast each device is sending right now. ' +
          LIMITS,
        inputSchema: {
          capture: z.string().optional().describe('A capture id from list_captures'),
          remotes: z.number().int().min(0).max(500).optional().describe('How many internet hosts to include, busiest first (default 20)'),
        },
      },
      async ({ capture, remotes }) => {
        const v = await view(capture);
        if (typeof v === 'string') return error(v);
        return json({
          ...where(v),
          devices: v.devices.map(deviceLine),
          remotes: v.remotes.slice(0, remotes ?? 20).map(remoteLine),
          remotesTotal: v.remotes.length,
        });
      },
    );

    mcp.registerTool(
      'get_device',
      {
        annotations: READ_ONLY,
        title: 'One device and who it talked to',
        description:
          'One device from a capture, found by its name, IP or MAC address: what is known of it, the internet hosts and local ' +
          'devices it talked to (busiest first, in bytes), and the other devices that talked to the same hosts. Without `capture`, ' +
          'the live session. ' +
          LIMITS,
        inputSchema: {
          device: z.string().min(1).describe('A name, IP or MAC, as get_hosts gives it'),
          capture: z.string().optional(),
        },
      },
      async ({ device, capture }) => {
        const v = await view(capture);
        if (typeof v === 'string') return error(v);
        const graph = new EntityGraph<Device | Remote>([...v.devices, ...v.remotes], v.links);
        const d = graph.find(device, 'device') as Device | undefined;
        if (!d) return error(`No device "${device}" ${v.capture ? `in capture ${v.capture.id}` : 'in the live session'}. get_hosts lists them.`);
        const key = keyOf(d);
        return json({
          ...deviceLine(d),
          talkedTo: graph.linked(key).map((n) => ({ name: n.entity.name, kind: n.entity.kind, id: n.entity.id, bytes: n.weight })),
          sameHostsAs: graph.twoSteps(key).filter((o) => o.entity.kind === 'device').map((o) => ({ name: o.entity.name, via: o.via.map((x) => x.name) })),
        });
      },
    );

    mcp.registerTool(
      'list_captures',
      {
        annotations: READ_ONLY,
        title: 'The captures',
        description:
          'Every capture he saved from the live session (or brought in), newest first: when, how long, on which interfaces, how many packets.',
      },
      async () => json(captures.all().map(captureLine)),
    );
  });
}
