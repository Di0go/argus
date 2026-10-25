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
    <h1 class="page-title">Captures</h1>
    <p class="page-lede">
      Argus keeps on disk only the last minutes of each interface, deleting the oldest as it goes. To keep a moment, save it here: it
      stays as a capture, to see again as it was or to open in Wireshark.
    </p>
    <div class="head-actions">
      <button class="primary" disabled={saving || !listening} onclick={save}>{saving ? 'Saving…' : 'Save the last minutes'}</button>
      {#if !listening}<span class="muted">Turn an interface on in <a href={link.now()}>Now</a> first.</span>{/if}
      {#if problem}<span class="error" role="alert">{problem}</span>{/if}
    </div>
  </header>
  {#if argus.captures.length}
    <div class="records-wrap">
      <table class="records" aria-label="Captures">
        <thead><tr><th>When</th><th>Where</th><th class="num">Length</th><th class="num">Packets</th><th class="num hide-s">Size</th><th></th></tr></thead>
        <tbody>
          {#each argus.captures as c (c.id)}
            <tr>
              <td><a href={link.capture(c.id)}>{when(c.started)}</a>{#if c.source === 'file'}<span class="tag">recording</span>{/if}</td>
              <td>{c.interfaces.join(', ')}</td>
              <td class="num">{span(c.seconds)}</td>
              <td class="num">{(c.packets ?? 0).toLocaleString('en-GB')}</td>
              <td class="num hide-s">{bytes(c.bytes ?? 0)}</td>
              <td class="num"><button class="link del" onclick={() => argus.removeCapture(c.id)} aria-label="Delete the capture of {when(c.started)}">Delete</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="empty-state">
      <h2>No captures saved</h2>
      <p>While listening, the button above saves what the ring buffer holds at that moment.</p>
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
