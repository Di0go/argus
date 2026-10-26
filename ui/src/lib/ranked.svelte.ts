// An order that a person can read while it moves: busiest first, but re-sorted at most every few seconds, and never
// while the pointer is over the list. In between, the lines keep their places: one that left goes, a newcomer takes its
// place by its score (at the end while the pointer is over the list), and nothing jumps from under the pointer.

import { untrack } from 'svelte';

export class Ranked {
  order = $state<string[]>([]);
  /** The pointer is over the list: hold the order. */
  hold = $state(false);
  private at = 0;
  private every: number;

  constructor(every = 4000) {
    this.every = every;
  }

  update(ids: string[], score: (id: string) => number) {
    const had = untrack(() => this.order);
    const byScore = (a: string, b: string) => score(b) - score(a);
    let next: string[];
    const hold = untrack(() => this.hold);
    if (hold || Date.now() - this.at < this.every) {
      const still = new Set(ids);
      next = had.filter((id) => still.has(id));
      for (const id of ids.filter((x) => !had.includes(x)).sort(byScore)) {
        // Under the pointer a newcomer waits at the end; otherwise it takes its place, and the others keep their order.
        const at = hold ? -1 : next.findIndex((x) => score(x) < score(id));
        next.splice(at < 0 ? next.length : at, 0, id);
      }
    } else {
      this.at = Date.now();
      next = [...ids].sort(byScore);
    }
    if (next.join('\n') !== had.join('\n')) this.order = next;
  }
}
