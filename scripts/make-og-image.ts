/**
 * Renders public/og.png (1200×630), the social preview card, from an SVG template.
 * The artwork on the right is a miniature of the real support matrix: one cell per product × capability,
 * coloured by support level (empty = unknown). Re-run after big data changes:
 *
 *   npm run og-image
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { parseDataYaml } from '../src/data/yaml.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const W = 1200;
const H = 630;

// Dark-theme tokens from src/styles/global.css.
const C = {
  bg: '#0e0f13',
  surface: '#16181e',
  border: '#2b2f39',
  text: '#ecedf1',
  muted: '#9a9eab',
  usd: '#f0904a',
  mtlx: '#3cc2b6',
  level: {
    native: '#2f9e5b',
    plugin: '#3a7bd5',
    partial: '#d39b22',
    experimental: '#8b5cd6',
    planned: '#7c8796',
    deprecated: '#9c6b4e',
    none: '#c94a4a',
  } as Record<string, string>,
};

type Cap = { id: string; tech: string };
type Product = { tier: number; name: string; support?: { capability: string; level: string }[] };

const caps = parseDataYaml(readFileSync(join(ROOT, 'data/capabilities.yaml'), 'utf8')) as Cap[];
const products = readdirSync(join(ROOT, 'data/products'))
  .filter((f) => f.endsWith('.yaml'))
  .map((f) => parseDataYaml(readFileSync(join(ROOT, 'data/products', f), 'utf8')) as Product)
  .filter((p) => (p.support ?? []).length > 0)
  .sort((a, b) => a.tier - b.tier || (b.support?.length ?? 0) - (a.support?.length ?? 0));

// Mini matrix geometry: fit every product × capability into the right-hand panel.
const panel = { x: 640, y: 70, w: 500, h: 490 };
const cell = Math.floor(Math.min(panel.w / caps.length, panel.h / products.length));
const gap = Math.max(1, Math.round(cell * 0.18));
const gridW = caps.length * cell;
const gridH = products.length * cell;
const gx = panel.x + (panel.w - gridW) / 2;
const gy = panel.y + (panel.h - gridH) / 2;
const usdCount = caps.filter((c) => c.tech === 'usd').length;

let cells = '';
products.forEach((p, r) => {
  const byCap = new Map((p.support ?? []).map((s) => [s.capability, s.level]));
  caps.forEach((c, i) => {
    const level = byCap.get(c.id);
    const x = gx + i * cell + (c.tech === 'usd' ? 0 : gap * 2);
    const y = gy + r * cell;
    const s = cell - gap;
    cells += level
      ? `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="1.5" fill="${C.level[level] ?? C.muted}"/>`
      : `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="1.5" fill="${C.surface}" stroke="${C.border}" stroke-width="0.6"/>`;
  });
});
const splitX = gx + usdCount * cell + gap / 2;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect x="${panel.x - 24}" y="${panel.y - 24}" width="${panel.w + 48}" height="${panel.h + 48}" rx="18" fill="${C.surface}" stroke="${C.border}"/>
  ${cells}
  <text x="${gx}" y="${gy - 10}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="600" fill="${C.usd}">OpenUSD</text>
  <text x="${splitX + gap * 2}" y="${gy - 10}" font-family="Segoe UI, Arial, sans-serif" font-size="15" font-weight="600" fill="${C.mtlx}">MaterialX</text>

  <circle cx="78" cy="98" r="15" fill="${C.usd}"/>
  <circle cx="96" cy="98" r="15" fill="${C.mtlx}" fill-opacity="0.9"/>
  <text x="124" y="106" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="700" fill="${C.text}">USD &amp; MaterialX Support Graph</text>

  <text font-family="Segoe UI, Arial, sans-serif" font-size="54" font-weight="800" fill="${C.text}">
    <tspan x="64" y="232">Who supports</tspan>
    <tspan x="64" y="298" fill="${C.usd}">OpenUSD</tspan><tspan dx="15" fill="${C.text}">and</tspan>
    <tspan x="64" y="364" fill="${C.mtlx}">MaterialX</tspan><tspan fill="${C.text}">, how well,</tspan>
    <tspan x="64" y="430">and since when?</tspan>
  </text>
  <text x="64" y="500" font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="${C.muted}">${products.length} products · ${caps.length} capabilities · every claim sourced</text>
  <text x="64" y="560" font-family="Segoe UI, Arial, sans-serif" font-size="20" fill="${C.muted}">jakethorn.github.io/USD-Mtlx-Support-Graph</text>
</svg>`;

const out = join(ROOT, 'public/og.png');
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(out);
console.log(`wrote public/og.png (${products.length} products × ${caps.length} capabilities, cell ${cell}px)`);
