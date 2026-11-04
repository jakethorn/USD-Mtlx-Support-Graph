/** Build-time data access shared by pages and endpoints. */
import { getCollection } from 'astro:content';
import type { Capability, Product } from '../data/schema';

export type ProductEntry = Product & { id: string };

export async function loadData() {
  const [productEntries, capabilityEntries] = await Promise.all([
    getCollection('products'),
    getCollection('capabilities'),
  ]);

  const products: ProductEntry[] = productEntries
    .map((e) => ({ id: e.id, ...e.data }))
    .sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));

  // Display order is the order of data/capabilities.yaml.
  const capabilities: Capability[] = capabilityEntries
    .sort((a, b) => a.data.order - b.data.order)
    .map(({ data: { order: _order, ...c } }) => c);

  return { products, capabilities };
}
