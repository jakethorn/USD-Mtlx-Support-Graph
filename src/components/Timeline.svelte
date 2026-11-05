<script lang="ts">
  /** Chronological view of milestones, upstream releases, product releases and first shipped support. */
  import { TECH_LABEL, type Tech, type TimelineItem } from '../lib/view';

  let { items }: { items: TimelineItem[] } = $props();

  type Kind = TimelineItem['kind'] | 'upstream';
  const KINDS: { id: Kind; label: string }[] = [
    { id: 'milestone', label: 'Milestones' },
    { id: 'adoption', label: 'First support in a product' },
    { id: 'release', label: 'Product releases' },
    { id: 'upstream', label: 'OpenUSD / MaterialX releases' },
  ];

  let tech = $state<'all' | Tech>('all');
  let kinds = $state<Kind[]>(['milestone', 'adoption']);
  let newestFirst = $state(true);

  const kindOf = (i: TimelineItem): Kind => (i.subkind === 'upstream' ? 'upstream' : i.kind);
  const toggle = (k: Kind) => (kinds = kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k]);

  const years = $derived.by(() => {
    const list = items.filter((i) => kinds.includes(kindOf(i)) && (tech === 'all' || i.tech.includes(tech)));
    const sorted = newestFirst ? list.toReversed() : list;
    const out: { year: string; items: TimelineItem[] }[] = [];
    for (const i of sorted) {
      if (out.at(-1)?.year !== i.year) out.push({ year: i.year, items: [] });
      out.at(-1)!.items.push(i);
    }
    return out;
  });
  const total = $derived(years.reduce((n, y) => n + y.items.length, 0));

  const fmtDate = (d: string) => {
    if (d.length === 4) return d;
    const [y, m, day] = d.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, day ?? 1)).toLocaleDateString('en', {
      month: 'short',
      ...(day ? { day: 'numeric' } : {}),
      timeZone: 'UTC',
    });
  };
</script>

<div class="controls">
  <div class="chip-row" role="group" aria-label="Technology">
    <button class="chip" aria-pressed={tech === 'all'} onclick={() => (tech = 'all')}>Both</button>
    <button class="chip" aria-pressed={tech === 'usd'} onclick={() => (tech = 'usd')}>OpenUSD</button>
    <button class="chip" aria-pressed={tech === 'materialx'} onclick={() => (tech = 'materialx')}>MaterialX</button>
    <span class="sep" aria-hidden="true"></span>
    <button class="chip" aria-pressed={newestFirst} onclick={() => (newestFirst = !newestFirst)}>
      {newestFirst ? 'Newest first' : 'Oldest first'}
    </button>
  </div>
  <div class="chip-row" role="group" aria-label="Show">
    {#each KINDS as k (k.id)}
      <button class={`chip k-${k.id}`} aria-pressed={kinds.includes(k.id)} onclick={() => toggle(k.id)}>
        <span class="dot" aria-hidden="true"></span>{k.label}
      </button>
    {/each}
    <span class="muted count">{total} entries</span>
  </div>
</div>

{#each years as y (y.year)}
  <section class="year">
    <h2>{y.year}</h2>
    <ol role="list">
      {#each y.items as i, n (`${i.date}-${i.title}-${n}`)}
        <li class={`item k-${kindOf(i)}`}>
          <span class="dot" aria-hidden="true"></span>
          <div>
            <p class="meta">
              <time datetime={i.date}>{fmtDate(i.date)}</time>
              {#each i.tech as t (t)}<span class={`tag t-${t}`}>{TECH_LABEL[t]}</span>{/each}
            </p>
            <p class="title">
              {#if i.href}<a href={i.href}>{i.title}</a>{:else}{i.title}{/if}
            </p>
            {#if i.description}<p class="desc muted">{i.description}</p>{/if}
            {#if i.sources.length}
              <p class="sources">
                {#each i.sources as s, k (k)}<a href={s.url} rel="noopener">{s.title ?? new URL(s.url).hostname}</a>{/each}
              </p>
            {/if}
          </div>
        </li>
      {/each}
    </ol>
  </section>
{:else}
  <p class="muted">Nothing matches these filters.</p>
{/each}

<style>
  .controls {
    display: grid;
    gap: 10px;
    margin: 20px 0 8px;
  }
  .sep {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 4px;
  }
  .count {
    margin-left: auto;
    font-size: 0.85rem;
  }
  .k-milestone {
    --k: var(--accent);
  }
  .k-adoption {
    --k: var(--level-native);
  }
  .k-release {
    --k: var(--level-plugin);
  }
  .k-upstream {
    --k: var(--text-muted);
  }
  .chip .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--k);
    margin-right: 6px;
  }
  .year {
    display: grid;
    grid-template-columns: 80px 1fr;
    gap: 0 20px;
    margin-top: 28px;
  }
  .year h2 {
    margin: 0;
    font-size: 1.4rem;
    font-variant-numeric: tabular-nums;
    position: sticky;
    top: 76px;
    align-self: start;
  }
  ol {
    list-style: none;
    margin: 0;
    padding: 0 0 0 18px;
    border-left: 2px solid var(--border);
  }
  .item {
    position: relative;
    display: flex;
    gap: 12px;
    padding: 6px 0 14px;
  }
  .item > .dot {
    position: absolute;
    left: -25px;
    top: 12px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--k);
    border: 2px solid var(--bg);
  }
  .item p {
    margin: 0;
  }
  .meta {
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 0.78rem;
    color: var(--text-muted);
  }
  .tag {
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid var(--tc);
    color: var(--tc);
    font-weight: 600;
  }
  .t-usd {
    --tc: var(--usd);
  }
  .t-materialx {
    --tc: var(--mtlx);
  }
  .title {
    font-weight: 600;
    margin-top: 2px !important;
  }
  .k-upstream .title,
  .k-release .title {
    font-weight: 500;
  }
  .title a {
    color: var(--text);
  }
  .desc {
    font-size: 0.9rem;
    margin-top: 4px !important;
    max-width: 75ch;
  }
  .sources {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: 0.78rem;
    margin-top: 4px !important;
  }
  @media (max-width: 640px) {
    .year {
      grid-template-columns: 1fr;
    }
    .year h2 {
      position: static;
      margin-bottom: 8px;
    }
  }
</style>
