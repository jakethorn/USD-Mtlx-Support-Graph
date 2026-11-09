/**
 * Resolves data/node-support/<product>.yaml against MaterialX's node library
 * (data/generated/materialx-nodes.json) into one cell per nodedef and per node, per scope.
 *
 * Pure functions with no Astro imports, so the validator (tsx) and the site share them.
 *
 * Rules:
 *  - A record selects nodedefs by library, group, node or nodedef. The most specific selector
 *    wins across records: nodedef (3) > node (2) > group (1) > library (0).
 *  - An exception always overrides its own record, and competes with other records at the
 *    rank of its own selector (or its record's, if higher).
 *  - Two records that select the same nodedef at the same rank with different levels are a
 *    conflict: the first one in the file wins and the validator reports an error.
 *  - Library, group and node selectors expand to the nodedefs that existed in the record's
 *    `materialx` release (default: the latest tracked release). `generator` keeps only the
 *    nodedefs that MaterialX generator implements.
 *  - A nodedef or node that no record covers is unknown: it gets no cell.
 */
import type { MtlxNode, MtlxNodeDef } from './generated';
import { SUPPORT_LEVELS, type NodeSupport, type NodeSupportScope, type Source } from './schema';

export type NodeLevel = (typeof SUPPORT_LEVELS)[number];
type Confidence = 'high' | 'medium' | 'low';

export const SELECTOR_RANK = { library: 0, group: 1, node: 2, nodedef: 3 } as const;

// ── MaterialX node index ──────────────────────────────────────────────────

/** Compares MaterialX versions numerically ("1.38.10" > "1.38.9"). */
export function compareMtlxVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Whether a node or nodedef is part of the library in MaterialX `version`. */
export const existsAt = (x: { since: string | null; removedIn: string | null }, version: string) =>
  (!x.since || compareMtlxVersions(x.since, version) <= 0) &&
  (!x.removedIn || compareMtlxVersions(x.removedIn, version) > 0);

export interface NodeIndex {
  latest: string;
  versions: string[];
  nodes: MtlxNode[];
  byName: Map<string, MtlxNode>;
  defs: Map<string, { node: MtlxNode; def: MtlxNodeDef }>;
  libraries: Set<string>;
  /** Both bare group names ("math") and library-qualified ones ("stdlib:math"). */
  groups: Set<string>;
}

export function indexNodes(data: { latest: string; versions: string[]; nodes: MtlxNode[] }): NodeIndex {
  const byName = new Map<string, MtlxNode>();
  const defs = new Map<string, { node: MtlxNode; def: MtlxNodeDef }>();
  const libraries = new Set<string>();
  const groups = new Set<string>();
  for (const node of data.nodes) {
    byName.set(node.name, node);
    libraries.add(node.library);
    if (node.group) {
      groups.add(node.group);
      groups.add(`${node.library}:${node.group}`);
    }
    for (const def of node.nodedefs) defs.set(def.name, { node, def });
  }
  return { latest: data.latest, versions: data.versions, nodes: data.nodes, byName, defs, libraries, groups };
}

// ── Selection ─────────────────────────────────────────────────────────────

export interface NodeSelector {
  libraries?: string[];
  groups?: string[];
  nodes?: string[];
  nodedefs?: string[];
}

export interface Selection {
  /** nodedef name → rank of the most specific selector that picked it */
  defs: Map<string, number>;
  /** Names in the selector that don't exist in materialx-nodes.json, as "kind name". */
  unknown: string[];
}

export function selectNodedefs(
  sel: NodeSelector,
  index: NodeIndex,
  { version = index.latest, generator }: { version?: string; generator?: string } = {},
): Selection {
  const defs = new Map<string, number>();
  const unknown: string[] = [];
  const add = (def: MtlxNodeDef, rank: number) => {
    if (generator && (def.support[generator] ?? 'none') === 'none') return;
    defs.set(def.name, Math.max(rank, defs.get(def.name) ?? -1));
  };
  const addNode = (node: MtlxNode, rank: number) => {
    for (const def of node.nodedefs) if (existsAt(def, version)) add(def, rank);
  };

  for (const lib of sel.libraries ?? []) {
    if (!index.libraries.has(lib)) unknown.push(`library ${lib}`);
    for (const node of index.nodes) if (node.library === lib) addNode(node, SELECTOR_RANK.library);
  }
  for (const ref of sel.groups ?? []) {
    if (!index.groups.has(ref)) unknown.push(`group ${ref}`);
    const [lib, group] = ref.includes(':') ? ref.split(':') : [undefined, ref];
    for (const node of index.nodes) {
      if (node.group === group && (!lib || node.library === lib)) addNode(node, SELECTOR_RANK.group);
    }
  }
  for (const name of sel.nodes ?? []) {
    const node = index.byName.get(name);
    if (node) addNode(node, SELECTOR_RANK.node);
    else unknown.push(`node ${name}`);
  }
  for (const name of sel.nodedefs ?? []) {
    const hit = index.defs.get(name);
    if (hit) add(hit.def, SELECTOR_RANK.nodedef);
    else unknown.push(`nodedef ${name}`);
  }
  return { defs, unknown };
}

// ── Resolution ────────────────────────────────────────────────────────────

/** Points at a record, or at one exception of it, in the node-support file. */
export interface NodeSupportRef {
  record: number;
  exception?: number;
}

/** A record or exception with the fields an exception inherits filled in. */
export interface NodeSupportClaim {
  ref: NodeSupportRef;
  level: NodeLevel;
  notes?: string;
  gaps: string[];
  sources: Source[];
  confidence: Confidence;
  verified: string;
  review?: string;
  /** Needs human review: its own or its record's `review`, or low confidence. */
  flagged: boolean;
}

export interface NodeDefCell {
  level: NodeLevel;
  rank: number;
  ref: NodeSupportRef;
}

export interface NodeCell {
  /** The level all covered type variants share, or the strongest one when they differ. */
  level: NodeLevel;
  /** Type variants differ in level, or some are unknown. */
  mixed: boolean;
  /** Type variants (in the latest release) with a cell, out of `total`. */
  covered: number;
  total: number;
  /** The claim behind `level`. */
  ref: NodeSupportRef;
  flagged: boolean;
}

export interface NodeConflict {
  scope: string;
  nodedef: string;
  first: NodeSupportRef;
  second: NodeSupportRef;
  levels: [NodeLevel, NodeLevel];
}

export interface ResolvedNodeScope extends NodeSupportScope {
  nodedefs: Record<string, NodeDefCell>;
  nodes: Record<string, NodeCell>;
  /** Nodes in the latest MaterialX release per level (and unknown). */
  counts: Partial<Record<NodeLevel | 'unknown', number>>;
  /** Nodes in the latest MaterialX release. */
  total: number;
}

export interface ResolvedNodeSupport {
  latest: string;
  scopes: ResolvedNodeScope[];
  /** Per record: its own claim and one per exception, inherited fields filled in. */
  claims: { record: NodeSupportClaim; except: NodeSupportClaim[] }[];
  conflicts: NodeConflict[];
}

export const claimFor = (r: Pick<ResolvedNodeSupport, 'claims'>, ref: NodeSupportRef): NodeSupportClaim =>
  ref.exception === undefined ? r.claims[ref.record].record : r.claims[ref.record].except[ref.exception];

const levelStrength = (l: NodeLevel) => SUPPORT_LEVELS.indexOf(l);

export function resolveNodeSupport(file: NodeSupport, index: NodeIndex): ResolvedNodeSupport {
  const claims = file.records.map((r, ri) => {
    const record: NodeSupportClaim = {
      ref: { record: ri },
      level: r.level,
      notes: r.notes,
      gaps: r.gaps,
      sources: r.sources,
      confidence: r.confidence,
      verified: r.verified,
      review: r.review,
      flagged: Boolean(r.review) || r.confidence === 'low',
    };
    const except = r.except.map((e, ei): NodeSupportClaim => {
      const confidence = e.confidence ?? r.confidence;
      return {
        ref: { record: ri, exception: ei },
        level: e.level,
        notes: e.notes,
        gaps: e.gaps,
        sources: e.sources ?? r.sources,
        confidence,
        verified: e.verified ?? r.verified,
        review: e.review,
        flagged: Boolean(e.review || r.review) || confidence === 'low',
      };
    });
    return { record, except };
  });

  const conflicts: NodeConflict[] = [];
  const latestNodes = index.nodes.filter((n) => existsAt(n, index.latest));

  const scopes = file.scopes.map((scope): ResolvedNodeScope => {
    const cells = new Map<string, NodeDefCell>();

    file.records.forEach((r, ri) => {
      if (r.scopes && !r.scopes.includes(scope.id)) return;
      const version = r.materialx ?? index.latest;
      const local = new Map<string, NodeDefCell>();
      for (const [def, rank] of selectNodedefs(r, index, { version, generator: r.generator }).defs) {
        local.set(def, { level: r.level, rank, ref: { record: ri } });
      }
      r.except.forEach((e, ei) => {
        for (const [def, rank] of selectNodedefs(e, index, { version }).defs) {
          local.set(def, { level: e.level, rank: Math.max(rank, local.get(def)?.rank ?? -1), ref: { record: ri, exception: ei } });
        }
      });
      for (const [def, cell] of local) {
        const prev = cells.get(def);
        if (!prev || cell.rank > prev.rank) cells.set(def, cell);
        else if (cell.rank === prev.rank && cell.level !== prev.level) {
          conflicts.push({ scope: scope.id, nodedef: def, first: prev.ref, second: cell.ref, levels: [prev.level, cell.level] });
        }
      }
    });

    const nodes: Record<string, NodeCell> = {};
    for (const node of index.nodes) {
      const current = node.nodedefs.filter((d) => existsAt(d, index.latest));
      const defs = current.length > 0 ? current : node.nodedefs;
      const covered = defs.map((d) => cells.get(d.name)).filter((c): c is NodeDefCell => c !== undefined);
      if (covered.length === 0) continue;
      const levels = [...new Set(covered.map((c) => c.level))].sort((a, b) => levelStrength(a) - levelStrength(b));
      const level = levels[0];
      const best = covered.filter((c) => c.level === level).sort((a, b) => b.rank - a.rank)[0];
      nodes[node.name] = {
        level,
        mixed: levels.length > 1 || covered.length < defs.length,
        covered: covered.length,
        total: defs.length,
        ref: best.ref,
        flagged: covered.some((c) => claimFor({ claims }, c.ref).flagged),
      };
    }

    const counts: ResolvedNodeScope['counts'] = {};
    for (const node of latestNodes) {
      const key = nodes[node.name]?.level ?? 'unknown';
      counts[key] = (counts[key] ?? 0) + 1;
    }

    return { ...scope, nodedefs: Object.fromEntries(cells), nodes, counts, total: latestNodes.length };
  });

  return { latest: index.latest, scopes, claims, conflicts };
}
