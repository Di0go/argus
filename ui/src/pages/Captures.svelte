<script lang="ts">
  // The captures saved: each what the ring buffer held when he saved it (or a recording brought in), to look at again
  // as it was. Opening one shows its devices and hosts; its file stays in data/captures, readable by Wireshark.
  import { argus } from '../lib/argus.svelte.ts';
  import { bytes, span, when } from '../lib/format.ts';
  import { link } from '../lib/router.svelte.ts';

  let saving = $state(false);
  let problem = $state('');
  const listening = $derived(argus.session?.listening.some((l) => l.on));

  async function save() {
    saving = true;
    problem = '';
    try {
      const c = await argus.save();
      location.hash = link.capture(c.id);
    } catch (err) {
      problem = (err as Error).message;
    } finally {
      saving = false;
    }
  }
</script>

<div class="page">
  <header class="page-head">
    <h1 class="page-title">Capturas</h1>
    <p class="page-lede">
      O Argus guarda em disco só os últimos minutos de cada interface, e vai apagando os mais antigos. Para guardar um momento, grava-o
      aqui: fica como uma captura, para ver outra vez como estava ou abrir no Wireshark.
    </p>
    <div class="head-actions">
      <button class="primary" disabled={saving || !listening} onclick={save}>{saving ? 'A guardar…' : 'Guardar os últimos minutos'}</button>
      {#if !listening}<span class="muted">Liga uma interface em <a href={link.now()}>Agora</a> primeiro.</span>{/if}
      {#if problem}<span class="error" role="alert">{problem}</span>{/if}
    </div>
  </header>
  {#if argus.captures.length}
    <div class="records-wrap">
      <table class="records" aria-label="Capturas">
        <thead><tr><th>Quando</th><th>Onde</th><th class="num">Duração</th><th class="num">Pacotes</th><th class="num hide-s">Tamanho</th><th></th></tr></thead>
        <tbody>
          {#each argus.captures as c (c.id)}
            <tr>
              <td><a href={link.capture(c.id)}>{when(c.started)}</a>{#if c.source === 'file'}<span class="tag">gravação</span>{/if}</td>
              <td>{c.interfaces.join(', ')}</td>
              <td class="num">{span(c.seconds)}</td>
              <td class="num">{(c.packets ?? 0).toLocaleString('pt-PT')}</td>
              <td class="num hide-s">{bytes(c.bytes ?? 0)}</td>
              <td class="num"><button class="link del" onclick={() => argus.removeCapture(c.id)} aria-label="Apagar a captura de {when(c.started)}">Apagar</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="empty-state">
      <h2>Nenhuma captura guardada</h2>
      <p>Enquanto escuta, o botão acima guarda o que o ring buffer tem nesse momento.</p>
    </div>
  {/if}
</div>

<style>
  .tag {
    margin-left: 8px;
  }

  .del {
    font-size: 0.82rem;
    color: var(--muted);
  }

  .del:hover {
    color: var(--wrong);
  }

  @media (max-width: 640px) {
    .hide-s {
      display: none;
    }
  }
</style>
