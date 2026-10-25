<script lang="ts">
  // An entity's mark, in a small rounded tile: a device by what it probably is (kinds.ts), a host out on the internet
  // as a globe, a company as a building, an interface by its kind.
  import Building from '@lucide/svelte/icons/building';
  import Cable from '@lucide/svelte/icons/cable';
  import Camera from '@lucide/svelte/icons/camera';
  import Container from '@lucide/svelte/icons/container';
  import Cpu from '@lucide/svelte/icons/cpu';
  import Gamepad from '@lucide/svelte/icons/gamepad-2';
  import Globe from '@lucide/svelte/icons/globe';
  import Laptop from '@lucide/svelte/icons/laptop';
  import Monitor from '@lucide/svelte/icons/monitor';
  import Network from '@lucide/svelte/icons/network';
  import Printer from '@lucide/svelte/icons/printer';
  import Router from '@lucide/svelte/icons/router';
  import Shield from '@lucide/svelte/icons/shield';
  import Smartphone from '@lucide/svelte/icons/smartphone';
  import Speaker from '@lucide/svelte/icons/speaker';
  import Tablet from '@lucide/svelte/icons/tablet';
  import Tv from '@lucide/svelte/icons/tv';
  import Watch from '@lucide/svelte/icons/watch';
  import Wifi from '@lucide/svelte/icons/wifi';
  import type { Component } from 'svelte';
  import type { ArgusEntity } from '../../../shared/types.ts';
  import { type DeviceKind, deviceKind } from './kinds.ts';

  let { entity, size = 28 }: { entity: ArgusEntity; size?: number } = $props();

  const DEVICE: Record<DeviceKind, Component> = {
    router: Router,
    this: Laptop,
    phone: Smartphone,
    computer: Monitor,
    tv: Tv,
    speaker: Speaker,
    board: Cpu,
    printer: Printer,
    console: Gamepad,
    camera: Camera,
    watch: Watch,
    tablet: Tablet,
    other: Network,
  };
  const IFACE: Record<string, Component> = { wifi: Wifi, cable: Cable, vpn: Shield, docker: Container, loopback: Laptop };

  const Icon = $derived(
    entity.kind === 'device'
      ? DEVICE[deviceKind(entity)]
      : entity.kind === 'remote'
        ? Globe
        : entity.kind === 'site'
          ? Building
          : (IFACE[entity.type] ?? Network),
  );
  const tone = $derived(entity.kind === 'device' && (entity.role === 'gateway' || entity.role === 'self') ? 'acc' : '');
</script>

<span class="ei {tone}" style:width="{size}px" style:height="{size}px" aria-hidden="true">
  <Icon size={Math.round(size * 0.56)} strokeWidth={1.7} />
</span>

<style>
  .ei {
    flex: none;
    display: inline-grid;
    place-items: center;
    border-radius: 8px;
    background: var(--b2);
    color: var(--muted);
  }

  .ei.acc {
    background: var(--acc-soft);
    color: var(--acc);
  }
</style>
