<script lang="ts">
  // What listening here can and cannot see, said once, calmly, where he decides what to listen on.
  let { compact = false }: { compact?: boolean } = $props();
</script>

<aside class="limits" class:compact>
  <p>
    O Argus só escuta: não manda nada para a rede e não mexe no tráfego de ninguém. O que vai cifrado não se lê; vê-se quem fala
    com quem, quando e quanto.
  </p>
  {#if !compact}
    <p>
      Num PC ligado a um router ou a um switch normal vê-se sobretudo o tráfego deste PC, e o que os outros anunciam a todos (os seus
      nomes, os serviços que oferecem). O que os outros dispositivos dizem entre si, ou à internet, não passa por aqui.
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
