import type { APIRoute } from 'astro';
import { loadData } from '../lib/data';
import { withBase } from '../lib/url';
import { generatedFiles } from '../data/generated';

/** The curated dataset as one JSON file, plus links to the generated datasets. */
export const GET: APIRoute = async () => {
  const { products, projects, capabilities, events, nodeSupport } = await loadData();
  const body = {
    generated: new Date().toISOString(),
    license: 'See repository README',
    generatedDatasets: Object.fromEntries(
      Object.keys(generatedFiles).map((name) => [name, withBase(`data/${name}.json`)]),
    ),
    capabilities,
    products,
    projects,
    events,
    // Renderer-level MaterialX node support as written, with per-scope node counts. Resolve records against
    // materialx-nodes.json with the rules in src/data/node-support.ts for per-node cells.
    nodeSupport: nodeSupport.map(({ resolved, productName: _name, ...ns }) => ({
      ...ns,
      coverage: resolved.scopes.map((s) => ({ scope: s.id, materialx: resolved.latest, total: s.total, counts: s.counts })),
    })),
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
