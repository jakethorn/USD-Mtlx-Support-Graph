/**
 * Types and accessors for the machine-generated data in data/generated/
 * (written by scripts/ingest/*.py, refreshed weekly). Never edit those files by hand.
 */
import materialxNodesJson from '../../data/generated/materialx-nodes.json';
import usdSchemasJson from '../../data/generated/usd-schemas.json';
import releasesJson from '../../data/generated/releases.json';
import githubStatsJson from '../../data/generated/github-stats.json';

// ── MaterialX ─────────────────────────────────────────────────────────────

export type MtlxSupport = 'native' | 'graph' | 'none';

export interface MtlxPort {
  name: string;
  type: string;
  default?: string;
  enum?: string;
  uniform?: boolean;
}

export interface MtlxNodeDef {
  name: string;
  outputs: MtlxPort[];
  inputs: MtlxPort[];
  /** null = present in the earliest tracked release */
  since: string | null;
  removedIn: string | null;
  /** target id → how MaterialX's own generator supports it */
  support: Record<string, MtlxSupport>;
  version?: string;
  isDefaultVersion?: boolean;
}

export interface MtlxNode {
  name: string;
  library: string;
  group: string | null;
  doc: string | null;
  since: string | null;
  removedIn: string | null;
  nodedefs: MtlxNodeDef[];
  coverage: Record<string, { native: number; graph: number; total: number }>;
}

export interface MaterialXNodes {
  source: string;
  note: string;
  versions: string[];
  latest: string;
  targets: { id: string; label: string; inherits: string | null }[];
  history: { version: string; nodedefs: number; nodes: number; supported: Record<string, number> }[];
  nodes: MtlxNode[];
}

// ── OpenUSD ───────────────────────────────────────────────────────────────

export interface UsdProperty {
  name: string;
  type: string;
  inherited?: boolean;
  since: string | null;
}

export interface UsdSchema {
  name: string;
  domain: string;
  kind: 'concrete' | 'abstract' | 'api';
  typeName?: string;
  apiType?: string;
  versionOf?: string;
  schemaVersion?: number;
  inherits: string | null;
  doc: string | null;
  since: string | null;
  removedIn: string | null;
  properties: UsdProperty[];
}

export interface UsdSchemas {
  source: string;
  note: string;
  versions: string[];
  latest: string;
  domains: { id: string; label: string }[];
  history: {
    version: string;
    schemas: number;
    concrete: number;
    api: number;
    properties: number;
    byDomain: Record<string, number>;
  }[];
  schemas: UsdSchema[];
}

// ── Releases & GitHub ─────────────────────────────────────────────────────

export interface UpstreamRelease {
  version: string;
  tag: string;
  date: string;
  kind: 'major' | 'patch';
  url: string;
}

export type Releases = Record<'usd' | 'materialx', { name: string; repo: string; releases: UpstreamRelease[] }>;

export interface RepoStats {
  fullName: string;
  url: string;
  description: string | null;
  stars: number;
  forks: number;
  openIssues: number;
  license: string | null;
  language: string | null;
  topics: string[];
  archived: boolean;
  createdAt: string;
  pushedAt: string | null;
  latestRelease: { tag: string; date: string } | null;
  /** Commits per week for the last 52 weeks, oldest first. */
  weeklyCommits: number[] | null;
}

export interface GithubStats {
  fetched: string;
  repos: Record<string, RepoStats>;
}

export const materialxNodes = materialxNodesJson as MaterialXNodes;
export const usdSchemas = usdSchemasJson as UsdSchemas;
export const releases = releasesJson as Releases;
export const githubStats = githubStatsJson as GithubStats;

/** File name → data, for the downloadable /data/<name>.json endpoints. */
export const generatedFiles = {
  'materialx-nodes': materialxNodes,
  'usd-schemas': usdSchemas,
  releases,
  'github-stats': githubStats,
} as const;
