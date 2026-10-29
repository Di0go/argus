# How Argus shows the network

Argus stops being a list of traffic and becomes a monitor one person reads at a glance: open `https://argus.test` and
know in seconds what is happening on the network, what each device is and is doing, and what deserves attention. This
is how the pages are laid out, why, and what was tried and turned down. (The file keeps the name it was asked for;
everything in it is in English, like the rest of Argus.)

## 2026-10-29, later: Scan, a page of its own, and the router read

He: "the scan has to be a new section in Argus's sidebar", and of the router, "we go case by case then […] check MEO's
default password". **Scan** is a place in the ribbon, between Internet and Privacy. At its top, the networks as chips,
the one of here first ("here now"; the bar's network when it shows one). For the network of here, two panels side by
side (stacked on a phone), each titled with what it does in a tag, "active · sends packets" and "active · logs in to
it", the sentence of what exactly, and its button. For another network: why not ("cannot be reached from here") and a
link back to the network of here, no button. Under them, every run on that network, the latest first: what, when, on
which interface, how many, and a table of what it found with what Argus knew of each just before (*Heard*, *Found
before*, *New*), the router's with how each is connected (*Wi-Fi 5GHz, Willow House*, *Cable, LAN 2*) and the ones it
only remembers greyed. The router panel says the router's address and model and whether a password is saved (with
*Forget it*); asked for one, it says where the factory one is and that it stays on this PC. A public factory password
that let Argus in is said in a warning band: anyone on the network can log in to it.

Devices keeps the passive sources and points to Scan for the two active ones: one way to ask, not two.

**Turned down:** keeping the scan's button on Devices beside a link to Scan (two ways of doing one thing); detecting the
router's model on opening the page (a request to the router he did not press for); a second network picker in the
bar's menu (the chips are what can be *asked*, the bar is what is *shown*); trying guessed passwords on his router (it
locks its page after five; the factory password of the MEO box is the Wi-Fi key on its label, one per box, not public).

## 2026-10-29: where it listens, what it shows, and what it found

He, after the monitor: "I have certain networks selected but I still see devices that aren't from there. And I'm still
quite confused by the UI. And I'd like to see more of the network, not only what passes through my device." Three
answers, each checked in headless Chromium on the demo at 1440 and 390, and on the dev instance:

**The bar says two things apart, each with its caption.** *Listen on*: the interfaces, as pills (where frames are
captured). *Showing*: which network the pages read (the menu, "Showing: Willow House"). On a phone they are two lines,
each still captioned. The ribbon's "Network" became *Devices*: one word, one meaning.

**A network's list holds only its devices, and says the rest.** A device is on every network it was heard on; in one
network's view its network column names that network and "+1 elsewhere" for the others (the names in its tip), and its
totals are its share there. Traffic heard more than a minute outside every stay is on no network rather than guessed
into the nearest (`shared/networks.ts` `networkAt`). A device's own page opened while another network is shown says
so in a line, with "Show its network" and "Show all networks". On Devices, *This session* / *Heard now* (the last five
minutes) keeps a list of everything ever heard from reading as everyone here now.

**Found on the network, not heard**, at the end of Devices, apart from what was heard: the neighbour table and lease
files (passive, read every 15 s) and a scan of the LAN (active, only by its button, which says "active" and what it
sends: docs/sources.md). A found device says by what, "not heard" where its traffic would be, and is placed on the
network its interface was on when it was found; the scan is offered only while the Wi-Fi or cable of the network shown
is being listened on. Now says "2 more devices were found on the LAN" in one line, never among who is using it.

**Turned down:** a *Sources* popover in the bar (the bar is where it listens and what it shows; a third thing there
was the confusion again); a "Found only" choice beside *This session* (the section below is always there); renaming
Diary to Day (no one asked); a made-up network per interface for found devices (it showed the home TV at the café); one
ping per host after the scan (the scan's own ARP already left the MACs in the neighbour table).

## 2026-10-26: the monitor (this replaces the newsroom below)

He saw the newsroom (layout A below, release 8df7daa) on his own network and turned it down: "the homepage is
horrible, the selector with pills is great, but it needs to be there all of the time, the rest of the homepage is
unusable, I'm completely lost in all of this information, and the unencrypted traffic icons and signals are horrible
too, it's too much, just a small icon for it … and I can't see anything in real time that's useful". What is below this
section is kept as the record of what was tried; where it disagrees with this section, this section holds.

**The home page answers one question: who is using the network now, and for what.** A line per device in use (its
mark, its name, what it is doing in words, and how fast over the last ten whole seconds), in the order of that number;
at most five lines, the rest and the quiet ones in one link ("And 3 more in use, 4 quiet"). Under it, *Talking to
now*: the four busiest other ends (the app, else the company, else the host), what for, and how fast, the device said
only when there is more than one. Both move every second over the live stream, without a reload ("Live, every second"
says so); the order is re-sorted every two seconds and never under the pointer, and a conversation that has just begun
lights up for a moment. With nothing listening, or listening stopped (dumpcap gone), the page says so ("Not listening
now", "Listening stopped") and shows nothing of before as if it were now. A line is a door: one click to the device.
The sentence on top, the day by hour, the diary, privacy and the bandwidth chart left the home page; they are each
one click away in the ribbon (Diary, Privacy; the bandwidth of a network on its own page).

**Where Argus listens is a bar of pills on every page**, under the tabs, sticky: a pill per network that usually
matters (Wi-Fi, cable, VPN, up), each a switch with its rate now, the rest behind "N more", and "Save last minutes" at
the end. It replaces the list that opened under "Change" on Now.

**Without encryption is a small open padlock**, in the ink of the text beside it, no colour, no badge, no stripe, no
counter; its tip says what it was (the protocol, whether a login went by, why it matters). The full account (every
unencrypted conversation, tracking, DNS, old TLS, where the data goes) is on the Privacy page. `--clear` and its orange
are gone.

**A device's page** starts with what it is doing now, how fast, its last five minutes, and whom it is talking to now
(live, the same table as the home page); what it is, the clues, its day, privacy and conversations come after.

**Counted** (every visible text and icon above the fold at 1440 × 900, in headless Chromium; the page area, without
the frame every page shares, ribbon, tabs and status line, 22 of them): on a real network with one device busy, from
59 on 8df7daa to 26 (44 %); on the demo's busy house, from 94 to 43 (46 %), the five lines holding it there. Two
screenshots five seconds apart, no reload, show different rates on every line.

**Turned down after the first review** (02c9feb): a call ahead of anything else (a 30 KB/s call sat above a 1.1 MB/s
stream, and nothing on screen said why: the order now follows the number shown); a bar beside each rate (no scale, so
a reader could not tell what it meant; the number says it); a line for every busy device (on a busy house the page
grew back to two thirds of what it was).

**The crew**, the trades the verbs asked for and their methods, applied here:
- *The broadcast-graphics designer* (live scores, election night): figures in fixed-width columns that change in place,
  an order re-sorted on a slow clock and never under the eye, a newcomer marked for a moment, the refresh said on
  screen. *Changed:* tabular figures with a fixed column, `Ranked` (re-sort every 2 s, hold under the pointer, a newcomer
  takes its place, at the end while the pointer is over the list), the brief grey on a new conversation, "Live, every second".
- *The wayfinding designer* (stations, hospitals): the same sign in the same place everywhere, saying where you are,
  every door labelled by what is behind it. *Changed:* the network pills sticky under the tabs on every page, their
  state (dot, rate) on the pill itself; every line of the home page is a link to its device.
- *The usability researcher* (five-second and first-click tests): the page's one question written first, then a fresh
  reader shown the screen once. *Changed:* a reader with no context, shown the real and the demo home page once each,
  named every busy device and what it was doing and where to click; what confused it (an order that did not follow the
  number shown, two rates for the same thing, a pink highlight that meant nothing) was fixed: the order follows the
  number, the pills use the rows' ballistics, the highlight is grey.

**The red team** (a fresh reviewer told to break it) found, and it was fixed: the first rule for a second router turned
a host with a public address, or a device sending made-up addresses, into a router (now: a way out is where frames for
eight or more internet hosts are sent; this PC never is; a session kept before keeps its router); a printer's
announcements made a line blink in and out 34 times a minute (now: in use means doing something named or talking to
someone, held ten seconds; 0 changes in 60 s); a conversation shown faster than its whole device (now both over the
same three seconds; 0 in 20 s); lines that moved under the pointer (0 now); a login in the clear that never reached the
home page (now a padlock by the device's name); the router's page saying "Quiet now" at 3 MB/s.

**Turned down, with the reason:**
- *Cards per device* (mock-up B): the busiest device's number big, its top three conversations inside. Pretty with
  one device, a wall with eight, and two cards a row break the "read down one column" of a monitor.
- *A feed of what begins* (mock-up C): a ticker of new conversations, newest first. It moves, but what is new is
  rarely what matters; a monitor's question is "what is busy", not "what just started".
- *A sparkline per row*: htop and Activity Monitor have none; the number and a bar say it, and the sparklines alone
  were five icons above the fold.
- *The status sentence* ("In use. 1 of 13 devices are using the network…"): the list says it, line by line.

## The newsroom (2026-10-25, turned down on 2026-10-26)

Everything from here down is the design he turned down, kept so nobody draws it again: the one colour for
unencrypted, the status sentence, privacy beside the list and the day under it all left the home page (see the top).

### The questions, in the order a person asks them

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

### How the best do it, and what they do badly

| Tool | Kept | Turned down |
| --- | --- | --- |
| **Little Snitch** (Network Monitor, its map) | Traffic grouped by *who* (the app), not by host; one click from a line to its details. | The world map: beautiful, slow to read, says nothing about *what* the traffic is. |
| **GlassWire** | The bandwidth graph annotated with *what* caused it. Usage by app over a chosen period. | Alerts for every first connection: within a day you stop reading them. |
| **Firewalla** | Device type recognised and shown with an icon; per device, its top apps and categories; plain words. | Alarms as the main surface; a lot lives three taps deep in mobile tabs. |
| **UniFi** (client list, Traffic Identification) | Device fingerprinting (it is very good at saying what a client is); traffic by app category per client. | Donuts with no time on them; topology diagrams that are about cables, not use. |
| **Pi-hole** | The query log, where a colour says at once what was blocked. Top clients, top domains. | Big counters (queries today, % blocked) that say a number, not a meaning. |
| **ntopng** | Depth: every flow, ASN, country, TLS version, a score per host. | Built for a network engineer: a human looking for "is anything wrong" drowns. |

### The crew: the trades whose methods shaped it

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

### The three layouts drawn

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

### The pages

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

### Turned down

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

### As built, and what changed on the way

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
