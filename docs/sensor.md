# The sensor and the server

Argus is one process today, on the PC it listens from. One day (when Euclid has a server) the part that listens
should run somewhere else: on the router's mirror port, on a small box beside it, or not listen at all and read a DNS
server the house already runs (Pi-hole, AdGuard Home). This is where the line between the two is drawn, so that move
is a transport, not a rewrite. Nothing of it is built yet.

## What is the sensor

Everything that touches packets, and nothing that interprets them:

| File | What it does |
| --- | --- |
| `server/capture.ts` | which interfaces there are, whether this user may capture, this PC's MACs and system |
| `server/live.ts` | one `tshark` per interface, the ring buffer on disk, the session kept across restarts |
| `server/tally.ts` | tshark's fields added up: devices, flows, conversations, names, the bandwidth over time |
| `server/dissect.ts` | the same tally over a file (a capture saved, a recording brought in) |

Its output is **facts**, the `Dissected` shape of `server/tally.ts`: devices (MAC, addresses, names and who said them,
maker, what the device said of itself in `clues`: DHCP vendor class and options, mDNS services, User-Agents, JA4),
remote hosts (address, names from DNS, TLS and HTTP), conversations (both ends, service, bytes each way, first and
last, what tshark recognised, whether it carried content in the clear and whether a login went by, the TLS version
agreed) and the series of bytes over time. Cumulative counters, never packets, never contents. The sensor knows no
dictionary, no identity rules, no geography and no history.

## What is the server

Everything that reads the facts:

| File | What it does |
| --- | --- |
| `server/interpret.ts` | the facts read: the dictionary (`shared/classify.ts`), what is harmless in the clear, each device's identity (`shared/identify.ts`) and DNS, where each host's network is (`server/geo.ts`) |
| `server/history.ts` | looks at the facts every few seconds; what grew is now's traffic; the day kept as minutes, the diary, "doing now" |
| `server/tools.ts`, `server/index.ts` | the API, the live stream to the pages, MCP |
| `ui/` | the pages |

In the code the line runs in two places: `Live`'s `read` option (`server/index.ts` passes the function that runs
`interpret` and adds what each device is doing from the history) and `Captures.read`, which reads a saved capture's
facts the same way. None of the sensor's files imports the dictionary, identity, geo, history or tools; a test
(`tests/dissect.test.ts`) fails if one does, or if the facts carry a reading.

What the server uses of `Live` today, and so what a remote sensor must answer: `hosts()` and `view()` (the facts,
read), `session()`, `on()`, `set()` (turn an interface on or off), `reset()`, `ringFiles()` and `cut()` (for saving),
`deviceSeries()`, `load()` and `stop()`, and the live event stream. History needs only
`{ devices, conversations, remotes }` with cumulative counters, stable conversation ids (`a b service`) and the
session's start (a new start means the counters began again).

Strings that came off the network do cross the line as facts: names, the HTTP Host, User-Agents, JA4. They are data
from whoever runs the device, capped in length and number, and must stay data (the agent is told so).

## Moving the sensor out, when the time comes

1. Put `capture.ts`, `live.ts`, `tally.ts` and `dissect.ts` behind a small HTTP service on the sensor's machine:
   `GET /facts` (the `Dissected` snapshot), `GET /session`, `PUT /listen/<iface>`, `POST /save`, an event stream.
2. On the server, a `RemoteSensor` with the same methods `server/index.ts` calls on `Live` today (`hosts`, `view`,
   `session`, `set`, `reset`, `ringFiles`): it fetches instead of computing. `interpret` and `History` do not change.
3. Several sensors (two floors, a VPN box): each snapshot carries its sensor's name; devices are keyed by MAC
   already, conversations by both ends and service. Where two sensors hear the same traffic (a mirror port and this
   PC), summing would count it twice: merge by taking, per conversation and interval, the larger of the two, not the
   sum, or give each conversation one sensor that owns it.
4. The ring buffer and captures stay with the sensor; the server asks it to save and lists what it holds.

## A DNS server as a sensor

Pi-hole and AdGuard Home log every question with the client's address and the answer. That is a weaker sensor (no
bytes, no ports, nothing that went around DNS) but it sees every device, not only this PC's traffic. Mapped to the
facts: each question is a conversation `device → resolver, udp/53` with a packet count and no bytes, and each answer
gives the remote hosts their DNS names (`dnsNames` in the tally). History would then keep "asked for" instead of
bytes; the diary's episodes would say "used Netflix" without "2.3 GB". The interpretation (dictionary, identity
from the names, privacy for DNS) works unchanged. Both APIs are local and documented (Pi-hole's `/api/queries`,
AdGuard Home's `/control/querylog`).

## What stays true wherever the sensor runs

- Only listening: no monitor mode, no ARP spoofing, nothing sent into anyone's traffic.
- Facts cross the line, packets never do; a password that went by is a flag, never its value. (The ring buffer and
  the captures saved from it stay with the sensor and are raw packets: they hold it.)
- What is encrypted is not read.
