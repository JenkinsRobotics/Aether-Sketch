import { expect, it } from 'vitest';
import { closedSpline, distanceToPolyline, fisheyeCurves, frenchCurve, projectToEllipse, projectToLine, steadyPoint, strokeConstraint, symmetryCopies } from './guides';

it('a stroke that starts near the ruler runs along it; one that starts far away is free', () => {
  const guides = { ruler: { a: [0, 0] as [number, number], b: [100, 0] as [number, number] } };
  const along = strokeConstraint(guides, [10, 3], [20, 5], 8)!;
  expect(along([50, 30])).toEqual([50, 0]);
  expect(strokeConstraint(guides, [10, 40], [20, 45], 8)).toBeNull();
  expect(projectToLine([5, 5], [0, 0], [10, 10])).toEqual([5, 5]);
});

it('snaps to the ellipse and to perspective lines towards the vanishing point nearest the stroke direction', () => {
  const ellipse = { center: [0, 0] as [number, number], rx: 100, ry: 50, angle: 0 };
  const p = projectToEllipse([200, 0], ellipse); expect(p[0]).toBeCloseTo(100); expect(p[1]).toBeCloseTo(0);
  const towards = strokeConstraint({ perspective: { points: [[1000, 0], [-1000, 0]] } }, [0, 100], [10, 99], 8)!;
  const q = towards([500, 500]); // on the line from (0,100) to (1000,0)
  expect((q[1] - 100) / q[0]).toBeCloseTo(-.1);
  const vertical = strokeConstraint({ perspective: { points: [[1000, 0]] } }, [0, 100], [0, 120], 8)!;
  expect(vertical([7, 300])).toEqual([0, 300]);
});

it('steadies a stroke and draws mirrored or radial copies', () => {
  expect(steadyPoint([0, 0], [10, 0], .5)).toEqual([5, 0]);
  const path = { points: [[10, 0], [20, 5]] as [number, number][], closed: false };
  expect(symmetryCopies(path, { mode: 'vertical', center: [0, 0], sections: 2 })[0].points).toEqual([[-10, 0], [-20, 5]]);
  expect(symmetryCopies(path, { mode: 'both', center: [0, 0], sections: 2 })).toHaveLength(3);
  const radial = symmetryCopies(path, { mode: 'radial', center: [0, 0], sections: 4 });
  expect(radial).toHaveLength(3); expect(radial[1].points[0][0]).toBeCloseTo(-10); expect(radial[1].points[0][1]).toBeCloseTo(0);
});

it('three-point perspective has no upright; one-point keeps level and upright', () => {
  const three = { perspective: { points: [[1000, 0], [-1000, 0], [0, 2000]] as [number, number][] } };
  const down = strokeConstraint(three, [200, 0], [201, 20], 8)!; // set off downwards: runs to the third point, not straight down
  const q = down([0, 1000]); expect((q[0] - 200) / q[1]).toBeCloseTo(-200 / 2000);
  const level = strokeConstraint({ perspective: { points: [[0, 0]] as [number, number][] } }, [300, 200], [320, 201], 8)!;
  expect(level([500, 260])).toEqual([500, 200]);
});
it('isometric strokes take the nearest of three axes', () => {
  const iso = { isometric: { origin: [0, 0] as [number, number], size: 40 } };
  const up = strokeConstraint(iso, [10, 10], [11, 40], 8)!; expect(up([30, 90])[0]).toBeCloseTo(10);
  const right = strokeConstraint(iso, [0, 0], [20, 9], 8)!, r = right([100, 0]);
  expect(r[1] / r[0]).toBeCloseTo(Math.tan(Math.PI / 6));
  const left = strokeConstraint(iso, [0, 0], [20, -9], 8)!, l = left([100, 0]);
  expect(l[1] / l[0]).toBeCloseTo(-Math.tan(Math.PI / 6));
});
it('fisheye strokes bend through the rim or run to the centre', () => {
  const fisheye = { perspective: { kind: 'fisheye' as const, points: [[0, 0], [100, 0]] as [number, number][] } };
  const curves = fisheyeCurves([0, 0], 100, [0, 50]);
  // The level arc from (0, 50) passes through both ends of the level diameter.
  for (const end of [[-100, 0], [100, 0]] as [number, number][]) { const on = curves[0].project(end); expect(on[0]).toBeCloseTo(end[0]); expect(on[1]).toBeCloseTo(end[1]); }
  expect(Math.abs(curves[0].tangent[0])).toBeCloseTo(1); // level where it crosses the upright axis
  const level = strokeConstraint(fisheye, [0, 50], [10, 50], 8)!, bent = level([60, 80]);
  expect(Math.hypot(bent[0], bent[1] - -75)).toBeCloseTo(125); // on the circle through (-100,0), (0,50), (100,0): centre (0,-75), radius 125
  const radial = strokeConstraint(fisheye, [30, 40], [36, 48], 8)!; expect(radial([10, 90])[1] / radial([10, 90])[0]).toBeCloseTo(4 / 3);
  const axis = strokeConstraint(fisheye, [20, 0], [40, 0], 8)!; expect(axis([70, 30])).toEqual([70, 0]); // on the axis the arc is the straight axis
});
it('a stroke near the French curve slides along its edge, and flipping or turning the curve moves the edge', () => {
  const curve = { center: [0, 0] as [number, number], size: 200, angle: 0 };
  const outline = frenchCurve(curve); expect(outline.length).toBeGreaterThan(100);
  const start = outline[10], follow = strokeConstraint({ curve }, [start[0] + 3, start[1] - 2], outline[12], 8)!;
  const on = follow([outline[20][0] + 5, outline[20][1] + 5]); expect(distanceToPolyline(on, outline, true)).toBeLessThan(1e-6);
  expect(Math.hypot(on[0] - outline[20][0], on[1] - outline[20][1])).toBeLessThan(12);
  // It follows the edge even when the pointer swings over to the far side of the shape.
  const far = follow([-start[0], -start[1]]); expect(Math.hypot(far[0] - on[0], far[1] - on[1])).toBeLessThan(200 * .6);
  expect(strokeConstraint({ curve }, [0, -400], [10, -400], 8)).toBeNull();
  const flipped = frenchCurve({ ...curve, flip: true }); expect(flipped[10][1]).toBeCloseTo(-outline[10][1]);
  const turned = frenchCurve({ ...curve, angle: Math.PI / 2 }); expect(turned[10][0]).toBeCloseTo(-outline[10][1]); expect(turned[10][1]).toBeCloseTo(outline[10][0]);
  expect(closedSpline([[0, 0], [10, 0], [10, 10], [0, 10]], 4)).toHaveLength(16);
});
