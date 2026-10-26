// Which network the pages show: the one Argus is on now (by default; two, when it listens on two networks at once), one
// he chose (from this session or an earlier one), or all of them together. The same on every page, kept in this browser.

import { nowOf } from '../../../shared/networks.ts';
import type { Network } from '../../../shared/types.ts';

const KEY = 'argus.network';

/** 'now', 'all', or a network's id. */
export type Choice = string;

class Networks {
  choice = $state<Choice>('now');

  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '"now"') as unknown;
      if (typeof v === 'string' && v) this.choice = v;
    } catch {
      // No storage: the network of now.
    }
  }

  choose(c: Choice) {
    this.choice = c;
    try {
      localStorage.setItem(KEY, JSON.stringify(c));
    } catch {
      // Not essential.
    }
  }

  /** The networks shown, of the session's `list`; null for every one (or before there is any). */
  ids(list: Network[]): Set<string> | null {
    if (this.choice === 'all') return null;
    if (this.choice === 'now') return list.length ? nowOf(list) : null;
    return new Set([this.choice]);
  }
}

export const networks = new Networks();
