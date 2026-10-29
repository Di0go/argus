# Requests: what is read, of whom, with which keys

The Requests page (and the agent's `get_requests`) lists the web requests that go by, as they happen: who asked, the
method, the whole address, the request headers worth reading, the answer's status, type and size, and how long it
took. By device, by domain (a domain takes the hosts under it) and by method, on the networks shown. The sensor reads
them (`server/requests.ts`) from the same tshark line per frame as everything else; the server only places each on its
network and filters (`shared/requests.ts`).

## Of whom

| Traffic | Read? | Why |
| --- | --- | --- |
| Plain HTTP, any device heard | Yes | It travels as it is: anyone on the way reads it, and so does Argus |
| HTTPS of programs on this PC that write their keys (Firefox, Chromium, curl with `SSLKEYLOGFILE`) | Yes, HTTP/1.1 and HTTP/2 | tshark decrypts the TLS with the session's keys from the key log file |
| HTTPS of programs on this PC that do not (Go programs, most Electron apps' own clients unless they honour the variable, Node without `--tls-keylog`) | No | No keys: said on the page as "conversations of this PC without keys" |
| HTTP/3 (QUIC) of this PC | Not yet | tshark decrypts QUIC with the same keys, but its requests are not read here yet. To see a site that uses it, turn QUIC off in the browser (Firefox: `network.http.http3.enable` false) and it falls back to HTTP/2 |
| HTTPS of every other device | No, never | Its keys are on that device. Reading it would take a man in the middle (a proxy, a certificate installed on the device, ARP spoofing), which changes other people's traffic and is not in Argus |

On a switched network this PC hears mostly its own traffic anyway: the plain HTTP of others shows only where it passes
here (a mirror port, this PC as their router, Wi-Fi in the open).

## What is kept

- Per request: when, the device that asked, the server's address and port, the host, the method, the URL whole (query
  and all, cut at 2000 characters), the version, whether it was read inside TLS; the values of user-agent, referer,
  content-type, content-length, accept and origin; every other header by name only.
- Per answer: the status and phrase, when it began, the values of content-type, content-length, server, location,
  content-encoding and cache-control, every other header by name, and the body's size (its Content-Length, else what came:
  HTTP/2's DATA frames, HTTP/1's chunks).
- Of `Cookie`, `Set-Cookie` and `Authorization` only that they went by. No body, ever.
- The newest 2000 (`ARGUS_MAX_REQUESTS`), in memory and with the session in `data/live/session.json` (a restart reads
  them back). Never in the history (`data/history/`), which keeps aggregates only. A token in a URL's query is kept with
  the URL: `data/` is this machine's, never in Git.
- The ring buffer and the captures saved from it are raw packets: the plain HTTP in them is whole, cookies and bodies
  too, as it was on the wire. The HTTPS in them stays encrypted unless the key log is there: the captures do not carry
  the keys, and a saved capture is read with the keys the file holds when it is opened.

## The keys

tshark is given `-o tls.keylog_file:<file>` (`fieldArgs` in `server/tally.ts`); it reads the file as it grows, so a
browser started after Argus is read too, without a restart. The file is `ARGUS_TLS_KEYLOG`, else `SSLKEYLOGFILE` from
Argus's own environment, only on the real `/sys/class/net` (the tests and the demo set their own). Unset: no HTTPS
is read, and the page says so. The page shows where the file is, its size and when it was last written; never its
contents.

### Turning it on (his decision)

A key log file lets whoever reads it, with a capture of the same minutes, read everything those programs sent and
received over HTTPS: passwords, cookies, pages, mail. So it is off until he turns it on:

```bash
scripts/tls-keys.sh status   # how it is
scripts/tls-keys.sh on       # writes ~/.config/environment.d/90-argus-tls-keys.conf
```

then log out of the session and back in (the programs open now do not see the variable), and, if `argus.service` kept
running across the login, `systemctl --user restart argus`. The line it writes is
`SSLKEYLOGFILE=${XDG_RUNTIME_DIR}/tls-keys.log`: `/run/user/<uid>` is this user's alone (700), in memory, and gone at
logout or shutdown. The systemd user manager reads `environment.d`, KDE Plasma starts the session's programs from it,
and `argus.service` gets the same environment, so the browsers write where Argus reads. To check: open a page in
Firefox and run `scripts/tls-keys.sh status` (the file grows), or look at the Requests page.

`scripts/tls-keys.sh off` removes the line and the keys written so far (programs started before keep the variable
until the next login).

For a program that does not read `SSLKEYLOGFILE`: Node with `node --tls-keylog="$SSLKEYLOGFILE" …`; Python's `requests`
and `urllib3` 2 read it; Go's `net/http` needs `tls.Config.KeyLogWriter` in the program.

### Ways that were weighed

- **The key log (chosen).** Passive, the standard Wireshark way, nothing runs as root, nothing in the traffic changes,
  and it is per session: off is a line removed.
- **eBPF uprobes on the TLS libraries** (ecapture, bcc's `sslsniff`): plaintext without telling the programs, but a
  daemon with root (`CAP_BPF`), tied to library versions (Chromium's own BoringSSL is static), and out of band: the
  plaintext comes apart from the packets, so who asked whom is guessed again. Turned down.
- **A proxy that terminates TLS** (mitmproxy) with its certificate installed: sees everything, every device if pointed
  at it, but it is a man in the middle; left out with the rest of what changes other people's traffic, for him to
  think through.

## Limits

- HTTP/2's header blocks are matched to their streams by the order tshark lists them; a frame where they do not agree
  (a header block tshark could not decode, after `-M` reset its state or it missed the connection's start) is passed
  over, not guessed. Long connections that outlive a `-M` reset (every 100 000 frames) lose their keys' session and
  are not read after it.
- HTTP/1 pipelining: the first request of a frame is read.
- An answer is matched while its request is among the last 1000 awaiting one.
