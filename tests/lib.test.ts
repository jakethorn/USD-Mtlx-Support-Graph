import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pick, pickList, readParams, writeParams } from '../src/lib/url-state.ts';
import { correctionUrl, trackProductUrl } from '../src/lib/feedback.ts';
import { behindStep, dateValue, median } from '../src/lib/lag.ts';
import { compareVersions, newestFirst } from '../src/lib/releases.ts';

describe('release ordering', () => {
  it('compares product versions numerically', () => {
    assert.ok(compareVersions('2027', '2026.1') > 0);
    assert.ok(compareVersions('17.1', '16.0') > 0);
    assert.ok(compareVersions('8.0v1', '7.5v1') > 0);
    assert.ok(compareVersions('26.05.0.1', '26.05') > 0);
    assert.equal(compareVersions('5.2', '5.2.0'), 0);
  });
  it('flips oldest-first lists using their dates', () => {
    const katana = [
      { version: '7.0', date: '2023-11' },
      { version: '8.0', date: '2024-12' },
      { version: '9.0', date: '2026-02' },
    ];
    assert.deepEqual(newestFirst(katana).map((r) => r.version), ['9.0', '8.0', '7.0']);
  });
  it('keeps newest-first lists, including partly undated ones', () => {
    const maya = [{ version: '2027', date: '2026-03-25' }, { version: '2026', date: '2025-03-26' }, { version: '2024' }];
    assert.deepEqual(newestFirst(maya).map((r) => r.version), ['2027', '2026', '2024']);
    const unreal = [{ version: '5.8', date: '2026-06-17' }, { version: '5.7' }, { version: '5.6' }];
    assert.deepEqual(newestFirst(unreal).map((r) => r.version), ['5.8', '5.7', '5.6']);
  });
  it('falls back to version numbers when fewer than two entries are dated', () => {
    assert.deepEqual(newestFirst([{ version: '4.4.0' }, { version: '5.2.0' }]).map((r) => r.version), ['5.2.0', '4.4.0']);
    assert.deepEqual(newestFirst([{ version: '2027.0' }, { version: '2025.0' }]).map((r) => r.version), ['2027.0', '2025.0']);
  });
});

describe('url-state', () => {
  const g = globalThis as Record<string, unknown>;
  let replaced: string | null;

  beforeEach(() => {
    replaced = null;
    g.window = { location: { pathname: '/USD-Mtlx-Support-Graph/matrix/', search: '?keep=yes&tech=usd', hash: '#top' } };
    g.history = { state: null, replaceState: (_s: unknown, _t: string, url: string) => (replaced = url) };
  });
  afterEach(() => {
    delete g.window;
    delete g.history;
  });

  it('picks only allowed values', () => {
    assert.equal(pick('usd', ['usd', 'materialx'] as const), 'usd');
    assert.equal(pick('rust', ['usd', 'materialx'] as const), undefined);
    assert.equal(pick(null, ['usd']), undefined);
    assert.deepEqual(pickList('renderer,bogus,dcc', ['dcc', 'renderer', 'cad']), ['dcc', 'renderer']);
    assert.deepEqual(pickList(null, ['dcc']), []);
  });
  it('reads the current query string', () => {
    assert.equal(readParams().get('tech'), 'usd');
  });
  it('writes managed keys, drops defaults and empties, keeps other keys and the hash', () => {
    writeParams({ tech: 'all', cat: ['renderer', 'dcc'], q: '', tier: 0 }, { tech: 'all', tier: 0 });
    assert.equal(replaced, '/USD-Mtlx-Support-Graph/matrix/?keep=yes&cat=renderer,dcc#top');
  });
  it('does nothing when the URL would not change', () => {
    writeParams({ tech: 'usd' });
    assert.equal(replaced, null);
  });
});

describe('feedback links', () => {
  it('pre-fills the correction form', () => {
    const url = new URL(
      correctionUrl({ product: 'houdini', productName: 'Houdini', capability: 'usd.import', capabilityLabel: 'Import', page: '/x/' }),
    );
    assert.equal(url.pathname, '/jakethorn/USD-Mtlx-Support-Graph/issues/new');
    assert.equal(url.searchParams.get('template'), 'correction.yml');
    assert.equal(url.searchParams.get('title'), 'Correction: Houdini · Import');
    assert.equal(url.searchParams.get('product'), 'houdini');
    assert.equal(url.searchParams.get('capability'), 'usd.import');
    assert.equal(url.searchParams.get('page'), 'https://jakethorn.github.io/x/');
  });
  it('omits what it does not know', () => {
    const url = new URL(correctionUrl({}));
    assert.equal(url.searchParams.has('title'), false);
    assert.equal(url.searchParams.has('product'), false);
    assert.match(trackProductUrl, /template=track-product\.yml$/);
  });
});

describe('version lag helpers', () => {
  it('computes medians', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([1, 2, 3, 4]), 2.5);
  });
  it('buckets how many upstream releases a product was behind', () => {
    assert.deepEqual([0, 1, 2, 3, 4, 9].map(behindStep), [0, 1, 2, 2, 3, 3]);
  });
  it('parses full and month-only dates, marking the latter approximate', () => {
    assert.deepEqual(dateValue('2025-07-14'), { t: Date.UTC(2025, 6, 14), approx: false });
    assert.equal(dateValue('2025-07')?.approx, true);
  });
});
