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
| Scan of the LAN | **Active** | **Only when he presses *Scan … now* on Devices.** Never on a timer, never at start, never from the agent. | Runs `nmap -sn` over the /24 this PC is in (at most 254 addresses, whatever the interface's mask). Without root, nmap tries a TCP connection to ports 80 and 443 of each address; to do so the kernel sends an ARP request for each; for the addresses that answered, nmap asks the DNS server for their names (PTR). Then it reads the neighbour table for their MACs. |

The scan is the only thing in Argus that sends packets, and the page says so beside its button ("active", and what it
sends). Every other part only listens or reads files and tables of this machine. The scan is not a port scan: it asks
whether an address is up, by two ports it does not report on, and keeps nothing of the answers but "up".

`ARGUS_SCAN=0` takes the button away; `ARGUS_NEIGH=0` stops reading the neighbour table; `ARGUS_LEASES=none` stops
reading leases (or `ARGUS_LEASES=/path/a,/path/b` names the files). With made-up interfaces (`SYS_NET` is not
`/sys/class/net`: the tests, `pnpm demo`) all three are off unless turned on by those variables, so the real LAN never
reaches a test or a picture.

## Which network a found device is on

The same rule as for what was heard (`shared/networks.ts` `networkAt`): the network its interface was on at the time
it was last found, a stay that holds that time or one within a minute of it. A device the kernel remembered at home is
on the home network, not on the café's because the PC is at the café now. Found while nothing was listened on, it is
on no network: in no network's list, only with *All networks*. That is why the scan asks to listen on the network
shown first: what it finds is placed on the network being heard.

## What a found device is and is not

- It is a MAC, an address and, from a lease or a PTR record, a name: `foundOnly`, `origin` says by what.
- It has no traffic: no frame of it passed through this PC. Its rate, its spark and its total say "not heard".
- A device the sensor did hear gains the lease's name, its other addresses and the `origin` marks, and keeps its own
  times: being in a table is not being heard, so a quiet device stays quiet.
- It is not kept in the day (`server/history.ts`): the diary and "new device" are of what was heard.
- The agent sees it in `get_hosts` with `foundNotHeard`.
- This PC itself (its MACs and addresses) is never a found device.

## Not here, on purpose

Reading the router by its API or SNMP, a sensor on another machine (docs/sensor.md), a DNS server's log, and anything
that changes other people's traffic (ARP spoofing, deauthentication, port scans) are not part of this. Each of the
first four would be another `Found` source; the last are a separate question, to be thought about on their own.
