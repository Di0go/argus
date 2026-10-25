<script lang="ts">
  // Agora: the live session. Where it listens (a switch per interface), how fast the whole network moves now and over
  // the last ten minutes (or the day), the devices busiest first with their own pulse, and the companies out on the
  // internet they talk to. Everything moves as it comes in; nothing needs a reload.
  import { argus } from '../lib/argus.svelte.ts';
  import DeviceTable from '../lib/DeviceTable.svelte';
  import { bytes, rate, span } from '../lib/format.ts';
  import HostList from '../lib/HostList.svelte';
  import Limits from '../lib/Limits.svelte';
  import Listen from '../lib/Listen.svelte';
  import RateChart from '../lib/RateChart.svelte';
  import { link } from '../lib/router.svelte.ts';
  import Seg from '../lib/Seg.svelte';

  let period = $state<'minutes' | 'day'>('minutes');
  const PERIODS = [
    { id: 'minutes' as const, label: '10 min' },
    { id: 'day' as const, label: 'Hoje' },
  ];
  let saving = $state(false);
  let saved = $state('');

  const s = $derived(argus.session);
  const src = $derived(argus.liveSource);
  const on = $derived(s?.listening.filter((l) => l.on) ?? []);
  const names = $derived(on.map((l) => argus.interfaces.find((i) => i.id === l.id)?.name ?? l.id));
  const seen = $derived(Boolean(s?.packets));

  const lede = $derived.by(() => {
    if (!s) return '';
    if (!on.length && !seen) return 'Liga uma interface e o Argus mostra quem está na rede, ao segundo.';
    const where = names.length ? `A escutar ${list(names)}` : 'Sem escutar agora';
    const since = Math.min(...on.map((l) => l.since ?? Date.now() / 1000));
    const how = on.length ? ` há ${span(Date.now() / 1000 - since)}` : '';
    const what = seen ? `: ${plural(src.devices.length, 'dispositivo', 'dispositivos')} na rede, ${plural(src.remotes.length, 'anfitrião', 'anfitriões')} na internet.` : '.';
    return `${where}${names.length ? how : ''}${what}`;
  });

  function list(xs: string[]): string {
    return xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs.at(-1)}`;
  }

  function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  async function save() {
    saving = true;
    try {
      const c = await argus.save();
      saved = c.id;
    } catch (err) {
      saved = '';
      alertText = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  let alertText = $state('');
</script>

<div class="page now">
  <header class="page-head">
    <h1 class="page-title">Agora</h1>
    {#if s}<p class="page-lede">{lede}</p>{:else}<p class="page-lede"><span class="sk w45"></span></p>{/if}
  </header>

  <section class="band listen-band" aria-label="Onde escutar">
    <Listen />
  </section>

  {#if !argus.live.loaded}
    <section class="band" aria-hidden="true">
      <div class="sk tall w30"></div>
      <div class="sk-chart"></div>
    </section>
  {:else if !seen}
    <section class="band first">
      <div class="empty-state">
        <h2>{on.length ? 'À escuta' : 'Ainda não está a escutar'}</h2>
        <p>
          {on.length
            ? 'Os primeiros pacotes aparecem aqui assim que chegam. Numa rede calma podem demorar uns segundos.'
            : 'Escolhe acima onde escutar: o Wi-Fi, o cabo ou a VPN, um ou vários. Fica ligado até o desligares, mesmo que feches esta página.'}
        </p>
      </div>
      <Limits />
    </section>
  {:else}
    <section class="band pulse" aria-label="Débito">
      <div class="figure">
        <p class="big" aria-live="off"><span class="v">{rate(argus.meter)}</span></p>
        <p class="what">
          toda a rede vista daqui, agora; {bytes(s?.bytes ?? 0)} desde o início
        </p>
      </div>
<Seg bind:value={period} label="Período" options={PERIODS} />
      <div class="chart-wrap">
        {#if period === 'minutes'}
          <RateChart series={argus.fine} label="Débito, toda a rede" seconds={600} height={210} since={s?.started} />
        {:else}
          <RateChart series={argus.coarse} label="Débito, toda a rede, hoje" height={210} since={s?.started} />
        {/if}
      </div>
    </section>

    <div class="bands main">
      <section class="band">
        <div class="band-h">
          <h2>Na rede local</h2>
          <a href={link.devices()}>{src.devices.length > 8 ? `Todos os ${src.devices.length}` : 'Dispositivos'}</a>
        </div>
        <DeviceTable devices={src.devices} live limit={8} />
      </section>
      <section class="band side">
        <div class="band-h">
          <h2>Na internet</h2>
          <a href={link.internet()}>{src.remotes.length} anfitriões</a>
        </div>
        <HostList items={src.sites.slice(0, 8)} live label="Empresas e sites" />
        {#if src.remotes.some((r) => !r.names.length)}
          <p class="note">
            {src.remotes.filter((r) => !r.names.length).length} sem nome visto: o nome só se sabe quando o pedido de DNS ou o início da
            ligação cifrada passam por aqui.
          </p>
        {/if}
      </section>
    </div>

    <section class="band foot">
      <div class="keep">
        <button class="ghost small" disabled={saving} onclick={save}>{saving ? 'A guardar…' : 'Guardar os últimos minutos'}</button>
        <span class="muted"
          >O que o ring buffer tem em disco, até {s ? `${s.limits.ringFiles * s.limits.ringFileMB} MB` : ''} por interface, fica guardado
          como uma captura.</span
        >
        {#if saved}<a href={link.capture(saved)}>Abrir a captura guardada</a>{/if}
        {#if alertText}<span class="error" role="alert">{alertText}</span>{/if}
      </div>
      <Limits />
    </section>
  {/if}
</div>

<style>
  .listen-band {
    margin-bottom: 36px;
  }

  .pulse {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: end;
    gap: 4px 24px;
  }

  .figure {
    min-width: 0;
  }

  .big {
    margin: 0;
    font-size: clamp(2.2rem, 1.6rem + 2vw, 3.1rem);
    font-weight: 650;
    line-height: 1.05;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .what {
    margin: 6px 0 0;
    font-size: 0.86rem;
    color: var(--muted);
  }

  .chart-wrap {
    grid-column: 1 / -1;
    margin-top: 14px;
  }


  .main {
    --cols: 1;
    grid-template-columns: minmax(0, 1.9fr) minmax(280px, 1fr);
    gap: 16px 40px;
  }

  .note {
    margin: 12px 0 0;
    font-size: 0.8rem;
    line-height: 1.5;
    color: var(--faint);
  }

  .foot {
    display: grid;
    gap: 22px;
    padding-top: 22px;
    border-top: 1px solid var(--rule);
  }

  .keep {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 14px;
    font-size: 0.84rem;
  }

  .first {
    display: grid;
    gap: 12px;
  }

  .first .empty-state {
    padding: 8px 0 0;
  }

  .sk-chart {
    height: 210px;
    margin-top: 18px;
    border-radius: var(--radius-lg);
    background: var(--b1);
  }

  @media (max-width: 1100px) {
    .main {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
