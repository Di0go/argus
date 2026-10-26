// What a conversation shows of how safe it is, from its headers alone: whether what it carries travels in the clear
// (HTTP, FTP, Telnet, mail without TLS), whether a password went with it (only that one did: the facts never hold
// the password; the ring buffer's raw packets do, for its minutes), which TLS version it agreed, and whether a device asks for names in the clear, from another server than
// the house's, or encrypted. Words for the pages and the agent; the tally (server/tally.ts) marks the conversations.

/** The protocols that carry what someone reads or types in the clear, by tshark's layer name, as he would say them. */
export const CLEAR: Record<string, string> = {
  http: 'HTTP',
  ftp: 'FTP',
  'ftp-data': 'FTP',
  telnet: 'Telnet',
  pop: 'POP3',
  imap: 'IMAP',
  smtp: 'SMTP',
  mqtt: 'MQTT',
  rtsp: 'RTSP',
  tftp: 'TFTP',
  irc: 'IRC',
  sip: 'SIP',
  snmp: 'SNMP',
  vnc: 'VNC',
  rlogin: 'rlogin',
  ldap: 'LDAP',
  http2: 'HTTP/2',
  redis: 'Redis',
  pgsql: 'PostgreSQL',
  mysql: 'MySQL',
  x11: 'X11',
};

/** What each one exposes, in a phrase. */
export const CLEAR_WHY: Record<string, string> = {
  HTTP: 'pages, forms and cookies can be read and changed on the way',
  FTP: 'files, and the password to log in, travel as they are',
  Telnet: 'everything typed, passwords included, travels as it is',
  POP3: 'mail, and the password to fetch it, travels as it is',
  IMAP: 'mail, and the password to read it, travels as it is',
  SMTP: 'mail travels as it is',
  MQTT: "a home device's messages and commands travel as they are",
  RTSP: 'a camera or media stream can be watched on the way',
  TFTP: 'files travel as they are, without a password at all',
  IRC: 'chat travels as it is',
  SIP: 'who calls whom, and maybe the call, travel as they are',
  SNMP: "the device's settings, and its community password, travel as they are",
  VNC: 'the screen and the keyboard may travel unencrypted',
  rlogin: 'everything typed travels as it is',
  LDAP: 'directory lookups, and maybe passwords, travel as they are',
  'HTTP/2': 'pages, forms and cookies can be read and changed on the way',
  Redis: 'the data and its password travel as they are',
  PostgreSQL: 'queries, results and maybe the password travel as they are',
  MySQL: 'queries and results travel as they are',
  X11: 'the screen and the keyboard travel as they are',
};

/** A TLS version as tshark prints it (0x0301…0x0304) → "1.0" … "1.3"; SSL 3 is "SSL 3". */
export function tlsVersion(v: string | undefined): string | undefined {
  const n = v ? Number.parseInt(v, v.startsWith('0x') ? 16 : 10) : Number.NaN;
  switch (n) {
    case 0x0300:
      return 'SSL 3';
    case 0x0301:
      return '1.0';
    case 0x0302:
      return '1.1';
    case 0x0303:
      return '1.2';
    case 0x0304:
      return '1.3';
    default:
      return undefined;
  }
}

/** TLS older than 1.2: broken or deprecated (RFC 8996). */
export const isOldTls = (v: string | undefined) => v === 'SSL 3' || v === '1.0' || v === '1.1';

/** The public resolvers a device may ask directly, by address, as he would name them. */
export const RESOLVERS: Record<string, string> = {
  '8.8.8.8': 'Google DNS',
  '8.8.4.4': 'Google DNS',
  '2001:4860:4860::8888': 'Google DNS',
  '2001:4860:4860::8844': 'Google DNS',
  '1.1.1.1': 'Cloudflare DNS',
  '1.0.0.1': 'Cloudflare DNS',
  '2606:4700:4700::1111': 'Cloudflare DNS',
  '2606:4700:4700::1001': 'Cloudflare DNS',
  '9.9.9.9': 'Quad9',
  '149.112.112.112': 'Quad9',
  '208.67.222.222': 'OpenDNS',
  '208.67.220.220': 'OpenDNS',
  '94.140.14.14': 'AdGuard DNS',
  '94.140.15.15': 'AdGuard DNS',
};

/** How a device looks up names. */
export interface DnsUse {
  /** house: the network's own resolver (the router, or the one most devices ask); other: a resolver it chose, in the
   * clear; encrypted: DNS over TLS (853) or over HTTPS (a known resolver's name in TLS). */
  kind: 'house' | 'other' | 'encrypted';
  /** The server's address (or entity key, for one here). */
  server: string;
  /** "Google DNS", "the router". */
  name?: string;
  /** Questions (packets) or connections seen. */
  count: number;
}

/**
 * In the clear by design and harmless: connectivity checks (captive.apple.com, connectivitycheck.gstatic.com),
 * certificate lists and status from the certificate authorities (CRL, OCSP: signed, public), and software updates
 * (signed packages over plain HTTP, as Chrome, Windows and Linux mirrors fetch them: on a real network they kept the
 * colour on all day). Said, but not coloured: a colour always on stops meaning anything. Never with a login.
 *
 * Only by the name the connection itself asked for (HTTP's Host, TLS's SNI), never by what DNS said of the address
 * (one address serves many names), and only by the dictionary's name rules or the authorities' own hosts: a host that
 * merely starts with "ocsp." or "status." is not exempt (both found by the red team).
 */
export function harmless(clear: string, asked: string[], app?: { category: string; activity: string; by: string }): boolean {
  if (clear !== 'HTTP' || !asked.length) return false;
  if (app?.by === 'name' && (app.category === 'updates' || app.activity === 'checking for internet')) return true;
  return asked.every((n) => AUTHORITIES.test(n) || CHECKS.has(n.toLowerCase()));
}

/** The certificate authorities' CRL and OCSP hosts, and those of their intermediate certificates (signed: crt., cacerts.). */
const AUTHORITIES =
  /^((ocsp|crl|crt|cacerts)\d*\.(digicert|sectigo|comodoca|usertrust|globalsign|entrust|godaddy|identrust|verisign|starfieldtech)\.(com|net)|[a-z0-9.-]*\.lencr\.org|(ocsp|crl|c)\.pki\.goog|crl\.microsoft\.com|ocsp\.msocsp\.com|ctldl\.windowsupdate\.com|ocsp\.apple\.com|crl\.apple\.com)$/i;

/** Connectivity checks, by their exact hosts. */
const CHECKS = new Set([
  'captive.apple.com',
  'connectivitycheck.gstatic.com',
  'connectivitycheck.android.com',
  'clients3.google.com',
  'detectportal.firefox.com',
  'www.msftconnecttest.com',
  'nmcheck.gnome.org',
  'network-test.debian.org',
  'ping.archlinux.org',
]);
