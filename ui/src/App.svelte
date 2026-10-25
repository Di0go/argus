<script lang="ts">
  // The frame (the core's): the ribbon with Argus's places, the open pages as tabs, the page the address names, and
  // the status line saying where it listens and how fast the network moves. One hover card for every entity link,
  // one search over every entity, and a menu on each entity's link.
  import { keyOf } from '@organon/core/shared/entities';
  import ContextMenu, { type MenuItem } from '@organon/core/ui/ContextMenu.svelte';
  import Frame from '@organon/core/ui/Frame.svelte';
  import HoverCard from '@organon/core/ui/HoverCard.svelte';
  import Ribbon, { type Place } from '@organon/core/ui/Ribbon.svelte';
  import Search, { type SearchHit } from '@organon/core/ui/Search.svelte';
  import StatusLine from '@organon/core/ui/StatusLine.svelte';
  import TabBar from '@organon/core/ui/TabBar.svelte';
  import { when } from './lib/format.ts';
  import { argus } from './lib/argus.svelte.ts';
  import EntityCard from './lib/EntityCard.svelte';
  import { rate } from './lib/format.ts';
  import Logo from './lib/Logo.svelte';
  import { entityHref, link, router, tabs, type Located } from './lib/router.svelte.ts';
  import Capture from './pages/Capture.svelte';
  import Captures from './pages/Captures.svelte';
  import Device from './pages/Device.svelte';
  import Devices from './pages/Devices.svelte';
  import Interface from './pages/Interface.svelte';
  import Internet from './pages/Internet.svelte';
  import Now from './pages/Now.svelte';
  import Remote from './pages/Remote.svelte';
  import Site from './pages/Site.svelte';
  import { theme } from './theme.svelte.ts';

  /** The places' icons, drawn like the core's (20×20, stroked); the tabs use them too. */
  const ICON = {
    now: 'M2.5 10.5h3.2l2.1-5.5 3.6 10 2.2-6h3.9',
    devices: 'M2.5 4.5h10v7.5h-10zM5.5 15.5h4M7.5 12v3.5M14.5 8h3v8.5h-3z',
    internet: 'M10 3.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M3.5 10h13M10 3.5c1.9 1.9 2.8 4.1 2.8 6.5s-.9 4.6-2.8 6.5c-1.9-1.9-2.8-4.1-2.8-6.5s.9-4.6 2.8-6.5',
    site: 'M5 16.5V4h7v12.5M12 8h3v8.5M3.5 16.5h13M7.5 7h2M7.5 10h2M7.5 13h2',
    captures: 'M3.5 5h13v3h-13zM4.5 8v7.5h11V8M8 11h4',
    interface: 'M3 8.2a10 10 0 0 1 14 0M5.6 11a6.3 6.3 0 0 1 8.8 0M8.2 13.8a2.6 2.6 0 0 1 3.6 0M10 16.2v.1',
  };
  const PAGE_ICON: Record<Located['page'], string> = {
    now: ICON.now,
    devices: ICON.devices,
    device: ICON.devices,
    internet: ICON.internet,
    remote: ICON.internet,
    site: ICON.site,
    interface: ICON.interface,
    captures: ICON.captures,
    capture: ICON.captures,
  };

  const route = $derived(router.route);
  const failed = $derived(argus.session?.listening.filter((l) => l.on && l.status === 'failed') ?? []);
  const places = $derived<Place[]>([
    {
      id: 'now',
      label: 'Agora',
      href: link.now(),
      icon: ICON.now,
      on: route.page === 'now' || route.page === 'interface',
      pip: failed.length ? 'turn' : undefined,
      pipTitle: failed.length ? `Parou: ${failed.map((l) => l.id).join(', ')}` : undefined,
    },
    { id: 'devices', label: 'Rede', href: link.devices(), icon: ICON.devices, on: route.page === 'devices' || route.page === 'device' },
    {
      id: 'internet',
      label: 'Internet',
      href: link.internet(),
      icon: ICON.internet,
      on: route.page === 'internet' || route.page === 'remote' || route.page === 'site',
    },
    { id: 'captures', label: 'Capturas', href: link.captures(), icon: ICON.captures, on: route.page === 'captures' || route.page === 'capture' },
  ]);
  const on = $derived(argus.session?.listening.filter((l) => l.on) ?? []);
  const onNames = $derived(on.map((l) => argus.interfaces.find((i) => i.id === l.id)?.name ?? l.id).join(', '));

  /** A tab's title, from what is known now, so it follows names as they are learnt. */
  function title(key: string): string {
    const r = router.parse(key);
    const src = argus.sourceFor(r.capture);
    const named = (k: string, fallback: string) => src?.graph.get(k)?.name ?? fallback;
    switch (r.page) {
      case 'now':
        return 'Agora';
      case 'devices':
        return 'Dispositivos';
      case 'device':
        return named(`device:${r.id}`, r.id);
      case 'internet':
        return 'Na internet';
      case 'remote':
        return named(`remote:${r.id}`, r.id);
      case 'site':
        return r.id;
      case 'interface':
        return argus.interfaces.find((i) => i.id === r.id)?.name ?? r.id;
      case 'captures':
        return 'Capturas';
      case 'capture': {
        const c = argus.captures.find((x) => x.id === r.id);
        return c ? `Captura de ${when(c.started)}` : 'Captura';
      }
    }
  }

  const KINDS = { device: 'Dispositivo', remote: 'Internet', site: 'Empresa', interface: 'Interface', capture: 'Captura' };

  /** Every entity of what the page shows (the live session or its capture), and the captures by date or interface. */
  function search(q: string): SearchHit[] {
    const capture = router.route.capture;
    const src = argus.sourceFor(capture);
    const hits: SearchHit[] = (src?.graph.search(q, 30) ?? []).map((h) => ({
      kind: h.entity.kind,
      title: h.entity.name,
      href: entityHref(h.entity.kind, h.entity.id, capture),
      context: h.entity.summary,
      snippet: h.snippet !== h.entity.name ? h.snippet : undefined,
      entity: keyOf(h.entity),
    }));
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    for (const c of argus.captures) {
      const text = `${when(c.started)} ${c.interfaces.join(' ')} captura`.toLowerCase();
      if (words.every((w) => text.includes(w))) hits.push({ kind: 'capture', title: `Captura de ${when(c.started)}`, href: link.capture(c.id), context: c.interfaces.join(', ') });
    }
    return hits.slice(0, 40);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // No clipboard here: nothing to do.
    }
  }

  /** Right-click on an entity's link: open it, copy its addresses, listen or stop on an interface. */
  function actions(el: Element): MenuItem[] {
    const target = el.closest<HTMLElement>('[data-tip-entity]');
    const key = target?.dataset.tipEntity;
    if (!key) return [];
    const capture = target.dataset.capture || router.route.capture;
    const e = argus.sourceFor(capture)?.graph.get(key);
    if (!e) return [];
    const items: MenuItem[] = [{ label: `Abrir ${e.name}`, run: () => (location.hash = entityHref(e.kind, e.id, capture)) }];
    if (e.kind === 'device') {
      if (e.ips[0]) items.push({ label: 'Copiar o endereço', hint: e.ips[0], run: () => void copy(e.ips[0]!) });
      if (e.mac) items.push({ label: 'Copiar a MAC', hint: e.mac, run: () => void copy(e.mac!) });
    }
    if (e.kind === 'remote') {
      items.push({ label: 'Copiar o endereço', hint: e.ip, run: () => void copy(e.ip) });
      if (e.name !== e.ip) items.push({ label: 'Copiar o nome', run: () => void copy(e.name) });
    }
    if (e.kind === 'interface') {
      const listening = argus.session?.listening.find((l) => l.id === e.id)?.on;
      items.push({
        label: listening ? 'Parar de escutar' : 'Escutar aqui',
        run: () => void argus.listen(e.id, !listening),
        disabled: e.capturable ? undefined : 'Este utilizador não pode escutar nesta interface',
      });
    }
    return items;
  }

  argus.start();
</script>

<Frame app="argus">
  {#snippet ribbon()}
    <Ribbon {places} look={theme} />
  {/snippet}
  {#snippet brand()}<Logo size={20} class="mobile-mark" />argus{/snippet}
  {#snippet mobile()}
    {#if on.length}<span class="listening-m" title="A escutar {onNames}"><i></i>{rate(argus.meter)}</span>{/if}
  {/snippet}
  {#snippet tabbar()}
    <TabBar {tabs} {title} icon={(key) => PAGE_ICON[router.parse(key).page]} />
  {/snippet}
  {#snippet status()}
    <StatusLine warnings={argus.warnings}>
      {#snippet left()}
        {#if !argus.live.connected && argus.live.loaded}<span class="st"><i class="off"></i>Sem ligação ao Argus: a tentar outra vez</span>{/if}
      {/snippet}
      {#each failed as l (l.id)}<a class="st" href={link.interface(l.id)}><i class="off"></i>{l.id} parou</a>{/each}
      {#if on.length}
        <a class="st" href={link.now()} title="O que passa por aqui agora"><i class="on"></i>A escutar {onNames}</a>
        <span class="rate">{rate(argus.meter)}</span>
      {:else if argus.live.loaded}
        <a class="st" href={link.now()}><i></i>Sem escutar</a>
      {/if}
    </StatusLine>
  {/snippet}

  {#key route.page + ('id' in route ? route.id : '') + (route.capture ?? '')}
    {#if route.page === 'now'}
      <Now />
    {:else if route.page === 'devices'}
      <Devices capture={route.capture} />
    {:else if route.page === 'device'}
      <Device id={route.id} capture={route.capture} />
    {:else if route.page === 'internet'}
      <Internet capture={route.capture} />
    {:else if route.page === 'site'}
      <Site id={route.id} capture={route.capture} />
    {:else if route.page === 'remote'}
      <Remote id={route.id} capture={route.capture} />
    {:else if route.page === 'interface'}
      <Interface id={route.id} />
    {:else if route.page === 'captures'}
      <Captures />
    {:else if route.page === 'capture'}
      <Capture id={route.id} />
    {/if}
  {/key}
</Frame>

<HoverCard>
  {#snippet entity(key)}<EntityCard {key} />{/snippet}
</HoverCard>
<Search {search} kinds={KINDS} placeholder="Procurar um dispositivo, um endereço, uma MAC, uma empresa…" empty="Procura entre tudo o que o Argus viu: dispositivos, anfitriões, empresas, interfaces e capturas." />
<ContextMenu app="Argus" {actions} />
