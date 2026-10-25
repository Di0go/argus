<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/banner-dark.svg">
    <img src="docs/images/banner-light.svg" alt="Argus: a readable network spy, live, on tshark." width="100%">
  </picture>
</p>

<p align="center">
  <a href="#what-it-shows">What it shows</a> ·
  <a href="#what-it-cannot-see">What it cannot see</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a>
</p>

<p align="center">
  <img alt="Live, on tshark" src="https://img.shields.io/badge/live-on%20tshark-bf124e?style=flat-square">
  <img alt="Only listens" src="https://img.shields.io/badge/only-listens-2e8b57?style=flat-square">
  <img alt="On @organon/core" src="https://img.shields.io/badge/on-%40organon%2Fcore-a8742a?style=flat-square">
  <img alt="Svelte 5" src="https://img.shields.io/badge/Svelte-5-ff3e00?style=flat-square&logo=svelte&logoColor=white">
  <img alt="TypeScript on Node 24+" src="https://img.shields.io/badge/TypeScript-Node%2024%2B-3178c6?style=flat-square&logo=typescript&logoColor=white">
</p>

---

**Argus shows your network as it happens, in plain words.** Turn on the Wi-Fi, a cable or a VPN, one or several, and
it says which devices are there (by the name they give themselves, their address, their maker), how fast each one is
moving data right now, and which companies out on the internet they talk to. It runs on your own machine, listens
only, and keeps nothing but the last minutes on disk. An agent can ask it the same over MCP.

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/now-dark.webp"><img src="docs/images/now-light.webp" alt="Argus's Now page: the networks as a list, the Wi-Fi and Docker listening with their devices and rate, the VPN off; the whole network's rate now over a chart of the last minutes; below, the devices with their network, and the companies on the internet." width="100%"></picture>
</p>

<p align="center"><sub>Every picture here is of <code>pnpm demo</code>: a made-up house, no real traffic.</sub></p>

## What it shows

**Devices**, each named the way it named itself: the hostname a phone gives when it asks for an address (DHCP), what a
TV or a speaker announces on the local network (mDNS), a Windows PC's name (NetBIOS). The maker comes from the first
half of the MAC address; a phone that makes up a MAC for each network is said to, rather than guessed at. The router and
this PC are known by what they do.

**The internet, by company.** Hosts are named by the DNS answers your network got for them and by the server name an
encrypted connection asks for in the clear (SNI), then grouped by who runs them: `rr3---sn-…googlevideo.com` is Google.

**Networks.** Where it listens is a list: each network with its kind, how it is going, the devices heard on it and
its rate now. Every device says which network it is on, and one network can be chosen: its devices first and the
others' after, or the others left out altogether (remembered).

**Conversations.** Open a device, a host, a company or a network and it says whom it talked to, by what service (as
the port says: HTTPS, DNS, QUIC…), how much each way and when, live; the other end is a click away.

**What it was for.** A dictionary reads each conversation's names, address and port, and what the traffic looks like,
into the company, the app and what someone is doing: `rr3---sn-…googlevideo.com` is Google · YouTube · watching video;
WhatsApp over STUN is a call; a WireGuard tunnel on port 443 is a VPN, not the web. A CDN says who carries the bytes,
never whose app they are. Built on open lists (v2fly's, the Public Suffix List, iptoasn); which, why, and how much of
a real house it says: [docs/dicionario.md](docs/dicionario.md).

**Live.** A bandwidth chart for the whole network and for each device, a second at a time for the last ten minutes, a
minute at a time for the day. Rows hold still while you read them, and a device that just turned up is marked.

<p align="center">
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/device-dark.webp"><img src="docs/images/device-light.webp" alt="A device's page: its conversations, each with whom, by what service, how much each way and when, below its bandwidth chart; then the companies and devices it talks to." width="49%"></picture>
  <picture><source media="(prefers-color-scheme: dark)" srcset="docs/images/search-dark.webp"><img src="docs/images/search-light.webp" alt="The search palette over everything Argus has seen: typing living finds the Living Room TV." width="49%"></picture>
</p>

Everything links to everything: a device to the companies it uses, a company to its hosts and the devices that use it,
an interface to what was heard on it. Search finds any of them (Ctrl+K), hovering a name shows its card, and a
right-click copies its address or MAC.

**Captures.** The last minutes of each interface stay on disk in a bounded ring buffer. Save them, and they become a
capture you can open again as it was, or in Wireshark.

## What it cannot see

Argus only listens: no monitor mode, nothing sent, nobody's traffic changed. What is encrypted is not read; you see who
talks to whom, when and how much. And on an ordinary home network (a router, a switch), a PC hears mostly its own
traffic and what the others announce to everyone, not what they say to each other or to the internet. The page says
so too, once.

## Quick start

**You need** Linux, [Node.js](https://nodejs.org) 24.2 or newer, [pnpm](https://pnpm.io), and Wireshark's command-line
tools (`tshark`, `dumpcap`, `mergecap`).

```sh
git clone https://github.com/Di0go/argus.git
cd argus
pnpm install
pnpm demo           # a made-up house, nothing captured: http://localhost:4950
```

To listen for real, this user needs to be allowed to capture. Only `dumpcap` gets that right (Wireshark's capture
capabilities); Argus itself never runs as root. On Arch, once:

```sh
pkexec bash "$PWD/scripts/install-capture.sh"   # wireshark-cli, the wireshark group, argus.test (read it first)
pnpm start                                        # builds the interface and starts the server on :4930
```

Then turn an interface on at **http://localhost:4930** (or **https://argus.test**). What was on is listened on again
after a restart.

## How it works

Per interface, one `tshark -i <iface> -w <ring> -b files:20 -b filesize:10240 -b duration:30 -P -T fields`: `dumpcap`
writes the packets into a ring buffer of files (200 MB at most per interface), and tshark prints each packet's fields as
it comes in. The server adds them up (`server/tally.ts`) into devices, hosts and conversations, with ceilings on what it
keeps in memory, and sends the page only the totals, once a second, over Server-Sent Events. Nothing is lost on a
reload: the page asks the server, and the server writes the session to `data/live/` every minute.

| Part | Where |
|---|---|
| Listening, the ring buffer, saving | `server/live.ts` |
| Adding up, naming, the router | `server/tally.ts` |
| The routes and the MCP tools (`get_hosts`, `get_device`, `list_captures`) | `server/index.ts`, `server/tools.ts` |
| The pages | `ui/src` |
| The frame, the live stream, the server, release | [`@organon/core`](https://github.com/Di0go/organon) |

`pnpm gates` runs the types and every test: the dissection against a capture built by hand packet by packet
(`pnpm fixtures`, so no real traffic is in this repository), the server and the live stream with a pretend tshark, and
the pages in headless Chromium.

Part of a saga with [Aristotle](https://github.com/Di0go/aristotle) and [Galen](https://github.com/Di0go/galen), on
their shared core, [Organon](https://github.com/Di0go/organon).

## License

[MIT](LICENSE)
