import { describe, expect, it } from 'vitest';
import type { Point } from '@aether/sketch';
import type { DrawingPath } from './document';
import { joinOpenPath } from './join';

const line = (id: string, ...points: Point[]): DrawingPath => ({ id, points, closed: false, color: id === 'new' ? '#ff0000' : '#000000', widthPx: 2, opacity: 1 });

describe('joinOpenPath', () => {
  it('leaves a line that touches nothing alone', () => {
    expect(joinOpenPath(line('new', [0, 0], [10, 0]), [line('a', [50, 50], [60, 60])], 1)).toEqual({ path: line('new', [0, 0], [10, 0]), removed: [] });
  });
  it('extends a path from its end, keeping its id and look', () => {
    const { path, removed } = joinOpenPath(line('new', [10, 0], [10, 10]), [line('a', [0, 0], [10, 0])], 1);
    expect(removed).toEqual(['a']);
    expect(path).toMatchObject({ id: 'a', color: '#000000', closed: false, points: [[0, 0], [10, 0], [10, 10]] });
  });
  it('joins either end, in either direction', () => {
    expect(joinOpenPath(line('new', [5, 5], [0, 0]), [line('a', [0, 0], [10, 0])], 1).path.points).toEqual([[5, 5], [0, 0], [10, 0]]);
  });
  it('bridges two separate paths into one', () => {
    const { path, removed } = joinOpenPath(line('new', [10, 0], [20, 10]), [line('a', [0, 0], [10, 0]), line('b', [20, 10], [30, 10])], 1);
    expect(removed).toEqual(['a', 'b']);
    expect(path.points).toEqual([[0, 0], [10, 0], [20, 10], [30, 10]]);
  });
  it('closes the shape when the last line returns to the start', () => {
    const { path } = joinOpenPath(line('new', [10, 10], [0, 0]), [line('a', [0, 0], [10, 0], [10, 10])], 1);
    expect(path).toMatchObject({ id: 'a', closed: true, points: [[0, 0], [10, 0], [10, 10]] });
  });
  it('keeps curve handles with their edges when a curved path is reversed', () => {
    const curved: DrawingPath = { ...line('a', [0, 0], [10, 0]), curves: [{ c1: [3, 5], c2: [7, 5] }, null] };
    const { path } = joinOpenPath(line('new', [0, 0], [0, 10]), [curved], 1);
    expect(path.points).toEqual([[10, 0], [0, 0], [0, 10]]);
    expect(path.curves).toEqual([{ c1: [7, 5], c2: [3, 5] }, null, null]);
  });
  it('never joins closed shapes', () => {
    expect(joinOpenPath(line('new', [0, 0], [5, 5]), [{ ...line('a', [0, 0], [10, 0], [10, 10]), closed: true }], 1).removed).toEqual([]);
  });
});
