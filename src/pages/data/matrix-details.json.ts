import type { APIRoute } from 'astro';
import { loadData } from '../../lib/data';
import { matrixDetailKey, type MatrixDetail } from '../../lib/view';

/**
 * Notes and gaps for every matrix cell, keyed "<productId>|<capabilityId>". Kept out of the
 * matrix island's props so the page stays light; the island fetches this on first open.
 */
export const GET: APIRoute = async () => {
  const { products } = await loadData();
  const details: Record<string, MatrixDetail> = {};
  for (const p of products) {
    for (const s of p.support) {
      if (s.notes || s.gaps.length) details[matrixDetailKey(p.id, s.capability)] = { notes: s.notes, gaps: s.gaps };
    }
  }
  return new Response(JSON.stringify(details), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
