<script lang="ts">
  // One interface: what it is, whether Argus listens on it and how that goes, and the devices heard on it.
  import type { Interface } from '../../../shared/types.ts';
  import { argus } from '../lib/argus.svelte.ts';
  import Conversations from '../lib/Conversations.svelte';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import EntityIcon from '../lib/EntityIcon.svelte';
  import { bytes, since, span } from '../lib/format.ts';
  import { link } from '../lib/router.svelte.ts';

  let { id }: { id: string } = $props();
  const i = $derived(argus.interfaces.find((x) => x.id === id) as Interface | undefined);
  const l = $derived(argus.session?.listening.find((x) => x.id === id));
  const devices = $derived(argus.liveSource.devices.filter((d) => d.interfaces.includes(id)));
  const talks = $derived(argus.liveSource.conversations.filter((c) => c.interfaces.includes(id)));
  let problem = $state('');
</script>

<div class="page">
  <header class="page-head">
    <p class="crumbs"><a href={link.now()}>Agora</a><span class="sep">/</span>{i?.name ?? id}</p>
    {#if i}
      <div class="title">
        <EntityIcon entity={i} size={46} />
        <div>
          <h1 class="page-title">{i.name}</h1>
          <p class="who mono">{i.id}</p>
        </div>
      </div>
      <dl class="props">
        <dt>Estado</dt>
        <dd>
          {#if l?.on}{l.status === 'failed' ? `Parou: ${l.error}` : l.status === 'starting' ? 'A abrir' : `A escutar há ${span(Date.now() / 1000 - (l.since ?? Date.now() / 1000))}`}{:else}Sem
            escutar{/if}{i.up === false ? '; a interface está desligada' : ''}
        </dd>
        {#if l?.on}
          <dt>Pacotes</dt>
          <dd>{l.packets.toLocaleString('pt-PT')}</dd>
          <dt>Em disco</dt>
          <dd>
            {bytes(l.ringBytes)} de {argus.session ? `${argus.session.limits.ringFiles * argus.session.limits.ringFileMB} MB` : ''}: o ring buffer guarda os
            últimos minutos e apaga os mais antigos
          </dd>
        {/if}
      </dl>
      <div class="head-actions">
        <button
          class={l?.on ? 'ghost' : 'primary'}
          disabled={!i.capturable}
          onclick={async () => (problem = await argus.listen(id, !l?.on))}>{l?.on ? 'Parar de escutar' : 'Escutar'}</button
        >
        {#if problem}<span class="error">{problem}</span>{/if}
      </div>
    {:else}
      <h1 class="page-title">{id}</h1>
      <p class="page-lede">Esta interface já não existe neste PC.</p>
    {/if}
  </header>
  {#if devices.length}
    <section class="band">
      <div class="band-h"><h2>Ouvidos aqui</h2><span class="aside">{devices.length}</span></div>
      <DeviceTable {devices} live />
    </section>
    <section class="band">
      <Conversations conversations={talks} source={argus.liveSource} title="Ligações nesta rede" />
    </section>
  {:else if l?.on}
    <p class="muted">Ainda ninguém {l.since ? `desde ${since(l.since)}` : ''}.</p>
  {/if}
</div>

<style>
  .title {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .who {
    margin: 4px 0 0;
    color: var(--muted);
  }
</style>
