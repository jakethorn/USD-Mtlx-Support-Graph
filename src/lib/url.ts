/** Prefix an internal path with the site base (`/USD-Mtlx-Support-Graph/` on GitHub Pages). */
export function withBase(path = ''): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${path.replace(/^\//, '')}`;
}
