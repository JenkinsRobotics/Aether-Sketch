// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { adjustLine, composeLayers, depthDefs, depthRegion, effectReach, layerDepths, usesDepth } from './depth';
import { drawingSVG, exportArea } from './paint';
import { drawingPDF } from './export';
import { flattenInto, flattenPlan, mergeKind } from './structure';
import { newDocument, newLayer, newPixelLayer, readDocument, serializeDocument, type Layer, type SketchDocument } from './document';

const square = (id: string, x = 0, size = 10) => ({ id, points: [[x, 0], [x + size, 0], [x + size, size], [x, size]] as [number, number][], closed: true, color: '#ff0000', fill: '#00ff00', widthPx: 1, opacity: 1 });
const layer = (name: string, extra: Partial<Layer> = {}): Layer => ({ ...newLayer(name), id: name, paths: [square(`${name}-shape`)], ...extra });
/** Layers are listed top first, as in the file. */
const drawing = (...layers: Layer[]): SketchDocument => ({ ...newDocument(), layers });

it('works out which roles are in force: clips find their base, masks the layer below, and neither works without one', () => {
  const doc = drawing(layer('clip2', { role: 'clip' }), layer('mask', { role: 'mask' }), layer('clip1', { role: 'clip' }), layer('base-mask', { role: 'mask' }), layer('base'), layer('floor', { role: 'clip' }));
  const d = layerDepths(doc);
  expect(d.map(x => x.role)).toEqual(['clip', 'mask', 'clip', 'mask', undefined, undefined]); // the bottom layer has nothing to clip to
  expect(d[0].clipTo).toBe(4); expect(d[2].clipTo).toBe(4);
  expect(d[2].hide).toEqual([1]); expect(d[4].hide).toEqual([3]); // a mask acts on the nearest layer below that is not a mask
  expect(d.map(x => x.drawn)).toEqual([true, false, true, false, true, true]);
});
it('a hidden mask is switched off, and hiding a base hides what is clipped to it', () => {
  const doc = drawing(layer('clip', { role: 'clip' }), layer('mask', { role: 'mask', visible: false }), layer('base', { visible: false }));
  const d = layerDepths(doc);
  expect(d[2].hide).toEqual([]); expect(d[0].drawn).toBe(false);
});
it('an adjustment layer wraps everything beneath it, or only its base when it is clipped', () => {
  const adjust = { brightness: .2, contrast: 0, saturation: 0, hueDeg: 0 };
  const order = (doc: SketchDocument) => composeLayers<string>(doc, layerDepths(doc), l => l.name, (below, d) => `adjust${d.index}(${below.join(',')})`).join(',');
  expect(order(drawing(layer('top'), layer('a', { adjust }), layer('mid'), layer('low')))).toBe('adjust1(low,mid),a,top');
  expect(order(drawing(layer('a', { adjust, role: 'clip' }), layer('clip', { role: 'clip' }), layer('base'), layer('low')))).toBe('low,adjust0(base,clip),a');
  expect(order(drawing(layer('a', { adjust, visible: false }), layer('low')))).toBe('low,a'); // hidden: no adjustment
});
it('turns adjustment amounts into the line each colour channel follows', () => {
  expect(adjustLine({ brightness: 0, contrast: 0, saturation: 0, hueDeg: 0 })).toEqual({ slope: 1, intercept: 0 });
  expect(adjustLine({ brightness: .5, contrast: 0, saturation: 0, hueDeg: 0 }).slope).toBeCloseTo(1.5);
  const contrast = adjustLine({ brightness: 0, contrast: 1, saturation: 0, hueDeg: 0 }); // mid grey stays put
  expect(contrast.slope * .5 + contrast.intercept).toBeCloseTo(.5);
  const inverted = adjustLine({ brightness: 0, contrast: 0, saturation: 0, hueDeg: 0, invert: true });
  expect(inverted.slope * .2 + inverted.intercept).toBeCloseTo(.8);
});
it('covers effects when measuring: a shadow reaches its offset plus three deviations', () => {
  expect(effectReach({ shadow: { dxPx: 10, dyPx: -4, blurPx: 5, color: '#000000', opacity: 1 } })).toBe(25);
  expect(effectReach({ blurPx: 2, glow: { blurPx: 4, color: '#ffffff', opacity: 1 } })).toBe(18);
  const doc = drawing(layer('a', { effects: { shadow: { dxPx: 10, dyPx: 0, blurPx: 0, color: '#000000', opacity: 1 } } }));
  expect(depthRegion(doc)!.width).toBeGreaterThanOrEqual(10 + 2 * 10);
  const plain = drawing(layer('a')), infinite = { ...doc, infinite: true };
  expect(exportArea(infinite).width).toBeGreaterThan(exportArea({ ...plain, infinite: true }).width + 19); // exports frame the shadow too
});
it('writes clips and masks into the SVG as masks, with mask layers kept out of the picture', () => {
  const doc = drawing(layer('clip', { role: 'clip' }), layer('mask', { role: 'mask', effects: { blurPx: 3 } }), layer('base'));
  expect(usesDepth(doc)).toBe(true);
  const svg = drawingSVG(doc), parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
  expect(parsed.querySelector('parsererror')).toBeNull();
  const drawn = [...parsed.querySelectorAll('svg > g')].map(g => g.getAttribute('inkscape:label'));
  expect(drawn).toEqual(['base', 'clip']); // the mask layer is not a layer of the picture
  expect(parsed.querySelector('svg > g[mask="url(#sketch-layer-2-clip)"]')?.getAttribute('inkscape:label')).toBe('clip');
  expect(parsed.querySelector('defs > g#sketch-layer-1')?.getAttribute('filter')).toBe('url(#sketch-layer-1-effects)'); // a blurred mask is a feathered mask
  expect(parsed.querySelector('g#sketch-layer-2')?.getAttribute('mask')).toBe('url(#sketch-layer-2-hide)');
  expect(parsed.querySelector('mask#sketch-layer-2-hide use')?.getAttribute('href')).toBe('#sketch-layer-1');
  expect(parsed.querySelector('mask#sketch-layer-2-clip use')?.getAttribute('href')).toBe('#sketch-layer-2');
  // A plain drawing gains nothing.
  expect(drawingSVG(drawing(layer('a'), layer('b')))).not.toMatch(/mask|sketch-layer/);
});
it('draws only the asked-for layers, still clipped to a base that is left out', () => {
  const doc = drawing(layer('clip', { role: 'clip' }), layer('base'), layer('low'));
  const parsed = new DOMParser().parseFromString(drawingSVG(doc, undefined, ['clip']), 'image/svg+xml');
  expect([...parsed.querySelectorAll('svg > g')].map(g => g.getAttribute('inkscape:label'))).toEqual(['clip']);
  expect(parsed.querySelector('defs > g#sketch-layer-1')).not.toBeNull(); // the base, for the clip to point at
  expect(parsed.querySelector('#sketch-layer-2')).toBeNull();
});
it('never puts a layer id from the file into markup', () => {
  const doc = drawing({ ...layer('clip', { role: 'clip' }), id: '"><script>alert(1)</script>' }, { ...layer('base'), id: '"/><image href="x"' });
  const svg = drawingSVG(doc);
  expect(svg).not.toContain('script'); expect(svg).not.toContain('href="x"');
  expect(depthDefs(doc, { x: 0, y: 0, width: 1, height: 1 })).toMatch(/^(<filter|<mask)/);
});
it('applies vector clips and masks in PDF as soft masks', () => {
  const pdf = new TextDecoder().decode(drawingPDF(drawing(layer('clip', { role: 'clip' }), layer('mask', { role: 'mask' }), layer('base'))));
  expect(pdf).toMatch(/\/SMask << \/Type \/Mask \/S \/Alpha \/G \d+ 0 R >>/);
  expect(pdf).toMatch(/\/SMask << \/Type \/Mask \/S \/Luminosity \/BC \[1 1 1\] \/G \d+ 0 R >>/);
  expect(new TextDecoder().decode(drawingPDF(drawing(layer('a'))))).not.toContain('SMask');
});
it('merges as vectors when it can and as pixels otherwise', () => {
  expect(mergeKind(drawing(layer('up'), layer('low')), 'up')).toBe('vector');
  expect(mergeKind(drawing(layer('up', { effects: { blurPx: 2 } }), layer('low')), 'up')).toBe('pixel');
  expect(mergeKind(drawing(layer('up', { role: 'clip' }), layer('low')), 'up')).toBe('pixel'); // the clip is applied
  expect(mergeKind(drawing(layer('up', { role: 'clip' }), layer('low', { role: 'clip' }), layer('base')), 'up')).toBe('vector'); // two clips of one base
  expect(mergeKind(drawing(layer('up'), { ...newPixelLayer('low'), id: 'low' }), 'up')).toBe('pixel');
  expect(mergeKind(drawing(layer('up'), layer('mask', { role: 'mask' }), layer('low')), 'up')).toBe('pixel'); // into the masked layer, mask applied
  expect(flattenPlan(drawing(layer('up'), layer('mask', { role: 'mask' }), layer('low')), 'up')).toMatchObject({ lowerID: 'low', only: ['up', 'low'], remove: ['up', 'mask'] });
  expect(mergeKind(drawing(layer('up'), layer('mask', { role: 'mask' }), layer('low', { locked: true })), 'up')).toBeNull();
  expect(mergeKind(drawing(layer('low')), 'low')).toBeNull();
});
it('flattens a layer and its masks into the layer below, which keeps its own opacity, blend and role', () => {
  const doc = drawing(layer('m', { role: 'mask' }), layer('up', { blend: 'multiply' }), layer('low', { role: 'clip', opacity: .5, blend: 'screen', effects: { blurPx: 2 } }), layer('base'));
  const plan = flattenPlan(doc, 'up')!;
  expect(plan.only).toEqual(['up', 'low']); expect(plan.remove).toEqual(['up', 'm']);
  // The picture is rendered without what the result keeps.
  expect(plan.render.layers[2]).toMatchObject({ opacity: 1, visible: true }); expect(plan.render.layers[2].role).toBeUndefined(); expect(plan.render.layers[2].blend).toBeUndefined();
  const pixels = { x: 0, y: 0, width: 1, height: 1, src: 'data:image/png;base64,AAAA' }, merged = flattenInto(doc, plan.lowerID, plan.remove, pixels);
  expect(merged.layers.map(l => l.id)).toEqual(['low', 'base']);
  expect(merged.layers[0]).toMatchObject({ kind: 'pixel', paths: [], pixels, role: 'clip', opacity: .5, blend: 'screen' }); expect(merged.layers[0].effects).toBeUndefined();
  expect(() => readDocument(serializeDocument(merged))).not.toThrow();
});
it('saves and reopens roles, effects and adjustments, and rejects malformed ones', () => {
  const doc = drawing(layer('a', { role: 'mask', effects: { blurPx: 4, shadow: { dxPx: 3, dyPx: -3, blurPx: 2, color: '#112233', opacity: .5 }, glow: { blurPx: 6, color: '#ffeeaa', opacity: 1 } } }),
    layer('b', { adjust: { brightness: -.5, contrast: .25, saturation: 1, hueDeg: 90, invert: true } }));
  expect(readDocument(serializeDocument(doc))).toEqual(doc);
  const broken = (change: (l: Record<string, unknown>) => void) => { const copy = JSON.parse(serializeDocument(doc)); change(copy.layers[0]); return () => readDocument(JSON.stringify(copy)); };
  expect(broken(l => { l.role = 'cut'; })).toThrow();
  expect(broken(l => { l.effects = { blurPx: -1 }; })).toThrow();
  expect(broken(l => { l.effects = { shadow: { dxPx: 0, dyPx: 0, blurPx: 1, color: 'red"/>', opacity: 1 } }; })).toThrow();
  expect(broken(l => { l.adjust = { brightness: 2, contrast: 0, saturation: 0, hueDeg: 0 }; })).toThrow();
});
