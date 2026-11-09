<script lang="ts">
  /**
   * Version lag as "lag ribbons": one lane per product, one arc per release, running from the day the
   * bundled upstream version was tagged to the day the product shipped it. Arc length = months behind,
   * arc colour = how many newer upstream releases were already out (ordinal ramp, --lag-0…3).
   * The data comes from /data/version-lag.json, fetched on mount.
   */
  import { onMount } from 'svelte';
  import {
    BEHIND_STEPS,
    behindStep,
    dateValue,
    median,
    type LagProduct,
    type LagRelease,
    type VersionLagData,
  } from '../lib/lag';
  import { CATEGORY_LABEL, TECH_LABEL, type Tech } from '../lib/view';
  import { pick, readParams, writeParams } from '../lib/url-state';

  interface Props {
    dataUrl: string;
    /** Build date (YYYY-MM-DD), so every visitor sees the same "now". */
    today: string;
    categories: string[];
  }

  let { dataUrl, today, categories }: Props = $props();

  let payload = $state<VersionLagData | null>(null);
  let failed = $state(false);
  onMount(async () => {
    try {
      const res = await fetch(dataUrl);
      if (!res.ok) throw new Error(String(res.status));
      payload = (await res.json()) as VersionLagData;
    } catch {
      failed = true;
    }
  });
  const products = $derived(payload?.products ?? []);
  const upstream = $derived(payload?.upstream ?? { usd: [], materialx: [] });

  type Sort = 'lag' | 'latest' | 'name';
  interface Lane {
    p: LagProduct;
    plotted: LagRelease[];
    undated: LagRelease[];
    typical: number;
    latest: LagRelease;
  }
  interface Tip {
    pid: string;
    i: number;
    x: number;
    y: number;
  }

  let tech = $state<Tech>('usd');
  let category = $state('all');
  let sort = $state<Sort>('lag');
  let view = $state<'chart' | 'table'>('chart');
  let plotW = $state(760);
  let wrapW = $state(1000);
  let tip = $state<Tip | null>(null);
  let pinned = $state(false);
  let hoverUp = $state<string | null>(null);
  let wrap: HTMLDivElement | undefined = $state();
  let tipW = $state(280);
  let tipH = $state(120);

  // ── shareable URL state (?tech=materialx&cat=renderer&sort=latest&view=table) ──
  let urlReady = false;
  onMount(() => {
    const p = readParams();
    tech = pick(p.get('tech'), ['usd', 'materialx'] as const) ?? tech;
    category = pick(p.get('cat'), categories) ?? category;
    sort = pick(p.get('sort'), ['lag', 'latest', 'name'] as const) ?? sort;
    view = pick(p.get('view'), ['chart', 'table'] as const) ?? view;
    urlReady = true;
  });
  $effect(() => {
    const values = { tech, cat: category, sort, view };
    if (urlReady) writeParams(values, { tech: 'usd', cat: 'all', sort: 'lag', view: 'chart' });
  });

  const DAY = 86_400_000;
  const LANE_H = 46;
  const BASE = 36;
  const AXIS_H = 34;
  const nowT = $derived(Date.parse(today));
  const techLabel = $derived(TECH_LABEL[tech]);

  const tOf = (d: string) => dateValue(d)?.t ?? Date.parse(d);

  const visible = $derived(products.filter((p) => category === 'all' || p.categories.includes(category)));
  const withData = $derived(visible.filter((p) => p.releases[tech].length > 0));
  const notPublished = $derived(visible.filter((p) => p.releases[tech].length === 0));

  const lanes = $derived.by(() => {
    const out: Lane[] = [];
    for (const p of withData) {
      const plotted = p.releases[tech].filter((r) => r.months !== null).toReversed();
      if (!plotted.length) continue;
      out.push({
        p,
        plotted,
        undated: p.releases[tech].filter((r) => r.months === null),
        typical: median(plotted.map((r) => r.months!))!,
        latest: plotted.at(-1)!,
      });
    }
    const byName = (a: Lane, b: Lane) => a.p.name.localeCompare(b.p.name);
    if (sort === 'name') return out.sort(byName);
    if (sort === 'latest') return out.sort((a, b) => a.latest.months! - b.latest.months! || byName(a, b));
    return out.sort((a, b) => a.typical - b.typical || byName(a, b));
  });

  const undated = $derived(
    withData.flatMap((p) => p.releases[tech].filter((r) => r.months === null).map((r) => ({ p, r }))),
  );

  /** Longest lag in the whole dataset for this tech, so arc heights don't jump when filtering. */
  const maxMonths = $derived(
    Math.max(1, ...products.flatMap((p) => p.releases[tech].map((r) => Math.max(0, r.months ?? 0)))),
  );

  const domain = $derived.by(() => {
    let lo = Infinity;
    for (const l of lanes) for (const r of l.plotted) lo = Math.min(lo, Date.parse(r.upstreamDate!), tOf(r.date!));
    if (!Number.isFinite(lo)) lo = nowT - 3 * 365 * DAY;
    return [lo - 70 * DAY, nowT + 50 * DAY] as const;
  });
  const x = (t: number) => ((t - domain[0]) / (domain[1] - domain[0])) * plotW;

  const years = $derived.by(() => {
    const out: { y: number; x: number; mid: number }[] = [];
    const y0 = new Date(domain[0]).getUTCFullYear();
    const y1 = new Date(domain[1]).getUTCFullYear();
    for (let y = y0; y <= y1; y++) {
      out.push({ y, x: x(Date.UTC(y, 0, 1)), mid: x(Date.UTC(y, 6, 2)) });
    }
    return out;
  });

  const ticks = $derived(upstream[tech].filter((u) => Date.parse(u.date) >= domain[0] && Date.parse(u.date) <= domain[1]));

  /** Greedy left-to-right labelling so tick labels never collide at any width. */
  const tickLabels = $derived.by(() => {
    const pool = tech === 'usd' ? ticks.filter((u) => u.major) : ticks;
    const out = new Set<string>();
    let last = -Infinity;
    for (const u of pool) {
      const px = x(Date.parse(u.date));
      if (px - last >= 46 && px > 14 && px < plotW - 14) {
        out.add(u.version);
        last = px;
      }
    }
    return out;
  });

  const arcH = (months: number) => 5 + (BASE - 12) * Math.sqrt(Math.min(Math.max(months, 0), maxMonths) / maxMonths);
  /** Cubic Bézier whose peak is `h` above the baseline (peak = 0.75 × control height). */
  const arcPath = (a: number, b: number, h: number) => {
    const k = h / 0.75;
    return `M${a.toFixed(1)},${BASE}C${a.toFixed(1)},${(BASE - k).toFixed(1)} ${b.toFixed(1)},${(BASE - k).toFixed(1)} ${b.toFixed(1)},${BASE}`;
  };

  const active = $derived.by(() => {
    if (!tip) return null;
    const lane = lanes.find((l) => l.p.id === tip!.pid);
    const r = lane?.plotted[tip.i];
    return lane && r ? { p: lane.p, r } : null;
  });
  const focusVersion = $derived(hoverUp ?? active?.r.bundled ?? null);
  /** x of the focused upstream release, so neighbouring axis labels can make room for its label. */
  const focusX = $derived.by(() => {
    const u = focusVersion ? upstream[tech].find((t) => t.version === focusVersion) : undefined;
    return u ? x(Date.parse(u.date)) : null;
  });

  // ── stats (scoped to the filters, like everything else) ──
  const allPlotted = $derived(lanes.flatMap((l) => l.plotted));
  const typicalAll = $derived(median(allPlotted.map((r) => r.months!)));
  const newestShare = $derived(
    allPlotted.length ? Math.round((100 * allPlotted.filter((r) => r.behind === 0).length) / allPlotted.length) : null,
  );

  // ── formatting ──
  const fmtDate = (d: string | null) => {
    if (!d) return 'date not sourced';
    const [y, m, day] = d.split('-').map(Number);
    if (!m) return String(y);
    return new Date(Date.UTC(y, m - 1, day ?? 1)).toLocaleDateString('en-GB', {
      ...(day ? { day: 'numeric' } : {}),
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });
  };
  const fmtMonths = (m: number, approx = false) => {
    if (m < 0) return 'Shipped before the tag';
    if (m < 1) return 'Under a month';
    const v = m < 10 ? m.toFixed(1) : Math.round(m).toString();
    return `${approx ? '~' : ''}${v} months`;
  };
  const shortMonths = (m: number) => (m < 1 ? '<1 mo' : `${m < 10 ? m.toFixed(1) : Math.round(m)} mo`);
  const behindText = (r: LagRelease) =>
    r.behind === 0
      ? `newest ${techLabel} release at ship`
      : `${r.behind} newer release${r.behind === 1 ? '' : 's'} already out (latest ${r.newest})`;
  const host = (u: string) => new URL(u).hostname.replace(/^www\./, '');
  const ariaFor = (p: LagProduct, r: LagRelease) =>
    `${p.name} ${r.version}, released ${fmtDate(r.date)}, bundles ${techLabel} ${r.bundled}: ${fmtMonths(r.months!, r.approx)} behind, ${behindText(r)}`;

  // ── tooltip ──
  function place(el: Element, pid: string, i: number) {
    if (!wrap) return;
    const a = el.getBoundingClientRect();
    const b = wrap.getBoundingClientRect();
    tip = { pid, i, x: a.left + a.width / 2 - b.left, y: a.top + a.height / 2 - b.top };
  }
  function enter(e: Event, pid: string, i: number) {
    if (pinned) return;
    place(e.currentTarget as Element, pid, i);
  }
  function leave() {
    if (!pinned) tip = null;
  }
  function pin(e: Event, pid: string, i: number) {
    e.stopPropagation();
    const same = pinned && tip?.pid === pid && tip.i === i;
    place(e.currentTarget as Element, pid, i);
    pinned = !same;
    if (same) tip = null;
  }
  function key(e: KeyboardEvent, pid: string, i: number) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pin(e, pid, i);
    }
  }
  function close() {
    pinned = false;
    tip = null;
  }

  const tipStyle = $derived.by(() => {
    if (!tip) return '';
    const left = Math.max(4, Math.min(tip.x - tipW / 2, wrapW - tipW - 4));
    const above = tip.y - tipH - 16;
    const top = above >= -40 ? above : tip.y + 18;
    return `left:${left}px;top:${top}px`;
  });

  $effect(() => {
    const onDoc = (e: MouseEvent) => {
      if (pinned && !(e.target as Element).closest?.('.tip, .hit')) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('click', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  });

  // Filters change the lanes; drop a tooltip that points at a lane that may have moved.
  $effect(() => {
    void tech;
    void category;
    void sort;
    void view;
    close();
  });
</script>

<div class="controls">
  <div class="chip-row" role="group" aria-label="Technology">
    <button class="chip tech-chip t-usd" aria-pressed={tech === 'usd'} onclick={() => (tech = 'usd')}>
      <span class="dot" aria-hidden="true"></span>OpenUSD
    </button>
    <button class="chip tech-chip t-materialx" aria-pressed={tech === 'materialx'} onclick={() => (tech = 'materialx')}>
      <span class="dot" aria-hidden="true"></span>MaterialX
    </button>
    <span class="sep" aria-hidden="true"></span>
    <button class="chip" aria-pressed={view === 'chart'} onclick={() => (view = 'chart')}>Chart</button>
    <button class="chip" aria-pressed={view === 'table'} onclick={() => (view = 'table')}>Table</button>
  </div>
  <div class="chip-row" role="group" aria-label="Sort products">
    <span class="muted small">Sort by</span>
    <button class="chip" aria-pressed={sort === 'lag'} onclick={() => (sort = 'lag')}>Typical lag</button>
    <button class="chip" aria-pressed={sort === 'latest'} onclick={() => (sort = 'latest')}>Latest release</button>
    <button class="chip" aria-pressed={sort === 'name'} onclick={() => (sort = 'name')}>Name</button>
  </div>
  <div class="chip-row" role="group" aria-label="Category">
    <button class="chip" aria-pressed={category === 'all'} onclick={() => (category = 'all')}>All categories</button>
    {#each categories as c (c)}
      <button class="chip" aria-pressed={category === c} onclick={() => (category = c)}>{CATEGORY_LABEL[c] ?? c}</button>
    {/each}
  </div>
</div>

<ul class="stats" role="list">
  <li>
    <span class="label">Typical lag at ship</span>
    <strong>{typicalAll === null ? '–' : fmtMonths(typicalAll)}</strong>
    <span class="muted">median over {allPlotted.length} dated releases</span>
  </li>
  <li>
    <span class="label">Shipped the newest {techLabel}</span>
    <strong>{newestShare === null ? '–' : `${newestShare}%`}</strong>
    <span class="muted">of those releases had no newer upstream release out</span>
  </li>
  <li>
    <span class="label">Publish their {techLabel} version</span>
    <strong>{payload ? `${withData.length} of ${visible.length}` : '–'}</strong>
    <span class="muted">products{category === 'all' ? '' : ` in ${CATEGORY_LABEL[category] ?? category}`}</span>
  </li>
</ul>

{#if !payload}
  <div class="loading" aria-busy={!failed}>
    {#if failed}
      <p>Couldn't load the release data. <a href={dataUrl}>Download version-lag.json</a> instead.</p>
    {:else}
      <p class="muted">Loading releases…</p>
    {/if}
  </div>
{:else if view === 'chart'}
  <figure class={`chart t-${tech}`} aria-label={`${techLabel} version lag by product`}>
    <div class="legend" aria-hidden="true">
      <span class="key anatomy">
        <svg viewBox="0 0 64 22" width="64" height="22">
          <line x1="6" x2="6" y1="13" y2="21" class="up-tick" />
          <path d="M6,17C6,1 52,1 52,17" class="arc s1" />
          <circle cx="52" cy="17" r="4" class="end s1" />
        </svg>
        {techLabel} tag → product release
      </span>
      {#each BEHIND_STEPS as label, s (label)}
        <span class="key"><span class={`line-key s${s}`}></span>{label}</span>
      {/each}
    </div>

    <div class="wrap" bind:this={wrap} bind:clientWidth={wrapW}>
      <div class="row axis-row">
        <div class="plot" bind:clientWidth={plotW}>
          <svg width={plotW} height={AXIS_H} role="img" aria-label={`${techLabel} releases`}>
            <line x1="0" x2={plotW} y1={AXIS_H - 1} y2={AXIS_H - 1} class="baseline" />
            {#each ticks as u (u.version)}
              {@const px = x(Date.parse(u.date))}
              {@const on = focusVersion === u.version}
              <g
                class="tick"
                class:on
                role="presentation"
                onpointerenter={() => (hoverUp = u.version)}
                onpointerleave={() => (hoverUp = null)}
              >
                <line x1={px} x2={px} y1={u.major ? AXIS_H - 13 : AXIS_H - 7} y2={AXIS_H - 1} class="up-tick" />
                <rect x={px - 5} y="0" width="10" height={AXIS_H} fill="transparent" />
                {#if on || (tickLabels.has(u.version) && (focusX === null || Math.abs(px - focusX) >= 46))}
                  <text x={px} y="11" text-anchor="middle" class:strong={on}>{u.version}</text>
                {/if}
                <title>{techLabel} {u.version}, tagged {fmtDate(u.date)}</title>
              </g>
            {/each}
          </svg>
        </div>
      </div>

      {#each lanes as lane (lane.p.id)}
        <div class="row lane">
          <div class="lname">
            <a href={lane.p.href}>{lane.p.name}</a>
            <span class="muted cat">{CATEGORY_LABEL[lane.p.categories[0]] ?? lane.p.categories[0]}</span>
          </div>
          <div class="plot">
            <svg width={plotW} height={LANE_H} aria-label={`${lane.p.name} releases`} role="group">
              {#each years as y (y.y)}
                {#if y.x > 0 && y.x < plotW}<line x1={y.x} x2={y.x} y1="4" y2={BASE + 6} class="grid" />{/if}
              {/each}
              <line x1="0" x2={plotW} y1={BASE} y2={BASE} class="grid" />
              <line x1={x(nowT)} x2={x(nowT)} y1="4" y2={BASE + 6} class="now" />
              {#each lane.plotted as r, i (`${r.version}-${i}`)}
                {@const a = x(Date.parse(r.upstreamDate!))}
                {@const b = x(tOf(r.date!))}
                {@const s = behindStep(r.behind!)}
                {@const isActive = tip?.pid === lane.p.id && tip.i === i}
                {@const dim = hoverUp !== null && hoverUp !== r.bundled}
                <g class="rel" class:dim class:active={isActive}>
                  <line x1={a} x2={a} y1={BASE - 5} y2={BASE + 4} class="up-tick" />
                  {#if b > a + 1}<path d={arcPath(a, b, arcH(r.months!))} class={`arc s${s}`} />{/if}
                  <g
                    class="hit"
                    role="button"
                    tabindex="0"
                    aria-label={ariaFor(lane.p, r)}
                    onpointerenter={(e) => enter(e, lane.p.id, i)}
                    onpointerleave={leave}
                    onfocus={(e) => enter(e, lane.p.id, i)}
                    onblur={leave}
                    onclick={(e) => pin(e, lane.p.id, i)}
                    onkeydown={(e) => key(e, lane.p.id, i)}
                  >
                    <circle cx={b} cy={BASE} r="12" fill="transparent" />
                    <circle cx={b} cy={BASE} r={isActive ? 5.5 : 4.5} class={`end s${s}`} />
                  </g>
                </g>
              {/each}
            </svg>
          </div>
          <div class="lsum">
            <strong>{shortMonths(lane.typical)}</strong>
            <span class="muted">{lane.plotted.length > 1 ? 'typical' : 'one release'}</span>
            {#if lane.undated.length}<span class="muted undated-n">+{lane.undated.length} undated</span>{/if}
          </div>
        </div>
      {:else}
        <p class="muted empty">No dated releases with a published {techLabel} version in this category.</p>
      {/each}

      <div class="row axis-row bottom">
        <div class="plot">
          <svg width={plotW} height="22" aria-hidden="true">
            {#each years as y (y.y)}
              {#if y.mid > 16 && y.mid < plotW - 16 && Math.abs(y.mid - x(nowT)) > 44}<text x={y.mid} y="15" text-anchor="middle">{y.y}</text>{/if}
            {/each}
            {#if x(nowT) < plotW}<text x={Math.min(x(nowT), plotW - 2)} y="15" text-anchor="end" class="now-label">now</text>{/if}
          </svg>
        </div>
      </div>

      {#if tip && active}
        <div
          class="tip"
          class:pinned
          style={tipStyle}
          bind:offsetWidth={tipW}
          bind:offsetHeight={tipH}
          role={pinned ? 'dialog' : 'tooltip'}
          aria-label={`${active.p.name} ${active.r.version}`}
        >
          {#if pinned}<button class="close" onclick={close} aria-label="Close">×</button>{/if}
          <p class="tt-head">
            <span class={`line-key s${behindStep(active.r.behind!)}`} aria-hidden="true"></span>
            <span>{active.p.name} <strong>{active.r.version}</strong></span>
          </p>
          <p class="tt-value">
            <strong>{fmtMonths(active.r.months!, active.r.approx)}</strong> behind
          </p>
          <p class="tt-line muted">{behindText(active.r)}</p>
          <dl>
            <dt>Released</dt>
            <dd>{fmtDate(active.r.date)}{active.r.approx ? ' (month only)' : ''}</dd>
            <dt>Bundles</dt>
            <dd>
              {techLabel}
              {#if active.r.upstreamUrl}<a href={active.r.upstreamUrl} rel="noopener">{active.r.bundled}</a>{:else}{active.r.bundled}{/if},
              tagged {fmtDate(active.r.upstreamDate)}
            </dd>
          </dl>
          {#if active.r.notes}<p class="tt-notes muted">{active.r.notes}</p>{/if}
          {#if active.r.review}<p class="tt-flag">⚑ Flagged for review: {active.r.review}</p>{/if}
          <p class="tt-src">
            {#each active.r.sources as s, k (k)}<a href={s.url} rel="noopener">{s.title ?? host(s.url)}</a>{/each}
          </p>
          {#if !pinned}<p class="tt-hint muted">Click to pin and open sources</p>{/if}
        </div>
      {/if}
    </div>
  </figure>
{:else}
  <div class="table-wrap">
    <table>
      <caption class="visually-hidden">{techLabel} version bundled by each product release, and how far it trailed upstream</caption>
      <thead>
        <tr>
          <th scope="col">Product</th>
          <th scope="col">Release</th>
          <th scope="col">Released</th>
          <th scope="col">Bundles</th>
          <th scope="col">Tagged</th>
          <th scope="col" class="num">Months behind</th>
          <th scope="col" class="num">Newer releases out</th>
          <th scope="col">Sources</th>
        </tr>
      </thead>
      <tbody>
        {#each [...lanes.map((l) => l.p), ...withData.filter((p) => !lanes.some((l) => l.p.id === p.id))] as p (p.id)}
          {#each p.releases[tech] as r, i (`${r.version}-${i}`)}
            <tr>
              <th scope="row"><a href={p.href}>{p.name}</a></th>
              <td>{r.version}</td>
              <td>{fmtDate(r.date)}</td>
              <td>{r.bundled}</td>
              <td>{fmtDate(r.upstreamDate)}</td>
              <td class="num">{r.months === null ? '–' : shortMonths(Math.max(0, r.months))}</td>
              <td class="num">{r.behind ?? '–'}</td>
              <td class="srcs">
                {#each r.sources as s, k (k)}<a href={s.url} rel="noopener">{s.title ?? host(s.url)}</a>{/each}
              </td>
            </tr>
          {/each}
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if payload && view === 'chart' && undated.length}
  <section class="aside">
    <h3>Bundled version known, release date not sourced ({undated.length})</h3>
    <p class="muted">These releases state their {techLabel} version but we haven't sourced a release date, so they can't be placed in time.</p>
    <ul class="pills" role="list">
      {#each undated as { p, r }, i (`${p.id}-${r.version}-${i}`)}
        <li><a href={p.href}>{p.name} {r.version}</a> <span class="muted">→ {r.bundled}</span></li>
      {/each}
    </ul>
  </section>
{/if}

{#if payload}
<section class="aside">
  <h3>{techLabel} version not published ({notPublished.length})</h3>
  <p class="muted">
    None of the releases we've sourced for these products state which {techLabel} version they bundle or build against.
    That's unknown, not "none": the vendor may not say, or we haven't found where.
  </p>
  {#if notPublished.length}
    <ul class="pills" role="list">
      {#each notPublished as p (p.id)}
        <li><a href={p.href}>{p.name}</a></li>
      {/each}
    </ul>
  {/if}
</section>
{/if}

<style>
  .controls {
    display: grid;
    gap: 10px;
    margin: 20px 0 16px;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }
  .tech-chip .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 6px;
    background: var(--tc);
  }
  .t-usd {
    --tc: var(--usd);
  }
  .t-materialx {
    --tc: var(--mtlx);
  }

  .stats {
    list-style: none;
    padding: 0;
    margin: 0 0 16px;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
    gap: 10px;
  }
  .stats li {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 12px 16px;
    display: grid;
    gap: 2px;
  }
  .stats .label {
    font-size: 0.84rem;
    color: var(--text-muted);
  }
  .stats strong {
    font-size: 1.6rem;
    font-weight: 650;
    line-height: 1.2;
  }
  .stats .muted {
    font-size: 0.8rem;
  }

  .chart {
    margin: 0;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 14px 18px 10px;
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 16px;
    font-size: 0.8rem;
    color: var(--text-muted);
    margin-bottom: 8px;
  }
  .key {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .line-key {
    display: inline-block;
    width: 14px;
    height: 3px;
    border-radius: 2px;
    background: var(--k);
    flex: none;
  }
  .s0 {
    --k: var(--lag-0);
  }
  .s1 {
    --k: var(--lag-1);
  }
  .s2 {
    --k: var(--lag-2);
  }
  .s3 {
    --k: var(--lag-3);
  }

  .wrap {
    position: relative;
  }
  .row {
    display: grid;
    grid-template-columns: 168px minmax(0, 1fr) 84px;
    grid-template-areas: 'name plot sum';
    column-gap: 12px;
    align-items: center;
  }
  .plot {
    grid-area: plot;
    min-width: 0;
  }
  .plot svg {
    display: block;
    overflow: visible;
  }
  .lane {
    border-top: 1px solid var(--grid);
  }
  .lane:hover {
    background: color-mix(in srgb, var(--surface-2) 55%, transparent);
  }
  .lname {
    grid-area: name;
    display: flex;
    flex-direction: column;
    line-height: 1.25;
    min-width: 0;
  }
  .lname a {
    color: var(--text);
    font-weight: 600;
    font-size: 0.92rem;
    text-decoration: none;
  }
  .lname a:hover {
    text-decoration: underline;
  }
  .cat {
    font-size: 0.74rem;
  }
  .lsum {
    grid-area: sum;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
  }
  .lsum strong {
    font-size: 0.92rem;
  }
  .lsum .muted {
    font-size: 0.72rem;
  }
  .empty {
    padding: 24px 0;
  }
  .loading {
    min-height: 720px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 18px;
  }
  .loading p {
    margin: 0;
  }

  text {
    font-size: 11px;
    fill: var(--text-muted);
    font-variant-numeric: tabular-nums;
  }
  text.strong {
    fill: var(--text);
    font-weight: 650;
  }
  .baseline {
    stroke: var(--border);
  }
  .grid {
    stroke: var(--grid);
    stroke-width: 1;
  }
  .now {
    stroke: var(--text-muted);
    stroke-width: 1;
    opacity: 0.45;
  }
  .now-label {
    fill: var(--text-muted);
  }
  .up-tick {
    stroke: var(--tc);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .tick {
    cursor: default;
  }
  .tick.on .up-tick {
    stroke-width: 3;
  }
  .arc {
    fill: none;
    stroke: var(--k);
    stroke-width: 2;
    stroke-linecap: round;
  }
  .end {
    fill: var(--k);
    stroke: var(--surface);
    stroke-width: 2;
  }
  .rel {
    transition: opacity 120ms;
  }
  .rel.dim {
    opacity: 0.15;
  }
  .rel.active .arc {
    stroke-width: 3;
  }
  .hit {
    cursor: pointer;
    outline: none;
  }
  .hit:focus-visible .end {
    stroke: var(--text);
  }

  .anatomy svg {
    overflow: visible;
  }
  .anatomy .arc {
    stroke: var(--lag-1);
  }
  .anatomy .end {
    fill: var(--lag-1);
  }
  .anatomy .up-tick {
    stroke: var(--tc);
  }

  .tip {
    position: absolute;
    z-index: 5;
    width: min(300px, calc(100% - 8px));
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 6px 24px rgb(0 0 0 / 0.14);
    padding: 10px 12px;
    font-size: 0.84rem;
    line-height: 1.4;
    pointer-events: none;
  }
  .tip.pinned {
    pointer-events: auto;
  }
  .tip p {
    margin: 0;
  }
  .close {
    position: absolute;
    top: 4px;
    right: 6px;
    border: 0;
    background: none;
    color: var(--text-muted);
    font-size: 1.2rem;
    line-height: 1;
    cursor: pointer;
    padding: 4px;
  }
  .tt-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding-right: 18px;
  }
  .tt-value {
    margin-top: 4px !important;
  }
  .tt-value strong {
    font-size: 1.15rem;
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 8px 0 0;
  }
  dt {
    color: var(--text-muted);
  }
  dd {
    margin: 0;
  }
  .tt-notes {
    margin-top: 6px !important;
    font-size: 0.8rem;
    display: -webkit-box;
    -webkit-line-clamp: 4;
    line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .tt-flag {
    margin-top: 6px !important;
    font-size: 0.8rem;
  }
  .tt-src {
    margin-top: 8px !important;
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    font-size: 0.8rem;
  }
  .tt-src a,
  .srcs a {
    overflow-wrap: anywhere;
  }
  .tt-hint {
    margin-top: 6px !important;
    font-size: 0.74rem;
  }

  .table-wrap {
    overflow-x: auto;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
  }
  th,
  td {
    text-align: left;
    padding: 7px 10px;
    border-bottom: 1px solid var(--grid);
    vertical-align: top;
  }
  thead th {
    font-size: 0.78rem;
    color: var(--text-muted);
    font-weight: 600;
    white-space: nowrap;
  }
  tbody th {
    font-weight: 600;
    white-space: nowrap;
  }
  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .srcs {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    min-width: 160px;
  }

  .aside {
    margin-top: 24px;
  }
  .aside h3 {
    font-size: 1rem;
    margin: 0 0 4px;
  }
  .aside p {
    margin: 0 0 10px;
    font-size: 0.88rem;
    max-width: 75ch;
  }
  .pills {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .pills li {
    font-size: 0.84rem;
    border: 1px solid var(--border);
    background: var(--surface);
    border-radius: 999px;
    padding: 2px 10px;
  }
  .pills a {
    color: var(--text);
  }
  .small {
    font-size: 0.82rem;
    margin-right: 4px;
  }

  @media (max-width: 640px) {
    .stats {
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
    }
    .stats li {
      padding: 8px 10px;
      align-content: start;
    }
    .stats strong {
      font-size: 1.15rem;
      order: 2;
    }
    .stats .label {
      font-size: 0.72rem;
      line-height: 1.25;
      order: 1;
    }
    .stats .muted {
      display: none;
    }
    .chart {
      padding: 12px 12px 8px;
    }
    .row {
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'name sum'
        'plot plot';
      row-gap: 0;
    }
    .lane {
      padding-top: 6px;
    }
    .lname {
      flex-direction: row;
      align-items: baseline;
      gap: 6px;
    }
    .lsum {
      flex-direction: row;
      align-items: baseline;
      gap: 4px;
    }
    .undated-n {
      display: none;
    }
  }
</style>
