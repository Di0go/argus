// What a conversation is for, said by the server's port: "tcp/443" is HTTPS, "udp/443" QUIC. Only the port, read off
// the headers (what is encrypted is not read): a name here is what that port usually carries, not a proof of it.

/** The ports a home network meets most, by protocol and port. */
const NAMES: Record<string, string> = {
  'tcp/20': 'FTP',
  'tcp/21': 'FTP',
  'tcp/22': 'SSH',
  'tcp/23': 'Telnet',
  'tcp/25': 'SMTP',
  'udp/53': 'DNS',
  'tcp/53': 'DNS',
  'udp/67': 'DHCP',
  'udp/68': 'DHCP',
  'udp/69': 'TFTP',
  'tcp/80': 'HTTP',
  'tcp/110': 'POP3',
  'udp/123': 'NTP',
  'udp/137': 'NetBIOS',
  'udp/138': 'NetBIOS',
  'tcp/139': 'NetBIOS',
  'tcp/143': 'IMAP',
  'udp/161': 'SNMP',
  'tcp/443': 'HTTPS',
  'udp/443': 'QUIC',
  'tcp/445': 'Windows sharing',
  'udp/500': 'VPN (IKE)',
  'tcp/465': 'SMTP',
  'tcp/548': 'Mac sharing',
  'udp/546': 'DHCPv6',
  'udp/547': 'DHCPv6',
  'tcp/554': 'RTSP',
  'tcp/587': 'SMTP',
  'tcp/631': 'Printing (IPP)',
  'udp/853': 'Encrypted DNS',
  'tcp/853': 'Encrypted DNS',
  'tcp/993': 'IMAP',
  'tcp/995': 'POP3',
  'udp/1194': 'OpenVPN',
  'udp/1900': 'SSDP',
  'tcp/1883': 'MQTT',
  'tcp/3000': 'Web (dev)',
  'tcp/3306': 'MySQL',
  'tcp/3389': 'Remote desktop',
  'udp/3478': 'Calls (STUN)',
  'udp/3479': 'Calls (STUN)',
  'udp/4500': 'VPN (IPsec)',
  'tcp/5222': 'Messaging (XMPP)',
  'tcp/5228': 'Google Push',
  'udp/5353': 'mDNS',
  'udp/5355': 'LLMNR',
  'tcp/5432': 'PostgreSQL',
  'tcp/5900': 'VNC',
  'tcp/6379': 'Redis',
  'tcp/7000': 'AirPlay',
  'tcp/8008': 'Google Cast',
  'tcp/8009': 'Google Cast',
  'tcp/8080': 'HTTP',
  'tcp/8443': 'HTTPS',
  'tcp/9100': 'Printing',
  'udp/41641': 'Tailscale',
  'udp/51820': 'WireGuard',
  'tcp/27017': 'MongoDB',
  icmp: 'Ping (ICMP)',
  icmpv6: 'ICMPv6',
  igmp: 'Groups (IGMP)',
};

/**
 * The service of a frame, from its protocol and ports: the port that names a service, else the lower of the two (the
 * other is the client's, picked at random from the high ones). "tcp/443", "udp/53", "icmp", or "" when not IP.
 */
export function serviceOf(proto: 'tcp' | 'udp', srcPort: number, dstPort: number): string {
  const named = [srcPort, dstPort].filter((p) => NAMES[`${proto}/${p}`]);
  // Both named (DHCP's 67 and 68): the lower is the server's.
  return `${proto}/${Math.min(...(named.length ? named : [srcPort, dstPort]))}`;
}

/** IP's protocol numbers that are not TCP or UDP, as a service. */
export function serviceOfProtocol(n: number): string {
  if (n === 1) return 'icmp';
  if (n === 58) return 'icmpv6';
  if (n === 2) return 'igmp';
  return `ip/${n}`;
}

/** "tcp/443" → "HTTPS"; one not in the list → "TCP 8123". */
export function serviceName(service: string): string {
  if (!service) return 'Other';
  const known = NAMES[service];
  if (known) return known;
  const [proto = '', port = ''] = service.split('/');
  return port ? `${proto.toUpperCase()} ${port}` : proto.toUpperCase();
}

/** The port, to show beside the name ("443"), or "" when there is none. */
export function servicePort(service: string): string {
  const [proto = '', port = ''] = service.split('/');
  return port && proto !== 'ip' ? `${proto} ${port}` : '';
}
