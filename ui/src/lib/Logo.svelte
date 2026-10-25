<script module lang="ts">
  // The mark: an eye. Argus Panoptes, the watchman with a hundred eyes, who saw everything and slept with half of them
  // open. The lid is one stroke in the text colour; the pupil is the accent, the one point of colour, as Galen's
  // pulse ends in one.

  /** The lid's path, shared by the inline mark and the favicon. */
  export const LOGO_PATH = 'M6 24 C12 14.5 18 11 24 11 C30 11 36 14.5 42 24 C36 33.5 30 37 24 37 C18 37 12 33.5 6 24 Z';

  /** The mark as a favicon: on a rounded tile in the theme's ground, with the accent pupil. */
  export function faviconHref(dark: boolean, accent: string): string {
    const ground = dark ? '#1e1e1e' : '#ffffff';
    const ink = dark ? '#dcddde' : '#222222';
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'><rect width='48' height='48' rx='11' fill='${ground}'/>` +
      `<path d='${LOGO_PATH}' fill='none' stroke='${ink}' stroke-width='4.4' stroke-linejoin='round'/>` +
      `<circle cx='24' cy='24' r='6.5' fill='${accent}'/></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
  }
</script>

<script lang="ts">
  let { size = 20, class: cls = '' }: { size?: number; class?: string } = $props();

  // Drawn heavier when small, so it holds up at ribbon and favicon sizes.
  const small = $derived(size <= 28);
</script>

<svg class="logo {cls}" width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
  <path d={LOGO_PATH} fill="none" stroke="currentColor" stroke-width={small ? 4.4 : 3.2} stroke-linejoin="round" />
  <circle cx="24" cy="24" r={small ? 6.5 : 5.5} fill="var(--acc)" />
</svg>
