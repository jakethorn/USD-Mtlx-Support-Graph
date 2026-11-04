/**
 * Data schemas for everything under /data.
 *
 * Shared by the Astro content collections (src/content.config.ts) and the standalone
 * validator (scripts/validate-data.ts), so a record that passes `npm run validate`
 * also builds.
 *
 * Ground rules encoded here:
 *  - Every claim carries at least one source with the date it was checked.
 *  - "Support" is never a yes/no: it is a level for one capability of one product.
 *  - Absence of a record means "unknown". There is no "unknown" level.
 *  - Version numbers are strings. Quote them in YAML ("24.10", not 24.10 → 24.1).
 */
import { z } from 'astro/zod';

// ---------------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------------

export const TECHS = ['usd', 'materialx'] as const;

export const SUPPORT_LEVELS = [
  'native', // built in, maintained by the vendor
  'plugin', // via an official or widely used plugin (see `via`)
  'partial', // works, with significant documented gaps
  'experimental', // shipped behind a flag / labelled beta
  'planned', // publicly announced, not shipped
  'deprecated', // existed, being removed or no longer maintained
  'none', // explicitly not supported (still needs a source)
] as const;

export const CONFIDENCE = [
  'high', // official docs, release notes, source code
  'medium', // vendor staff posts, conference talks, vendor blog
  'low', // community reports, indirect evidence
] as const;

export const SOURCE_KINDS = [
  'docs',
  'release-notes',
  'repo',
  'issue',
  'forum',
  'talk',
  'blog',
  'news',
  'other',
] as const;

export const PRODUCT_CATEGORIES = [
  'dcc', // general 3D content creation
  'renderer',
  'game-engine',
  'viewer',
  'texturing',
  'lookdev',
  'compositing',
  'layout', // scene assembly / USD composition tools
  'pipeline', // asset management, review, publishing
  'cad',
  'aec',
  'xr-web',
  'platform', // e.g. simulation / digital-twin platforms
  'library', // SDKs a product is built on
] as const;

export const INDUSTRIES = [
  'film-tv',
  'vfx',
  'animation',
  'games',
  'aec',
  'product-design',
  'automotive',
  'manufacturing',
  'simulation',
  'xr',
  'web',
] as const;

export const LICENSES = ['commercial', 'free', 'open-source', 'source-available', 'mixed'] as const;

export const PROJECT_KINDS = [
  'library',
  'plugin',
  'tool',
  'viewer',
  'converter',
  'renderer',
  'sample-assets',
  'learning',
  'spec',
] as const;

export const EVENT_KINDS = ['release', 'spec', 'organization', 'adoption', 'milestone'] as const;

export const ISSUE_STATUSES = ['open', 'fixed', 'wontfix', 'unknown'] as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** kebab-case id, also used as the file name (houdini.yaml → houdini). */
export const idSchema = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'ids are kebab-case: lowercase letters, digits and dashes');

/** Dotted capability id, e.g. `usd.composition.variants`. */
export const capabilityIdSchema = z.string().regex(/^(usd|mtlx)(\.[a-z0-9_]+)+$/, 'capability ids look like usd.import or mtlx.openpbr');

/**
 * YYYY, YYYY-MM or YYYY-MM-DD. Accepts the Date objects the YAML timestamp tag produces
 * and normalises everything to a string, so Astro and the validator agree.
 */
export const isoDateSchema = z.preprocess(
  (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v),
  z.string().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/, 'dates are YYYY, YYYY-MM or YYYY-MM-DD'),
);

const versionHint = 'versions are quoted strings, e.g. "24.08" (unquoted 24.10 becomes the number 24.1)';

/** A product's own version, e.g. "20.5", "2025.1", "5.4". */
export const versionSchema = z.string({ error: versionHint }).min(1);

/** OpenUSD release, e.g. "24.08", "25.05.01" or a lettered hotfix like "25.02a". */
export const usdVersionSchema = z
  .string({ error: versionHint })
  .regex(/^\d{2}\.\d{2}(\.\d{1,2})?[a-z]?$/, 'USD versions look like "24.08", "25.05.01" or "25.02a"');

/** MaterialX release, e.g. "1.39.3". */
export const mtlxVersionSchema = z
  .string({ error: versionHint })
  .regex(/^\d+\.\d+(\.\d+){0,2}$/, 'MaterialX versions look like "1.38.10" or "1.39.3"');

/** GitHub `owner/name`. */
export const repoSchema = z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'repos are GitHub owner/name');

/** Present ⇒ the record is flagged for human review; the string says why. */
const reviewSchema = z.string().min(1).optional();

export const sourceSchema = z.strictObject({
  url: z.url(),
  title: z.string().optional(),
  kind: z.enum(SOURCE_KINDS),
  /** When the source was last read and found to support the claim. */
  accessed: isoDateSchema,
});

const sourcesSchema = z.array(sourceSchema).min(1, 'every claim needs at least one source');

// ---------------------------------------------------------------------------
// Capabilities taxonomy (data/capabilities.yaml)
// ---------------------------------------------------------------------------

export const capabilitySchema = z.strictObject({
  id: capabilityIdSchema,
  tech: z.enum(TECHS),
  group: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Products (data/products/<id>.yaml)
// ---------------------------------------------------------------------------

export const releaseSchema = z.strictObject({
  version: versionSchema,
  date: isoDateSchema.optional(),
  /** USD version the release bundles or is built against. */
  usd: usdVersionSchema.optional(),
  /** MaterialX version the release bundles or is built against. */
  materialx: mtlxVersionSchema.optional(),
  notes: z.string().optional(),
  sources: sourcesSchema,
  review: reviewSchema,
});

export const supportSchema = z.strictObject({
  capability: capabilityIdSchema,
  level: z.enum(SUPPORT_LEVELS),
  /** Product version in which this level of support first shipped. */
  since: versionSchema.optional(),
  /** Product version in which it was removed. */
  until: versionSchema.optional(),
  /** Project or product id providing the support, for `plugin` (and sometimes others). */
  via: idSchema.optional(),
  /** For plugins / render delegates: the host products this record applies to. */
  hosts: z.array(idSchema).optional(),
  notes: z.string().optional(),
  /** Known gaps / limitations, one short sentence each. */
  gaps: z.array(z.string().min(1)).default([]),
  sources: sourcesSchema,
  confidence: z.enum(CONFIDENCE),
  /** Date a human or agent last confirmed this record against its sources. */
  verified: isoDateSchema,
  review: reviewSchema,
});

export const issueSchema = z.strictObject({
  title: z.string().min(1),
  url: z.url(),
  capability: capabilityIdSchema.optional(),
  status: z.enum(ISSUE_STATUSES),
  /** Free text version range, e.g. "20.0–20.5". */
  affects: z.string().optional(),
  fixedIn: versionSchema.optional(),
  severity: z.enum(['minor', 'major', 'blocker']).optional(),
  verified: isoDateSchema,
  review: reviewSchema,
});

export const productSchema = z.strictObject({
  name: z.string().min(1),
  vendor: z.string().min(1),
  /** First entry is the primary category, used for grouping and colour. */
  categories: z.array(z.enum(PRODUCT_CATEGORIES)).min(1),
  industries: z.array(z.enum(INDUSTRIES)).min(1),
  license: z.enum(LICENSES),
  website: z.url(),
  repo: repoSchema.optional(),
  /** 1 = industry pillar, 2 = widely used, 3 = niche / long tail. */
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  status: z.enum(['active', 'discontinued']).default('active'),
  summary: z.string().max(280).optional(),
  releases: z.array(releaseSchema).default([]),
  support: z.array(supportSchema).default([]),
  issues: z.array(issueSchema).default([]),
});

// ---------------------------------------------------------------------------
// Ecosystem projects (data/projects/<id>.yaml)
// ---------------------------------------------------------------------------

export const projectSchema = z
  .strictObject({
    name: z.string().min(1),
    repo: repoSchema.optional(),
    url: z.url().optional(),
    tech: z.array(z.enum(TECHS)).min(1),
    kind: z.enum(PROJECT_KINDS),
    description: z.string().min(1).max(280),
    license: z.string().optional(),
    /** Products this project plugs into or targets. */
    hosts: z.array(idSchema).default([]),
    tags: z.array(z.string()).default([]),
    sources: z.array(sourceSchema).default([]),
    verified: isoDateSchema,
    review: reviewSchema,
  })
  .refine((p) => p.repo || p.url, { message: 'a project needs a repo or a url' });

// ---------------------------------------------------------------------------
// Timeline events (data/events.yaml)
// ---------------------------------------------------------------------------

export const eventSchema = z.strictObject({
  id: idSchema,
  date: isoDateSchema,
  title: z.string().min(1),
  tech: z.array(z.enum(TECHS)).min(1),
  kind: z.enum(EVENT_KINDS),
  description: z.string().optional(),
  sources: sourcesSchema,
  review: reviewSchema,
});

export type Capability = z.infer<typeof capabilitySchema>;
export type Product = z.infer<typeof productSchema>;
export type SupportRecord = z.infer<typeof supportSchema>;
export type Release = z.infer<typeof releaseSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type Project = z.infer<typeof projectSchema>;
export type TimelineEvent = z.infer<typeof eventSchema>;
export type Source = z.infer<typeof sourceSchema>;
