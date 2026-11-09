/** Build-time data access shared by pages and endpoints. */
import { getCollection } from 'astro:content';
import type { Capability, NodeSupport, Product, Project, TimelineEvent } from '../data/schema';
import { githubStats, materialxNodes, type RepoStats } from '../data/generated';
import { indexNodes, resolveNodeSupport, type NodeCell, type ResolvedNodeSupport } from '../data/node-support';

export type ProductEntry = Product & { id: string; stats?: RepoStats };
export type ProjectEntry = Project & { id: string; stats?: RepoStats };

/** data/node-support/<product>.yaml, plus its resolution against the MaterialX node library. */
export type NodeSupportEntry = NodeSupport & { product: string; productName: string; resolved: ResolvedNodeSupport };

/**
 * One column of a node table: a product scope (Karma XPU, Blender export…) with a cell per
 * MaterialX node it covers. Nodes missing from `nodes` are unknown.
 */
export interface NodeColumn {
  key: string;
  product: string;
  productName: string;
  scope: string;
  label: string;
  context: NodeSupport['scopes'][number]['context'];
  nodes: Record<string, NodeCell>;
  /** The sourced claims behind the cells: `claimFor(column, cell.ref)`. Plain data, so it can go to an island. */
  claims: ResolvedNodeSupport['claims'];
}

const statsFor = (repo: string | undefined) => (repo ? githubStats.repos[repo] : undefined);

export async function loadData() {
  const [productEntries, projectEntries, capabilityEntries, eventEntries, nodeSupportEntries] = await Promise.all([
    getCollection('products'),
    getCollection('projects'),
    getCollection('capabilities'),
    getCollection('events'),
    getCollection('nodeSupport'),
  ]);

  const products: ProductEntry[] = productEntries
    .map((e) => ({ id: e.id, ...e.data, stats: statsFor(e.data.repo) }))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  const projects: ProjectEntry[] = projectEntries
    .map((e) => ({ id: e.id, ...e.data, stats: statsFor(e.data.repo) }))
    .sort((a, b) => (b.stats?.stars ?? 0) - (a.stats?.stars ?? 0) || a.name.localeCompare(b.name));

  // Display order is the order of data/capabilities.yaml.
  const capabilities: Capability[] = capabilityEntries
    .sort((a, b) => a.data.order - b.data.order)
    .map(({ data: { order: _order, ...c } }) => c);

  // Chronological order from data/events.yaml.
  const events: TimelineEvent[] = eventEntries
    .sort((a, b) => a.data.date.localeCompare(b.data.date) || a.data.order - b.data.order)
    .map(({ data: { order: _order, ...e } }) => e);

  const nodeIndex = indexNodes(materialxNodes);
  const nodeSupport: NodeSupportEntry[] = nodeSupportEntries
    .map((e) => ({
      ...e.data,
      product: e.id,
      productName: products.find((p) => p.id === e.id)?.name ?? e.id,
      resolved: resolveNodeSupport(e.data, nodeIndex),
    }))
    .sort((a, b) => a.productName.localeCompare(b.productName));

  const nodeColumns: NodeColumn[] = nodeSupport.flatMap((ns) =>
    ns.resolved.scopes.map((s) => ({
      key: `${ns.product}/${s.id}`,
      product: ns.product,
      productName: ns.productName,
      scope: s.id,
      label: s.label,
      context: s.context,
      nodes: s.nodes,
      claims: ns.resolved.claims,
    })),
  );

  return { products, projects, capabilities, events, nodeSupport, nodeColumns };
}
