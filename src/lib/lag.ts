/**
 * Version lag: how far each product release trails the upstream OpenUSD / MaterialX release it bundles.
 * Computed at build time from data/products/*.yaml and data/generated/releases.json.
 * Pure data, safe to import types from Svelte islands.
 */
import type { Release } from '../data/schema';
import type { Releases } from '../data/generated';
import type { Tech } from './view';

export interface UpstreamTick {
  version: string;
  date: string;
  /** OpenUSD: a YY.MM release (not a hotfix). MaterialX: an x.y.0 release. */
  major: boolean;
  url: string;
}

export interface LagRelease {
  version: string;
  /** Date as recorded: YYYY-MM-DD, YYYY-MM or YYYY. */
  date: string | null;
  /** Month-only date, placed on the 15th. */
  approx: boolean;
  bundled: string;
  upstreamDate: string | null;
  upstreamUrl: string | null;
  /** Product release date minus the bundled version's tag date, in months. null = can't be placed in time. */
  months: number | null;
  /** Upstream releases newer than the bundled one that were already out on the product's release date. */
  behind: number | null;
  /** Newest upstream release out on the product's release date (counted kinds only). */
  newest: string | null;
  notes?: string;
  review?: string;
  sources: { url: string; title?: string }[];
}

export interface LagProduct {
  id: string;
  name: string;
  vendor: string;
  href: string;
  categories: string[];
  releases: Record<Tech, LagRelease[]>;
}

/** Shape of /data/version-lag.json. */
export interface VersionLagData {
  note: string;
  upstream: Record<Tech, UpstreamTick[]>;
  products: LagProduct[];
}

const DAY = 86_400_000;
const MONTH = (365.25 / 12) * DAY;

/** Timestamp for a recorded date. Month-only dates land mid-month; year-only dates aren't placeable. */
export function dateValue(d: string): { t: number; approx: boolean } | null {
  const [y, m, day] = d.split('-').map(Number);
  if (!m) return null;
  return { t: Date.UTC(y, m - 1, day ?? 15), approx: day === undefined };
}

export function upstreamTicks(releases: Releases): Record<Tech, UpstreamTick[]> {
  const map = (tech: Tech) =>
    releases[tech].releases.map((r) => ({
      version: r.version,
      date: r.date,
      major: tech === 'usd' ? r.kind === 'major' : /^\d+\.\d+\.0$/.test(r.version),
      url: r.url,
    }));
  return { usd: map('usd'), materialx: map('materialx') };
}

/**
 * OpenUSD counts only YY.MM releases as "behind" (hotfixes like 25.05.01 aren't feature releases).
 * MaterialX ships new nodes in patch releases (1.39.3, 1.39.4 …), so every tag counts.
 */
const counts = (tech: Tech, r: UpstreamTick) => tech === 'materialx' || r.major;

export function lagFor(tech: Tech, release: Release, ticks: UpstreamTick[]): LagRelease | null {
  const bundled = release[tech];
  if (!bundled) return null;
  const up = ticks.find((u) => u.version === bundled);
  const ship = release.date ? dateValue(release.date) : null;
  const base: LagRelease = {
    version: release.version,
    date: release.date ?? null,
    approx: ship?.approx ?? false,
    bundled,
    upstreamDate: up?.date ?? null,
    upstreamUrl: up?.url ?? null,
    months: null,
    behind: null,
    newest: null,
    notes: release.notes,
    review: release.review,
    sources: release.sources.map((s) => ({ url: s.url, title: s.title })),
  };
  if (!up || !ship) return base;
  const tu = Date.parse(up.date);
  const out = ticks.filter((u) => counts(tech, u) && Date.parse(u.date) <= ship.t);
  return {
    ...base,
    months: Math.round(((ship.t - tu) / MONTH) * 10) / 10,
    behind: out.filter((u) => Date.parse(u.date) > tu && u.version !== bundled).length,
    newest: out.at(-1)?.version ?? null,
  };
}

/** Releases of one product carrying a bundled version for `tech`, newest date first (undated last). */
export function lagReleases(tech: Tech, releases: Release[], ticks: UpstreamTick[]): LagRelease[] {
  return releases
    .map((r) => lagFor(tech, r, ticks))
    .filter((r): r is LagRelease => r !== null)
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
}

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Ordinal bucket for "releases behind" (colour step): 0, 1, 2–3, 4+. */
export const behindStep = (n: number) => (n <= 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3);
export const BEHIND_STEPS = ['Newest at ship', '1 behind', '2–3 behind', '4+ behind'] as const;
