// Which network the device lists show: all of them, or one (an interface), and whether the devices of the other
// networks are then left out altogether or only put after, faded. Remembered in this browser, as the look is.

import type { Device, Interface } from '../../../shared/types.ts';
import { argus } from './argus.svelte.ts';

const KEY = 'argus.networks';

class Networks {
  /** The interface whose devices come first, or null for every network. */
  selected = $state<string | null>(null);
  /** With a network selected, the others' devices are not listed at all. */
  hideOthers = $state(false);

  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { selected?: unknown; hideOthers?: unknown };
      if (typeof v.selected === 'string') this.selected = v.selected;
      this.hideOthers = v.hideOthers === true;
    } catch {
      // No storage: every network, shown.
    }
  }

  select(id: string | null) {
    this.selected = id;
    this.save();
  }

  setHideOthers(on: boolean) {
    this.hideOthers = on;
    this.save();
  }

  /** The selected network, if the devices shown have it (a capture from elsewhere may not). */
  current(devices: Device[]): string | null {
    const s = this.selected;
    return s && devices.some((d) => d.interfaces.includes(s)) ? s : null;
  }

  /** The devices of the selected network, and the others' (none when they are hidden). */
  split(devices: Device[]): { mine: Device[]; others: Device[]; network: string | null } {
    const network = this.current(devices);
    if (!network) return { mine: devices, others: [], network };
    const mine = devices.filter((d) => d.interfaces.includes(network));
    const others = this.hideOthers ? [] : devices.filter((d) => !d.interfaces.includes(network));
    return { mine, others, network };
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ selected: this.selected, hideOthers: this.hideOthers }));
    } catch {
      // Not essential.
    }
  }
}

export const networks = new Networks();

/** The networks the devices were seen on, in the order the interfaces are listed, with how many devices each. */
export function networksOf(devices: Device[]): { id: string; iface?: Interface; name: string; count: number }[] {
  const count = new Map<string, number>();
  for (const d of devices) for (const i of d.interfaces) count.set(i, (count.get(i) ?? 0) + 1);
  const order = (id: string) => {
    const k = argus.interfaces.findIndex((i) => i.id === id);
    return k < 0 ? 999 : k;
  };
  return [...count]
    .sort((a, b) => order(a[0]) - order(b[0]))
    .map(([id, n]) => {
      const iface = argus.interfaces.find((i) => i.id === id);
      return { id, iface, name: iface?.name ?? id, count: n };
    });
}
