<script lang="ts">
  /**
   * Site-wide search palette. Opens with Ctrl+K / ⌘K, "/" (outside text fields) or the header button.
   * The index (/data/search-index.json) is fetched the first time the palette opens.
   */
  import { onMount, tick } from 'svelte';
  import type { SearchEntry } from '../lib/view';

  let { indexUrl }: { indexUrl: string } = $props();

  const KIND_LABEL: Record<SearchEntry['kind'], string> = {
    page: 'Page',
    product: 'Product',
    capability: 'Capability',
    project: 'Project',
    schema: 'USD schema',
    node: 'MaterialX node',
  };
  const KIND_WEIGHT: Record<SearchEntry['kind'], number> = {
    product: 10,
    page: 8,
    capability: 6,
    project: 4,
    node: 3,
    schema: 3,
  };
  const MAX_RESULTS = 40;

  let dlg: HTMLDialogElement | undefined = $state();
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLUListElement | undefined = $state();
  let isOpen = $state(false);
  let query = $state('');
  let active = $state(0);
  let index = $state<SearchEntry[] | null>(null);
  let failed = $state(false);
  let shortcut = $state('Ctrl K');
  let requested = false;

  function load() {
    if (requested) return;
    requested = true;
    fetch(indexUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: SearchEntry[]) => (index = d))
      .catch(() => (failed = true));
  }

  async function openPalette() {
    load();
    if (!isOpen) {
      isOpen = true;
      dlg?.showModal();
    }
    await tick();
    input?.focus();
    input?.select();
  }
  // Closing is tracked here rather than through the dialog's `close` event, which doesn't fire everywhere.
  function closePalette() {
    dlg?.close();
    isOpen = false;
  }

  const isTyping = (t: EventTarget | null) =>
    t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

  onMount(() => {
    if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) shortcut = '⌘K';
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) closePalette();
        else openPalette();
      } else if (e.key === '/' && !isOpen && !isTyping(e.target)) {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function score(e: SearchEntry, q: string, tokens: string[]): number {
    if (!tokens.every((t) => e.terms.includes(t))) return -1;
    const title = e.title.toLowerCase();
    let s = KIND_WEIGHT[e.kind];
    if (title === q) s += 200;
    else if (title.startsWith(q)) s += 120;
    else if (title.split(/[\s_\-·./]+/).some((w) => w.startsWith(tokens[0]))) s += 70;
    else if (title.includes(q)) s += 40;
    return s - title.length * 0.05;
  }

  const results = $derived.by(() => {
    if (!index) return [];
    const q = query.trim().toLowerCase();
    if (!q) return index.filter((e) => e.kind === 'page');
    const tokens = q.split(/\s+/);
    return index
      .map((e) => ({ e, s: score(e, q, tokens) }))
      .filter((r) => r.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, MAX_RESULTS)
      .map((r) => r.e);
  });

  $effect(() => {
    void query;
    active = 0;
  });

  async function move(delta: number) {
    if (!results.length) return;
    active = (active + delta + results.length) % results.length;
    await tick();
    list?.querySelector(`#search-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }

  function onInputKey(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter' && results[active]) {
      e.preventDefault();
      list?.querySelector<HTMLAnchorElement>(`#search-opt-${active} a`)?.click();
    }
  }
</script>

<button class="trigger" type="button" aria-haspopup="dialog" onclick={openPalette} title={`Search (${shortcut})`}>
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
  <span class="label">Search</span>
  <kbd>{shortcut}</kbd>
</button>

<dialog
  bind:this={dlg}
  aria-label="Search the site"
  oncancel={(e) => {
    e.preventDefault();
    closePalette();
  }}
  onclick={(e) => {
    if (e.target === dlg) closePalette();
  }}
>
  <div class="panel">
    <div class="field">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
      <input
        bind:this={input}
        bind:value={query}
        onkeydown={onInputKey}
        type="search"
        placeholder="Products, capabilities, schemas, nodes, projects…"
        role="combobox"
        aria-expanded="true"
        aria-controls="search-results"
        aria-activedescendant={results.length ? `search-opt-${active}` : undefined}
        aria-autocomplete="list"
        autocomplete="off"
        spellcheck="false"
      />
      <button class="esc" type="button" onclick={closePalette} aria-label="Close search">Esc</button>
    </div>

    {#if failed}
      <p class="state">Couldn't load the search index.</p>
    {:else if !index}
      <p class="state">Loading…</p>
    {:else if results.length === 0}
      <p class="state">No matches for “{query.trim()}”.</p>
    {:else}
      {#if !query.trim()}<p class="hint">Jump to a page, or start typing to search everything.</p>{/if}
      <ul bind:this={list} id="search-results" role="listbox" aria-label="Results">
        {#each results as r, i (r.kind + r.href + r.title)}
          <li id={`search-opt-${i}`} role="option" aria-selected={i === active} class:active={i === active}>
            <a
              href={r.href}
              tabindex="-1"
              target={r.external ? '_blank' : undefined}
              rel={r.external ? 'noopener' : undefined}
              onmousemove={() => (active = i)}
              onclick={() => closePalette()}
            >
              <span class={`kind kind-${r.kind}`}>{KIND_LABEL[r.kind]}</span>
              <span class="text">
                <span class="title">{r.title}{r.external ? ' ↗' : ''}</span>
                {#if r.sub}<span class="sub">{r.sub}</span>{/if}
              </span>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
    <p class="foot">
      <span><kbd>↑</kbd> <kbd>↓</kbd> move</span>
      <span><kbd>Enter</kbd> open</span>
      <span><kbd>Esc</kbd> close</span>
    </p>
  </div>
</dialog>

<style>
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-muted);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
  }
  .trigger:hover {
    border-color: var(--text-muted);
    color: var(--text);
  }
  svg {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    flex: none;
  }
  kbd {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 1px 5px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--text-muted);
  }
  @media (max-width: 720px) {
    .trigger .label,
    .trigger kbd {
      display: none;
    }
    .trigger {
      width: 36px;
      justify-content: center;
      padding: 0;
    }
  }

  dialog {
    width: min(640px, calc(100vw - 24px));
    max-height: min(560px, calc(100vh - 80px));
    margin: 10vh auto auto;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: var(--surface);
    color: var(--text);
    box-shadow: 0 20px 60px rgb(0 0 0 / 0.35);
    overflow: hidden;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.45);
  }
  .panel {
    display: flex;
    flex-direction: column;
    max-height: inherit;
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--text-muted);
  }
  .field input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-size: 1rem;
  }
  .esc {
    font-family: var(--font-mono);
    font-size: 0.72rem;
    padding: 2px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--text-muted);
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 6px;
    overflow-y: auto;
  }
  li a {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 8px;
    color: var(--text);
    text-decoration: none;
  }
  li.active a {
    background: var(--surface-2);
    outline: 2px solid var(--accent);
    outline-offset: -2px;
  }
  .kind {
    flex: none;
    width: 92px;
    font-size: 0.7rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
  }
  .kind-product {
    color: var(--accent);
  }
  .kind-schema {
    color: var(--usd);
  }
  .kind-node {
    color: var(--mtlx);
  }
  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .sub {
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .state,
  .hint {
    margin: 0;
    padding: 14px 16px 4px;
    font-size: 0.88rem;
    color: var(--text-muted);
  }
  .foot {
    display: flex;
    gap: 16px;
    margin: 0;
    padding: 8px 14px;
    border-top: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--text-muted);
  }
  @media (max-width: 720px) {
    dialog {
      margin-top: 8px;
    }
    .kind {
      width: 70px;
    }
    .foot {
      display: none;
    }
  }
</style>
