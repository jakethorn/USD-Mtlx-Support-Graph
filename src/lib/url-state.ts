/**
 * Keep a view's filters in the query string, so any filtered view can be bookmarked or shared.
 *
 * Usage in a Svelte island:
 *   onMount(() => { const p = readParams(); tech = pick(p.get('tech'), TECHS) ?? tech; …; ready = true; });
 *   $effect(() => { const v = { tech, q: query }; if (ready) writeParams(v, { tech: 'all' }); });
 *
 * Read in onMount (after hydration), never at script init, so the server-rendered markup and the first
 * client render agree. Writes use history.replaceState, so filtering doesn't flood the back button.
 */

type Primitive = string | number | boolean;
export type ParamValue = Primitive | readonly Primitive[] | null | undefined;

const encode = (v: ParamValue) => (Array.isArray(v) ? v.join(',') : v == null || v === false ? '' : String(v));

export function readParams(): URLSearchParams {
  return new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search);
}

/** Replace the managed keys in the query string. Empty and default values are dropped to keep URLs short. */
export function writeParams(values: Record<string, ParamValue>, defaults: Record<string, ParamValue> = {}): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) {
    const v = encode(value);
    if (!v || v === encode(defaults[key])) params.delete(key);
    else params.set(key, v);
  }
  // Commas are safe in query strings and much easier to read than %2C.
  const query = params.toString().replaceAll('%2C', ',');
  const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    history.replaceState(history.state, '', next);
  }
}

/** The value if it is one of `allowed`, else undefined. */
export function pick<T extends Primitive>(value: string | null, allowed: readonly T[]): T | undefined {
  if (value === null) return undefined;
  return allowed.find((a) => String(a) === value);
}

/** A comma-separated list, keeping only allowed entries. */
export function pickList<T extends string>(value: string | null, allowed: readonly T[]): T[] {
  if (!value) return [];
  const set = new Set(value.split(','));
  return allowed.filter((a) => set.has(a));
}
