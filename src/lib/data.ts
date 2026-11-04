/** Build-time data access shared by pages and endpoints. */
import { getCollection } from 'astro:content';
import type { Capability, Product, Project, TimelineEvent } from '../data/schema';
import { githubStats, type RepoStats } from '../data/generated';

export type ProductEntry = Product & { id: string; stats?: RepoStats };
export type ProjectEntry = Project & { id: string; stats?: RepoStats };

const statsFor = (repo: string | undefined) => (repo ? githubStats.repos[repo] : undefined);

export async function loadData() {
  const [productEntries, projectEntries, capabilityEntries, eventEntries] = await Promise.all([
    getCollection('products'),
    getCollection('projects'),
    getCollection('capabilities'),
    getCollection('events'),
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

  return { products, projects, capabilities, events };
}
