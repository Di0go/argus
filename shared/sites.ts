// Hosts out on the internet grouped by who runs them: the site a name belongs to (the registrable part:
// "rr3---sn-apo3qxax-hp5e.googlevideo.com" → "googlevideo.com"), and the company behind the sites everyone meets
// ("googlevideo.com", "1e100.net", "gstatic.com" → Google). A host with no name seen has no site: it stays by itself.

/** Second-level suffixes under which a name has one more label of its own (example.co.uk, example.com.pt). */
const SECOND_LEVEL = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.pt', 'gov.pt', 'org.pt', 'edu.pt', 'com.br', 'net.br', 'gov.br', 'org.br',
  'com.au', 'net.au', 'co.jp', 'ne.jp', 'co.nz', 'co.za', 'com.mx', 'com.ar', 'com.es', 'co.in', 'com.cn', 'com.tr',
]);

/** The company behind a site, for the sites a home network meets most. */
const COMPANIES: [RegExp, string][] = [
  [/^(google|googleapis|googlevideo|gstatic|googleusercontent|1e100|youtube|ytimg|ggpht|doubleclick|googlesyndication|google-analytics|googletagmanager|gvt1|gvt2|withgoogle|android|app-measurement)\.(com|net|org)$/, 'Google'],
  [/^(facebook|fbcdn|instagram|cdninstagram|whatsapp|fbsbx|meta|messenger|oculus)\.(com|net)$/, 'Meta'],
  [/^(apple|icloud|mzstatic|apple-dns|aaplimg|cdn-apple|icloud-content|me)\.com$/, 'Apple'],
  [/^(microsoft|msft|live|windows|windowsupdate|office|office365|msn|bing|azure|azureedge|outlook|skype|xbox|xboxlive|microsoftonline|msedge|sharepoint|onedrive|linkedin|github|githubusercontent|githubassets)\.(com|net)$/, 'Microsoft'],
  [/^(amazon|amazonaws|cloudfront|media-amazon|ssl-images-amazon|primevideo|aiv-cdn|amazonvideo|a2z)\.(com|net)$/, 'Amazon'],
  [/^(cloudflare|cloudflare-dns|one\.one\.one|cloudflareinsights)\.(com|net|one)$/, 'Cloudflare'],
  [/^(akamai|akamaihd|akamaiedge|akamaized|akadns|edgekey|edgesuite|akamaitechnologies)\.net$/, 'Akamai'],
  [/^(netflix|nflxvideo|nflximg|nflxext|nflxso)\.(com|net)$/, 'Netflix'],
  [/^(spotify|scdn|spotifycdn)\.(com|co|net)$/, 'Spotify'],
  [/^(anthropic|claude)\.(com|ai)$/, 'Anthropic'],
  [/^(openai|chatgpt|oaiusercontent)\.com$/, 'OpenAI'],
  [/^(tiktok|tiktokcdn|tiktokv|byteoversea|ibytedtos)\.com$/, 'TikTok'],
  [/^(fastly|fastly-edge)\.(net|com)$/, 'Fastly'],
  [/^(tailscale)\.(com|io|net)$/, 'Tailscale'],
  [/^(steampowered|steamcontent|steamstatic|steamcommunity|valvesoftware)\.com$/, 'Valve'],
  [/^(discord|discordapp|discord\.gg)\.(com|net|gg)$/, 'Discord'],
  [/^(meo|telecom)\.pt$/, 'MEO'],
  [/^(nos)\.pt$/, 'NOS'],
  [/^(vodafone)\.(pt|com)$/, 'Vodafone'],
  [/^(archlinux|pkgbuild)\.org$/, 'Arch Linux'],
  [/^(mozilla|firefox|mozilla\.net|mozgcp)\.(org|com|net)$/, 'Mozilla'],
];

/** The site a host name belongs to; undefined for an address or a name with one label. */
export function siteOf(name: string): string | undefined {
  const n = name.toLowerCase().replace(/\.$/, '');
  if (/^[\d.]+$/.test(n) || n.includes(':')) return undefined;
  const labels = n.split('.').filter(Boolean);
  if (labels.length < 2) return undefined;
  const last2 = labels.slice(-2).join('.');
  if (SECOND_LEVEL.has(last2) && labels.length >= 3) return labels.slice(-3).join('.');
  return last2;
}

/** Who runs a site, when it is one everyone meets; else the site itself. */
export function companyOf(site: string): string {
  for (const [re, company] of COMPANIES) if (re.test(site)) return company;
  return site;
}
