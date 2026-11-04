// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Deployed as a GitHub Pages project site: https://jakethorn.github.io/USD-Mtlx-Support-Graph/
// Internal links must go through `withBase()` (src/lib/url.ts) so they respect `base`.
export default defineConfig({
  site: 'https://jakethorn.github.io',
  base: '/USD-Mtlx-Support-Graph',
  integrations: [svelte()],
});
