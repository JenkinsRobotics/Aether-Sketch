import { describe, expect, it } from 'vitest';
import { pathBounds } from '@aether/sketch';
import { alignPaths, distributePaths, flipPaths, orderPaths, rotatePaths } from './arrange';
import type { DrawingPath, Layer } from './document';

const box = (id: string, x: number, y: number, w = 10, h = 10): DrawingPath => ({
  id, points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true, color: '#000000', widthPx: 1, opacity: 1,
});
const b = (p: DrawingPath) => pathBounds([p])!;
const artboard = { x: 0, y: 0, width: 100, height: 100 };

describe('arrange', () => {
  it('aligns several paths to their shared bounds', () => {
    const [a, c] = alignPaths([box('a', 0, 0), box('c', 40, 30, 20, 20)], 'right', artboard);
    expect(b(a).x + b(a).width).toBe(60);
    expect(b(c).x + b(c).width).toBe(60);
    const [m] = alignPaths([box('a', 0, 0), box('c', 40, 30, 20, 20)], 'middle', artboard);
    expect(b(m).y).toBe(20);
  });

  it('aligns one path to the artboard', () => {
    const [a] = alignPaths([box('a', 5, 5)], 'center', artboard);
    expect(b(a).x).toBe(45);
  });

  it('distributes with equal gaps and keeps the ends', () => {
    const out = distributePaths([box('a', 0, 0), box('m', 15, 0), box('z', 90, 0)], 'horizontal');
    expect(out.map(p => b(p).x)).toEqual([0, 45, 90]);
    expect(distributePaths([box('a', 0, 0), box('z', 50, 0)], 'vertical')[1]).toEqual(box('z', 50, 0));
  });

  it('flips and turns about the selection centre', () => {
    const [f] = flipPaths([box('a', 0, 0, 10, 4)], 'vertical');
    expect(b(f)).toEqual({ x: 0, y: 0, width: 10, height: 4 });
    expect(f.points[0]).toEqual([0, 4]);
    const [r] = rotatePaths([box('a', 0, 0, 10, 4)], Math.PI / 2);
    expect(b(r).width).toBeCloseTo(4);
    expect(b(r).height).toBeCloseTo(10);
  });

  it('reorders within a layer', () => {
    const layer: Layer = { id: 'l', name: 'L', visible: true, locked: false, paths: ['a', 'b', 'c', 'd'].map(id => box(id, 0, 0)) };
    const ids = (l: Layer) => l.paths.map(p => p.id).join('');
    expect(ids(orderPaths(layer, ['b'], 'front'))).toBe('acdb');
    expect(ids(orderPaths(layer, ['c'], 'back'))).toBe('cabd');
    expect(ids(orderPaths(layer, ['a', 'b'], 'forward'))).toBe('cabd');
    expect(ids(orderPaths(layer, ['c', 'd'], 'backward'))).toBe('acdb');
  });
});
