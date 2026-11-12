import { expect, it } from 'vitest';
import { newDocument, newLayer, readDocument, serializeDocument, type DrawingPath } from './document';
import { canMergeDown, duplicateLayer, groupSelection, mergeDown, ungroupSelection, pathLocked, pathVisible, moveTreeItem, groupPaths } from './structure';
const path = (id: string): DrawingPath => ({ id, points: [[0, 0], [100, 0], [100, 100]], closed: true, color: '#123456', fill: '#abcdef', widthPx: 3, opacity: .7, nodeModes: ['corner', 'smooth', 'symmetric'] });
it('groups a selection into a contiguous paint block without flattening nested groups', () => {
  const layer = { ...newDocument().layers[0], paths: ['a', 'b', 'c', 'd'].map(path) };
  const grouped = groupSelection(layer, ['a', 'c'], 'g');
  expect(grouped.paths.map(p => p.id)).toEqual(['b', 'a', 'c', 'd']);
  const nested = groupSelection(grouped, ['a', 'c', 'd'], 'g2');
  expect(nested.groups?.find(g => g.id === 'g')?.parentID).toBe('g2');
  expect(groupPaths(nested, 'g2').map(p => p.id)).toEqual(['a', 'c', 'd']);
  const ungrouped = ungroupSelection(nested, ['a', 'c', 'd']);
  expect(ungrouped.groups?.map(g => g.id)).toEqual(['g']);
  expect(ungrouped.paths.find(p => p.id === 'd')?.groupID).toBeUndefined();
});
it('inherits group visibility and locks and moves whole subtrees between layers', () => {
  const doc = newDocument(), a = doc.layers[0]; a.paths = ['a', 'b'].map(path);
  doc.layers[0] = groupSelection(a, ['a', 'b'], 'g'); doc.layers.push({ ...a, id: 'second', paths: [], groups: [] });
  let next = moveTreeItem(doc, 'g', 'second', 'inside');
  expect(next.layers[0].paths).toHaveLength(0); expect(next.layers[1].paths).toHaveLength(2);
  expect(readDocument(serializeDocument(next))).toEqual(next);
  next.layers[1].groups![0] = { ...next.layers[1].groups![0], hidden: true, locked: true };
  expect(pathVisible(next.layers[1], next.layers[1].paths[0])).toBe(false);
  expect(pathLocked(next.layers[1], next.layers[1].paths[0])).toBe(true);
  expect(moveTreeItem(next, 'g', a.id, 'inside')).toBe(next);
});
it('rejects nesting cycles and respects tree before/after ordering', () => {
  const doc = newDocument(), layer = doc.layers[0]; layer.paths = ['a', 'b', 'c'].map(path);
  doc.layers[0] = groupSelection(layer, ['a', 'b'], 'g');
  expect(moveTreeItem(doc, 'g', 'a', 'inside')).toBe(doc);
  expect(moveTreeItem(doc, 'c', 'g', 'before').layers[0].paths.map(p => p.id)).toEqual(['a', 'b', 'c']);
  expect(moveTreeItem(doc, 'c', 'g', 'after').layers[0].paths.map(p => p.id)).toEqual(['c', 'a', 'b']);
});
it('validates optional group, fill and node-mode data and rejects malformed hierarchies', () => {
  const doc = newDocument(); doc.layers[0].paths = [path('a'), path('b')];
  doc.layers[0] = groupSelection(doc.layers[0], ['a', 'b'], 'g');
  expect(readDocument(serializeDocument(doc))).toEqual(doc);
  doc.layers[0].groups![0].parentID = 'g'; expect(() => readDocument(serializeDocument(doc))).toThrow();
  delete doc.layers[0].groups![0].parentID;
  doc.layers[0].paths[0].nodeModes = ['corner']; expect(() => readDocument(serializeDocument(doc))).toThrow();
});

it('duplicates a layer above itself with fresh ids, and merges a layer down', () => {
  const doc = newDocument(), top = { ...newLayer('Top'), opacity: .5 };
  top.groups = [{ id: 'g', name: 'Group' }]; top.paths = [{ id: 'p', groupID: 'g', points: [[0, 0], [1, 1]], closed: false, color: '#000000', widthPx: 1, opacity: .8 }];
  doc.layers.unshift(top);
  let n = 0; const copy = duplicateLayer(doc, top.id, () => `id${n++}`);
  expect(copy.layers.map(l => l.name)).toEqual(['Top copy', 'Top', 'Layer 1']);
  expect(copy.layers[0].paths[0]).toMatchObject({ id: 'id1', groupID: 'id0' }); expect(copy.layers[0].groups![0].id).toBe('id0');
  const merged = mergeDown(doc, top.id);
  expect(merged.layers.map(l => l.name)).toEqual(['Layer 1']); expect(merged.layers[0].paths[0].opacity).toBeCloseTo(.4);
  expect(canMergeDown({ ...doc, layers: [{ ...top, blend: 'multiply' }, doc.layers[1]] }, top.id)).toBe(false);
});
