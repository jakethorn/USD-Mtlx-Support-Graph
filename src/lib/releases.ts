/**
 * Product release lists are curated by hand and not all files use the same direction: most list the newest
 * release first, some the oldest. Everything downstream (newest bundled version, release tables) assumes
 * newest first, so loadData() normalises with newestFirst().
 */

interface ReleaseLike {
  version: string;
  date?: string;
}

/** Compares product version strings by their numeric parts ("2027" > "2026.1", "17.1" > "16.0", "8.0v1" > "7.5v1"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.match(/\d+/g)?.map(Number) ?? [];
  const pb = b.match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Returns the list newest first, keeping the curated order otherwise. The direction is read from the dated
 * entries (first vs last); without two dates, from the first and last version numbers.
 */
export function newestFirst<T extends ReleaseLike>(releases: readonly T[]): T[] {
  if (releases.length < 2) return [...releases];
  const dated = releases.filter((r) => r.date);
  const ascending =
    dated.length >= 2
      ? dated[0].date! < dated[dated.length - 1].date!
      : compareVersions(releases[0].version, releases[releases.length - 1].version) < 0;
  return ascending ? [...releases].reverse() : [...releases];
}
