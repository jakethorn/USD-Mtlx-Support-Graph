import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareMtlxVersions,
  existsAt,
  indexNodes,
  resolveNodeSupport,
  selectNodedefs,
} from '../src/data/node-support.ts';
import type { MtlxNode, MtlxNodeDef } from '../src/data/generated.ts';
import type { NodeSupport } from '../src/data/schema.ts';

// A tiny synthetic MaterialX library: two releases, a node added in the newer one, one removed in it.
const def = (name: string, extra: Partial<MtlxNodeDef> = {}): MtlxNodeDef => ({
  name,
  outputs: [],
  inputs: [],
  since: null,
  removedIn: null,
  support: { genglsl: 'native', genosl: 'native' },
  ...extra,
});
const node = (name: string, library: string, group: string, nodedefs: MtlxNodeDef[], extra: Partial<MtlxNode> = {}): MtlxNode => ({
  name,
  library,
  group,
  doc: null,
  since: null,
  removedIn: null,
  nodedefs,
  coverage: {},
  ...extra,
});

const nodes: MtlxNode[] = [
  node('add', 'stdlib', 'math', [def('ND_add_float'), def('ND_add_color3', { support: { genglsl: 'native', genosl: 'none' } })]),
  node('multiply', 'stdlib', 'math', [def('ND_multiply_float')]),
  node('image', 'stdlib', 'texture2d', [def('ND_image_color3', { since: '1.39.0' })], { since: '1.39.0' }),
  node('swizzle', 'stdlib', 'channel', [def('ND_swizzle_float', { removedIn: '1.39.0' })], { removedIn: '1.39.0' }),
  node('standard_surface', 'bxdf', 'pbr', [def('ND_standard_surface_surfaceshader')]),
];
const index = indexNodes({ latest: '1.39.0', versions: ['1.38.10', '1.39.0'], nodes });

const source = { url: 'https://example.com/docs', kind: 'docs' as const, accessed: '2026-11-09' };
const record = (fields: Record<string, unknown>) => ({
  level: 'native',
  gaps: [],
  except: [],
  sources: [source],
  confidence: 'high',
  verified: '2026-11-09',
  ...fields,
});
const file = (records: Record<string, unknown>[]): NodeSupport =>
  ({ scopes: [{ id: 'main', label: 'Renderer', context: 'render' }], records: records.map(record) }) as unknown as NodeSupport;

describe('MaterialX versions', () => {
  it('compares numerically, not lexically', () => {
    assert.ok(compareMtlxVersions('1.38.10', '1.38.9') > 0);
    assert.equal(compareMtlxVersions('1.39.0', '1.39'), 0);
  });
  it('knows which release a node exists in', () => {
    assert.equal(existsAt({ since: '1.39.0', removedIn: null }, '1.38.10'), false);
    assert.equal(existsAt({ since: null, removedIn: '1.39.0' }, '1.39.0'), false);
    assert.equal(existsAt({ since: null, removedIn: '1.39.0' }, '1.38.10'), true);
  });
});

describe('selectNodedefs', () => {
  it('expands a library to the nodedefs of the requested release', () => {
    const latest = [...selectNodedefs({ libraries: ['stdlib'] }, index).defs.keys()].sort();
    assert.deepEqual(latest, ['ND_add_color3', 'ND_add_float', 'ND_image_color3', 'ND_multiply_float']);
    const older = [...selectNodedefs({ libraries: ['stdlib'] }, index, { version: '1.38.10' }).defs.keys()].sort();
    assert.deepEqual(older, ['ND_add_color3', 'ND_add_float', 'ND_multiply_float', 'ND_swizzle_float']);
  });
  it('keeps the most specific rank and honours generator filters', () => {
    const sel = selectNodedefs({ groups: ['math'], nodedefs: ['ND_add_float'] }, index, { generator: 'genosl' });
    assert.equal(sel.defs.get('ND_add_float'), 3);
    assert.equal(sel.defs.get('ND_multiply_float'), 1);
    assert.equal(sel.defs.has('ND_add_color3'), false, 'genosl does not implement ND_add_color3');
  });
  it('reports names that are not in the library', () => {
    assert.deepEqual(selectNodedefs({ nodes: ['nope'], groups: ['stdlib:nope'] }, index).unknown, ['group stdlib:nope', 'node nope']);
  });
});

describe('resolveNodeSupport', () => {
  it('lets a more specific selector win over a broader one', () => {
    const r = resolveNodeSupport(file([{ libraries: ['stdlib'], level: 'native' }, { nodes: ['add'], level: 'partial' }]), index);
    const scope = r.scopes[0];
    assert.equal(scope.nodedefs['ND_add_float'].level, 'partial');
    assert.equal(scope.nodedefs['ND_multiply_float'].level, 'native');
    assert.deepEqual(r.conflicts, []);
  });
  it('applies exceptions inside their record and marks the node as mixed', () => {
    const r = resolveNodeSupport(
      file([{ libraries: ['stdlib'], level: 'native', except: [{ nodedefs: ['ND_add_color3'], level: 'none', gaps: [] }] }]),
      index,
    );
    const scope = r.scopes[0];
    assert.equal(scope.nodedefs['ND_add_color3'].level, 'none');
    assert.equal(scope.nodes['add'].level, 'native', 'the strongest level among type variants');
    assert.equal(scope.nodes['add'].mixed, true);
    assert.equal(scope.nodes['add'].covered, 2);
  });
  it('reports a conflict when equal-rank records disagree, and keeps the first', () => {
    const r = resolveNodeSupport(file([{ nodes: ['multiply'], level: 'native' }, { nodes: ['multiply'], level: 'none' }]), index);
    assert.equal(r.conflicts.length, 1);
    assert.deepEqual(r.conflicts[0].levels, ['native', 'none']);
    assert.equal(r.scopes[0].nodedefs['ND_multiply_float'].level, 'native');
  });
  it('counts uncovered nodes in the latest release as unknown', () => {
    const r = resolveNodeSupport(file([{ nodes: ['add'], level: 'native' }]), index);
    assert.equal(r.scopes[0].counts.native, 1);
    // multiply, image and standard_surface exist in 1.39.0 and are not covered; swizzle was removed.
    assert.equal(r.scopes[0].counts.unknown, 3);
    assert.equal(r.scopes[0].total, 4);
  });
  it('flags claims with a review note or low confidence', () => {
    const r = resolveNodeSupport(
      file([{ nodes: ['add'], level: 'native', confidence: 'low' }, { nodes: ['multiply'], level: 'native', review: 'conflicting docs' }]),
      index,
    );
    assert.equal(r.claims[0].record.flagged, true);
    assert.equal(r.claims[1].record.flagged, true);
    assert.equal(r.scopes[0].nodes['add'].flagged, true);
  });
});
