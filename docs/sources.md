# Sources: seeing more of the network than passes through this PC

On a switched network (a router, a switch, Wi-Fi) a PC hears mostly its own traffic and what the others announce to
everyone. The sensor (docs/sensor.md) cannot do better by listening harder: no monitor mode, no ARP spoofing. So
Argus also asks other witnesses who is on the network (`server/sources.ts`). What they find is shown apart from what
was heard: *Found on the network, not heard*, at the end of Devices.

## The rule: what is passive, what is active, and when each runs

| Source | Passive or active | When it runs | What it does |
|---|---|---|---|
| Listening (tshark, dumpcap) | Passive | While an interface is turned on in the bar | Reads the frames that reach this PC. Sends nothing. |
| This PC's neighbour table | Passive | Every 15 s (`ARGUS_SOURCES_MS`) | Reads `ip neigh show`: the MACs the kernel resolved for its own traffic. A local read: sends nothing. |
| DHCP leases | Passive | Every 15 s, when a lease file exists | Reads a dnsmasq or ISC dhcpd lease file on this PC (only there when this PC hands out addresses: a hotspot, NetworkManager's shared connections, or `ARGUS_LEASES`). A local read: sends nothing. |
| Scan of the LAN | **Active** | **Only when he presses *Scan … now* on the Scan page, on the network this PC is on then.** Never on a timer, never at start, never from the agent. | Runs `nmap -sn` over the /24 this PC is in (at most 254 addresses, whatever the interface's mask). Without root, nmap tries a TCP connection to ports 80 and 443 of each address; to do so the kernel sends an ARP request for each; for the addresses that answered, nmap asks the DNS server for their names (PTR). Then it reads the neighbour table for their MACs. |
| Reading the router | **Active** | **Only when he presses *Read the router now* on the Scan page, on the network this PC is on then.** Never on a timer, never at start, never from the agent. | Asks the router's web page (`http://<gateway>`) which model it is, logs in to it as its owner would, reads its list of devices (name, MAC, address, cable or Wi-Fi, connected or only remembered) and logs out. Changes nothing on the router. |

The scan and reading the router are the only things in Argus that send, and the page says so beside each button
("active · sends packets", "active · logs in to it", and what each does). Every other part only listens or reads files
and tables of this machine. The scan is not a port scan: it asks whether an address is up, by two ports it does not
report on, and keeps nothing of the answers but "up".

**Only the network of here.** What is asked of a network can only be asked of the one this PC is on: its way out (the
default route of a Wi-Fi or a cable, not a VPN's), the gateway, and its MAC from the neighbour table
(`Sources.here`, local reads). The page offers the buttons only for that network; for another it says why not; the
server refuses a scan or a reading asked for another network. What they find is placed on the network asked.

**The router, model by model.** Each model is an adapter in `server/routers/` (listed in `server/routers/all.ts`):
how to tell its page before logging in, how to log in, where the list is, how many tries it allows. The first is the
**MEO Fiber Gateway** (Altice Labs; its page an AngularJS app on `micro_httpd`): it logs in with an HMAC of the
password's hash and a nonce the box gives per session, so the password itself never crosses the network; the list is
`ss-json/fgw.common/fgw.common.devicesAll.json`; `logout.cmd` after. Its factory password is not public: the box's own
login page says it is the Wi-Fi key on the label, one per box. The box locks its page after five wrong tries, so Argus
never tries a saved password with two or fewer left, nor a typed one with one left, and never guesses. A model whose
factory password is public, the same on every box, lists it in `defaults`: it is tried first, and the page says it
worked, as a warning. SNMP, TR-064 and UPnP were looked at for this box: none answered (no UPnP description, no SSDP
reply); its own page is the way.

**His password.** Typed on the Scan page, sent once to Argus's server (on this machine), tried, and kept only if it
lets Argus in: in `~/.config/argus/routers.json` (`ARGUS_ROUTER_KEYS`), a file of mode 600 in a folder of 700, by the
router's MAC, outside the repository and the data folder. It is only ever given to the router with that MAC; no
answer of the API, log or page carries it (the page learns only "saved, for user admin"); *Forget it* removes it.
Where the interfaces are made up (the tests, the demo) the file is the instance's own, so a made-up router's password
never reaches his. The tests use a pretend Fiber Gateway (`tests/fake-router.ts`), never his.

**Runs.** Each time he asks is a run (`SourceRun`): when, on which network and interface, what it found, and for each
device what Argus knew of it just before (heard by this PC, found before, or new). Kept in memory, like the found
devices, the last 30, until Argus restarts.

`ARGUS_SCAN=0` takes the scan's button away; `ARGUS_ROUTER=0` the router's; `ARGUS_ROUTER_URL` points at a made-up
router (the demo, the tests); `ARGUS_NEIGH=0` stops reading the neighbour table; `ARGUS_LEASES=none` stops
reading leases (or `ARGUS_LEASES=/path/a,/path/b` names the files). With made-up interfaces (`SYS_NET` is not
`/sys/class/net`: the tests, `pnpm demo`) all four are off unless turned on by those variables, so the real LAN never
reaches a test or a picture.

## Which network a found device is on

The same rule as for what was heard (`shared/networks.ts` `networkAt`): the network its interface was on at the time
it was last found, a stay that holds that time or one within a minute of it. A device the kernel remembered at home is
on the home network, not on the café's because the PC is at the café now. Found while nothing was listened on, it is
on no network: in no network's list, only with *All networks*. What a scan or the router found is on the network that
was asked, the router's, whatever was being listened on.

## What a found device is and is not

- It is a MAC, an address and, from a lease or a PTR record, a name: `foundOnly`, `origin` says by what.
- It has no traffic: no frame of it passed through this PC. Its rate, its spark and its total say "not heard".
- A device the sensor did hear gains the lease's name, its other addresses and the `origin` marks, and keeps its own
  times: being in a table is not being heard, so a quiet device stays quiet.
- It is not kept in the day (`server/history.ts`): the diary and "new device" are of what was heard.
- The agent sees it in `get_hosts` with `foundNotHeard`.
- This PC itself (its MACs and addresses) is never a found device.

## Not here, on purpose

Other models of router (each its own adapter, when one is met), a sensor on another machine (docs/sensor.md), a DNS
server's log, and anything that changes other people's traffic (ARP spoofing, deauthentication, port scans) are not
part of this. The first three would be other `Found` sources; the last are a separate question, to be thought about on
their own.
