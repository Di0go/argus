// The day's traffic by what it was for, in five groups, each with its colour (app.css: four hues checked for colour
// blindness, and grey). The dictionary has two dozen categories; a chart that reads at a glance has five. The colour
// follows the group, never its rank.

export interface Group {
  key: string;
  label: string;
  color: string;
  categories: string[];
}

export const GROUPS: Group[] = [
  { key: 'watch', label: 'Video and music', color: 'var(--cat-1)', categories: ['video', 'music'] },
  { key: 'work', label: 'Work and AI', color: 'var(--cat-2)', categories: ['work', 'ai', 'email', 'cloud'] },
  { key: 'talk', label: 'Calls and messages', color: 'var(--cat-3)', categories: ['calls', 'messaging'] },
  { key: 'social', label: 'Social, web and games', color: 'var(--cat-4)', categories: ['social', 'web', 'search', 'news', 'shopping', 'finance', 'games', 'adult'] },
  { key: 'other', label: 'Updates and the rest', color: 'var(--cat-other)', categories: [] },
];

/** The group a category belongs to ("" is traffic nobody named: the rest). */
export function groupOfCategory(category: string): Group {
  return GROUPS.find((g) => g.categories.includes(category)) ?? GROUPS[GROUPS.length - 1]!;
}
