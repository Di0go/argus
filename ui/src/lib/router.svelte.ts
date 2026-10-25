// The page from the address: #/ (hosts), #/device/<id>, #/remote/<ip>, each with ?c=<capture> to look at another.

export type Route = { page: 'hosts' } | { page: 'device'; id: string } | { page: 'remote'; id: string } | { page: 'captures' };

function parse(hash: string): { route: Route; capture?: string } {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const capture = new URLSearchParams(query).get('c') ?? undefined;
  const [, page, ...rest] = path.split('/');
  const id = decodeURIComponent(rest.join('/'));
  if (page === 'device' && id) return { route: { page: 'device', id }, capture };
  if (page === 'remote' && id) return { route: { page: 'remote', id }, capture };
  if (page === 'captures') return { route: { page: 'captures' }, capture };
  return { route: { page: 'hosts' }, capture };
}

class Router {
  current = $state(parse(location.hash));

  constructor() {
    addEventListener('hashchange', () => {
      this.current = parse(location.hash);
      scrollTo(0, 0);
    });
  }
}

export const router = new Router();

/** The address of an entity's page, in the capture being looked at. */
export function href(kind: string, id: string, capture?: string): string {
  const page = kind === 'remote' ? 'remote' : kind === 'device' ? 'device' : '';
  return `#/${page}${page ? `/${encodeURIComponent(id)}` : ''}${capture ? `?c=${encodeURIComponent(capture)}` : ''}`;
}
