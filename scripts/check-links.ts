/**
 * Checks that every source URL in data/products and data/projects still resolves.
 *
 *   npm run check:links            → report broken links (404/410/DNS) and blocked ones (401/403/429)
 *
 * Many vendor sites refuse automated requests (403), so only definite failures are errors.
 */
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDataYaml } from '../src/data/yaml.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONCURRENCY = 12;
const TIMEOUT_MS = 25_000;

type Use = { file: string; where: string };
const urls = new Map<string, Use[]>();

function collect(value: unknown, file: string, path: string) {
  if (Array.isArray(value)) value.forEach((v, i) => collect(v, file, `${path}[${i}]`));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if ((k === 'url' || k === 'website') && typeof v === 'string' && v.startsWith('http')) {
        const uses = urls.get(v) ?? [];
        uses.push({ file, where: path });
        urls.set(v, uses);
      } else collect(v, file, path ? `${path}.${k}` : k);
    }
  }
}

for (const folder of ['products', 'projects']) {
  const dir = join(ROOT, 'data', folder);
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.yaml'))) {
    collect(parseDataYaml(readFileSync(join(dir, f), 'utf8')), `data/${folder}/${f}`, '');
  }
}

async function check(url: string): Promise<{ status: number | string }> {
  for (const method of ['HEAD', 'GET'] as const) {
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; usd-mtlx-support-graph link checker)',
          Accept: 'text/html,application/xhtml+xml,*/*',
        },
      });
      // Some servers reject HEAD; retry those with GET.
      if (method === 'HEAD' && (res.status === 405 || res.status === 403 || res.status === 404 || res.status >= 500)) continue;
      return { status: res.status };
    } catch (e) {
      if (method === 'HEAD') continue;
      return { status: (e as Error).name === 'TimeoutError' ? 'timeout' : `error: ${(e as Error).cause ?? (e as Error).message}` };
    }
  }
  return { status: 'unknown' };
}

const list = [...urls.keys()];
const results = new Map<string, number | string>();
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < list.length) {
      const url = list[next++];
      results.set(url, (await check(url)).status);
    }
  }),
);

const broken = list.filter((u) => {
  const s = results.get(u);
  return s === 404 || s === 410 || (typeof s === 'string' && s.startsWith('error'));
});
const blocked = list.filter((u) => [401, 403, 429].includes(results.get(u) as number) || results.get(u) === 'timeout');
const other = list.filter((u) => {
  const s = results.get(u);
  return typeof s === 'number' && s >= 500;
});

const show = (label: string, items: string[]) => {
  if (!items.length) return;
  console.log(`\n${label} (${items.length})`);
  for (const u of items) console.log(`  ${results.get(u)}  ${u}\n        ← ${urls.get(u)!.map((x) => x.file).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
};
show('BROKEN', broken);
show('SERVER ERROR', other);
show('BLOCKED / TIMEOUT (could not check automatically)', blocked);
const totals = `${list.length} unique URLs · ${broken.length} broken · ${other.length} server errors · ${blocked.length} unverifiable`;
console.log(`\n${totals}`);

// In GitHub Actions: annotate each broken link on its data file and write a run summary.
if (process.env.GITHUB_ACTIONS) {
  for (const u of [...broken, ...other]) {
    for (const file of new Set(urls.get(u)!.map((x) => x.file))) {
      console.log(`::warning file=${file},title=Source link ${results.get(u)}::${u}`);
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = [...broken, ...other].map(
      (u) => `| ${results.get(u)} | ${u} | ${[...new Set(urls.get(u)!.map((x) => `\`${x.file}\``))].join(', ')} |`,
    );
    const md = [
      '## Source link check',
      '',
      totals,
      '',
      ...(rows.length ? ['| Status | URL | Cited in |', '|---|---|---|', ...rows] : ['No broken links.']),
      '',
    ].join('\n');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
}
process.exit(broken.length > 0 ? 1 : 0);
