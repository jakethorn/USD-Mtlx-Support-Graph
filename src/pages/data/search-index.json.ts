import type { APIRoute } from 'astro';
import { loadData } from '../../lib/data';
import { withBase } from '../../lib/url';
import { materialxNodes, usdSchemas } from '../../data/generated';
import { CATEGORY_LABEL, TECH_LABEL, type SearchEntry } from '../../lib/view';

/**
 * Everything the Ctrl+K palette can find: pages, products, capabilities, projects, OpenUSD schemas and
 * MaterialX nodes. Fetched by the palette the first time it opens.
 */
export const GET: APIRoute = async () => {
  const { products, projects, capabilities } = await loadData();
  const entries: SearchEntry[] = [];
  const add = (e: Omit<SearchEntry, 'terms'>, extra: (string | null | undefined)[] = []) =>
    entries.push({ ...e, terms: [e.title, e.sub, ...extra].filter(Boolean).join(' ').toLowerCase() });

  const pages: [string, string, string][] = [
    ['Overview', '', 'home start'],
    ['Support matrix', 'matrix/', 'grid table capabilities products'],
    ['Version lag', 'versions/', 'versions bundled behind upstream releases'],
    ['MaterialX node table', 'nodes/', 'nodes periodic table generators glsl osl mdl msl slang'],
    ['Timeline', 'timeline/', 'history milestones releases adoption'],
    ['Open-source ecosystem', 'ecosystem/', 'projects github plugins libraries'],
    ['Schemas & nodes explorer', 'schemas/', 'usd schemas prim types api'],
    ['Needs review', 'review/', 'flagged uncertain'],
    ['Download the data', 'data.json', 'json export api download'],
  ];
  for (const [title, path, keywords] of pages) add({ kind: 'page', title, href: withBase(path) }, [keywords]);

  for (const p of products) {
    add(
      {
        kind: 'product',
        title: p.name,
        sub: [p.vendor, ...p.categories.map((c) => CATEGORY_LABEL[c] ?? c)].join(' · '),
        href: withBase(`products/${p.id}/`),
      },
      [p.id, p.status === 'discontinued' ? 'discontinued' : null],
    );
  }

  for (const c of capabilities) {
    add(
      { kind: 'capability', title: c.label, sub: `${TECH_LABEL[c.tech]} · ${c.group}`, href: withBase(`matrix/?tech=${c.tech}`) },
      [c.id, c.description],
    );
  }

  for (const p of projects) {
    const href = p.stats?.url ?? p.url ?? (p.repo ? `https://github.com/${p.repo}` : withBase('ecosystem/'));
    add({ kind: 'project', title: p.name, sub: p.description, href, external: href.startsWith('http') }, [
      p.repo,
      p.kind,
      ...p.tags,
    ]);
  }

  for (const s of usdSchemas.schemas.filter((s) => !s.removedIn)) {
    const domain = usdSchemas.domains.find((d) => d.id === s.domain)?.label ?? s.domain;
    add(
      {
        kind: 'schema',
        title: s.typeName ?? s.name,
        sub: `OpenUSD ${s.kind === 'api' ? 'API schema' : s.kind === 'concrete' ? 'prim type' : 'abstract schema'} · ${domain}`,
        href: withBase(`schemas/?q=${encodeURIComponent(s.name)}`),
      },
      [s.name, s.domain],
    );
  }

  for (const n of materialxNodes.nodes.filter((n) => !n.removedIn)) {
    add(
      {
        kind: 'node',
        title: n.name,
        sub: `MaterialX node · ${n.library}${n.group ? ` · ${n.group}` : ''}`,
        href: withBase(`nodes/?node=${encodeURIComponent(n.name)}`),
      },
      [n.doc],
    );
  }

  return new Response(JSON.stringify(entries), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
