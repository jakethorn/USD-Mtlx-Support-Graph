<script lang="ts">
  /**
   * Side-by-side comparison of 2–4 products: a per-technology summary bar (records by level), the newest
   * bundled OpenUSD / MaterialX versions, and every capability as a row. Data: /data/support.json.
   * URL state: ?p=houdini,maya,blender&tech=usd&diff=1
   */
  import { onMount } from 'svelte';
  import type { SupportRow } from '../lib/matrix';
  import { CATEGORY_LABEL, LEVEL_LABEL, LEVEL_ORDER, TECH_LABEL, type MatrixCap, type Tech } from '../lib/view';
  import { pick, readParams, writeParams } from '../lib/url-state';

  let { dataUrl }: { dataUrl: string } = $props();

  const MAX = 4;
  const DEFAULT_PICK = ['houdini', 'maya', 'blender'];

  let rows = $state<SupportRow[]>([]);
  let caps = $state<MatrixCap[]>([]);
  let failed = $state(false);
  let picked = $state<string[]>([]);
  let tech = $state<'all' | Tech>('all');
  let diffOnly = $state(false);
  let urlReady = false;

  onMount(async () => {
    try {
      const res = await fetch(dataUrl);
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { rows: SupportRow[]; caps: MatrixCap[] };
      rows = data.rows;
      caps = data.caps;
    } catch {
      failed = true;
      return;
    }
    const p = readParams();
    const ids = new Set(rows.map((r) => r.id));
    const fromUrl = (p.get('p') ?? '').split(',').filter((id) => ids.has(id));
    picked = [...new Set(fromUrl.length ? fromUrl : DEFAULT_PICK.filter((id) => ids.has(id)))].slice(0, MAX);
    tech = pick(p.get('tech'), ['all', 'usd', 'materialx'] as const) ?? tech;
    diffOnly = p.get('diff') === '1';
    urlReady = true;
  });
  $effect(() => {
    const values = { p: picked, tech, diff: diffOnly ? '1' : '' };
    if (urlReady) writeParams(values, { tech: 'all' });
  });

  const selected = $derived(picked.map((id) => rows.find((r) => r.id === id)!).filter(Boolean));
  const available = $derived.by(() => {
    const groups = new Map<string, SupportRow[]>();
    for (const r of [...rows].sort((a, b) => a.name.localeCompare(b.name))) {
      if (picked.includes(r.id)) continue;
      const cat = r.categories[0];
      groups.set(cat, [...(groups.get(cat) ?? []), r]);
    }
    return [...groups.entries()].sort((a, b) => (CATEGORY_LABEL[a[0]] ?? a[0]).localeCompare(CATEGORY_LABEL[b[0]] ?? b[0]));
  });

  function add(e: Event) {
    const sel = e.currentTarget as HTMLSelectElement;
    if (sel.value && picked.length < MAX) picked = [...picked, sel.value];
    sel.value = '';
  }
  const remove = (id: string) => (picked = picked.filter((x) => x !== id));

  const techs = $derived<Tech[]>(tech === 'all' ? ['usd', 'materialx'] : [tech]);
  const levelKey = (r: SupportRow, capId: string) => r.cells[capId]?.level ?? 'unknown';
  const differs = (capId: string) => new Set(selected.map((r) => levelKey(r, capId))).size > 1;

  const sections = $derived(
    techs.map((t) => {
      const techCaps = caps.filter((c) => c.tech === t && (!diffOnly || differs(c.id)));
      const groups = [...new Set(techCaps.map((c) => c.group))].map((g) => ({ g, caps: techCaps.filter((c) => c.group === g) }));
      return { tech: t, groups, count: techCaps.length };
    }),
  );

  /** Records per level for one product and technology, strongest first; the rest is unknown. */
  function summary(r: SupportRow, t: Tech) {
    const techCaps = caps.filter((c) => c.tech === t);
    const levels = LEVEL_ORDER.map((level) => ({ level, n: techCaps.filter((c) => r.cells[c.id]?.level === level).length })).filter(
      (x) => x.n > 0,
    );
    const known = levels.reduce((s, x) => s + x.n, 0);
    return { levels, known, total: techCaps.length, unknown: techCaps.length - known };
  }
  const describe = (r: SupportRow, t: Tech) => {
    const s = summary(r, t);
    return `${r.name}, ${TECH_LABEL[t]}: ${s.levels.map((x) => `${x.n} ${LEVEL_LABEL[x.level].toLowerCase()}`).join(', ')}${s.unknown ? `, ${s.unknown} unknown` : ''} of ${s.total} capabilities`;
  };
  const shareUrl = $derived(typeof window === 'undefined' ? '' : window.location.href);
  let copied = $state(false);
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      copied = false;
    }
  }
</script>

{#if failed}
  <p class="muted">Couldn't load the comparison data.</p>
{:else if !rows.length}
  <p class="muted">Loading…</p>
{:else}
  <div class="picker">
    <ul class="picked" role="list" aria-label="Products being compared">
      {#each selected as r (r.id)}
        <li>
          <a href={r.href}>{r.name}</a>
          <button type="button" onclick={() => remove(r.id)} aria-label={`Remove ${r.name}`} disabled={picked.length <= 1}>×</button>
        </li>
      {/each}
    </ul>
    <label class="add">
      <span class="visually-hidden">Add a product</span>
      <select onchange={add} disabled={picked.length >= MAX}>
        <option value="">{picked.length >= MAX ? `Up to ${MAX} products` : '+ Add a product…'}</option>
        {#each available as [cat, list] (cat)}
          <optgroup label={CATEGORY_LABEL[cat] ?? cat}>
            {#each list as r (r.id)}<option value={r.id}>{r.name} ({r.vendor})</option>{/each}
          </optgroup>
        {/each}
      </select>
    </label>
  </div>

  <div class="controls">
    <div class="chip-row" role="group" aria-label="Technology">
      <button class="chip" aria-pressed={tech === 'all'} onclick={() => (tech = 'all')}>Both</button>
      <button class="chip" aria-pressed={tech === 'usd'} onclick={() => (tech = 'usd')}>OpenUSD</button>
      <button class="chip" aria-pressed={tech === 'materialx'} onclick={() => (tech = 'materialx')}>MaterialX</button>
    </div>
    <label class="toggle"><input type="checkbox" bind:checked={diffOnly} /> Differences only</label>
    <button class="chip share" type="button" onclick={copyLink} title={shareUrl}>{copied ? 'Link copied' : 'Copy link'}</button>
  </div>

  <!-- Summary: records per level, as one stacked bar per product and technology -->
  <section class="summary" aria-label="Summary">
    {#each techs as t (t)}
      <div class="sum-block">
        <h2>{TECH_LABEL[t]}</h2>
        {#each selected as r (r.id)}
          {@const s = summary(r, t)}
          <div class="sum-row">
            <span class="sum-name">{r.name}</span>
            <div class="bar" role="img" aria-label={describe(r, t)}>
              {#each s.levels as x (x.level)}
                <span class={`seg lv-${x.level}`} style:flex-grow={x.n} title={`${LEVEL_LABEL[x.level]}: ${x.n}`}></span>
              {/each}
              {#if s.unknown}<span class="seg unknown" style:flex-grow={s.unknown} title={`Unknown: ${s.unknown}`}></span>{/if}
            </div>
            <span class="sum-count">{s.known}<span class="muted">/{s.total} known</span></span>
          </div>
        {/each}
      </div>
    {/each}
    <ul class="legend" role="list" aria-label="Legend">
      {#each LEVEL_ORDER as l (l)}<li><span class={`swatch lv-${l}`}></span>{LEVEL_LABEL[l]}</li>{/each}
      <li><span class="swatch unknown"></span>Unknown (no record)</li>
    </ul>
  </section>

  <div class="scroll" role="region" aria-label="Comparison table" tabindex="0">
    <table>
      <thead>
        <tr>
          <th scope="col" class="cap">Capability</th>
          {#each selected as r (r.id)}<th scope="col"><a href={r.href}>{r.name}</a><span class="vendor">{r.vendor}</span></th>{/each}
        </tr>
      </thead>
      <tbody>
        <tr class="versions">
          <th scope="row" class="cap">Newest bundled versions</th>
          {#each selected as r (r.id)}
            <td>
              {#each techs as t (t)}
                {@const v = r.latest[t]}
                <div class="ver">
                  <span class="muted">{t === 'usd' ? 'USD' : 'MtlX'}</span>
                  {#if v}<strong>{v.version}</strong> <span class="muted">in {v.release}</span>{:else}<span class="muted">not published</span>{/if}
                </div>
              {/each}
            </td>
          {/each}
        </tr>
        {#each sections as sec (sec.tech)}
          <tr class="tech-row"><th colspan={selected.length + 1} scope="colgroup">{TECH_LABEL[sec.tech]}{diffOnly ? ` · ${sec.count} differ` : ''}</th></tr>
          {#each sec.groups as { g, caps: groupCaps } (g)}
            <tr class="group-row"><th colspan={selected.length + 1} scope="colgroup">{g}</th></tr>
            {#each groupCaps as c (c.id)}
              <tr class:differs={differs(c.id)}>
                <th scope="row" class="cap" title={c.description}>{c.label}</th>
                {#each selected as r (r.id)}
                  {@const cell = r.cells[c.id]}
                  <td>
                    {#if cell}
                      <a class={`pill lv-${cell.level}`} href={`${r.href}#${c.anchor}`}>{LEVEL_LABEL[cell.level]}</a>
                      {#if cell.since}<span class="since">since {cell.since}</span>{/if}
                      {#if cell.flagged}<span class="flag" title="Flagged for review">?</span>{/if}
                    {:else}
                      <span class="muted unknown-text">Unknown</span>
                    {/if}
                  </td>
                {/each}
              </tr>
            {/each}
          {/each}
          {#if diffOnly && sec.count === 0}
            <tr><td colspan={selected.length + 1} class="muted">No differences in {TECH_LABEL[sec.tech]}.</td></tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .picker {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 20px 0 12px;
  }
  .picked {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .picked li {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px 4px 4px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface);
    font-weight: 600;
  }
  .picked a {
    color: var(--text);
    text-decoration: none;
  }
  .picked button {
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    font-size: 1rem;
    cursor: pointer;
  }
  .picked button:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .picked button:disabled {
    opacity: 0.3;
    cursor: default;
  }
  /* Native selects size to their longest option; keep this one inside the viewport on phones. */
  .add {
    flex: 0 1 260px;
    min-width: 0;
  }
  select {
    font: inherit;
    font-size: 0.88rem;
    padding: 6px 10px;
    border-radius: 999px;
    border: 1px dashed var(--border);
    background: var(--surface);
    color: var(--text);
    width: 100%;
  }
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 18px;
    margin-bottom: 18px;
    font-size: 0.88rem;
  }
  .toggle {
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .share {
    margin-left: auto;
  }

  .summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
    gap: 8px 32px;
    margin-bottom: 24px;
  }
  .sum-block h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 0 0 8px;
  }
  .sum-row {
    display: grid;
    /* Fixed outer columns, so every product's bar has the same length and stays comparable. */
    grid-template-columns: minmax(80px, 140px) 1fr 7.5em;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    font-size: 0.88rem;
  }
  .sum-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Stacked bar: 2px surface gaps between segments, 4px rounded ends. */
  .bar {
    display: flex;
    gap: 2px;
    height: 14px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--surface);
  }
  .seg {
    flex-basis: 0;
    background: var(--lv-pattern, none), var(--lv);
    min-width: 3px;
  }
  .seg.unknown,
  .swatch.unknown {
    background: var(--surface-2);
    box-shadow: inset 0 0 0 1px var(--border);
  }
  .sum-count {
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }
  .legend {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    list-style: none;
    padding: 0;
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--lv-pattern, none), var(--lv);
    display: inline-block;
  }

  .scroll {
    overflow: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.86rem;
  }
  th,
  td {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: middle;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--surface);
    min-width: 140px;
  }
  thead a {
    color: var(--text);
    font-weight: 700;
    text-decoration: none;
  }
  .vendor {
    display: block;
    font-size: 0.75rem;
    font-weight: 400;
    color: var(--text-muted);
  }
  th.cap {
    position: sticky;
    left: 0;
    background: var(--surface);
    font-weight: 500;
    min-width: 170px;
  }
  thead th.cap {
    z-index: 2;
    color: var(--text-muted);
  }
  .tech-row th {
    background: var(--surface-2);
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .group-row th {
    font-size: 0.75rem;
    color: var(--text-muted);
    font-weight: 600;
    padding-top: 14px;
  }
  tr.differs th.cap {
    box-shadow: inset 3px 0 0 var(--accent);
  }
  .pill {
    display: inline-block;
    font-size: 0.72rem;
    font-weight: 650;
    padding: 2px 8px;
    border-radius: 4px;
    color: #fff;
    background: var(--lv);
    text-decoration: none;
    white-space: nowrap;
  }
  .since {
    margin-left: 6px;
    font-size: 0.78rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
  .flag {
    margin-left: 4px;
    font-weight: 700;
    color: var(--level-partial);
    cursor: help;
  }
  .unknown-text {
    font-size: 0.8rem;
  }
  .versions td {
    font-size: 0.82rem;
  }
  .ver {
    display: flex;
    gap: 6px;
    align-items: baseline;
    white-space: nowrap;
  }
</style>
