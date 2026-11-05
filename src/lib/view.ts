/** Labels and orderings shared by the designed views (Phase 4). Pure data, safe to import from Svelte islands. */
import type { SUPPORT_LEVELS, TECHS } from '../data/schema';

export type Level = (typeof SUPPORT_LEVELS)[number];
export type Tech = (typeof TECHS)[number];

export const TECH_LABEL: Record<Tech, string> = { usd: 'OpenUSD', materialx: 'MaterialX' };

/** Strongest first. Used for sorting and for legends. */
export const LEVEL_ORDER: Level[] = ['native', 'plugin', 'partial', 'experimental', 'planned', 'deprecated', 'none'];

export const LEVEL_LABEL: Record<Level, string> = {
  native: 'Native',
  plugin: 'Plugin',
  partial: 'Partial',
  experimental: 'Experimental',
  planned: 'Planned',
  deprecated: 'Deprecated',
  none: 'Not supported',
};

/** Rough "how usable is it" weight, used only to rank products in the matrix. */
export const LEVEL_SCORE: Record<Level, number> = {
  native: 1,
  plugin: 0.85,
  partial: 0.5,
  experimental: 0.3,
  planned: 0,
  deprecated: 0.1,
  none: 0,
};

export const CATEGORY_LABEL: Record<string, string> = {
  dcc: 'DCC',
  renderer: 'Renderer',
  'game-engine': 'Game engine',
  viewer: 'Viewer',
  texturing: 'Texturing',
  lookdev: 'Look dev',
  compositing: 'Compositing',
  layout: 'Layout',
  pipeline: 'Pipeline',
  cad: 'CAD',
  aec: 'AEC',
  'xr-web': 'XR & web',
  platform: 'Platform',
  library: 'Library',
};

export const INDUSTRY_LABEL: Record<string, string> = {
  'film-tv': 'Film & TV',
  vfx: 'VFX',
  animation: 'Animation',
  games: 'Games',
  aec: 'AEC',
  'product-design': 'Product design',
  automotive: 'Automotive',
  manufacturing: 'Manufacturing',
  simulation: 'Simulation',
  xr: 'XR',
  web: 'Web',
};

export const capAnchor = (capId: string) => `cap-${capId.replaceAll('.', '-')}`;

// ── Props for the Svelte islands (kept here so .astro pages and islands share them) ──

export interface MatrixCell {
  level: Level;
  since?: string;
  via?: string;
  confidence: 'high' | 'medium' | 'low';
  flagged: boolean;
  notes?: string;
  gaps: string[];
}

export interface MatrixRow {
  id: string;
  name: string;
  vendor: string;
  href: string;
  categories: string[];
  industries: string[];
  tier: number;
  discontinued: boolean;
  cells: Record<string, MatrixCell>;
}

export interface MatrixCap {
  id: string;
  tech: Tech;
  group: string;
  label: string;
  description: string;
  anchor: string;
}

export interface TimelineItem {
  date: string;
  year: string;
  kind: 'milestone' | 'release' | 'adoption';
  /** Event kind (release/spec/organization/adoption/milestone) or 'product-release'/'first-support'. */
  subkind: string;
  tech: Tech[];
  title: string;
  description?: string;
  href?: string;
  product?: string;
  sources: { url: string; title?: string }[];
}

export interface ExplorerSchema {
  name: string;
  domain: string;
  kind: 'concrete' | 'abstract' | 'api';
  typeName?: string;
  inherits: string | null;
  since: string | null;
  removedIn: string | null;
  doc: string | null;
  ownProps: number;
  totalProps: number;
  sampleProps: string[];
}

export interface ExplorerNode {
  name: string;
  library: string;
  group: string | null;
  doc: string | null;
  since: string | null;
  removedIn: string | null;
  nodedefs: number;
  /** targetId → 'native' | 'graph' | 'partial' | 'none' */
  targets: Record<string, 'native' | 'graph' | 'partial' | 'none'>;
}
