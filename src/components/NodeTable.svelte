<script lang="ts">
  /**
   * MaterialX node table: every live standard-library node as a tile, grouped by library and node group,
   * coloured by how one of MaterialX's own code generators supports it (or diffing two generators).
   * The 1 MB dataset is fetched client-side from /data/materialx-nodes.json.
   */
  import { onMount } from 'svelte';
  import type { MaterialXNodes, MtlxNode, MtlxNodeDef } from '../data/generated';

  interface Props {
    dataUrl: string;
    /** For the loading placeholder. */
    nodeCount: number;
  }

  let { dataUrl, nodeCount }: Props = $props();

  type State = 'native' | 'graph' | 'partial' | 'none';
  type Diff = 'a' | 'same' | 'b' | 'mixed' | 'neither';

  const SHORT: Record<string, string> = {
    genglsl: 'GLSL',
    essl: 'ESSL',
    genmsl: 'MSL',
    genosl: 'OSL',
    genmdl: 'MDL',
    genslang: 'Slang',
  };
  const LIB_LABEL: Record<string, string> = {
    stdlib: 'Standard library',
    pbrlib: 'PBR library',
    bxdf: 'Shading models',
    'bxdf/translation': 'Shading-model translations',
    'bxdf/lama': 'Lama shading models',
    cmlib: 'Color management',
    lights: 'Lights',
    nprlib: 'NPR library',
  };
  const LIB_ORDER = Object.keys(LIB_LABEL);
  const STATES: State[] = ['native', 'graph', 'partial', 'none'];

  let data = $state<MaterialXNodes | null>(null);
  let failed = $state(false);
  let target = $state('genglsl');
  let compare = $state(false);
  let targetB = $state('genosl');
  let sinceIdx = $state(-1);
  let query = $state('');
  let selected = $state<MtlxNode | null>(null);
  let selectedDef = $state(0);
  let dlg: HTMLDialogElement | undefined = $state();

  onMount(async () => {
    try {
      const res = await fetch(dataUrl);
      if (!res.ok) throw new Error(String(res.status));
      data = (await res.json()) as MaterialXNodes;
      sinceIdx = data.versions.length - 1;
    } catch {
      failed = true;
    }
  });

  const short = (id: string) => SHORT[id] ?? data?.targets.find((t) => t.id === id)?.label ?? id;
  const vparts = (v: string) => v.split('.').map(Number);
  const vcmp = (a: string, b: string) => {
    const [x, y] = [vparts(a), vparts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    return 0;
  };

  const targets = $derived(data ? data.targets.filter((t) => data!.history.at(-1)!.supported[t.id] !== undefined) : []);
  const versions = $derived(data?.versions ?? []);
  const lastIdx = $derived(versions.length - 1);
  const sinceOn = $derived(sinceIdx >= 0 && sinceIdx < lastIdx);
  const sinceVersion = $derived(versions[sinceIdx] ?? '');

  const liveDefs = (n: MtlxNode) => n.nodedefs.filter((d) => !d.removedIn);
  const live = $derived(data ? data.nodes.filter((n) => !n.removedIn) : []);

  function stateOf(n: MtlxNode, t: string): State {
    const c = n.coverage[t];
    if (!c || c.total === 0 || c.native + c.graph === 0) return 'none';
    if (c.native === c.total) return 'native';
    if (c.native + c.graph === c.total) return 'graph';
    return 'partial';
  }
  const ok = (d: MtlxNodeDef, t: string) => d.support[t] === 'native' || d.support[t] === 'graph';
  function diffOf(n: MtlxNode, a: string, b: string): Diff {
    const defs = liveDefs(n);
    const onlyA = defs.some((d) => ok(d, a) && !ok(d, b));
    const onlyB = defs.some((d) => ok(d, b) && !ok(d, a));
    if (onlyA && onlyB) return 'mixed';
    if (onlyA) return 'a';
    if (onlyB) return 'b';
    return defs.some((d) => ok(d, a)) ? 'same' : 'neither';
  }

  const isNew = (n: MtlxNode) => sinceOn && n.since !== null && vcmp(n.since, sinceVersion) > 0;
  const q = $derived(query.trim().toLowerCase());
  const matches = (n: MtlxNode) => !q || n.name.toLowerCase().includes(q) || (n.group ?? '').includes(q);

  const libraries = $derived.by(() => {
    const libs = [...new Set(live.map((n) => n.library))].sort(
      (a, b) => (LIB_ORDER.indexOf(a) + 1 || 99) - (LIB_ORDER.indexOf(b) + 1 || 99) || a.localeCompare(b),
    );
    return libs.map((lib) => {
      const nodes = live.filter((n) => n.library === lib);
      const groups = [...new Set(nodes.map((n) => n.group ?? 'other'))]
        .map((g) => ({ g, nodes: nodes.filter((n) => (n.group ?? 'other') === g).sort((a, b) => a.name.localeCompare(b.name)) }))
        .sort((a, b) => b.nodes.length - a.nodes.length || a.g.localeCompare(b.g));
      return { lib, count: nodes.length, groups };
    });
  });

  const counts = $derived.by(() => {
    const out: Record<string, number> = {};
    for (const n of live) {
      const k = compare ? diffOf(n, target, targetB) : stateOf(n, target);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  });
  const newCount = $derived(sinceOn ? live.filter(isNew).length : 0);
  const matchCount = $derived(q ? live.filter(matches).length : live.length);

  const segments = $derived.by(() => {
    const A = short(target);
    const B = short(targetB);
    const list: { key: string; label: string; cls: string }[] = compare
      ? [
          { key: 'a', label: `More in ${A}`, cls: 'c-a' },
          { key: 'mixed', label: 'Differs both ways', cls: 'c-mixed' },
          { key: 'same', label: 'Same in both', cls: 'c-same' },
          { key: 'b', label: `More in ${B}`, cls: 'c-b' },
          { key: 'neither', label: 'In neither', cls: 'c-neither' },
        ]
      : [
          { key: 'native', label: 'Native implementation', cls: 's-native' },
          { key: 'graph', label: 'Uses node graphs', cls: 's-graph' },
          { key: 'partial', label: 'Some type variants', cls: 's-partial' },
          { key: 'none', label: 'Not supported', cls: 's-none' },
        ];
    return list.map((s) => ({ ...s, n: counts[s.key] ?? 0 }));
  });

  const STATE_LABEL: Record<State, string> = {
    native: 'native',
    graph: 'uses node graphs',
    partial: 'some type variants',
    none: 'not supported',
  };
  const tileClass = (n: MtlxNode) => (compare ? `c-${diffOf(n, target, targetB)}` : `s-${stateOf(n, target)}`);
  const tileLabel = (n: MtlxNode) => {
    const what = compare
      ? segments.find((s) => s.key === diffOf(n, target, targetB))!.label.toLowerCase()
      : `${short(target)} ${STATE_LABEL[stateOf(n, target)]}`;
    const defs = liveDefs(n).length;
    return `${n.name}, ${defs} type variant${defs === 1 ? '' : 's'}: ${what}${isNew(n) ? `, added in ${n.since}` : ''}`;
  };
  /** Let long snake_case names break after underscores. */
  const parts = (name: string) => name.split('_').map((p, i, a) => (i < a.length - 1 ? `${p}_` : p));

  function open(n: MtlxNode) {
    selected = n;
    const defs = liveDefs(n);
    selectedDef = Math.max(0, defs.findIndex((d) => d.isDefaultVersion));
    dlg?.showModal();
  }
  function onDialogClick(e: MouseEvent) {
    // Clicks on the backdrop land on the <dialog> element itself.
    if (e.target === dlg) dlg?.close();
  }

  const selDefs = $derived(selected ? liveDefs(selected) : []);
  const def = $derived(selDefs[selectedDef] ?? selDefs[0]);
  const removedDefs = $derived(selected ? selected.nodedefs.length - selDefs.length : 0);
  const ndLabel = (d: MtlxNodeDef, n: MtlxNode) => d.name.replace(new RegExp(`^ND_${n.name}_?`), '') || d.name;
  const supLabel = (s: string | undefined) => (s === 'native' ? 'Native' : s === 'graph' ? 'Node graph' : 'Not supported');
</script>

<div class="controls">
  <div class="chip-row" role="group" aria-label="Colour by code generator">
    <span class="muted small">Generator</span>
    {#each targets.length ? targets : Object.keys(SHORT).map((id) => ({ id, label: SHORT[id] })) as t (t.id)}
      <button
        class="chip"
        aria-pressed={target === t.id}
        title={t.label}
        onclick={() => {
          target = t.id;
          if (targetB === t.id) targetB = targets.find((x) => x.id !== t.id)?.id ?? targetB;
        }}>{short(t.id)}</button
      >
    {/each}
    <span class="sep" aria-hidden="true"></span>
    <button class="chip compare" aria-pressed={compare} onclick={() => (compare = !compare)}>Compare two</button>
  </div>
  {#if compare}
    <div class="chip-row" role="group" aria-label="Compare against">
      <span class="muted small">against</span>
      {#each targets.filter((t) => t.id !== target) as t (t.id)}
        <button class="chip" aria-pressed={targetB === t.id} title={t.label} onclick={() => (targetB = t.id)}>{short(t.id)}</button>
      {/each}
    </div>
  {/if}
  <div class="tools">
    <label class="search">
      <span class="visually-hidden">Find a node</span>
      <input type="search" placeholder="Find a node, e.g. mix" bind:value={query} />
    </label>
    {#if versions.length}
      <label class="since">
        <span class="small">{sinceOn ? 'New after' : 'Highlight new nodes'}</span>
        <input type="range" min="0" max={lastIdx} step="1" bind:value={sinceIdx} aria-valuetext={sinceOn ? `nodes added after ${sinceVersion}` : 'off'} />
        <output class="small">
          {#if sinceOn}<strong>{sinceVersion}</strong> · {newCount} node{newCount === 1 ? '' : 's'}{:else}off{/if}
        </output>
        {#if sinceOn}<button class="linkish small" onclick={() => (sinceIdx = lastIdx)}>Clear</button>{/if}
      </label>
    {/if}
  </div>
</div>

{#if failed}
  <p class="state">Couldn't load the node data. <a href={dataUrl}>Download materialx-nodes.json</a> instead.</p>
{:else if !data}
  <p class="state muted" aria-busy="true">Loading {nodeCount} nodes…</p>
{:else}
  <figure class="summary">
    <figcaption>
      {#if compare}
        <strong>{short(target)}</strong> vs <strong>{short(targetB)}</strong>, node by node across all type variants
      {:else}
        <strong>{short(target)}</strong> generates
        <strong>{(counts.native ?? 0) + (counts.graph ?? 0)}</strong> of {live.length} nodes in full
        ({counts.native ?? 0} fully native, {counts.graph ?? 0} using node graphs)
      {/if}
    </figcaption>
    <div class="seg-bar" role="img" aria-label={segments.map((s) => `${s.label}: ${s.n}`).join(', ')}>
      {#each segments.filter((s) => s.n > 0) as s (s.key)}
        <span class={`seg ${s.cls}`} style={`flex-grow:${s.n}`} title={`${s.label}: ${s.n}`}>
          {#if s.n / live.length > 0.045}<span class="seg-n">{s.n}</span>{/if}
        </span>
      {/each}
    </div>
    <ul class="legend" role="list">
      {#each segments as s (s.key)}
        <li><span class={`sw ${s.cls}`} aria-hidden="true"></span>{s.label} <span class="n">{s.n}</span></li>
      {/each}
    </ul>
  </figure>

  {#if q}<p class="muted small found">{matchCount} node{matchCount === 1 ? '' : 's'} match "{query.trim()}"</p>{/if}

  <div class="table" class:filtering={q || sinceOn}>
    {#each libraries as L (L.lib)}
      <section class="lib">
        <h2>
          <code>{L.lib}</code>
          <span class="muted">{LIB_LABEL[L.lib] ?? ''} · {L.count} node{L.count === 1 ? '' : 's'}</span>
        </h2>
        {#each L.groups as G (G.g)}
          <div class="group">
            <h3>{G.g} <span class="muted">{G.nodes.length}</span></h3>
            <div class="tiles">
              {#each G.nodes as n (n.name)}
                {@const fresh = isNew(n)}
                <button
                  class={`tile ${tileClass(n)}`}
                  class:dim={(sinceOn && !fresh) || (q !== '' && !matches(n))}
                  class:fresh
                  aria-label={tileLabel(n)}
                  onclick={() => open(n)}
                >
                  <span class="name">{#each parts(n.name) as p, i (i)}{p}<wbr />{/each}</span>
                  <span class="meta">
                    <span>×{liveDefs(n).length}</span>
                    {#if fresh}<span class="new">{n.since}</span>{/if}
                  </span>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </section>
    {/each}
  </div>
{/if}

<dialog bind:this={dlg} onclose={() => (selected = null)} onclick={onDialogClick} aria-labelledby="node-title">
  {#if selected && def}
    <div class="sheet">
      <header>
        <div>
          <p class="eyebrow muted">{selected.library} · {selected.group ?? 'other'}</p>
          <h2 id="node-title"><code>{selected.name}</code></h2>
        </div>
        <button class="x" onclick={() => dlg?.close()} aria-label="Close">×</button>
      </header>
      {#if selected.doc}<p class="doc">{selected.doc}</p>{/if}
      <p class="muted small">
        {selected.since ? `Added in MaterialX ${selected.since}.` : `In every tracked release (${versions[0]} onwards).`}
        {selDefs.length} type variant{selDefs.length === 1 ? '' : 's'}{removedDefs ? `, plus ${removedDefs} removed in earlier releases` : ''}.
      </p>

      <h3>By code generator</h3>
      <ul class="gen" role="list">
        {#each targets as t (t.id)}
          {@const st = stateOf(selected, t.id)}
          {@const c = selected.coverage[t.id]}
          <li>
            <span class={`sw s-${st}`} aria-hidden="true"></span>
            <span><strong>{short(t.id)}</strong> <span class="muted">{STATE_LABEL[st]}</span></span>
            {#if c}<span class="muted num">{c.native + c.graph}/{c.total}</span>{/if}
          </li>
        {/each}
      </ul>

      <h3>Type variants</h3>
      <div class="scroll">
        <table class="variants">
          <thead>
            <tr>
              <th scope="col">Variant</th>
              <th scope="col">Output</th>
              {#each targets as t (t.id)}<th scope="col" class="t" title={t.label}>{short(t.id)}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each selDefs as d, i (d.name)}
              <tr class:sel={i === selectedDef}>
                <th scope="row">
                  <button class="variant" aria-pressed={i === selectedDef} onclick={() => (selectedDef = i)} title={d.name}>
                    {ndLabel(d, selected)}{#if d.version}<span class="muted ver">v{d.version}{d.isDefaultVersion ? ' (default)' : ''}</span>{/if}
                  </button>
                </th>
                <td class="mono">{d.outputs.map((o) => o.type).join(', ') || '–'}</td>
                {#each targets as t (t.id)}
                  {@const s = d.support[t.id]}
                  <td class="t">
                    <span class={`cell s-${s === 'native' ? 'native' : s === 'graph' ? 'graph' : 'none'}`} title={`${short(t.id)}: ${supLabel(s)}`}></span>
                    <span class="visually-hidden">{supLabel(s)}</span>
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="muted small key">
        <span><span class="cell s-native"></span> native</span>
        <span><span class="cell s-graph"></span> node graph</span>
        <span><span class="cell s-none"></span> not supported</span>
        <span>· select a variant to see its inputs</span>
      </p>

      <h3>Inputs of <code>{def.name}</code></h3>
      {#if def.inputs.length}
        <div class="scroll">
          <table class="inputs">
            <thead>
              <tr><th scope="col">Input</th><th scope="col">Type</th><th scope="col">Default</th></tr>
            </thead>
            <tbody>
              {#each def.inputs as inp (inp.name)}
                <tr>
                  <th scope="row" class="mono">{inp.name}{#if inp.uniform}<span class="muted"> uniform</span>{/if}</th>
                  <td class="mono">{inp.type}</td>
                  <td class="mono">{inp.default ?? ''}{#if inp.enum}<span class="muted"> ({inp.enum})</span>{/if}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <p class="muted small">No inputs.</p>
      {/if}
    </div>
  {/if}
</dialog>

<style>
  .controls {
    display: grid;
    gap: 10px;
    margin: 20px 0 18px;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }
  .small {
    font-size: 0.82rem;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 20px;
    align-items: center;
  }
  .search input {
    font: inherit;
    font-size: 0.88rem;
    width: min(260px, 100%);
    padding: 5px 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text);
  }
  .search {
    flex: 0 1 260px;
    min-width: 0;
  }
  .since {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    min-width: 0;
  }
  .since input {
    width: 180px;
    max-width: 100%;
    accent-color: var(--mtlx);
  }
  .since output {
    min-width: 7em;
    font-variant-numeric: tabular-nums;
  }
  .linkish {
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    font: inherit;
  }
  .state {
    min-height: 400px;
    padding-top: 24px;
  }

  /* fills: one ordinal ramp for single-generator coverage, a categorical pair for compare */
  .s-native {
    --f: var(--cov-native);
    --ink: var(--cov-native-ink);
  }
  .s-graph {
    --f: var(--cov-graph);
    --ink: var(--cov-graph-ink);
  }
  .s-partial {
    --f: var(--cov-partial);
    --ink: var(--cov-partial-ink);
  }
  .s-none,
  .c-neither {
    --f: transparent;
    --ink: var(--text-muted);
    --edge: var(--border);
  }
  .c-a {
    --f: var(--cmp-a);
    --ink: var(--cmp-ink);
  }
  .c-b {
    --f: var(--cmp-b);
    --ink: var(--cmp-ink);
  }
  .c-mixed {
    --f: linear-gradient(135deg, var(--cmp-a) 50%, var(--cmp-b) 50%);
    --ink: var(--cmp-ink);
  }
  .c-same {
    --f: var(--surface-2);
    --ink: var(--text);
    --edge: var(--border);
  }

  .summary {
    margin: 0 0 8px;
  }
  .summary figcaption {
    font-size: 0.92rem;
    margin-bottom: 8px;
  }
  .seg-bar {
    display: flex;
    gap: 2px;
    height: 28px;
  }
  .seg {
    flex-basis: 0;
    min-width: 3px;
    background: var(--f);
    border-radius: 4px;
    box-shadow: inset 0 0 0 1px var(--edge, transparent);
    color: var(--ink);
    display: flex;
    align-items: center;
    padding-left: 8px;
    font-size: 0.8rem;
    font-weight: 650;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
  }
  .legend {
    list-style: none;
    padding: 0;
    margin: 8px 0 0;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .legend .n {
    color: var(--text);
    font-variant-numeric: tabular-nums;
  }
  .sw {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--f);
    box-shadow: inset 0 0 0 1px var(--edge, transparent);
    flex: none;
  }
  .found {
    margin: 12px 0 0;
  }

  .lib {
    margin-top: 28px;
  }
  .lib h2 {
    font-size: 1.05rem;
    margin: 0 0 10px;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--border);
  }
  .lib h2 .muted {
    font-size: 0.82rem;
    font-weight: 400;
  }
  .group {
    margin: 10px 0 14px;
  }
  .group h3 {
    font-size: 0.78rem;
    font-weight: 600;
    margin: 0 0 6px;
    text-transform: lowercase;
    letter-spacing: 0.02em;
  }
  .group h3 .muted {
    font-weight: 400;
  }
  .tiles {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
    gap: 3px;
  }
  .tile {
    font: inherit;
    text-align: left;
    min-height: 52px;
    padding: 6px 7px 5px;
    border: 0;
    border-radius: 6px;
    background: var(--f);
    box-shadow: inset 0 0 0 1px var(--edge, transparent);
    color: var(--ink);
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 4px;
    cursor: pointer;
    transition:
      opacity 120ms,
      transform 120ms;
  }
  .tile:hover,
  .tile:focus-visible {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }
  .name {
    font-family: var(--font-mono);
    font-size: 0.74rem;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 0.66rem;
    opacity: 0.85;
    font-variant-numeric: tabular-nums;
  }
  .new {
    font-weight: 700;
    opacity: 1;
  }
  .tile.dim {
    opacity: 0.18;
  }
  .tile.fresh {
    outline: 2px solid var(--text);
    outline-offset: 1px;
  }

  dialog {
    padding: 0;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    width: min(600px, 100vw);
    max-width: 100vw;
    height: 100dvh;
    max-height: 100dvh;
    margin: 0 0 0 auto;
    border-radius: 0;
  }
  dialog::backdrop {
    background: rgb(0 0 0 / 0.4);
  }
  .sheet {
    padding: 18px 22px 28px;
  }
  .sheet header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
  }
  .eyebrow {
    margin: 0;
    font-size: 0.8rem;
  }
  .sheet h2 {
    margin: 2px 0 8px;
    font-size: 1.35rem;
    overflow-wrap: anywhere;
  }
  .sheet h3 {
    font-size: 0.92rem;
    margin: 22px 0 8px;
  }
  .doc {
    margin: 0 0 6px;
  }
  .x {
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
    border-radius: 8px;
    width: 34px;
    height: 34px;
    font-size: 1.2rem;
    cursor: pointer;
    flex: none;
  }
  .gen {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
    gap: 6px 18px;
    font-size: 0.86rem;
  }
  .gen li {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .gen .num {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
  }
  .scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.8rem;
  }
  th,
  td {
    text-align: left;
    padding: 4px 6px;
    border-bottom: 1px solid var(--grid);
    vertical-align: middle;
  }
  thead th {
    color: var(--text-muted);
    font-weight: 600;
    font-size: 0.74rem;
  }
  th.t,
  td.t {
    text-align: center;
    width: 40px;
    padding: 4px 2px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 0.76rem;
  }
  .variant {
    font: inherit;
    font-family: var(--font-mono);
    font-size: 0.76rem;
    border: 0;
    background: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    text-align: left;
  }
  .variant .ver {
    margin-left: 0.5em;
    font-weight: 400;
  }
  .variant[aria-pressed='true'] {
    color: var(--text);
    font-weight: 700;
  }
  tr.sel {
    background: var(--surface-2);
  }
  .cell {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 3px;
    background: var(--f);
    box-shadow: inset 0 0 0 1px var(--edge, transparent);
    vertical-align: middle;
  }
  .key {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    margin-top: 8px;
  }
  .key > span {
    white-space: nowrap;
  }

  @media (max-width: 640px) {
    .tiles {
      grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    }
    dialog {
      width: 100vw;
      height: 88dvh;
      margin: auto 0 0;
      border-radius: 14px 14px 0 0;
    }
    .sheet {
      padding: 16px 16px 28px;
    }
  }
</style>
