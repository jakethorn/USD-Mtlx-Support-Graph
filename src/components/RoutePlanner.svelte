<script lang="ts">
  /**
   * Pipeline route planner: what should survive moving a scene from product A to product B through USD.
   * Each aspect combines A's record and B's record as the weaker of the two. Records rarely say whether a
   * capability works on import, export or both, so the page presents this as an estimate and links every
   * pill to its sourced record. Data: /data/support.json. URL state: ?from=houdini&to=unreal-engine
   */
  import { onMount } from 'svelte';
  import type { SupportRow } from '../lib/matrix';
  import { pick, readParams, writeParams } from '../lib/url-state';
  import { CATEGORY_LABEL, LEVEL_LABEL, LEVEL_SCORE, type Level, type MatrixCap, type MatrixCell } from '../lib/view';

  let { dataUrl }: { dataUrl: string } = $props();

  type Combined = Level | 'unknown';
  interface Aspect {
    label: string;
    /** Capabilities on the sending side; the strongest record counts. */
    out: string[];
    /** Capabilities on the receiving side; the strongest record counts. */
    in: string[];
    hint?: string;
  }
  const SECTIONS: { title: string; aspects: Aspect[] }[] = [
    {
      title: 'Getting USD across',
      aspects: [{ label: 'USD out → USD in', out: ['usd.export', 'usd.stage'], in: ['usd.import', 'usd.stage'], hint: 'Export (or a native stage) on the left, import (or a native stage) on the right.' }],
    },
    {
      title: 'Geometry',
      aspects: [
        { label: 'Meshes & subdivision', out: ['usd.geom.meshes'], in: ['usd.geom.meshes'] },
        { label: 'Curves & hair', out: ['usd.geom.curves'], in: ['usd.geom.curves'] },
        { label: 'Points', out: ['usd.geom.points'], in: ['usd.geom.points'] },
        { label: 'Volumes', out: ['usd.volumes'], in: ['usd.volumes'] },
      ],
    },
    {
      title: 'Animation & scene',
      aspects: [
        { label: 'Time-sampled animation', out: ['usd.animation'], in: ['usd.animation'] },
        { label: 'Skeletal animation', out: ['usd.skel'], in: ['usd.skel'] },
        { label: 'Cameras', out: ['usd.cameras'], in: ['usd.cameras'] },
        { label: 'Lights', out: ['usd.lights'], in: ['usd.lights'] },
        { label: 'Instancing', out: ['usd.instancing'], in: ['usd.instancing'] },
        { label: 'Physics', out: ['usd.physics'], in: ['usd.physics'] },
      ],
    },
    {
      title: 'Scene structure',
      aspects: [
        { label: 'Variant sets', out: ['usd.composition.variants'], in: ['usd.composition.variants'] },
        { label: 'References', out: ['usd.composition.references'], in: ['usd.composition.references'] },
        { label: 'Payloads', out: ['usd.composition.payloads'], in: ['usd.composition.payloads'] },
        { label: 'Sublayers', out: ['usd.composition.sublayers'], in: ['usd.composition.sublayers'] },
      ],
    },
    {
      title: 'Materials',
      aspects: [
        { label: 'MaterialX in USD', out: ['usd.shade.materialx'], in: ['usd.shade.materialx'] },
        { label: 'UsdPreviewSurface', out: ['usd.shade.preview_surface'], in: ['usd.shade.preview_surface'] },
        { label: 'OpenPBR Surface', out: ['mtlx.openpbr'], in: ['mtlx.openpbr'] },
        { label: 'Standard Surface', out: ['mtlx.standard_surface'], in: ['mtlx.standard_surface'] },
        { label: 'glTF PBR', out: ['mtlx.gltf_pbr'], in: ['mtlx.gltf_pbr'] },
        { label: '.mtlx files on the side', out: ['mtlx.export'], in: ['mtlx.import'], hint: 'MaterialX documents exported separately and imported on the other side.' },
      ],
    },
  ];
  const MATERIAL_PATHS = ['MaterialX in USD', 'UsdPreviewSurface'];

  let rows = $state<SupportRow[]>([]);
  let caps = $state<MatrixCap[]>([]);
  let failed = $state(false);
  let from = $state('houdini');
  let to = $state('unreal-engine');
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
    const ids = rows.map((r) => r.id);
    from = pick(p.get('from'), ids) ?? (ids.includes(from) ? from : ids[0]);
    to = pick(p.get('to'), ids) ?? (ids.includes(to) ? to : ids[1]);
    urlReady = true;
  });
  $effect(() => {
    const values = { from, to };
    if (urlReady) writeParams(values);
  });

  const A = $derived(rows.find((r) => r.id === from));
  const B = $derived(rows.find((r) => r.id === to));
  const capById = $derived(new Map(caps.map((c) => [c.id, c])));
  const grouped = $derived.by(() => {
    const g = new Map<string, SupportRow[]>();
    for (const r of [...rows].sort((a, b) => a.name.localeCompare(b.name))) g.set(r.categories[0], [...(g.get(r.categories[0]) ?? []), r]);
    return [...g.entries()].sort((a, b) => (CATEGORY_LABEL[a[0]] ?? a[0]).localeCompare(CATEGORY_LABEL[b[0]] ?? b[0]));
  });

  /** The strongest record among the given capabilities. */
  function best(r: SupportRow | undefined, ids: string[]): { cap: string; cell: MatrixCell } | null {
    if (!r) return null;
    let top: { cap: string; cell: MatrixCell } | null = null;
    for (const id of ids) {
      const cell = r.cells[id];
      if (cell && (!top || LEVEL_SCORE[cell.level] > LEVEL_SCORE[top.cell.level])) top = { cap: id, cell };
    }
    return top;
  }
  function combine(a: MatrixCell | undefined, b: MatrixCell | undefined): Combined {
    if (!a || !b) return 'unknown';
    if (a.level === 'none' || b.level === 'none') return 'none';
    return LEVEL_SCORE[a.level] <= LEVEL_SCORE[b.level] ? a.level : b.level;
  }
  const VERDICT: Record<Combined, string> = {
    native: 'Should work',
    plugin: 'Works with a plugin',
    partial: 'Partly',
    experimental: 'Experimental',
    planned: 'Not yet',
    deprecated: 'Deprecated',
    none: 'Not supported',
    unknown: 'Unknown',
  };

  const results = $derived(
    SECTIONS.map((s) => ({
      title: s.title,
      aspects: s.aspects.map((asp) => {
        const a = best(A, asp.out);
        const b = best(B, asp.in);
        return { ...asp, a, b, combined: combine(a?.cell, b?.cell) };
      }),
    })),
  );
  const gate = $derived(results[0].aspects[0]);
  const materialPath = $derived.by(() => {
    const mats = results.find((s) => s.title === 'Materials')!.aspects.filter((x) => MATERIAL_PATHS.includes(x.label));
    const usable = mats.filter((m) => m.combined !== 'unknown' && m.combined !== 'none' && m.combined !== 'planned');
    return usable.sort((x, y) => LEVEL_SCORE[y.combined as Level] - LEVEL_SCORE[x.combined as Level])[0] ?? null;
  });
  const tally = $derived.by(() => {
    const all = results.slice(1).flatMap((s) => s.aspects);
    const ok = all.filter((x) => x.combined === 'native' || x.combined === 'plugin').length;
    const partial = all.filter((x) => x.combined === 'partial' || x.combined === 'experimental').length;
    const blocked = all.filter((x) => x.combined === 'none' || x.combined === 'planned' || x.combined === 'deprecated').length;
    return { ok, partial, blocked, unknown: all.length - ok - partial - blocked, total: all.length };
  });

  const swap = () => ([from, to] = [to, from]);
  const recordHref = (r: SupportRow, capId: string) => `${r.href}#${capById.get(capId)?.anchor ?? ''}`;
</script>

{#snippet pill(r: SupportRow | undefined, x: { cap: string; cell: MatrixCell } | null)}
  {#if r && x}
    <a class={`pill lv-${x.cell.level}`} href={recordHref(r, x.cap)} title={`${r.name} · ${capById.get(x.cap)?.label}: ${LEVEL_LABEL[x.cell.level]}`}>
      {LEVEL_LABEL[x.cell.level]}{x.cell.flagged ? ' ?' : ''}
    </a>
  {:else}
    <span class="pill unknown">Unknown</span>
  {/if}
{/snippet}

{#if failed}
  <p class="muted">Couldn't load the support data.</p>
{:else if !A || !B}
  <p class="muted">Loading…</p>
{:else}
  <div class="pickers">
    <label>
      <span class="lbl">From</span>
      <select bind:value={from}>
        {#each grouped as [cat, list] (cat)}
          <optgroup label={CATEGORY_LABEL[cat] ?? cat}>{#each list as r (r.id)}<option value={r.id}>{r.name}</option>{/each}</optgroup>
        {/each}
      </select>
    </label>
    <button class="swap" type="button" onclick={swap} aria-label="Swap source and target" title="Swap">⇄</button>
    <label>
      <span class="lbl">To</span>
      <select bind:value={to}>
        {#each grouped as [cat, list] (cat)}
          <optgroup label={CATEGORY_LABEL[cat] ?? cat}>{#each list as r (r.id)}<option value={r.id}>{r.name}</option>{/each}</optgroup>
        {/each}
      </select>
    </label>
  </div>

  <section class="verdict" aria-live="polite">
    <div class={`gate lv-${gate.combined === 'unknown' ? 'unknown' : gate.combined}`}>
      <span class="gate-label">{A.name} → {B.name}</span>
      <strong>{gate.combined === 'unknown' ? 'No sourced USD path yet' : `USD hand-off: ${VERDICT[gate.combined].toLowerCase()}`}</strong>
    </div>
    <ul class="tally" role="list">
      <li><strong>{tally.ok}</strong> of {tally.total} aspects should carry over</li>
      <li><strong>{tally.partial}</strong> partly or experimentally</li>
      <li><strong>{tally.blocked}</strong> blocked</li>
      <li><strong>{tally.unknown}</strong> unknown</li>
    </ul>
    <p class="muted mat">
      {#if materialPath}
        Best material path: <strong>{materialPath.label}</strong> ({VERDICT[materialPath.combined].toLowerCase()}).
      {:else}
        No material path is confirmed on both sides yet.
      {/if}
    </p>
  </section>

  {#each results as sec (sec.title)}
    <section class="sec">
      <h2>{sec.title}</h2>
      <ul class="aspects" role="list">
        {#each sec.aspects as asp (asp.label)}
          <li class={`aspect c-${asp.combined}`}>
            <span class="name" title={asp.hint}>{asp.label}</span>
            <span class="chain">
              <span class="side" aria-label={`${A.name}`}>{@render pill(A, asp.a)}</span>
              <span class={`link lv-${asp.combined === 'unknown' ? 'unknown' : asp.combined}`} aria-hidden="true"></span>
              <span class="side" aria-label={`${B.name}`}>{@render pill(B, asp.b)}</span>
            </span>
            <span class="result">{VERDICT[asp.combined]}</span>
          </li>
        {/each}
      </ul>
    </section>
  {/each}

  <p class="caveat muted">
    How to read this: each row puts {A.name}'s record next to {B.name}'s and takes the weaker of the two. Most records
    don't say whether a capability works on import, export or both, so treat this as a starting point and check the
    linked records. "?" marks a record flagged for review; "Unknown" means no sourced record yet, not "unsupported".
  </p>
{/if}

<style>
  .pickers {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    gap: 10px;
    margin: 20px 0 18px;
  }
  .pickers label {
    display: grid;
    gap: 4px;
    flex: 1 1 200px;
    max-width: 320px;
    min-width: 0;
  }
  .lbl {
    font-size: 0.75rem;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  select {
    font: inherit;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    width: 100%;
  }
  .swap {
    height: 38px;
    width: 38px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    font-size: 1.1rem;
    cursor: pointer;
  }
  .swap:hover {
    border-color: var(--text-muted);
  }

  .verdict {
    display: grid;
    gap: 10px;
    padding: 16px 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
    margin-bottom: 24px;
  }
  .gate {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 6px 14px;
    padding-left: 12px;
    border-left: 5px solid var(--lv, var(--border));
  }
  .gate-label {
    color: var(--text-muted);
    font-size: 0.9rem;
  }
  .gate strong {
    font-size: 1.15rem;
  }
  .tally {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 22px;
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.9rem;
  }
  .tally strong {
    font-variant-numeric: tabular-nums;
    font-size: 1.05rem;
  }
  .mat {
    margin: 0;
    font-size: 0.9rem;
  }

  .sec h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 22px 0 8px;
  }
  .aspects {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--surface);
  }
  /* name | A | link | B | result */
  .aspect {
    display: grid;
    grid-template-columns: minmax(130px, 1.3fr) auto minmax(24px, 1fr) auto minmax(90px, 0.9fr);
    align-items: center;
    gap: 10px;
    padding: 9px 14px;
    border-top: 1px solid var(--border);
    font-size: 0.9rem;
  }
  .aspect:first-child {
    border-top: 0;
  }
  .name {
    font-weight: 500;
  }
  .chain {
    display: contents;
  }
  .link {
    height: 4px;
    border-radius: 2px;
    background: var(--lv-pattern, none), var(--lv, var(--border));
  }
  .link.lv-unknown {
    background: repeating-linear-gradient(90deg, var(--border) 0 6px, transparent 6px 10px);
  }
  .result {
    font-weight: 600;
    text-align: right;
  }
  .c-unknown .result {
    color: var(--text-muted);
    font-weight: 400;
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
  .pill.unknown {
    color: var(--text-muted);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--border);
    font-weight: 500;
  }
  .caveat {
    margin-top: 22px;
    font-size: 0.85rem;
    max-width: 75ch;
  }
  @media (max-width: 640px) {
    .aspect {
      grid-template-columns: 1fr auto;
      grid-template-areas:
        'name result'
        'chain chain';
      row-gap: 6px;
    }
    .name {
      grid-area: name;
    }
    .result {
      grid-area: result;
    }
    .chain {
      grid-area: chain;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .chain .link {
      flex: 1;
    }
  }
</style>
