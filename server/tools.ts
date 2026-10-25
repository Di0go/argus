// The tools an agent uses to ask Argus what it saw, over MCP (the core's handler, server/index.ts). They only read:
// a capture is started by him, on the page. The descriptions are all a client knows of each tool, so they carry
// what the answers can and cannot say.

import { defineTools, error, json, READ_ONLY, z } from '@organon/core/server/mcp';
import { EntityGraph, keyOf } from '@organon/core/shared/entities';
import type { Capture, Device, HostsView, Remote } from '../shared/types.ts';
import type { Captures } from './captures.ts';

const LIMITS =
  'What is encrypted is not read: only who talked to whom, when and how much. On a PC on a switched network, the capture sees ' +
  "mostly this PC's own traffic and the broadcast and multicast of the others, not what other devices send to each other.";

export function instructions(): string {
  return (
    'Argus is a readable network spy on tshark: the devices a capture saw on the local network (name, address, maker, how much ' +
    'they sent), and the hosts out on the internet they talked to. He starts captures on the page; you read them. ' +
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

export function argusTools(captures: Captures) {
  /** The capture asked for, or the newest finished one. */
  const pick = (id?: string) => (id ? captures.get(id) : captures.latest());
  const view = async (id?: string): Promise<HostsView | string> => {
    const c = pick(id);
    if (!c) return id ? `No capture "${id}". list_captures lists them.` : 'No capture yet: he starts one on the page (https://argus.test).';
    if (c.status !== 'done') return `Capture ${c.id} is ${c.status}${c.error ? `: ${c.error}` : ''}.`;
    return captures.hosts(c);
  };

  return defineTools((mcp) => {
    mcp.registerTool(
      'get_hosts',
      {
        annotations: READ_ONLY,
        title: 'The hosts a capture saw',
        description:
          'The devices on the local network that a capture saw (name and where it came from: DHCP, mDNS, NetBIOS; IP and MAC ' +
          'addresses; maker from the MAC; bytes sent and received; which is the router and which is this PC), and the hosts out on ' +
          'the internet, named by DNS answers or TLS SNI when seen. Without `capture`, the newest finished capture. ' +
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
          capture: captureLine(v.capture),
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
          'devices it talked to (busiest first, in bytes), and the other devices that talked to the same hosts. ' +
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
        if (!d) return error(`No device "${device}" in capture ${v.capture.id}. get_hosts lists them.`);
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
        description: 'Every capture, newest first: when, how long, on which interfaces, whether it finished, how many packets.',
      },
      async () => json(captures.all().map(captureLine)),
    );
  });
}
