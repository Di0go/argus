# Argus

A readable network spy for one person, on `tshark`: pick one or more network interfaces, capture for a few seconds,
and see in plain words which devices were there (name, address, maker, how much traffic) and which hosts out on the
internet they talked to. The agent asks the same over MCP (`get_hosts`, `get_device`, `list_captures`). The first app
born on the saga's shared core, [Organon](../Organon) (`@organon/core`, pinned at an exact version in `package.json`).

## The rule of the core

What Argus needs that is mechanism (the server, MCP and its bridge, control, release, `.test`, systemd, entities,
search, the hover card, the look) comes from `@organon/core`. A fix or a new piece is made in `~/Projects/Organon`,
with tests, in a new version, through its own process (`pnpm gates`, `canary`, `pack:release`, `CHANGELOG.md`), and
Argus moves its pin; it is never copied here. What is Argus's own stays here: captures (`server/capture.ts`,
`server/captures.ts`), dissection (`server/dissect.ts`), the entity kinds (`shared/types.ts`), the MCP tools
(`server/tools.ts`), the pages (`ui/src`). `python3 ~/Projects/Organon/docs/inventario.py --against .` checks no
file here is a copy of Aristotle's or Galen's infrastructure (exceptions, with the reason, in `organon-exceptions.tsv`).

## Capture, and what it never does

Only `dumpcap` touches the network: it has the capture capabilities and this user may run it
(`scripts/install-capture.sh`, run once with `pkexec`). Argus runs as the user and reads with `tshark` the file
`dumpcap` wrote, in structured fields (`-T fields`), never its text output. It only listens: no monitor mode, no ARP
spoofing, nothing sent. What is encrypted is not read; on a switched network a PC sees mostly its own traffic and
the broadcast and multicast of the others. The interface says both.

## Working on it

- `pnpm dev`: server on 4940, Vite on 5203, data in `.dev/` (the fixture recording brought in first). The live app:
  `https://argus.test` (127.0.0.84, 4930, TLS 4931), run by `argus.service` from the release copy.
- `pnpm gates` (types, build, tests: the dissection against `tests/fixtures/lan.truth.json`, the server and MCP with
  a pretend `dumpcap`, the pages in headless Chromium, the dev instance). The tests need `tshark`.
- `pnpm fixtures` rebuilds `tests/fixtures/lan.pcap` and its truth from `scripts/make-fixture.ts`: every packet made
  by hand, so no capture of anybody's traffic is committed. Real captures live in `data/` (never in Git).
- `pnpm release` ships what is committed (the core's release); `pnpm release --rollback` goes back.
- Verify with what runs (tests, the dev instance, headless Chromium through `playwright-core`), never with the
  desktop's own browser.
