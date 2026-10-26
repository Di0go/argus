# The dictionary

Argus's dictionary turns traffic into plain words: from a host's names (asked of DNS, said in TLS), its address, its
port and what tshark recognised the traffic as, to **who runs it, the app, the category and the activity**:

| What the network shows | What the dictionary says |
| --- | --- |
| `rr3---sn-….googlevideo.com`, UDP 443 | Google · YouTube · Video · "watching video" |
| `e7.whatsapp.net`, STUN | Meta · WhatsApp · Calls · "on a call" (by how the traffic goes) |
| `tlu.dl.delivery.mp.microsoft.com` | Microsoft · Windows Update · "updating the system" |
| `www.google-analytics.com` | Google · Google Analytics · Advertising and tracking, tracking |
| a WireGuard tunnel on UDP 443, no name | WireGuard · VPN · "through the VPN" (tshark's `wg`, not QUIC) |
| `a1234.dscb.akamai.net` | Akamai · Infrastructure and CDN, a carrier: the app is not known |
| `142.250.184.14`, no name seen | Google (by its network, AS15169); the app is not known |
| UDP 53 with the router | DNS · "looking up names (DNS)" (by the port) |
| `94.140.14.14`, no name seen | AdGuard · AdGuard DNS · "looking up names" (a public resolver, by its address) |
| `derp4c.tailscale.com` | Tailscale · VPN · "through a relay of the VPN (DERP)" |
| a host with no name, only STUN and probes from a PC running Tailscale | Tailscale's relay, *likely* (below) |

It says only what is known. A shared CDN or a cloud (Akamai, Cloudflare, Fastly, AWS, Azure, Google Cloud) says who
carries the bytes and is marked a carrier: it never names an app. A network (AS) names an app only when it is that
app's own (Netflix, Telegram, Valve); Google's or Meta's says the company.

## Where it is

- `shared/classify.ts`: the `Dictionary` and its `classify(clue)`: the model (`Classification`), the order (a name,
  then the network, then the port; what tshark recognised and how the traffic goes on top), the Public Suffix List,
  the address ranges.
- `shared/dictionary/apps.ts`: the words, by hand: the categories with their activity; who each v2fly list is
  (`LISTS`); names more particular than the lists (`DOMAINS`); names by their shape (`SHAPES`); addresses that are one
  service (`ADDRESSES`); networks (`ASNS`); ports (`PORTS`); protocols (`PROTOCOLS`).
- `shared/dictionary/{v2fly,psl,asn}.json`: the open sources, as `pnpm dictionary` (`scripts/dictionary.ts`) brings
  them, each at a pinned version.
- `server/dictionary.ts`: the dictionary loaded, with the house's own words on top (below), and `classify` for the
  server. The tally (`server/tally.ts`) gives what it says to every host (`Remote.app`) and conversation
  (`Conversation.app`); the pages and the agent (`get_hosts`' `apps` and `what`, `get_device`'s) read it there.
  The pages read it from what the server sends rather than calling it: the sources are 1–2 MB the browser need not load.
- `server/interpret.ts`: what is said of hosts that never said a name (below), from what the view holds together.
- `scripts/cobertura.ts`: how much of a capture it says (below); `scripts/nomes.ts`: how many hosts are left with no
  name a person reads.

### The house's own words

What only this house has (its work's domains, its devices' clouds) goes in `data/dicionario.json`, never in the
repository, which is public. The server reads it at start, on top of the dictionary's words:

```json
{
  "domains": { "intranet.example.com": { "company": "O trabalho", "app": "Intranet", "category": "work" } },
  "asns": { "64500": { "company": "…", "category": "vpn" } },
  "ports": { "tcp/8123": { "app": "Home Assistant", "category": "smart-home" } }
}
```

An entry whose category is not one of `CATEGORIES` is left out and said in the server's warnings.

## The sources, and why each is in or out

The repository is public and MIT. A source is embedded only when its licence lets MIT code carry it; a source that is
non-commercial or copyleft for data is not embedded. None is downloaded at start either: Argus listens, and a program
that listens should not call out to the internet when it starts; and the measured coverage below did not need them.

| Source | Licence | Decision |
| --- | --- | --- |
| [v2fly/domain-list-community](https://github.com/v2fly/domain-list-community) | MIT | **In, embedded** (`v2fly.json`, with its licence). Lists by service (`youtube`, `whatsapp`, `netflix`, ~1500) and by category (`category-ads-all`, `category-games-!cn`, `category-stun`…), with `@ads` attributes. The lists for China only are left out. Who each list is, is said in `apps.ts`. |
| [Public Suffix List](https://publicsuffix.org/) | MPL-2.0 | **In, embedded** (`psl.json`, its rules unchanged, with the MPL notice: the MPL is per file, so the file stays MPL inside an MIT repository). ICANN and private sections both: `x.pages.dev` and `someone.github.io` are sites of their own. |
| [iptoasn.com](https://iptoasn.com/) | Public domain (PDDL 1.0) | **In, embedded, in part** (`asn.json`): only the ranges of the networks `apps.ts` names, not the whole table (~9 MB). Not versioned at the source: the file says the day it was fetched. |
| [IANA service names and port numbers](https://www.iana.org/assignments/service-names-port-numbers) | CC0 (IANA/IETF: free for any use) | **Usable, not embedded**: its thousands of names are not words for a person ("ms-sql-s"). The ports here (`PORTS`, `shared/services.ts`) are the few a house meets, by hand, consistent with it. |
| `/etc/services` | from IANA (Arch: `iana-etc`) | **Out**: the same as IANA's, and a file of this machine. |
| [nDPI](https://github.com/ntop/nDPI) host and protocol lists | LGPL-3.0 | **Out**: copyleft, and its lists are C source inside the library, not data to download. Its idea, protocol by how the traffic goes, is here as tshark's own dissectors (`frame.protocols`: `wg`, `stun`…). |
| [DuckDuckGo Tracker Radar](https://github.com/duckduckgo/tracker-radar) | CC BY-NC-SA 4.0 | **Out**: non-commercial. Trackers come from v2fly's `@ads` and `category-ads-all`, and by hand. |
| [Disconnect tracking protection](https://github.com/disconnectme/disconnect-tracking-protection) (`services.json`, `entities.json`) | CC BY-NC-SA 4.0 | **Out**: non-commercial. |
| [Ghostery TrackerDB](https://github.com/ghostery/trackerdb) | CC BY-NC-SA 4.0 | **Out**: non-commercial. |
| [AdGuard companiesdb](https://github.com/AdguardTeam/companiesdb) | CC BY-SA 4.0 | **Out**: copyleft for data (and built on WhoTracks.me's). A candidate to download at start if tracking companies are ever wanted beyond v2fly's. |
| IEEE OUI (makers by MAC) | IEEE's public registry | **Not this dictionary's**: the maker of a device already comes from tshark's own list (`eth.src.oui_resolved`, Wireshark's, built from IEEE's). |

`pnpm dictionary` rebuilds the three files from the pins in `scripts/dictionary.ts`; `pnpm dictionary --latest` moves
the pins to what the sources publish today (read the diff before committing).

## Coverage, measured

`node scripts/cobertura.ts <capture> [--casa data/dicionario.json]` reads a capture with the same tally as the live
session and says the share of the bytes and of the conversations whose **app** is known (a carrier alone does not
count), and the busiest that are not. It runs on a real capture of this house, which is never committed; the tests use
the hand-made fixture (`tests/fixtures/lan.pcap`, `scripts/make-fixture.ts`).

Measured on 25 October 2026 on a real house's Wi-Fi, three captures of 15 minutes of normal use each. Capture A was
used to write the words; B and C were taken afterwards and only measured. None is kept, and nothing seen in them
(names, addresses) is in the repository: the few words that were one house's own were moved out, to its
`data/dicionario.json`, before C, so C measures the dictionary exactly as committed. Without the house's own words:

| | Before (`sites.ts`: a company, no app) | A (used to build) | B (not used) | **C (not used, as committed)** |
| --- | --- | --- | --- | --- |
| Bytes with the internet, app known | 0 % | 84.5 % | 96.6 % | **96.6 %** |
| Conversations with the internet, app known | 0 % | 94.5 % | 93.1 % | **91.4 %** |
| All conversations (the local ones too), app known | 0 % | 94.7 % | 92.9 % | 91.6 % |

With that house's own words on top, C is 98.5 % of the bytes and 93.1 % of the conversations.

What was left without an app was what should be: sites the dictionary does not know on a CDN (it says the carrier),
and hosts with no name seen on a cloud (it says the cloud).

Read, not only counted: `scripts/cobertura.ts` also lists what it said, by bytes. Two kinds of reading were wrong and
are fixed in the code: one CDN address serving several of a browser's services was said by the first name DNS gave it;
now the names TLS asked for count first, and names that disagree say "several services". And a WireGuard tunnel on
UDP 443 was QUIC by its port; tshark's `wg` says it is a VPN.

## Hosts with no name

Some hosts never say their name: they are asked by address, from a list their app was given, so neither DNS nor TLS
carries one. What is said of them is read from the rest of the view, never asked of the network (no reverse lookups,
no whois: Argus only listens), and says how sure it is (`confidence`, as a device's identity does):

- **A public resolver**, by its address (`ADDRESSES`, from `shared/security.ts` `RESOLVERS`): AdGuard DNS, Quad9, Google
  DNS. Over 443 or 853, encrypted DNS. Sure.
- **Tailscale's relays (DERP).** Its client asks every relay on the map its server gives it the way through the router
  (STUN, 3478) and how far it is (HTTP on 80, ping), by address and all in the same seconds (its netcheck); only the
  relay it settles on is named, in TLS (`derp4c.tailscale.com`, `SHAPES`). A host with no name talked to only that
  way, with STUN among it, is **likely** a relay: from a device running Tailscale (talking to it by name, or to a peer on
  41641), when it is in a network (AS) where one of its named relays is, or when 8 or more such hosts were first asked
  within 10 seconds; from any device, when 20 or more were (the whole map, a hundred hosts, is asked at once; a call's
  relay given by address is one or two). Measured against the map Tailscale publishes
  (`login.tailscale.com/derpmap/default`): every host it said was a relay, on every set below, is on the map. The map
  itself is not embedded: it states no licence.
- **A peer, by its port**: a host whose every conversation says one company's app by how it goes (Tailscale on 41641).
- **Spotify's port, 4070**, to its access points: **likely** (a habit, not a registration).
- **A neighbour**: a host in the same /24 (IPv6: /64) and network as hosts that were named, all of one company in one
  category: **possibly** theirs (`by: 'neighbour'`). Measured on a real day, among named hosts with named neighbours:
  9 in 10 were the same company, 6 in 10 the same app (a cloud gives the next address to someone else). Said of the
  host only, not of its conversations: the history keeps what is surer.

What is left, a host with no name, no pattern and no named neighbour, says only its carrier, or nothing.

`node scripts/nomes.ts <data/live/session.json | capture> [--since <epoch>]` counts the hosts out on the internet and
their bytes with no readable name (no app or company that is not only a carrier, and no site's name), and lists them.
Measured on 26 October 2026: on this house's live session of the day (A, used to write the rules); on the dev
instance's session of the same day on the Wi-Fi (B, not used); on four short captures of 25 October (C, not used); on
ten minutes of the live ring after the rules were first written (D, used to add the netcheck burst); and on ten
minutes of the ring after that (E, not used: every packet in it came after the rules).

| | A (used) | B (not used) | C (not used) | D (used for the burst) | **E (not used)** |
| --- | --- | --- | --- | --- | --- |
| Hosts with no readable name, before | 148 of 691 (21.4 %) | 43 of 403 (10.7 %) | 20 of 49 (40.8 %) | 112 of 159 (70.4 %) | 120 of 168 (71.4 %) |
| … after | **4 (0.6 %)** | **0 (0.0 %)** | **17 (34.7 %)** | **13 (8.2 %)** | **11 (6.5 %)** |
| Bytes to them, before | 0.16 % | 0.07 % | 1.84 % | 0.14 % | 0.30 % |
| … after | **0.00 %** | **0.00 %** | **1.66 %** | **0.05 %** | **0.14 %** |

What is left: hosts on a cloud asked over TLS before the capture began (no name seen, no named neighbour); a few of
Tailscale's relays asked by STUN outside a netcheck, in a window where none of them was named; and, in C, 10-second
captures where nothing says the PC runs Tailscale and no netcheck fell inside. The clue that would name those, STUN's
SOFTWARE attribute (Tailscale's says `tailnode`), is not among the facts the sensor keeps.

## What it cannot know

- **Several names, one address.** A CDN or a company's front door serves many names from one address, and what went
  to which is not seen (the bytes are counted by address and port). When the names disagree it says so.
- **A connection reused for another name.** Browsers send a second site's requests over a connection opened for
  another name the same certificate covers (HTTP/2 and HTTP/3 coalescing): the bytes go to the first name's app.
- **Encrypted names.** With Encrypted Client Hello the SNI is `cloudflare-ech.com` (a carrier); with DNS over HTTPS
  the names never cross the network. Then only the address's network is left: Google, but not which app.
- **Connections older than the capture**: no DNS answer and no TLS handshake seen; the network says the company.
