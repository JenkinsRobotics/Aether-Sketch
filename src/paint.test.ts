import { expect, it } from 'vitest';
import { newDocument, readDocument, serializeDocument, type DrawingPath } from './document';
import { addInside, duplicatePaintSelection, clipPaths, defaultPaint, drawingSVG, repairClips } from './paint';
const boundary = (): DrawingPath => ({ ...defaultPaint, id: 'boundary', name: 'Boundary', closed: true, points: [[10, 10], [100, 10], [100, 100], [10, 100]], fillGradient: { kind: 'linear', angleDeg: 45, stops: [{ offset: 0, color: '#ff0000', opacity: 1 }, { offset: 1, color: '#0000ff', opacity: .5 }] } });
it('saves live clipping and exports the same gradient, opacity and stroke style', () => {
  const doc = newDocument(); doc.layers[0].paths = [boundary()];
  doc.layers[0] = addInside(doc.layers[0], 'boundary', [{ ...boundary(), id: 'stroke', closed: false, points: [[0, 50], [150, 50]], dash: 'dashed', strokeOpacity: .7 }], 'clip-group');
  expect(readDocument(serializeDocument(doc))).toEqual(doc);
  expect(clipPaths(doc.layers[0], doc.layers[0].paths[1]).map(p => p.id)).toEqual(['boundary']);
  const svg = drawingSVG(doc);
  expect(svg).toContain('<linearGradient'); expect(svg).toContain('stop-opacity="0.5"');
  expect(svg).toContain('clip-path="url(#sketch-vector-0-clip)"'); expect(svg).toContain('stroke-opacity="0.7"'); expect(svg).toContain('stroke-dasharray="12 6"');
  doc.layers[0].paths[0].points[0] = [20, 20]; expect(drawingSVG(doc)).toContain('M20,20');
});
it('repairs deleted/opened clipping references and rejects invalid references or paint on import', () => {
  const doc = newDocument(); doc.layers[0].paths = [boundary()];
  doc.layers[0] = addInside(doc.layers[0], 'boundary', [], 'clip-group');
  doc.layers[0].paths[0].closed = false;
  expect(() => readDocument(serializeDocument(doc))).toThrow();
  expect(readDocument(serializeDocument(repairClips(doc))).layers[0].groups![0].clipPathID).toBeUndefined();
  doc.layers[0].paths[0].closed = true; doc.layers[0].paths[0].fillGradient!.stops[0].opacity = 2;
  expect(() => readDocument(serializeDocument(doc))).toThrow();
});

it('duplicates a clipping group with a new live boundary rather than unclipping the contents', () => {
  const doc = newDocument(); doc.layers[0].paths = [boundary()];
  const layer = addInside(doc.layers[0], 'boundary', [{ ...boundary(), id: 'inside' }], 'g');
  const copy = duplicatePaintSelection(layer, ['boundary', 'inside']);
  doc.layers[0] = copy.layer; const cloned = copy.layer.paths.find(p => p.id === copy.selected[0])!;
  expect(copy.layer.groups![1].clipPathID).toBe(cloned.id);
  expect(clipPaths(copy.layer, copy.layer.paths[3])[0].id).toBe(cloned.id);
  expect(cloned.points[0]).toEqual([30, 30]); expect(readDocument(serializeDocument(doc))).toEqual(doc);
});
