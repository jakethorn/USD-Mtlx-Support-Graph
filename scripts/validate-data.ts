/**
 * Validates everything under /data: schemas, cross-references and data hygiene.
 *
 *   npm run validate          → errors fail the run, warnings are printed
 *   npm run review            → also lists every record that needs human review
 *
 * Astro's content collections validate schemas at build time too, but they can't check
 * cross-references (does `via: maya-usd` exist?) or editorial rules, and they're slower.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'astro/zod';
import { parseDataYaml } from '../src/data/yaml.ts';
import {
  capabilitySchema,
  eventSchema,
  idSchema,
  nodeSupportSchema,
  productSchema,
  projectSchema,
  SUPPORT_LEVELS,
  type Capability,
  type NodeSupport,
  type Product,
  type Project,
  type TimelineEvent,
} from '../src/data/schema.ts';
import type { MaterialXNodes } from '../src/data/generated.ts';
import {
  compareMtlxVersions,
  existsAt,
  indexNodes,
  resolveNodeSupport,
  selectNodedefs,
  type NodeSupportRef,
} from '../src/data/node-support.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const REVIEW_MODE = process.argv.includes('--review');
const STALE_AFTER_DAYS = 365;
const TODAY = new Date().toISOString().slice(0, 10);

type Problem = { file: string; where: string; message: string };
type ReviewItem = { file: string; what: string; reason: string };

const errors: Problem[] = [];
const warnings: Problem[] = [];
const reviewItems: ReviewItem[] = [];

const rel = (file: string) => relative(ROOT, file).replaceAll('\\', '/');

const readYaml = (file: string): unknown => parseDataYaml(readFileSync(file, 'utf8'));

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>(
    (acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)),
    '',
  );
}

function validate<S extends z.ZodType>(schema: S, data: unknown, file: string, prefix = ''): z.output<S> | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const path = formatPath(issue.path);
    const where = prefix && path && !path.startsWith('[') ? `${prefix}.${path}` : prefix + path;
    errors.push({ file, where: where || '(root)', message: issue.message });
  }
  return undefined;
}

function yamlFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => join(dir, f));
}

function daysSince(date: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return Math.floor((Date.parse(TODAY) - Date.parse(date)) / 86_400_000);
}

function checkDate(date: string | undefined, file: string, where: string, { stale = false } = {}) {
  if (!date) return;
  if (date > TODAY) errors.push({ file, where, message: `date ${date} is in the future` });
  const age = daysSince(date);
  if (stale && age !== undefined && age > STALE_AFTER_DAYS) {
    warnings.push({ file, where, message: `last verified ${age} days ago — re-check against sources` });
  }
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

function loadList<S extends z.ZodType>(file: string, schema: S): z.output<S>[] {
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = readYaml(file);
  } catch (e) {
    errors.push({ file: rel(file), where: '(parse)', message: (e as Error).message });
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push({ file: rel(file), where: '(root)', message: 'expected a YAML list' });
    return [];
  }
  return raw.flatMap((item, i) => {
    const parsed = validate(schema, item, rel(file), `[${i}]`);
    return parsed === undefined ? [] : [parsed];
  });
}

function loadDir<S extends z.ZodType>(dir: string, schema: S): Map<string, { file: string; data: z.output<S> }> {
  const out = new Map<string, { file: string; data: z.output<S> }>();
  for (const path of yamlFilesIn(dir)) {
    const file = rel(path);
    const id = path.split(/[\\/]/).pop()!.replace(/\.yaml$/, '');
    if (!idSchema.safeParse(id).success) {
      errors.push({ file, where: '(file name)', message: `"${id}" is not a kebab-case id` });
      continue;
    }
    let raw: unknown;
    try {
      raw = readYaml(path);
    } catch (e) {
      errors.push({ file, where: '(parse)', message: (e as Error).message });
      continue;
    }
    const data = validate(schema, raw, file);
    if (data !== undefined) out.set(id, { file, data });
  }
  return out;
}

/** data/generated/*.json, written by scripts/ingest. Missing files are an error: the site imports them. */
function readGenerated<T>(name: string): T | undefined {
  const file = join(DATA, 'generated', name);
  if (!existsSync(file)) {
    errors.push({ file: rel(file), where: '(file)', message: 'missing: run `npm run ingest`' });
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (e) {
    errors.push({ file: rel(file), where: '(parse)', message: (e as Error).message });
    return undefined;
  }
}

type ReleasesFile = Record<'usd' | 'materialx', { releases: { version: string }[] }>;
const generated = {
  releases: readGenerated<ReleasesFile>('releases.json'),
  githubStats: readGenerated<{ repos: Record<string, unknown> }>('github-stats.json'),
  materialxNodes: readGenerated<MaterialXNodes>('materialx-nodes.json'),
  usdSchemas: readGenerated<{ latest: string }>('usd-schemas.json'),
};
const knownUsdVersions = new Set(generated.releases?.usd.releases.map((r) => r.version));
const knownMtlxVersions = new Set(generated.releases?.materialx.releases.map((r) => r.version));

const capabilitiesFile = join(DATA, 'capabilities.yaml');
const capabilities: Capability[] = loadList(capabilitiesFile, capabilitySchema);
const products = loadDir(join(DATA, 'products'), productSchema) as Map<string, { file: string; data: Product }>;
const projects = loadDir(join(DATA, 'projects'), projectSchema) as Map<string, { file: string; data: Project }>;
const events: TimelineEvent[] = loadList(join(DATA, 'events.yaml'), eventSchema);
const nodeSupport = loadDir(join(DATA, 'node-support'), nodeSupportSchema) as Map<string, { file: string; data: NodeSupport }>;

// ---------------------------------------------------------------------------
// Cross-reference & hygiene checks
// ---------------------------------------------------------------------------

const capabilityIds = new Set<string>();
for (const c of capabilities) {
  if (capabilityIds.has(c.id)) errors.push({ file: rel(capabilitiesFile), where: c.id, message: 'duplicate capability id' });
  capabilityIds.add(c.id);
  const prefix = c.id.split('.')[0];
  if ((prefix === 'usd') !== (c.tech === 'usd')) {
    errors.push({ file: rel(capabilitiesFile), where: c.id, message: `id prefix "${prefix}" does not match tech "${c.tech}"` });
  }
}

for (const id of projects.keys()) {
  if (products.has(id)) errors.push({ file: projects.get(id)!.file, where: '(file name)', message: `id "${id}" is also a product id` });
}

const knownCapability = (id: string | undefined, file: string, where: string) => {
  if (id && !capabilityIds.has(id)) errors.push({ file, where, message: `unknown capability "${id}" (see data/capabilities.yaml)` });
};
const knownProducts = (ids: string[] | undefined, file: string, where: string) => {
  for (const id of ids ?? []) if (!products.has(id)) errors.push({ file, where, message: `unknown product "${id}"` });
};

let supportCount = 0;
let sourceCount = 0;

for (const [productId, { file, data: p }] of products) {
  const versions = new Set<string>();
  p.releases.forEach((r, i) => {
    const where = `releases[${i}]`;
    if (versions.has(r.version)) errors.push({ file, where, message: `duplicate release "${r.version}"` });
    versions.add(r.version);
    checkDate(r.date, file, `${where}.date`);
    r.sources.forEach((s, j) => checkDate(s.accessed, file, `${where}.sources[${j}].accessed`));
    if (r.usd && knownUsdVersions.size && !knownUsdVersions.has(r.usd)) {
      warnings.push({ file, where: `${where}.usd`, message: `"${r.usd}" is not a known OpenUSD release (data/generated/releases.json)` });
    }
    if (r.materialx && knownMtlxVersions.size && !knownMtlxVersions.has(r.materialx)) {
      warnings.push({ file, where: `${where}.materialx`, message: `"${r.materialx}" is not a known MaterialX release (data/generated/releases.json)` });
    }
    sourceCount += r.sources.length;
    if (r.review) reviewItems.push({ file, what: `${p.name} ${r.version} release`, reason: r.review });
  });

  const seen = new Set<string>();
  p.support.forEach((s, i) => {
    const where = `support[${i}] (${s.capability})`;
    supportCount++;
    sourceCount += s.sources.length;
    knownCapability(s.capability, file, where);
    knownProducts(s.hosts, file, `${where}.hosts`);
    if (s.via && !products.has(s.via) && !projects.has(s.via)) {
      errors.push({ file, where: `${where}.via`, message: `unknown product or project "${s.via}"` });
    }
    if (s.via === productId) errors.push({ file, where: `${where}.via`, message: 'a product cannot provide support via itself' });
    if (s.level === 'plugin' && !s.via) warnings.push({ file, where, message: 'plugin-level support should name the plugin in `via`' });

    const key = [s.capability, [...(s.hosts ?? [])].sort().join('+'), s.since ?? ''].join('|');
    if (seen.has(key)) errors.push({ file, where, message: 'duplicate support record (same capability, hosts and since)' });
    seen.add(key);

    checkDate(s.verified, file, `${where}.verified`, { stale: true });
    s.sources.forEach((src, j) => checkDate(src.accessed, file, `${where}.sources[${j}].accessed`));

    if (s.review) reviewItems.push({ file, what: `${p.name} · ${s.capability}`, reason: s.review });
    else if (s.confidence === 'low') reviewItems.push({ file, what: `${p.name} · ${s.capability}`, reason: 'low confidence' });
  });

  p.issues.forEach((issue, i) => {
    const where = `issues[${i}]`;
    knownCapability(issue.capability, file, `${where}.capability`);
    checkDate(issue.verified, file, `${where}.verified`, { stale: true });
    if (issue.review) reviewItems.push({ file, what: `${p.name} issue: ${issue.title}`, reason: issue.review });
  });
}

const missingStats = (repo: string | undefined, file: string) => {
  if (repo && generated.githubStats && !(repo in generated.githubStats.repos)) {
    warnings.push({ file, where: 'repo', message: `no GitHub stats for ${repo} yet: run \`npm run ingest:github\`` });
  }
};
for (const [, { file, data: p }] of products) missingStats(p.repo, file);

for (const [, { file, data: proj }] of projects) {
  missingStats(proj.repo, file);
  knownProducts(proj.hosts, file, 'hosts');
  checkDate(proj.verified, file, 'verified', { stale: true });
  sourceCount += proj.sources.length;
  if (proj.review) reviewItems.push({ file, what: proj.name, reason: proj.review });
}

const eventIds = new Set<string>();
for (const e of events) {
  const file = 'data/events.yaml';
  if (eventIds.has(e.id)) errors.push({ file, where: e.id, message: 'duplicate event id' });
  eventIds.add(e.id);
  checkDate(e.date, file, `${e.id}.date`);
  sourceCount += e.sources.length;
  if (e.review) reviewItems.push({ file, what: `event: ${e.title}`, reason: e.review });
}

// ---------------------------------------------------------------------------
// MaterialX node support (data/node-support/<product-id>.yaml)
// ---------------------------------------------------------------------------

let nodeRecordCount = 0;
const nodeCoverage: string[] = [];
const nodeIndex = generated.materialxNodes ? indexNodes(generated.materialxNodes) : undefined;
const earliestMtlx = generated.materialxNodes?.versions[0];
const describeRef = (ref: NodeSupportRef) =>
  `records[${ref.record}]` + (ref.exception === undefined ? '' : `.except[${ref.exception}]`);
const selectorLabel = (s: { libraries?: string[]; groups?: string[]; nodes?: string[]; nodedefs?: string[] }) => {
  const names = [...(s.libraries ?? []), ...(s.groups ?? []), ...(s.nodes ?? []), ...(s.nodedefs ?? [])];
  return names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4}` : '');
};

for (const [productId, { file, data: ns }] of nodeSupport) {
  const productName = products.get(productId)?.data.name ?? productId;
  if (!products.has(productId)) {
    errors.push({ file, where: '(file name)', message: `"${productId}" is not a product id (data/products/${productId}.yaml)` });
  }

  const scopeIds = new Set<string>();
  ns.scopes.forEach((scope, i) => {
    if (scopeIds.has(scope.id)) errors.push({ file, where: `scopes[${i}]`, message: `duplicate scope id "${scope.id}"` });
    scopeIds.add(scope.id);
    knownProducts(scope.hosts, file, `scopes[${i}].hosts`);
  });

  ns.records.forEach((r, i) => {
    const where = `records[${i}]`;
    const label = `${productName} · MaterialX nodes${r.scopes ? ` (${r.scopes.join(', ')})` : ''} · ${selectorLabel(r)}`;
    nodeRecordCount++;
    sourceCount += r.sources.length;

    for (const id of r.scopes ?? []) {
      if (!scopeIds.has(id)) errors.push({ file, where: `${where}.scopes`, message: `unknown scope "${id}" (define it under scopes:)` });
    }
    if (r.materialx) {
      if (knownMtlxVersions.size && !knownMtlxVersions.has(r.materialx)) {
        warnings.push({ file, where: `${where}.materialx`, message: `"${r.materialx}" is not a known MaterialX release` });
      }
      if (earliestMtlx && compareMtlxVersions(r.materialx, earliestMtlx) < 0) {
        warnings.push({
          file,
          where: `${where}.materialx`,
          message: `older than the earliest tracked release (${earliestMtlx}), so nodes removed before it are missing`,
        });
      }
    } else if (r.libraries || r.groups) {
      warnings.push({
        file,
        where,
        message: `library/group selector without \`materialx\` expands against the latest release (${nodeIndex?.latest ?? '?'})`,
      });
    }

    checkDate(r.verified, file, `${where}.verified`, { stale: true });
    r.sources.forEach((src, j) => checkDate(src.accessed, file, `${where}.sources[${j}].accessed`));
    if (r.review) reviewItems.push({ file, what: label, reason: r.review });
    else if (r.confidence === 'low') reviewItems.push({ file, what: label, reason: 'low confidence' });

    if (nodeIndex) {
      const version = r.materialx ?? nodeIndex.latest;
      const sel = selectNodedefs(r, nodeIndex, { version, generator: r.generator });
      for (const u of sel.unknown) errors.push({ file, where, message: `unknown MaterialX ${u} (not in data/generated/materialx-nodes.json)` });
      if (sel.unknown.length === 0 && sel.defs.size === 0) {
        errors.push({ file, where, message: `selects no nodedefs in MaterialX ${version}${r.generator ? ` with generator ${r.generator}` : ''}` });
      }
      const missingAt = (names: string[] | undefined, w: string) => {
        for (const name of names ?? []) {
          const node = nodeIndex.byName.get(name);
          if (node && !node.nodedefs.some((d) => existsAt(d, version))) {
            warnings.push({ file, where: w, message: `node "${name}" is not in MaterialX ${version}, so this selects nothing for it` });
          }
        }
      };
      missingAt(r.nodes, `${where}.nodes`);
      // Exceptions should carve nodes out of their record (ignoring the generator filter).
      const parentDefs = selectNodedefs(r, nodeIndex, { version }).defs;
      r.except.forEach((e, j) => {
        missingAt(e.nodes, `${where}.except[${j}].nodes`);
        const esel = selectNodedefs(e, nodeIndex, { version });
        for (const u of esel.unknown) {
          errors.push({ file, where: `${where}.except[${j}]`, message: `unknown MaterialX ${u} (not in data/generated/materialx-nodes.json)` });
        }
        if (esel.unknown.length === 0 && ![...esel.defs.keys()].some((d) => parentDefs.has(d))) {
          warnings.push({ file, where: `${where}.except[${j}]`, message: 'exception selects no nodes that its record covers' });
        }
      });
    }

    r.except.forEach((e, j) => {
      const ewhere = `${where}.except[${j}]`;
      if (e.level === r.level && !e.notes && e.gaps.length === 0) {
        warnings.push({ file, where: ewhere, message: "exception has its record's level and no notes: drop it or say how it differs" });
      }
      checkDate(e.verified, file, `${ewhere}.verified`, { stale: true });
      e.sources?.forEach((src, k) => checkDate(src.accessed, file, `${ewhere}.sources[${k}].accessed`));
      sourceCount += e.sources?.length ?? 0;
      const ename = `${productName} · MaterialX nodes${r.scopes ? ` (${r.scopes.join(', ')})` : ''} · except ${selectorLabel(e)}`;
      if (e.review) reviewItems.push({ file, what: ename, reason: e.review });
      else if (e.confidence === 'low' && !r.review) reviewItems.push({ file, what: ename, reason: 'low confidence' });
    });
  });

  // Overlapping records at the same specificity must agree; otherwise the file order decides silently.
  if (nodeIndex && ns.records.every((r) => (r.scopes ?? []).every((id) => scopeIds.has(id)))) {
    const grouped = new Map<string, { first: NodeSupportRef; second: NodeSupportRef; scope: string; levels: string[]; defs: string[] }>();
    const resolved = resolveNodeSupport(ns, nodeIndex);
    for (const s of resolved.scopes) {
      const parts = SUPPORT_LEVELS.filter((level) => s.counts[level]).map((level) => `${s.counts[level]} ${level}`);
      nodeCoverage.push(
        `- **${productName} · ${s.label}** (${s.context}): ${parts.join(' · ') || 'nothing'} · ` +
          `${s.counts.unknown ?? 0} unknown, of ${s.total} nodes in MaterialX ${resolved.latest}`,
      );
    }
    for (const c of resolved.conflicts) {
      const key = `${c.scope}|${describeRef(c.first)}|${describeRef(c.second)}`;
      const g = grouped.get(key) ?? { first: c.first, second: c.second, scope: c.scope, levels: c.levels, defs: [] };
      g.defs.push(c.nodedef);
      grouped.set(key, g);
    }
    for (const g of grouped.values()) {
      const more = g.defs.length > 1 ? ` and ${g.defs.length - 1} more` : '';
      errors.push({
        file,
        where: describeRef(g.second),
        message:
          `conflicts with ${describeRef(g.first)} in scope "${g.scope}" (${g.levels[0]} vs ${g.levels[1]}) ` +
          `for ${g.defs[0]}${more}: make one selector more specific or use an exception`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const print = (label: string, list: Problem[]) => {
  for (const p of list) console.log(`${label} ${p.file} › ${p.where}: ${p.message}`);
};

print('✖', errors);
print('⚠', warnings);

if (REVIEW_MODE && nodeCoverage.length > 0) {
  console.log(`\n## MaterialX node coverage (${nodeCoverage.length} scopes)\n`);
  for (const line of nodeCoverage) console.log(line);
}

if (REVIEW_MODE) {
  console.log(`\n## Needs review (${reviewItems.length})\n`);
  if (reviewItems.length === 0) console.log('Nothing flagged.');
  for (const r of reviewItems) console.log(`- **${r.what}** — ${r.reason} (${r.file})`);
}

console.log(
  `\n${capabilities.length} capabilities · ${products.size} products · ${supportCount} support records · ` +
    `${projects.size} projects · ${nodeSupport.size} node-support files (${nodeRecordCount} records) · ` +
    `${events.length} events · ${sourceCount} sources · ` +
    `${reviewItems.length} flagged for review`,
);
console.log(
  `generated: OpenUSD ${generated.usdSchemas?.latest ?? '?'} schemas · MaterialX ${generated.materialxNodes?.latest ?? '?'} nodes · ` +
    `${knownUsdVersions.size} USD / ${knownMtlxVersions.size} MaterialX releases · ` +
    `${Object.keys(generated.githubStats?.repos ?? {}).length} repos with GitHub stats`,
);
console.log(`${errors.length} error(s), ${warnings.length} warning(s)`);

process.exit(errors.length > 0 ? 1 : 0);
