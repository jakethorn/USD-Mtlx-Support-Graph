import type { APIRoute } from 'astro';
import { loadData } from '../lib/data';

/** The whole dataset as one JSON file, for anyone who wants to reuse it. */
export const GET: APIRoute = async () => {
  const { products, capabilities } = await loadData();
  const body = {
    generated: new Date().toISOString(),
    license: 'See repository README',
    capabilities,
    products,
  };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
