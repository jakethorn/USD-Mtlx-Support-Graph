import type { APIRoute } from 'astro';
import { loadData } from '../lib/data';
import { withBase } from '../lib/url';

/**
 * sitemap.xml for search engines. (A robots.txt would have to live at the domain root, which a GitHub Pages
 * project site doesn't control, so submit this URL in Search Console instead.)
 */
export const GET: APIRoute = async ({ site }) => {
  const { products } = await loadData();
  const pages = ['', 'matrix/', 'compare/', 'versions/', 'nodes/', 'timeline/', 'ecosystem/', 'schemas/', 'review/'];
  const urls = [...pages.map((p) => withBase(p)), ...products.map((p) => withBase(`products/${p.id}/`))];
  const lastmod = new Date().toISOString().slice(0, 10);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${new URL(u, site).href}</loc><lastmod>${lastmod}</lastmod></url>`),
    '</urlset>',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
