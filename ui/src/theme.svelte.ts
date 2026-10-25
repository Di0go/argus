// Argus's look: the core's, under its own key and with its own default accent (theme-boot.js is told the same), and
// the tab icon drawn from the mark in the look's colours.
import { createTheme } from '@organon/core/ui/theme';
import { faviconHref } from './lib/Logo.svelte';

export const theme = createTheme({ key: 'argus.look', defaultAccent: 'red', favicon: faviconHref });
