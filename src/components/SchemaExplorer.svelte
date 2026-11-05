<script lang="ts">
  /**
   * Interactive explorer for OpenUSD schemas and MaterialX standard-library nodes,
   * backed by the weekly-ingested upstream datasets.
   */
  import type { ExplorerNode, ExplorerSchema } from '../lib/view';

  interface Props {
    usdLatest: string;
    mtlxLatest: string;
    domains: { id: string; label: string }[];
    schemas: ExplorerSchema[];
    targets: { id: string; label: string }[];
    nodes: ExplorerNode[];
  }

  let { usdLatest, mtlxLatest, domains, schemas, targets, nodes }: Props = $props();

  let tab = $state<'usd' | 'materialx'>('usd');

  // ── OpenUSD filters ──
  let usdDomain = $state('');
  let usdKind = $state<'all' | 'concrete' | 'api' | 'abstract'>('all');
  let usdQuery = $state('');

  const domainLabel = $derived(Object.fromEntries(domains.map((d) => [d.id, d.label])));

  const visibleSchemas = $derived.by(() => {
    const q = usdQuery.trim().toLowerCase();
    return schemas.filter(
      (s) =>
        !s.removedIn &&
        (!usdDomain || s.domain === usdDomain) &&
        (usdKind === 'all' || s.kind === usdKind) &&
        (!q ||
          s.name.toLowerCase().includes(q) ||
          (s.typeName?.toLowerCase().includes(q) ?? false) ||
          (s.doc?.toLowerCase().includes(q) ?? false) ||
          s.sampleProps.some((p) => p.toLowerCase().includes(q))),
    );
  });

  // ── MaterialX filters ──
  let mtlxLibrary = $state('');
  let mtlxGroup = $state('');
  let mtlxQuery = $state('');

  const allLibraries = $derived([...new Set(nodes.map((n) => n.library))]);
  const allGroups = $derived(
    [...new Set(nodes.filter((n) => !mtlxLibrary || n.library === mtlxLibrary).map((n) => n.group).filter(Boolean))] as string[],
  );

  const visibleNodes = $derived.by(() => {
    const q = mtlxQuery.trim().toLowerCase();
    return nodes.filter(
      (n) =>
        !n.removedIn &&
        (!mtlxLibrary || n.library === mtlxLibrary) &&
        (!mtlxGroup || n.group === mtlxGroup) &&
        (!q || n.name.toLowerCase().includes(q) || (n.doc?.toLowerCase().includes(q) ?? false)),
    );
  });
</script>

<div class="tabs chip-row" role="tablist" aria-label="Dataset">
  <button
    class="chip tech-usd"
    role="tab"
    aria-selected={tab === 'usd'}
    aria-pressed={tab === 'usd'}
    onclick={() => (tab = 'usd')}
  >
    OpenUSD {usdLatest} Schemas ({schemas.filter((s) => !s.removedIn).length})
  </button>
  <button
    class="chip tech-mtlx"
    role="tab"
    aria-selected={tab === 'materialx'}
    aria-pressed={tab === 'materialx'}
    onclick={() => (tab = 'materialx')}
  >
    MaterialX {mtlxLatest} Nodes ({nodes.filter((n) => !n.removedIn).length})
  </button>
</div>

{#if tab === 'usd'}
  <div class="controls">
    <div class="chip-row" role="group" aria-label="Schema kind">
      <button class="chip" aria-pressed={usdKind === 'all'} onclick={() => (usdKind = 'all')}>All kinds</button>
      <button class="chip" aria-pressed={usdKind === 'concrete'} onclick={() => (usdKind = 'concrete')}>
        Concrete prims
      </button>
      <button class="chip" aria-pressed={usdKind === 'api'} onclick={() => (usdKind = 'api')}>API schemas</button>
      <button class="chip" aria-pressed={usdKind === 'abstract'} onclick={() => (usdKind = 'abstract')}>
        Abstract base types
      </button>
    </div>
    <div class="chip-row" role="group" aria-label="Domain">
      <button class="chip" aria-pressed={usdDomain === ''} onclick={() => (usdDomain = '')}>All domains</button>
      {#each domains as d (d.id)}
        <button class="chip" aria-pressed={usdDomain === d.id} onclick={() => (usdDomain = d.id)}>
          {d.label}
        </button>
      {/each}
    </div>
    <div class="row">
      <input type="search" placeholder="Search schema name, prim type, property or description" bind:value={usdQuery} />
      <span class="muted count">{visibleSchemas.length} schemas</span>
    </div>
  </div>

  <div class="grid">
    {#each visibleSchemas as s (s.name)}
      <article class="card">
        <header>
          <div>
            <strong>{s.typeName ?? s.name}</strong>
            {#if s.typeName && s.typeName !== s.name}
              <code class="muted">({s.name})</code>
            {/if}
          </div>
          <span class={`badge kind-${s.kind}`}>{s.kind}</span>
        </header>
        <p class="meta muted">
          <span>{domainLabel[s.domain] ?? s.domain}</span>
          {#if s.inherits}<span>· inherits <code>{s.inherits}</code></span>{/if}
          {#if s.since}<span>· since {s.since}</span>{/if}
          {#if s.totalProps > 0}<span>· {s.ownProps} own / {s.totalProps} total properties</span>{/if}
        </p>
        {#if s.doc}<p class="doc muted">{s.doc}</p>{/if}
        {#if s.sampleProps.length > 0}
          <p class="props">
            {#each s.sampleProps as p (p)}<code>{p}</code>{/each}
          </p>
        {/if}
      </article>
    {/each}
  </div>
{:else}
  <div class="controls">
    <div class="chip-row" role="group" aria-label="Library">
      <button
        class="chip"
        aria-pressed={mtlxLibrary === ''}
        onclick={() => {
          mtlxLibrary = '';
          mtlxGroup = '';
        }}>All libraries</button
      >
      {#each allLibraries as lib (lib)}
        <button
          class="chip"
          aria-pressed={mtlxLibrary === lib}
          onclick={() => {
            mtlxLibrary = lib;
            mtlxGroup = '';
          }}
        >
          {lib}
        </button>
      {/each}
    </div>
    <div class="row">
      <input type="search" placeholder="Search node name or description" bind:value={mtlxQuery} />
      <label>
        Group
        <select bind:value={mtlxGroup}>
          <option value="">All groups</option>
          {#each allGroups as g (g)}<option value={g}>{g}</option>{/each}
        </select>
      </label>
      <span class="muted count">{visibleNodes.length} nodes</span>
    </div>
  </div>

  <ul class="legend" role="list">
    <li><span class="swatch lv-native"></span>Native code generator implementation</li>
    <li><span class="swatch lv-plugin"></span>Evaluated via compound node graph</li>
    <li><span class="swatch lv-partial"></span>Partial across type variants</li>
    <li><span class="swatch lv-none"></span>Unsupported in target</li>
  </ul>

  <div class="scroll">
    <table>
      <thead>
        <tr>
          <th>Node</th>
          <th>Library / Group</th>
          <th>Since</th>
          <th>Defs</th>
          {#each targets as t (t.id)}
            <th class="center">{t.label}</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each visibleNodes as n (`${n.library}:${n.name}`)}
          <tr>
            <td>
              <strong><code>{n.name}</code></strong>
              {#if n.doc}<p class="node-doc muted">{n.doc}</p>{/if}
            </td>
            <td class="muted nowrap">{n.library}{n.group ? ` · ${n.group}` : ''}</td>
            <td class="muted nowrap">{n.since ?? '≤1.38.0'}</td>
            <td class="muted center">{n.nodedefs}</td>
            {#each targets as t (t.id)}
              {@const st = n.targets[t.id]}
              <td class="center">
                <span
                  class={`cell ${
                    st === 'native'
                      ? 'lv-native'
                      : st === 'graph'
                        ? 'lv-plugin'
                        : st === 'partial'
                          ? 'lv-partial'
                          : 'lv-none'
                  }`}
                  title={`${n.name} on ${t.label}: ${st}`}
                ></span>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .tabs {
    margin: 24px 0 14px;
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
  .controls {
    display: grid;
    gap: 10px;
    margin-bottom: 14px;
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
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text);
  }
  input {
    min-width: 280px;
    flex: 1;
    max-width: 440px;
  }
  .count {
    margin-left: auto;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr));
    gap: 12px;
  }
  .card {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .card header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
  }
  .card p {
    margin: 0;
  }
  .meta {
    font-size: 0.78rem;
  }
  .doc {
    font-size: 0.86rem;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .props {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: auto !important;
    padding-top: 4px;
  }
  .props code {
    font-size: 0.74rem;
    padding: 1px 6px;
    border-radius: 4px;
    background: var(--surface-2);
  }
  .badge {
    font-size: 0.7rem;
    font-weight: 650;
    text-transform: uppercase;
    padding: 1px 7px;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  .kind-concrete {
    border-color: var(--usd);
    color: var(--usd);
  }
  .kind-api {
    border-color: var(--accent);
    color: var(--accent);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    list-style: none;
    padding: 0;
    margin: 0 0 10px;
    font-size: 0.8rem;
    color: var(--text-muted);
  }
  .legend li {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .swatch,
  .cell {
    width: 14px;
    height: 14px;
    border-radius: 3px;
    background: var(--lv);
    display: inline-block;
  }
  .scroll {
    overflow: auto;
    max-height: 75vh;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.84rem;
  }
  th,
  td {
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    vertical-align: top;
  }
  thead th {
    position: sticky;
    top: 0;
    background: var(--surface);
    color: var(--text-muted);
    font-weight: 600;
  }
  .center {
    text-align: center;
  }
  .nowrap {
    white-space: nowrap;
  }
  .node-doc {
    margin: 2px 0 0;
    font-size: 0.78rem;
    max-width: 52ch;
  }
</style>
