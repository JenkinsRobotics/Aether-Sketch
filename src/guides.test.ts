import { expect, it } from 'vitest';
import { projectToEllipse, projectToLine, steadyPoint, strokeConstraint, symmetryCopies } from './guides';

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
