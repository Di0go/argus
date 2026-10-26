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

And where each frame was: the stays (`segments`). A stay on an interface begins where this PC joined a network (it asked
DHCP for an address from 0.0.0.0, the system said another SSID, or its frames for the internet went through another MAC
after its way out had been quiet for half a minute) and keeps the MACs this PC sent its frames for the internet to (its
way out: a MAC sent frames for two hosts or more, so a neighbour with a public address is not one) and the SSIDs the
system said (`iw dev <iface> link`, every few seconds, `server/capture.ts`). Every flow and conversation says its stay,
and every device the stays it was heard in (`heard`), with how much each way. Which stays are one network is not the
sensor's to say.

## What is the server

Everything that reads the facts:

| File | What it does |
| --- | --- |
| `server/interpret.ts` | the facts read: which network each stay was on (`shared/networks.ts`), the dictionary (`shared/classify.ts`), what is harmless in the clear, each device's identity (`shared/identify.ts`) and DNS, where each host's network is (`server/geo.ts`) |
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
`{ devices, conversations, remotes, networks }` with cumulative counters, stable conversation ids (`a b service
network`) and the session's start (a new start means the counters began again).

Which network: `shared/networks.ts`. A network is its way out, the router's MAC: stays through one router are one
network whatever the interface (home by cable and by Wi-Fi) and whatever their addresses, and two routers handing out
the same private addresses are two; two MACs that were ways out within one stay (IPv4 through one, IPv6 through another)
are one. A stay with no way out (Docker, a VPN, a network without internet) is its interface's, one per SSID. The SSID
names a network, else its router. A stay just joined whose way out is not seen yet is `pending` for up to two minutes,
and the history counts its traffic once it is known. The subnet is never used: so many routers hand out the same one. A
session kept before stays were is told apart by its routers when it is read back (`Tally.stays`); a day kept before
says so (`untold`) and is never split after the fact.

Strings that came off the network do cross the line as facts: names, the HTTP Host, User-Agents, JA4. They are data
from whoever runs the device, capped in length and number, and must stay data (the agent is told so).

## Moving the sensor out, when the time comes

1. Put `capture.ts`, `live.ts`, `tally.ts` and `dissect.ts` behind a small HTTP service on the sensor's machine:
   `GET /facts` (the `Dissected` snapshot), `GET /session`, `PUT /listen/<iface>`, `POST /save`, an event stream.
2. On the server, a `RemoteSensor` with the same methods `server/index.ts` calls on `Live` today (`hosts`, `view`,
   `session`, `set`, `reset`, `ringFiles`): it fetches instead of computing. `interpret` and `History` do not change.
3. Several sensors (two floors, a VPN box): each snapshot carries its sensor's name; devices are keyed by MAC
   already, conversations by both ends, service and stay. A sensor that is not a PC sends no frames of its own, so
   its stays have no way out: they are its interface's network until it says which router it sits behind. Where two sensors hear the same traffic (a mirror port and this
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
