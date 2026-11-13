import { describe, expect, it, test } from 'vitest';
import type { SketchPath } from '@aether/sketch';
import { BRUSH_PRESETS, brushOpacity, brushOutline, brushWidths, dabsTo, eraseWith, newDabState, type BrushSample } from './brush';

const line = (n: number, pressure = (_i: number) => .5, msPerStep = 16): BrushSample[] =>
  Array.from({ length: n }, (_, i) => ({ point: [i * 4, 0], pressure: pressure(i), timeMs: i * msPerStep }));

test('pen pressure sets the width; tapers thin both ends', () => {
  const firm = brushWidths(line(40, () => 1), { sizePx: 10, taper: false, pen: true });
  const light = brushWidths(line(40, () => .2), { sizePx: 10, taper: false, pen: true });
  expect(firm[20]).toBeCloseTo(1); expect(light[20]).toBeCloseTo(.2);
  const tapered = brushWidths(line(40, () => 1), { sizePx: 10, taper: true, pen: true });
  expect(tapered[0]).toBeLessThan(.2); expect(tapered.at(-1)!).toBeLessThan(.2); expect(tapered[20]).toBeCloseTo(1);
});

test('without a pen, a faster stroke is thinner', () => {
  const slow = brushWidths(line(30, undefined, 40), { sizePx: 10, taper: false, pen: false });
  const fast = brushWidths(line(30, undefined, 2), { sizePx: 10, taper: false, pen: false });
  expect(fast[20]).toBeLessThan(slow[20]);
});

test('the outline is a closed ring around the stroke, as wide as the brush', () => {
  const outline = brushOutline(line(40, () => 1), { sizePx: 10, taper: false, pen: true });
  const ys = outline.map(p => p[1]), xs = outline.map(p => p[0]);
  expect(Math.max(...ys)).toBeCloseTo(5, 0); expect(Math.min(...ys)).toBeCloseTo(-5, 0);
  expect(Math.min(...xs)).toBeLessThan(0); expect(Math.max(...xs)).toBeGreaterThan(156);
  expect(brushOutline([{ point: [3, 3], pressure: 1, timeMs: 0 }], { sizePx: 8, taper: true, pen: true }).length).toBeGreaterThan(8);
});

test('the eraser cuts through closed shapes and leaves open strokes', () => {
  const square: SketchPath & { id: string } = { id: 'sq', points: [[0, 0], [100, 0], [100, 100], [0, 100]] as [number, number][], closed: true };
  const stroke = { id: 'st', points: [[0, 50], [100, 50]] as [number, number][], closed: false };
  const swipe = brushOutline(Array.from({ length: 30 }, (_, i) => ({ point: [50, -20 + i * 5] as [number, number], pressure: 1, timeMs: i * 16 })), { sizePx: 20, taper: false, pen: true });
  const { ids, next } = eraseWith<SketchPath & { id: string }>([square, stroke], swipe, .5);
  expect(ids).toEqual(['sq']);
  // Cut in two: one compound path with two pieces either side of the swipe.
  expect(1 + (next[0].subpaths?.length ?? 0)).toBe(2);
  const all = [next[0], ...(next[0].subpaths ?? [])].flatMap(c => c.points.map(p => p[0]));
  expect(all.some(x => x > 41 && x < 59)).toBe(false);
  // Erasing all of a small shape removes it.
  expect(eraseWith([{ id: 'dot', points: [[48, 48], [52, 48], [52, 52], [48, 52]] as [number, number][], closed: true }], swipe, .5)).toEqual({ ids: ['dot'], next: [] });
});

test('presets set the light-pressure width and the opacity range', () => {
  const ink = brushWidths(line(30, () => 0), { sizePx: 10, taper: false, pen: true, minSize: .15 });
  expect(ink[15]).toBeCloseTo(.15);
  expect(brushOpacity({ opacity: 1, minOpacity: .2 }, line(5, () => 1))).toBeCloseTo(1);
  expect(brushOpacity({ opacity: 1, minOpacity: .2 }, line(5, () => 0))).toBeCloseTo(.2);
  expect(BRUSH_PRESETS.map(b => b.group)).toContain('Airbrush');
});

describe('dabsTo', () => {
  const style = { sizePx: 10, minSize: .5, opacity: 1, minOpacity: 1, softness: 0, taper: false, spacing: .25 };
  const at = (x: number, pressure = 1, timeMs = 0) => ({ point: [x, 0] as [number, number], pressure, timeMs });
  it('stamps once on the first sample, then evenly along the stroke', () => {
    const state = newDabState();
    expect(dabsTo(state, at(0), style, 10, true)).toEqual([{ x: 0, y: 0, radius: 5, alpha: 1 }]);
    const dabs = dabsTo(state, at(100), style, 10, true);
    expect(dabs).toHaveLength(40); // every 2.5 px (a quarter of the 10 px tip), from 2.5 to 100
    expect(dabs[0].x).toBeCloseTo(2.5); expect(dabs[1].x - dabs[0].x).toBeCloseTo(2.5);
  });
  it('keeps the spacing across samples', () => {
    const one = newDabState(), two = newDabState(); dabsTo(one, at(0), style, 10, true); dabsTo(two, at(0), style, 10, true);
    const whole = dabsTo(one, at(31), style, 10, true), parts = [...dabsTo(two, at(13), style, 10, true), ...dabsTo(two, at(31), style, 10, true)];
    expect(parts.map(d => +d.x.toFixed(6))).toEqual(whole.map(d => +d.x.toFixed(6)));
  });
  it('pressure sets the size and the paint; flow scales the paint', () => {
    const soft = { ...style, minOpacity: .2, flow: .5 }, state = newDabState();
    expect(dabsTo(state, at(0, 0), soft, 10, true)[0]).toMatchObject({ radius: 2.5, alpha: .1 });
    expect(dabsTo(newDabState(), at(0, 1), soft, 10, true)[0]).toMatchObject({ radius: 5, alpha: .5 });
  });
  it('a fast mouse draws thinner than a slow one', () => {
    const slow = newDabState(), fast = newDabState(); dabsTo(slow, at(0, .5, 0), style, 10, false); dabsTo(fast, at(0, .5, 0), style, 10, false);
    expect(dabsTo(fast, at(200, .5, 16), style, 10, false).at(-1)!.radius).toBeLessThan(dabsTo(slow, at(200, .5, 4000), style, 10, false).at(-1)!.radius);
  });
});
