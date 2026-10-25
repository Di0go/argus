<script lang="ts" generics="T extends string">
  // A choice of two or three, as the look's Light / Dark: the period of a chart, a view.
  let { value = $bindable(), options, label }: { value: T; options: { id: T; label: string }[]; label: string } = $props();
</script>

<div class="seg" role="group" aria-label={label}>
  {#each options as o (o.id)}
    <button class:on={value === o.id} aria-pressed={value === o.id} onclick={() => (value = o.id)}>{o.label}</button>
  {/each}
</div>

<style>
  .seg {
    display: inline-grid;
    grid-auto-flow: column;
    grid-auto-columns: 1fr;
    gap: 2px;
    padding: 2px;
    background: var(--b2);
    border-radius: var(--radius);
  }

  button {
    padding: 3px 11px;
    border: 0;
    border-radius: 5px;
    background: none;
    font-size: 0.8rem;
    color: var(--muted);
    cursor: pointer;
  }

  button.on {
    background: var(--b0);
    color: var(--fg);
    box-shadow: 0 1px 2px rgb(0 0 0 / 0.12);
  }
</style>
