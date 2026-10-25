<script lang="ts">
  // What listening here can and cannot see, said once, calmly, where he decides what to listen on.
  let { compact = false }: { compact?: boolean } = $props();
</script>

<aside class="limits" class:compact>
  <p>
    Argus only listens: it sends nothing to the network and touches nobody's traffic. What is encrypted is not read; you see who
    talks to whom, when and how much.
  </p>
  {#if !compact}
    <p>
      On a PC plugged into an ordinary router or switch you see mostly this PC's own traffic, and what the others announce to everyone
      (their names, the services they offer). What the other devices say to each other, or to the internet, does not pass through here.
    </p>
  {/if}
</aside>

<style>
  .limits {
    max-width: 40rem;
    font-size: 0.86rem;
    line-height: 1.6;
    color: var(--muted);
  }

  .limits p {
    margin: 0;
  }

  .limits p + p {
    margin-top: 8px;
  }
</style>
