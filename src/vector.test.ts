import { describe, expect, it } from 'vitest';
import { pathBounds, polygonArea, samplePath, type Point, type SketchPath } from '@aether/sketch';
import { newDocument, readDocument, serializeDocument, type DrawingPath } from './document';
import { SHAPES, arrowHeads, cornerIndices, dashArray, knifePath, makeShape, roundAllCorners, roundCorners } from './vector';

const square: SketchPath = { points: [[0, 0], [100, 0], [100, 100], [0, 100]], closed: true };
const area = (p: SketchPath) => Math.abs(polygonArea(samplePath(p, .05)));
const near = (got: Point[], want: Point[]) => { expect(got).toHaveLength(want.length); got.forEach((p, i) => { expect(p[0]).toBeCloseTo(want[i][0], 9); expect(p[1]).toBeCloseTo(want[i][1], 9); }); };
const line = (extra: Partial<DrawingPath> = {}): DrawingPath => ({ id: 'l', points: [[0, 0], [100, 0]], closed: false, color: '#112233', widthPx: 2, opacity: 1, ...extra });

describe('corner tool', () => {
  it('rounds one corner into an arc that leaves both edges tangentially', () => {
    const rounded = roundCorners(square, 20, 'round', [1]);
    near(rounded.points, [[0, 0], [80, 0], [100, 20], [100, 100], [0, 100]]);
    const arc = rounded.curves![1]!;
    expect(arc.c1[1]).toBeCloseTo(0); expect(arc.c2[0]).toBeCloseTo(100);            // handles lie along the old edges
    expect(arc.c1[0]).toBeCloseTo(80 + 20 * .5523, 2);                                // the quarter-circle handle length
    expect(rounded.curves!.filter(Boolean)).toHaveLength(1);
  });
  it('rounding every corner of a square removes the area of four corner offcuts', () => {
    const rounded = roundAllCorners(square, 20);
    expect(rounded.points).toHaveLength(8);
    expect(area(rounded)).toBeCloseTo(100 * 100 - (4 - Math.PI) * 20 * 20, -1); // the area is of a sampled outline
  });
  it('never uses more than half an edge, so a huge radius turns a square into a circle', () => {
    const rounded = roundAllCorners(square, 1e6);
    expect(area(rounded)).toBeCloseTo(Math.PI * 50 * 50, -1);
  });
  it('cuts a corner straight across', () => {
    const cut = roundCorners(square, 10, 'straight', [0]);
    near(cut.points.slice(0, 2), [[0, 10], [10, 0]]); expect(cut.curves).toBeUndefined();
  });
  it('leaves the ends of an open path and corners on curved edges alone', () => {
    expect(cornerIndices({ points: [[0, 0], [50, 0], [50, 50]], closed: false })).toEqual([1]);
    expect(cornerIndices({ points: [[0, 0], [50, 0], [50, 50]], closed: true, curves: [{ c1: [10, -10], c2: [40, -10] }, null, null] })).toEqual([2]);
    expect(cornerIndices({ points: [[0, 0], [50, 0], [100, 0]], closed: false })).toEqual([]); // a straight run has no corner
  });
  it('rounds the hole of a compound shape too', () => {
    const ring = { ...square, subpaths: [{ points: [[25, 25], [75, 25], [75, 75], [25, 75]] as Point[], closed: true }] };
    const rounded = roundAllCorners(ring, 5);
    expect(rounded.points).toHaveLength(8); expect(rounded.subpaths![0].points).toHaveLength(8);
  });
});

describe('knife', () => {
  it('cuts a square into two closed halves', () => {
    const pieces = knifePath(square, [50, -10], [50, 110])!;
    expect(pieces).toHaveLength(2);
    expect(pieces.every(p => p.closed)).toBe(true);
    expect(pieces.map(area).sort()).toEqual([5000, 5000]);
    expect(pieces.map(p => pathBounds([p])!.width)).toEqual([50, 50]);
  });
  it('cuts a diagonal, keeping the whole area', () => {
    const pieces = knifePath(square, [-10, 20], [110, 80])!;
    expect(pieces).toHaveLength(2);
    expect(area(pieces[0]) + area(pieces[1])).toBeCloseTo(10000, 6);
  });
  it('cuts a U shape that the line crosses four times into three pieces', () => {
    const u: SketchPath = { points: [[0, 0], [30, 0], [30, 70], [70, 70], [70, 0], [100, 0], [100, 100], [0, 100]], closed: true };
    const pieces = knifePath(u, [-10, 40], [110, 40])!;
    expect(pieces).toHaveLength(3);
    const sizes = pieces.map(area).sort((a, b) => a - b); [1200, 1200, area(u) - 2400].forEach((want, i) => expect(sizes[i]).toBeCloseTo(want, 6));
  });
  it('does not cut where the knife stops inside the shape', () => {
    expect(knifePath(square, [50, -10], [50, 50])).toBeNull();
    expect(knifePath(square, [50, 50], [50, 110])).toBeNull();
    expect(knifePath(square, [200, 0], [200, 100])).toBeNull();
  });
  it('splits an open path where the line crosses it', () => {
    const pieces = knifePath({ points: [[0, 0], [100, 0], [100, 100]], closed: false }, [40, -10], [40, 10])!;
    expect(pieces.map(p => p.points)).toEqual([[[0, 0], [40, 0]], [[40, 0], [100, 0], [100, 100]]]);
    expect(pieces.every(p => !p.closed)).toBe(true);
  });
  it('keeps curves when it cuts a circle', () => {
    const circle = makeShape('donut', { x: 0, y: 0, width: 100, height: 100 }), disc: SketchPath = { points: circle.points, curves: circle.curves, closed: true };
    const pieces = knifePath(disc, [-10, 50], [110, 50])!;
    expect(pieces).toHaveLength(2);
    expect(pieces.every(p => p.curves?.some(Boolean))).toBe(true);
    expect(area(pieces[0])).toBeCloseTo(Math.PI * 2500 / 2, -1);
  });
});

describe('stroke options', () => {
  it('uses a custom dash and gap before the named pattern', () => {
    expect(dashArray({ dash: 'dashed', widthPx: 2 })).toEqual([8, 4]);
    expect(dashArray({ dash: 'dashed', dashPx: [12, 3], widthPx: 2 })).toEqual([12, 3]);
    expect(dashArray({ widthPx: 2 })).toBeUndefined();
  });
  it('puts an arrowhead on the end of an open line, pointing along it', () => {
    const [head] = arrowHeads(line({ arrowEnd: 'arrow' }));
    expect(head.closed).toBe(true); expect(head.fill).toBe('#112233'); expect(head.strokeEnabled).toBe(false);
    expect(head.points[0][0]).toBeGreaterThan(100); expect(head.points[0][1]).toBeCloseTo(0);        // the tip, just beyond the end
    expect(head.points[1][0]).toBeLessThan(100); expect(head.points[1][1]).toBeCloseTo(-head.points[2][1]); // a symmetric base behind it
  });
  it('follows the curve handle at a curved end, and gives each end its own head', () => {
    const heads = arrowHeads(line({ arrowStart: 'arrow', arrowEnd: 'bar', curves: [{ c1: [0, 50], c2: [100, 50] }, null] }));
    expect(heads).toHaveLength(2);
    expect(heads[0].points[0][0]).toBeCloseTo(0); expect(heads[0].points[0][1]).toBeLessThan(0);      // start tip points away from its handle, upwards
    expect(heads[1].closed).toBe(false); expect(heads[1].points[0][1]).toBeCloseTo(0);                // the bar is square to the end direction (vertical), so it lies along x
  });
  it('has no heads on closed shapes, text or lines without them', () => {
    expect(arrowHeads(line())).toEqual([]);
    expect(arrowHeads({ ...line({ arrowEnd: 'dot' }), closed: true })).toEqual([]);
    expect(arrowHeads(line({ arrowEnd: 'dot' }))[0].curves!.filter(Boolean)).toHaveLength(4);
  });
  it('round-trips the new stroke options and rejects bad ones', () => {
    const doc = newDocument(); doc.layers[0].paths.push(line({ dashPx: [12, 3], arrowStart: 'dot', arrowEnd: 'arrow' }));
    expect(readDocument(serializeDocument(doc)).layers[0].paths[0]).toMatchObject({ dashPx: [12, 3], arrowStart: 'dot', arrowEnd: 'arrow' });
    const bad = (extra: object) => { const d = newDocument(); d.layers[0].paths.push({ ...line(), ...extra } as DrawingPath); return serializeDocument(d); };
    expect(() => readDocument(bad({ dashPx: [0, 3] }))).toThrow(); expect(() => readDocument(bad({ dashPx: [4] }))).toThrow(); expect(() => readDocument(bad({ arrowEnd: 'spear' }))).toThrow();
  });
});

describe('shape library', () => {
  const box = { x: 10, y: 20, width: 200, height: 100 };
  it('every shape is a closed outline that fills its box and stays inside it', () => {
    for (const kind of SHAPES) {
      const shape = makeShape(kind.id, box), b = pathBounds([shape])!;
      expect(shape.closed, kind.id).toBe(true);
      expect(shape.curves === undefined || shape.curves.length === shape.points.length, kind.id).toBe(true);
      expect(b.x, kind.id).toBeGreaterThanOrEqual(box.x - .01); expect(b.y, kind.id).toBeGreaterThanOrEqual(box.y - .01);
      expect(b.x + b.width, kind.id).toBeLessThanOrEqual(box.x + box.width + .01); expect(b.y + b.height, kind.id).toBeLessThanOrEqual(box.y + box.height + .01);
      expect(b.width, kind.id).toBeGreaterThan(box.width * .9); expect(b.height, kind.id).toBeGreaterThan(box.height * .9);
      expect(area(shape), kind.id).toBeGreaterThan(box.width * box.height * .15);
    }
  });
  it('the option changes the shape: corner radius, teeth, hole', () => {
    expect(makeShape('rounded-rectangle', box, 0).points).toHaveLength(4);
    expect(makeShape('rounded-rectangle', box, 50).points).toHaveLength(8);
    expect(area(makeShape('rounded-rectangle', box, 50))).toBeCloseTo(200 * 100 - (4 - Math.PI) * 50 * 50, -1);
    expect(makeShape('cog', box, 12).points).toHaveLength(48);
    expect(makeShape('donut', box, 50).subpaths).toHaveLength(1);
    expect(area(makeShape('pie', { x: 0, y: 0, width: 100, height: 100 }, 90))).toBeCloseTo(Math.PI * 2500 / 4, -1);
  });
});
