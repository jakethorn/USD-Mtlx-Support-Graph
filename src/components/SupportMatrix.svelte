<script lang="ts">
  /**
   * The support matrix: products × capabilities, one coloured cell per sourced record.
   * An empty cell means unknown (no record), never "not supported".
   */
  import { onMount, tick } from 'svelte';
  import { pick, pickList, readParams, writeParams } from '../lib/url-state';
  import { correctionUrl } from '../lib/feedback';
  import {
    CATEGORY_LABEL,
    INDUSTRY_LABEL,
    LEVEL_LABEL,
    LEVEL_ORDER,
    LEVEL_SCORE,
    TECH_LABEL,
    matrixDetailKey,
    type Level,
    type MatrixCap,
    type MatrixDetail,
    type MatrixRow,
    type Tech,
  } from '../lib/view';

  let {
    rows,
    capabilities,
    detailsUrl,
  }: { rows: MatrixRow[]; capabilities: MatrixCap[]; detailsUrl: string } = $props();

  // Notes and gaps live in a separate file (keeps the page light); fetched once, on first open.
  let details = $state<Record<string, MatrixDetail> | null>(null);
  let detailsError = $state(false);
  let detailsRequested = false;
  function loadDetails() {
    if (detailsRequested) return;
    detailsRequested = true;
    fetch(detailsUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => (details = d))
      .catch(() => (detailsError = true));
  }

  // ── filters ──
  let tech = $state<'all' | Tech>('all');
  let categories = $state<string[]>([]);
  let industry = $state('');
  let tier = $state<0 | 1 | 2>(0);
  let query = $state('');
  let sort = $state<'tier' | 'name' | 'coverage'>('tier');
  let selected = $state<{ row: string; cap: string } | null>(null);

  const allCategories = [...new Set(rows.flatMap((r) => r.categories))];
  const allIndustries = [...new Set(rows.flatMap((r) => r.industries))];

  // ── shareable URL state (?tech=usd&cat=renderer&p=houdini&c=usd.import …) ──
  let urlReady = false;
  onMount(() => {
    const p = readParams();
    tech = pick(p.get('tech'), ['all', 'usd', 'materialx'] as const) ?? tech;
    const t = pick(p.get('tier'), ['1', '2'] as const);
    if (t) tier = Number(t) as 1 | 2;
    categories = pickList(p.get('cat'), allCategories);
    industry = pick(p.get('ind'), allIndustries) ?? '';
    query = p.get('q') ?? '';
    sort = pick(p.get('sort'), ['tier', 'name', 'coverage'] as const) ?? sort;
    const row = p.get('p');
    const cap = p.get('c');
    if (row && cap && rows.some((r) => r.id === row) && capabilities.some((c) => c.id === cap)) selected = { row, cap };
    urlReady = true;
  });
  $effect(() => {
    const values = { tech, tier, cat: categories, ind: industry, q: query.trim(), sort, p: selected?.row, c: selected?.cap };
    if (urlReady) writeParams(values, { tech: 'all', tier: 0, sort: 'tier' });
  });

  const caps = $derived(capabilities.filter((c) => tech === 'all' || c.tech === tech));
  const groups = $derived.by(() => {
    const out: { key: string; tech: Tech; group: string; span: number }[] = [];
    for (const c of caps) {
      const key = `${c.tech}:${c.group}`;
      const last = out.at(-1);
      if (last?.key === key) last.span++;
      else out.push({ key, tech: c.tech, group: c.group, span: 1 });
    }
    return out;
  });

  const coverage = (r: MatrixRow) =>
    caps.reduce((n, c) => n + (r.cells[c.id] ? LEVEL_SCORE[r.cells[c.id].level] : 0), 0) / Math.max(caps.length, 1);

  const visible = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = rows.filter(
      (r) =>
        (categories.length === 0 || r.categories.some((c) => categories.includes(c))) &&
        (!industry || r.industries.includes(industry)) &&
        (!tier || r.tier === tier) &&
        (!q || r.name.toLowerCase().includes(q) || r.vendor.toLowerCase().includes(q)),
    );
    if (sort === 'name') return list.toSorted((a, b) => a.name.localeCompare(b.name));
    if (sort === 'coverage') return list.toSorted((a, b) => coverage(b) - coverage(a) || a.name.localeCompare(b.name));
    return list; // server order: tier, then name
  });

  const toggleCategory = (c: string) =>
    (categories = categories.includes(c) ? categories.filter((x) => x !== c) : [...categories, c]);

  const selRow = $derived(selected ? rows.find((r) => r.id === selected!.row) : undefined);
  const selCap = $derived(selected ? capabilities.find((c) => c.id === selected!.cap) : undefined);
  const selCell = $derived(selRow && selCap ? selRow.cells[selCap.id] : undefined);
  const selDetail = $derived(selRow && selCap && details ? details[matrixDetailKey(selRow.id, selCap.id)] : undefined);
  $effect(() => {
    if (selCell) loadDetails();
  });

  // ── keyboard: one tab stop for the whole grid, arrows move between cells (roving tabindex) ──
  let gridEl: HTMLTableElement | undefined = $state();
  let focusRaw = $state({ r: 0, c: 0 });
  const focusR = $derived(Math.min(focusRaw.r, Math.max(visible.length - 1, 0)));
  const focusC = $derived(Math.min(focusRaw.c, Math.max(caps.length - 1, 0)));
  const setFocus = (r: number, c: number) => (focusRaw = { r, c });

  async function onCellKey(e: KeyboardEvent) {
    const lastR = visible.length - 1;
    const lastC = caps.length - 1;
    let r = focusR;
    let c = focusC;
    switch (e.key) {
      case 'ArrowRight': c = Math.min(c + 1, lastC); break;
      case 'ArrowLeft': c = Math.max(c - 1, 0); break;
      case 'ArrowDown': r = Math.min(r + 1, lastR); break;
      case 'ArrowUp': r = Math.max(r - 1, 0); break;
      case 'PageDown': r = Math.min(r + 5, lastR); break;
      case 'PageUp': r = Math.max(r - 5, 0); break;
      case 'Home': c = 0; if (e.ctrlKey) r = 0; break;
      case 'End': c = lastC; if (e.ctrlKey) r = lastR; break;
      case 'Escape': if (selected) { selected = null; e.preventDefault(); } return;
      default: return;
    }
    e.preventDefault();
    setFocus(r, c);
    await tick();
    gridEl?.querySelector<HTMLButtonElement>(`button.cell[data-r="${r}"][data-c="${c}"]`)?.focus();
  }

  const fixUrl = (r: MatrixRow, c: MatrixCap) =>
    correctionUrl({
      product: r.id,
      productName: r.name,
      capability: c.id,
      capabilityLabel: c.label,
      page: `${r.href}#${c.anchor}`,
    });

  function cellTitle(r: MatrixRow, c: MatrixCap) {
    const cell = r.cells[c.id];
    if (!cell) return `${r.name} · ${c.label}: unknown (no sourced record)`;
    return `${r.name} · ${c.label}: ${LEVEL_LABEL[cell.level]}${cell.since ? ` since ${cell.since}` : ''}`;
  }

  /** Per column: how many visible products have a positive record. */
  const columnCounts = $derived(
    Object.fromEntries(
      caps.map((c) => [
        c.id,
        visible.filter((r) => r.cells[c.id] && ['native', 'plugin', 'partial', 'experimental'].includes(r.cells[c.id].level))
          .length,
      ]),
    ),
  );
</script>

<div class="controls">
  <div class="chip-row" role="group" aria-label="Technology">
    <button class="chip" aria-pressed={tech === 'all'} onclick={() => (tech = 'all')}>Both</button>
    <button class="chip tech-usd" aria-pressed={tech === 'usd'} onclick={() => (tech = 'usd')}>OpenUSD</button>
    <button class="chip tech-mtlx" aria-pressed={tech === 'materialx'} onclick={() => (tech = 'materialx')}>MaterialX</button>
    <span class="sep" aria-hidden="true"></span>
    <button class="chip" aria-pressed={tier === 0} onclick={() => (tier = 0)}>All tiers</button>
    <button class="chip" aria-pressed={tier === 1} onclick={() => (tier = 1)}>Tier 1</button>
    <button class="chip" aria-pressed={tier === 2} onclick={() => (tier = 2)}>Tier 2</button>
  </div>
  <div class="chip-row" role="group" aria-label="Category">
    {#each allCategories as c (c)}
      <button class="chip" aria-pressed={categories.includes(c)} onclick={() => toggleCategory(c)}>
        {CATEGORY_LABEL[c] ?? c}
      </button>
    {/each}
  </div>
  <div class="row">
    <label>
      <span class="visually-hidden">Search products</span>
      <input type="search" placeholder="Search product or vendor" bind:value={query} />
    </label>
    <label>
      Industry
      <select bind:value={industry}>
        <option value="">All</option>
        {#each allIndustries as i (i)}<option value={i}>{INDUSTRY_LABEL[i] ?? i}</option>{/each}
      </select>
    </label>
    <label>
      Sort
      <select bind:value={sort}>
        <option value="tier">Tier, then name</option>
        <option value="name">Name</option>
        <option value="coverage">Coverage</option>
      </select>
    </label>
    <span class="muted count">{visible.length} of {rows.length} products</span>
  </div>
</div>

<ul class="legend" role="list" aria-label="Legend">
  {#each LEVEL_ORDER as l (l)}
    <li><span class={`swatch lv-${l}`}></span>{LEVEL_LABEL[l]}</li>
  {/each}
  <li><span class="swatch unknown"></span>Unknown (no record)</li>
  <li><span class="swatch lv-native flagged"></span>Flagged / low confidence</li>
</ul>

<p class="kbd-hint muted" id="matrix-keys">
  Keyboard: Tab into the grid, move with the arrow keys (Home/End, Page Up/Down), Enter opens a cell, Esc closes it.
</p>

<div class="scroll" role="region" aria-label="Support matrix" tabindex="-1">
  <table bind:this={gridEl} aria-describedby="matrix-keys">
    <thead>
      <tr class="groups">
        <th class="corner" rowspan="2" scope="col">Product</th>
        {#each groups as g (g.key)}
          <th colspan={g.span} class={`group tech-${g.tech}`} scope="colgroup">
            <span>{tech === 'all' ? `${g.tech === 'usd' ? 'USD' : 'MtlX'} · ` : ''}{g.group}</span>
          </th>
        {/each}
      </tr>
      <tr class="caps">
        {#each caps as c (c.id)}
          <th scope="col" class={`cap tech-${c.tech}`} title={c.description}><span>{c.label}</span></th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each visible as r, ri (r.id)}
        <tr class:selected-row={selected?.row === r.id}>
          <th scope="row" class="name">
            <a href={r.href}>{r.name}</a>
            <span class="vendor">{r.vendor}{r.discontinued ? ' · discontinued' : ''}</span>
          </th>
          {#each caps as c, ci (c.id)}
            {@const cell = r.cells[c.id]}
            <td>
              <button
                class={`cell ${cell ? `lv-${cell.level}` : 'unknown'}`}
                class:flagged={cell?.flagged}
                class:active={selected?.row === r.id && selected?.cap === c.id}
                title={cellTitle(r, c)}
                data-r={ri}
                data-c={ci}
                tabindex={ri === focusR && ci === focusC ? 0 : -1}
                onfocus={() => setFocus(ri, ci)}
                onkeydown={onCellKey}
                onclick={() => (selected = selected?.row === r.id && selected?.cap === c.id ? null : { row: r.id, cap: c.id })}
              ></button>
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
    <tfoot>
      <tr>
        <th scope="row" class="name muted">Products with support</th>
        {#each caps as c (c.id)}<td class="tally">{columnCounts[c.id]}</td>{/each}
      </tr>
    </tfoot>
  </table>
</div>

{#if selRow && selCap}
  <aside class="detail" aria-live="polite">
    <button class="close" aria-label="Close details" onclick={() => (selected = null)}>×</button>
    <p class="eyebrow">{TECH_LABEL[selCap.tech]} · {selCap.group}</p>
    <h3><a href={selRow.href}>{selRow.name}</a> · {selCap.label}</h3>
    <p class="muted">{selCap.description}</p>
    {#if selCell}
      <p class="status">
        <span class={`badge lv-${selCell.level}`}>{LEVEL_LABEL[selCell.level]}</span>
        {#if selCell.since}<span>since {selCell.since}</span>{/if}
        {#if selCell.via}<span>via {selCell.via}</span>{/if}
        <span class="muted">{selCell.confidence} confidence</span>
        {#if selCell.flagged}<span class="flag">flagged for review</span>{/if}
      </p>
      {#if selDetail}
        {#if selDetail.notes}<p>{selDetail.notes}</p>{/if}
        {#if selDetail.gaps.length}
          <ul class="gaps">{#each selDetail.gaps as g, i (i)}<li>{g}</li>{/each}</ul>
        {/if}
      {:else if detailsError}
        <p class="muted">Couldn't load the notes. The full record is on the product page.</p>
      {:else if !details}
        <p class="muted">Loading notes…</p>
      {/if}
      <p class="links">
        <a href={`${selRow.href}#${selCap.anchor}`}>Sources and full record →</a>
        <a class="fix" href={fixUrl(selRow, selCap)} rel="noopener">Suggest a correction</a>
      </p>
    {:else}
      <p>
        No sourced record yet, so this is <strong>unknown</strong>, not unsupported. Know a source?
        <a href={fixUrl(selRow, selCap)} rel="noopener">Tell us about it</a>.
      </p>
    {/if}
  </aside>
{/if}

<style>
  .controls {
    display: grid;
    gap: 10px;
    margin: 20px 0 12px;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    align-items: center;
    font-size: 0.88rem;
  }
  input,
  select {
    font: inherit;
    font-size: 0.88rem;
    padding: 5px 9px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  input {
    min-width: 230px;
  }
  .count {
    margin-left: auto;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    list-style: none;
    padding: 0;
    margin: 0 0 12px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--lv-pattern, none), var(--lv);
    display: inline-block;
  }
  .kbd-hint {
    margin: -4px 0 10px;
    font-size: 0.78rem;
  }
  .swatch.unknown,
  .cell.unknown {
    background: transparent;
    border: 1px dashed var(--border);
  }
  .flagged {
    background-image: repeating-linear-gradient(
      135deg,
      transparent 0 3px,
      color-mix(in srgb, var(--bg) 70%, transparent) 3px 5px
    );
  }

  .scroll {
    overflow: auto;
    max-height: 78vh;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.82rem;
  }
  thead th {
    position: sticky;
    background: var(--surface);
    z-index: 2;
  }
  .groups th {
    top: 0;
    height: 30px;
  }
  .caps th {
    top: 30px;
  }
  .corner {
    left: 0;
    z-index: 4 !important;
    text-align: left;
    vertical-align: bottom;
    padding: 8px 12px;
    min-width: 210px;
    border-bottom: 1px solid var(--border);
  }
  .group {
    font-size: 0.72rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    border-bottom: 2px solid var(--tech-c);
    border-left: 1px solid var(--border);
    padding: 4px 6px;
    white-space: nowrap;
    overflow: hidden;
    max-width: 0;
    text-align: left;
  }
  .group span {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tech-usd {
    --tech-c: var(--usd);
  }
  .tech-materialx,
  .tech-mtlx {
    --tech-c: var(--mtlx);
  }
  .chip.tech-usd[aria-pressed='true'] {
    background: var(--usd);
    border-color: var(--usd);
    color: #fff;
  }
  .chip.tech-mtlx[aria-pressed='true'] {
    background: var(--mtlx);
    border-color: var(--mtlx);
    color: #fff;
  }
  .cap {
    height: 150px;
    width: 30px;
    min-width: 30px;
    vertical-align: bottom;
    padding: 0 0 8px;
    font-weight: 500;
    border-bottom: 1px solid var(--border);
  }
  .cap span {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    white-space: nowrap;
    display: inline-block;
    cursor: help;
  }
  tbody th,
  tfoot th {
    position: sticky;
    left: 0;
    background: var(--surface);
    z-index: 1;
    text-align: left;
    font-weight: 600;
    padding: 4px 12px;
    border-right: 1px solid var(--border);
    white-space: nowrap;
  }
  .name a {
    color: var(--text);
    text-decoration: none;
  }
  .name a:hover {
    text-decoration: underline;
  }
  .vendor {
    display: block;
    font-weight: 400;
    font-size: 0.72rem;
    color: var(--text-muted);
  }
  td {
    text-align: center;
    padding: 2px;
  }
  tbody tr:hover th,
  tbody tr:hover td,
  .selected-row th,
  .selected-row td {
    background: var(--surface-2);
  }
  .cell {
    width: 24px;
    height: 24px;
    border-radius: 5px;
    border: 0;
    padding: 0;
    background-color: var(--lv);
    background-image: var(--lv-pattern, none);
    cursor: pointer;
    display: block;
    margin: 0 auto;
  }
  .cell:hover,
  .cell.active {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .cell:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  tfoot th,
  tfoot td {
    border-top: 1px solid var(--border);
    position: sticky;
    bottom: 0;
    background: var(--surface);
  }
  tfoot th {
    z-index: 3;
    font-weight: 500;
    font-size: 0.75rem;
  }
  .tally {
    font-variant-numeric: tabular-nums;
    color: var(--text-muted);
    font-size: 0.75rem;
  }

  .detail {
    position: sticky;
    bottom: 12px;
    margin-top: 14px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 4px solid var(--accent);
    border-radius: var(--radius);
    padding: 14px 18px;
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.12);
    max-height: 45vh;
    overflow: auto;
  }
  .detail h3 {
    margin: 2px 0 4px;
  }
  .detail p {
    margin: 6px 0;
    font-size: 0.92rem;
  }
  .detail .links {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }
  .detail .fix {
    color: var(--text-muted);
  }
  .eyebrow {
    font-size: 0.72rem !important;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 0 !important;
  }
  .close {
    float: right;
    font-size: 1.4rem;
    line-height: 1;
    border: 0;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
  }
  .status {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 12px;
    align-items: center;
  }
  .badge {
    background: var(--lv);
    color: #fff;
    font-size: 0.72rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 8px;
    border-radius: 4px;
  }
  .flag {
    color: var(--level-partial);
    font-weight: 600;
  }
  .gaps {
    margin: 4px 0 8px;
    padding-left: 20px;
    font-size: 0.88rem;
    color: var(--text-muted);
  }
</style>
