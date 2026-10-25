// The interface's entry point: the core's fonts and styles, Argus's own after them, the frame's words in Portuguese,
// then the app.
import '@organon/core/ui/fonts.css';
import '@organon/core/ui/tokens.css';
import '@organon/core/ui/base.css';
import '@organon/core/ui/shell.css';
import '@organon/core/ui/dash.css';
import '@organon/core/ui/charts.css';
import './app.css';
import { setWords } from '@organon/core/ui/words';
import { mount } from 'svelte';
import App from './App.svelte';

setWords('pt');

// After a release, an open tab may ask for page code that is no longer there: reload once to get the new build.
addEventListener('vite:preloadError', (e) => {
  e.preventDefault();
  try {
    if (sessionStorage.getItem('argus.reloaded') === '1') return;
    sessionStorage.setItem('argus.reloaded', '1');
  } catch {
    // Reload anyway.
  }
  location.reload();
});
setTimeout(() => {
  try {
    sessionStorage.removeItem('argus.reloaded');
  } catch {
    // Not essential.
  }
}, 10_000);

mount(App, { target: document.getElementById('app') as HTMLElement });
