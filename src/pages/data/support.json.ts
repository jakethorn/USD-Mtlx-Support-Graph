import type { APIRoute } from 'astro';
import { loadData } from '../../lib/data';
import { buildMatrix } from '../../lib/matrix';

/** Every product's capability levels plus its newest bundled USD/MaterialX versions. Used by /compare/. */
export const GET: APIRoute = async () => {
  const { products, projects, capabilities } = await loadData();
  return new Response(JSON.stringify(buildMatrix(products, projects, capabilities)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
