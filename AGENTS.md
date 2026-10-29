# Argus

A readable network spy for one person, on `tshark`, live: turn on one or more network interfaces and see, as it
happens and in plain words, which devices are there (name, address, maker, how fast they move data now) and which
hosts and companies out on the internet they talk to; save the last minutes as a capture. Each network the PC was on (home, the office, a café) is kept apart: a network is
its router, named by its SSID (`shared/networks.ts`; the sensor keeps where it joined each one). The bar on every page says apart where Argus listens ("Listen on": the interfaces) and which network the pages read ("Showing"); a device is on every network it was heard on, and in one network's list says where else it was. The agent asks the same
over MCP (`get_hosts`, `get_device`, `list_captures`, `get_day`, `what_happened`). Since 2026-10-26 the home page is a live monitor: who is using the network now and for what, a line each, moving every second; where it listens is a bar of pills on every page (docs/apresentacao.md: why, what was tried and turned down). The first app born on the saga's shared core, [Organon](../Organon) (`@organon/core`, pinned at an exact version in `package.json`).

## The rule of the core

What Argus needs that is mechanism (the server, MCP and its bridge, control, release, `.test`, systemd, entities,
search, the hover card, the look) comes from `@organon/core`. A fix or a new piece is made in `~/Projects/Organon`,
with tests, in a new version, through its own process (`pnpm gates`, `canary`, `pack:release`, `CHANGELOG.md`), and
Argus moves its pin; it is never copied here. What is Argus's own stays here: listening (`server/live.ts`), adding
up (`server/tally.ts`, `server/dissect.ts`), the dictionary that says what traffic is for (`shared/classify.ts`, `shared/dictionary/`, `server/dictionary.ts`, [docs/dicionario.md](docs/dicionario.md)), the interfaces and captures (`server/capture.ts`, `server/captures.ts`), the reading of the facts (`server/interpret.ts`:
identity in `shared/identify.ts`, safety in `shared/security.ts`, where in `server/geo.ts`), the day kept and its diary
(`server/history.ts`, `shared/words.ts`), the entity kinds (`shared/types.ts`), the MCP tools
(`server/tools.ts`), the pages (`ui/src`). `python3 ~/Projects/Organon/docs/inventario.py --against .` checks no
file here is a copy of Aristotle's or Galen's infrastructure (exceptions, with the reason, in `organon-exceptions.tsv`).

## Listening, and what it never does

Listening touches the network only through `dumpcap`: it has the capture capabilities and this user may run it
(`scripts/install-capture.sh`, run once with `pkexec`). Per interface turned on, `server/live.ts` runs one
`tshark -i … -w <ring> -b … -P -T fields`: tshark has dumpcap write a ring buffer (data/live/ring/<iface>, files ×
size, the ceiling in `server/config.ts`) and prints each packet's structured fields, never its text output;
`server/tally.ts` adds them up, with ceilings on conversations and devices kept. The page gets only the totals, once a
second, over the core's event stream; the session is written to data/live/ every minute and on stop, and what was on
is listened on again after a restart. Saving merges the ring with `mergecap` into data/captures/. The sensor only
listens: no monitor mode, no ARP spoofing, nothing sent. What is encrypted is not read; on a switched network a PC sees
mostly its own traffic and the broadcast and multicast of the others. The interface says both, once.

To see more of the network than passes through this PC, `server/sources.ts` asks other witnesses
([docs/sources.md](docs/sources.md)). Passive, every 15 s: this PC's neighbour table (`ip neigh`) and DHCP lease files
on this PC, both local reads that send nothing. Active, two, both on the *Scan* page (`ui/src/pages/Scan.svelte`) and
nowhere else: a scan of the LAN (`nmap -sn` over the /24 this PC is in: an ARP request and a TCP connection attempt to
ports 80 and 443 per address, then PTR questions for those that answered), and reading the router (`server/routers.ts`:
it logs in to the router's web page, reads its list of devices, logs out, changes nothing; one adapter per model in
`server/routers/`, the first the MEO Fiber Gateway). Each runs only when he presses its button, which says "active" and
what it does, only on the network this PC is on then (its way out: `Sources.here`, the server refuses any other); never
on a timer, at start or from the agent. The router's password is his: typed on that page, kept in
`~/.config/argus/routers.json` (600, by the router's MAC, `ARGUS_ROUTER_KEYS`), only ever given to that MAC, and never
in the repository, a test, a log or an answer of the API; a model whose factory password is public tries it first and
says so as a warning. Tests use a pretend router (`tests/fake-router.ts`), never the real one. What they find is
`foundOnly` (no traffic), shown apart, placed on the network asked (else the one its interface was on when it was
found, else none), each time kept as a run (when, where, what Argus knew of each device before) until a restart, and
never kept in the day. Anything that changes other people's traffic (ARP spoofing, deauthentication) or scans ports for
services is not in Argus.

## The sensor and the server

`capture.ts`, `live.ts`, `tally.ts` and `dissect.ts` are the sensor: they touch packets and produce facts (cumulative
counters, names, clues, flags), never interpretations. Everything that reads them is the server. Keep that line
(docs/sensor.md): a new rule about what traffic means goes in `interpret.ts` or `shared/`, never in the tally. The
history (`data/history/`, a JSONL a day) keeps aggregates only; a password that went by is a flag there, never its value. The ring buffer and saved captures
are raw packets and do hold it: say so wherever the flag is shown, never claim otherwise.
Colour: data is neutral, and without encryption has no colour either: a small open padlock (`ui/src/lib/ClearTag.svelte`) beside the line, its detail in the tip, and the full account on the Privacy page, never on the home page.

## Working on it

- `pnpm dev`: server on 4940, Vite on 5203, data in `.dev/` (the fixture recording brought in first). `pnpm demo`:
  a made-up house on 4950 (`scripts/demo-tshark.ts`), data in `.demo/`: for a look without capture rights, and for
  the README's pictures (`pnpm pictures` takes them from it, in headless Chromium), which must never show real
  traffic. The live app:
  `https://argus.test` (127.0.0.84, 4930, TLS 4931), run by `argus.service` from the release copy.
- `pnpm gates` (types, `pnpm check:leaks`, build, tests: the dissection against `tests/fixtures/lan.truth.json`, the server, the live
  stream and MCP with a pretend `dumpcap` and `tshark`, the pages in headless Chromium, the dev instance). The tests
  need `tshark`.
- `pnpm fixtures` rebuilds `tests/fixtures/lan.pcap` and its truth from `scripts/make-fixture.ts`: every packet made
  by hand, so no capture of anybody's traffic is committed. Real captures live in `data/` (never in Git). The repository
  is public: no real name, MAC, address or path of this machine goes in a commit, a test or a picture. Made-up
  networks (the fixture, the demo, the tests) use private addresses only on their LAN, the documentation ranges
  (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 2001:db8::/32) out on the internet, and real makers' OUIs with
  invented halves.
- `pnpm check:leaks` (in the gates) fails if the tree holds anything of this machine's network: its addresses, MACs,
  interface names, the /48 of its IPv6, what the live session saw (`data/live/session.json`: neighbours' MACs,
  addresses, names), his name, home and e-mail; or a private address outside the fixtures. It reads those from the
  machine each time and writes them nowhere. `--history` checks every commit of every branch (files, pictures by
  OCR, captures with tshark, messages, author e-mails); `--listen 30` also listens for the names the network announces.
- `pnpm geo` downloads iptoasn.com's table into `~/.cache/argus` (shared by every instance; ARGUS_GEO_FILE
  elsewhere). The demo and the tests use made-up tables (`scripts/demo-geo.tsv`, `tests/fixtures/geo.tsv`).
- `pnpm release` ships what is committed (the core's release); `pnpm release --rollback` goes back.
- Verify with what runs (tests, the dev instance, headless Chromium through `playwright-core`), never with the
  desktop's own browser.
