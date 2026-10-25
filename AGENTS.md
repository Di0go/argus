# Argus

A readable network spy for one person, on `tshark`, live: turn on one or more network interfaces and see, as it
happens and in plain words, which devices are there (name, address, maker, how fast they move data now) and which
hosts and companies out on the internet they talk to; save the last minutes as a capture. The agent asks the same
over MCP (`get_hosts`, `get_device`, `list_captures`). The first app born on the saga's shared core, [Organon](../Organon) (`@organon/core`, pinned at an exact version in `package.json`).

## The rule of the core

What Argus needs that is mechanism (the server, MCP and its bridge, control, release, `.test`, systemd, entities,
search, the hover card, the look) comes from `@organon/core`. A fix or a new piece is made in `~/Projects/Organon`,
with tests, in a new version, through its own process (`pnpm gates`, `canary`, `pack:release`, `CHANGELOG.md`), and
Argus moves its pin; it is never copied here. What is Argus's own stays here: listening (`server/live.ts`), adding
up (`server/tally.ts`, `server/dissect.ts`), the interfaces and captures (`server/capture.ts`, `server/captures.ts`), the entity kinds (`shared/types.ts`), the MCP tools
(`server/tools.ts`), the pages (`ui/src`). `python3 ~/Projects/Organon/docs/inventario.py --against .` checks no
file here is a copy of Aristotle's or Galen's infrastructure (exceptions, with the reason, in `organon-exceptions.tsv`).

## Listening, and what it never does

Only `dumpcap` touches the network: it has the capture capabilities and this user may run it
(`scripts/install-capture.sh`, run once with `pkexec`). Per interface turned on, `server/live.ts` runs one
`tshark -i … -w <ring> -b … -P -T fields`: tshark has dumpcap write a ring buffer (data/live/ring/<iface>, files ×
size, the ceiling in `server/config.ts`) and prints each packet's structured fields, never its text output;
`server/tally.ts` adds them up, with ceilings on conversations and devices kept. The page gets only the totals, once a
second, over the core's event stream; the session is written to data/live/ every minute and on stop, and what was on
is listened on again after a restart. Saving merges the ring with `mergecap` into data/captures/. It only listens: no
monitor mode, no ARP spoofing, nothing sent. What is encrypted is not read; on a switched network a PC sees mostly its
own traffic and the broadcast and multicast of the others. The interface says both, once.

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
- `pnpm release` ships what is committed (the core's release); `pnpm release --rollback` goes back.
- Verify with what runs (tests, the dev instance, headless Chromium through `playwright-core`), never with the
  desktop's own browser.
