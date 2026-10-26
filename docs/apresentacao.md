# How Argus shows the network

Argus stops being a list of traffic and becomes a monitor one person reads at a glance: open `https://argus.test` and
know in seconds what is happening on the network, what each device is and is doing, and what deserves attention. This
is how the pages are laid out, why, and what was tried and turned down. (The file keeps the name it was asked for;
everything in it is in English, like the rest of Argus.)

## The questions, in the order a person asks them

1. **Is everything normal?** One sentence at the top, in words, and the only colour on the page when something is not.
2. **Who is using the network now, and for what?** One line per busy device: its name, what it is, and what it is
   doing in a verb ("Watching Netflix", "On a WhatsApp call", "Updating Windows"), with how fast.
3. **What is each device?** Under its name, what it is ("iPhone, iOS", "TV, LG webOS", "Linux laptop") and how sure
   Argus is (sure, likely, possibly). The evidence is on its page.
4. **Is anything unsafe?** Connections without encryption (HTTP, FTP, Telnet, mail in the clear, passwords in the
   clear) in one colour, wherever they show; tracking and telemetry; old TLS; devices that ask another DNS; where the
   data goes (country and network).
5. **What happened while I was not looking?** The day as a diary of episodes ("22:14 Living Room TV started Netflix,
   2.3 GB in 27 min") and as columns per hour by what the traffic was for.

Everything else (interfaces, ring buffer, captures, the 10-minute bandwidth chart, MAC addresses) is still there, one
click deeper: it is how Argus works, not what is happening.

## How the best do it, and what they do badly

| Tool | Kept | Turned down |
| --- | --- | --- |
| **Little Snitch** (Network Monitor, its map) | Traffic grouped by *who* (the app), not by host; one click from a line to its details. | The world map: beautiful, slow to read, says nothing about *what* the traffic is. |
| **GlassWire** | The bandwidth graph annotated with *what* caused it. Usage by app over a chosen period. | Alerts for every first connection: within a day you stop reading them. |
| **Firewalla** | Device type recognised and shown with an icon; per device, its top apps and categories; plain words. | Alarms as the main surface; a lot lives three taps deep in mobile tabs. |
| **UniFi** (client list, Traffic Identification) | Device fingerprinting (it is very good at saying what a client is); traffic by app category per client. | Donuts with no time on them; topology diagrams that are about cables, not use. |
| **Pi-hole** | The query log, where a colour says at once what was blocked. Top clients, top domains. | Big counters (queries today, % blocked) that say a number, not a meaning. |
| **ntopng** | Depth: every flow, ASN, country, TLS version, a score per host. | Built for a network engineer: a human looking for "is anything wrong" drowns. |

## The crew: the trades whose methods shaped it

The task, as verbs: *let one person, in ten seconds, tell who is using the network and for what, and whether anything
is unencrypted; name each device for what it is without claiming more than the evidence says; tell what happened while
nobody was looking, as something one reads; keep a day without keeping a packet.* Three trades a network tool would not
usually call answer those verbs:

- **The control-room (HMI) designer**, after ISA-101 "high-performance HMI": a screen that is grey when things are
  normal and uses colour only for what is abnormal, so colour is read, not ignored. *Changed:* the data on the page
  (sparklines, the live meter, the charts) goes neutral; the brand's red stays on navigation and links; one warm colour
  (the core's `--wrong`, orange in the red look) means "without encryption", and nothing else uses it: the category
  palette leaves orange out. Every coloured mark also carries a shape (an open padlock) for colour-blind eyes.
- **The intelligence analyst**, after ICD 203's estimative language: each judgement says how sure it is, in a fixed
  vocabulary tied to the evidence, and the evidence is kept apart from the judgement. *Changed:* the device identity
  says *sure* (the device said it itself: DHCP vendor class, an mDNS model, a user agent), *likely* (two independent
  clues agree), *possibly* (one indirect clue: the maker from the MAC, or what it talks to); when clues disagree it
  says only what they share ("Apple device"), and the device's page lists every clue with its source.
- **The wire editor**: news is a change, not a sample; lead with who did what; merge what is one story; drop what is
  not news. *Changed:* the diary is made of *episodes* (a device and an activity from when it started to when it
  stopped, with how much), not of minutes; quiet background (DNS, the network's own chatter) never makes an entry; a
  device's first appearance and every unencrypted conversation do.

## The three layouts drawn

Over the same made-up house (`docs/mockups/home.html`, opened at `#a`, `#b`, `#c`):

- **A, the newsroom** (chosen): a status sentence; *Who is using the network* (one line per busy device, its activity
  in words, the quiet ones in one line); *Today* (columns per hour by category); *What happened* (the diary); beside
  it, *Privacy and security* with the unencrypted box first.
  `docs/mockups/home-a-1440-light.webp`, `home-a-1440-dark.webp`, `home-a-390-light.webp`.
- **B, the map**: devices on the left, the companies they talk to on the right, the line's width the bytes, the
  unencrypted line in colour. `docs/mockups/home-b-1440-light.webp`.
- **C, the dashboard**: four tiles, a donut by category, top devices and top apps.
  `docs/mockups/home-c-1440-light.webp`.

Why A. The ten-second test asks two things: who uses the network for what, and is anything unencrypted. A answers the
first in its first lines *in words*, and the second with the only colour on the page. B shows who talks to whom but
not *what they are doing*, needs hovering to read amounts, and does not survive 390 px or more than a dozen devices.
C answers with numbers (11 devices, 9.7 GB, 4 %) that need interpreting, the donut has no time, and the tiles take
the best place on the page for what changes least. B's idea survives where it helps: a device's page shows who it
talks to, grouped by company, each line its width in bytes.

## The pages

- **Now** (the home page): as A. The interfaces' switches move to a compact line at the head ("Listening on Wi-Fi
  and Docker · change"), opening the full list; the bandwidth chart of the last ten minutes moves under the diary.
- **A device**: what it is (with how sure, and the clues on demand); *now* in words; its day (columns per hour by
  category, its own diary); *Privacy*: its unencrypted conversations, the trackers it talks to, its DNS, old TLS;
  the companies it talks to; its conversations (unencrypted rows marked); the details (addresses, MAC, names and where
  each came from).
- **A host or a company**: what it is (the dictionary), where it is (country, network), whether its connections are
  encrypted, who talks to it.
- **Privacy** (new place): everything of item 4 for the whole network, each line a link to the device or host.
- **Diary** (new place): the day's episodes, any day kept, with the columns per hour.
- **Network**, **Internet**, **Captures**: as they were, with the identity line and the unencrypted colour added.

Navigation: every name is a link to its page (the core's hover card on each); the status sentence and the unencrypted
pill go to **Privacy**; the diary's lines go to the device; the ribbon has Now, Network, Internet, Privacy, Diary,
Captures.

## Turned down

- **Alerts and notifications** (out of scope, and the reason GlassWire and Firewalla tire their users): colour and
  place only.
- **A world map** for "where the data goes": a bar of countries by bytes reads faster and fits a phone.
- **Donuts**: a bar or columns with time on them.
- **Calling DNS in the clear "unencrypted" in colour**: at home nearly every device asks the router in the clear, so
  it would colour everything and the colour would stop meaning anything. It is said in words in the Privacy box
  ("DNS in the clear: 9 devices"), and a device that asks a DNS other than the house's is listed.
- **Device identity from JA3/JA4 alone**: Argus records each device's TLS client fingerprints, but there is no open
  database of them under a licence compatible with this repository, and a fingerprint names a TLS library, not a
  device. They are kept as clues ("the same software as …"), never as a name.

## As built, and what changed on the way

- **The status sentence** says how many devices are using the network and what the two busiest are doing; the router
  is never counted as a user (it carries everyone's traffic). Beside it, either "N unencrypted in the last hour"
  (the colour, a link to Privacy) or, in plain ink, "Nothing unencrypted in the last hour": the negative is said too,
  so a glance can tell "fine" from "not shown".
- **A call outranks a download** in "doing now", whatever the bytes: a call is light but it is what someone is doing.
- **The diary merges** what one device did at the same time into one line ("This PC is on a Google Meet call, using
  npm, using GitHub"): five lines for one person at one desk was a log, not a diary.
- **Harmless in the clear** grew from connectivity checks and certificate lists to signed software updates: on a real
  network, Chrome's updater over plain HTTP kept the colour on, and a colour always on stops meaning anything. They
  are still listed, quietly, on Privacy. Never with a login.
- **On a phone** the order is the questions' order: the sentence, who is using the network, privacy, the day, the
  diary.
- **The colours**, checked with the dataviz validator for colour blindness, light and dark: blue (video and music),
  aqua (work and AI), violet (calls and messages), magenta (social, web and games), grey (the rest); orange and yellow
  left out so `--clear` (orange) stays alone. Data marks (the bandwidth chart, the sparklines) are neutral grey.
- **Beside Galen** (looked at, not changed): the same frame, ribbon and type; Galen's home leads with a one-line
  verdict ("Rest, protected.") and a diary of the last days with the date on the left, as Argus now does. Galen puts
  sections in panels; Argus keeps the core's bands, as its other pages do.
