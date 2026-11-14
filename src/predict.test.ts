import { expect, it } from 'vitest';
import { predictStroke } from './predict';

type P = [number, number];
/** A shaky hand: every point nudged a little, repeatably. */
const shaky = (points: P[], amount = 1.5): P[] => points.map(([x, y], i) => [x + Math.sin(i * 12.9898) * amount, y + Math.cos(i * 78.233) * amount]);
const along = (corners: P[], step = 4): P[] => corners.slice(1).flatMap((b, i) => { const a = corners[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); return Array.from({ length: n }, (_, k) => [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n] as P); });
const round = (cx: number, cy: number, rx: number, ry: number, from = 0, to = Math.PI * 2, n = 60): P[] => Array.from({ length: n + 1 }, (_, i) => { const t = from + (to - from) * i / n; return [cx + Math.cos(t) * rx, cy + Math.sin(t) * ry] as P; });

it('straightens a wobbly line and leaves its ends where they were drawn', () => {
  const drawn = shaky(along([[0, 0], [200, 60]]).concat([[200, 60]])), got = predictStroke(drawn)!;
  expect(got.kind).toBe('line'); expect(got.points).toEqual([drawn[0], drawn[drawn.length - 1]]); expect(got.closed).toBe(false);
});
it('turns a rough circle into a circle and a rough oval into an ellipse', () => {
  const circle = predictStroke(shaky(round(100, 100, 52, 48), 2))!;
  expect(circle.kind).toBe('ellipse'); expect(circle.closed).toBe(true); expect(circle.box!.width).toBeCloseTo(circle.box!.height); expect(circle.box!.width).toBeGreaterThan(96); expect(circle.box!.width).toBeLessThan(108);
  expect(circle.points[0]).toEqual(circle.points[circle.points.length - 1]);
  const oval = predictStroke(shaky(round(0, 0, 120, 50), 2))!;
  expect(oval.kind).toBe('ellipse'); expect(oval.box!.width / oval.box!.height).toBeGreaterThan(2);
});
it('turns an open bend into an arc of a circle that keeps going the way it was drawn', () => {
  const got = predictStroke(shaky(round(0, 0, 100, 100, 0, Math.PI * .75, 40), 1.5))!;
  expect(got.kind).toBe('arc'); expect(got.closed).toBe(false);
  for (const p of got.points) expect(Math.hypot(p[0], p[1])).toBeGreaterThan(95), expect(Math.hypot(p[0], p[1])).toBeLessThan(105);
  expect(got.points[0][0]).toBeGreaterThan(90); expect(got.points[got.points.length - 1][0]).toBeLessThan(-60); // from the start round to the end
  const back = predictStroke(shaky(round(0, 0, 100, 100, Math.PI * .75, 0, 40), 1.5))!; // drawn the other way
  expect(back.points[0][0]).toBeLessThan(-60); expect(back.points[back.points.length - 1][0]).toBeGreaterThan(90);
});
it('squares up a box drawn roughly level, and keeps the corners of a triangle or a tilted box', () => {
  const box = predictStroke(shaky(along([[10, 10], [210, 14], [206, 110], [8, 106], [10, 10]]), 1.5))!;
  expect(box.kind).toBe('polygon'); expect(box.points).toHaveLength(5);
  expect(new Set(box.points.map(p => Math.round(p[0]))).size).toBe(2); expect(new Set(box.points.map(p => Math.round(p[1]))).size).toBe(2); // only two xs and two ys: a true rectangle
  const triangle = predictStroke(shaky(along([[60, 0], [120, 100], [0, 100], [60, 0]]), 1.5))!;
  expect(triangle.kind).toBe('polygon'); expect(triangle.points).toHaveLength(4);
  // A stroke that starts in the middle of a side has no corner there.
  const midSide = predictStroke(shaky(along([[100, 0], [200, 0], [200, 100], [0, 100], [0, 0], [100, 0]]), 1.5))!;
  expect(midSide.points).toHaveLength(5);
  const diamond = predictStroke(shaky(along([[100, 0], [200, 100], [100, 200], [0, 100], [100, 0]]), 1.5))!;
  expect(diamond.kind).toBe('polygon'); expect(diamond.points).toHaveLength(5);
  expect(Math.min(...diamond.points.map(p => Math.abs(p[0] - 100) + Math.abs(p[1]))).valueOf()).toBeLessThan(8); // the top corner stays a corner, not a box
});
it('leaves alone what is not a simple shape', () => {
  const squiggle: P[] = Array.from({ length: 80 }, (_, i) => [i * 4, Math.sin(i / 5) * 40]);
  expect(predictStroke(squiggle)).toBeNull();
  const spiral: P[] = Array.from({ length: 120 }, (_, i) => [Math.cos(i / 8) * (10 + i), Math.sin(i / 8) * (10 + i)]);
  expect(predictStroke(spiral)).toBeNull();
  expect(predictStroke([[0, 0], [1, 1]])).toBeNull();
});
