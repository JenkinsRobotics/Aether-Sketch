import { describe, expect, it } from 'vitest';
import type { DrawingPath } from './document';
import { newDocument, newPixelLayer, readDocument, serializeDocument } from './document';
import { alphaBounds, fitMatrix, floodFill, floodRegion, matrixBounds, moveMatrix, outlinePath, paintedRect, pixelBounds, rotateMatrix, skewMatrix, unionRect, type Matrix } from './pixels';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
/** A w×h RGBA image from rows of characters: '.' transparent, '#' black, 'r' red. */
function image(rows: string[]) {
  const colors: Record<string, number[]> = { '.': [0, 0, 0, 0], '#': [0, 0, 0, 255], r: [255, 0, 0, 255] };
  return { data: new Uint8ClampedArray(rows.join('').split('').flatMap(c => colors[c])), width: rows[0].length, height: rows.length };
}
const show = (data: Uint8ClampedArray, width: number) => Array.from({ length: data.length / 4 / width }, (_, y) =>
  Array.from({ length: width }, (_, x) => { const i = (y * width + x) * 4; return data[i + 3] === 0 ? '.' : data[i] === 255 ? 'r' : '#'; }).join(''));

describe('floodFill', () => {
  it('fills the enclosed region and stops at the outline', () => {
    const { data, width, height } = image(['#####.', '#...#.', '#...#.', '#####.']);
    expect(floodFill(data, width, height, 2, 1, [255, 0, 0, 255], 0)).toBe(6);
    expect(show(data, width)).toEqual(['#####.', '#rrr#.', '#rrr#.', '#####.']);
  });
  it('leaks through a gap, as a paint bucket does', () => {
    const { data, width, height } = image(['##.#', '#..#', '####']);
    floodFill(data, width, height, 1, 1, [255, 0, 0, 255], 0);
    expect(show(data, width)).toEqual(['##r#', '#rr#', '####']);
  });
  it('tolerance takes in the soft edge of a stroke', () => {
    const data = new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 20, 0, 0, 0, 255]);
    expect(floodFill(data, 3, 1, 0, 0, [255, 0, 0, 255], 32)).toBe(2);
    expect(floodFill(new Uint8ClampedArray(data.length), 3, 1, 5, 0, [255, 0, 0, 255])).toBe(0);
  });
});

describe('pixel layer geometry', () => {
  const stroke: DrawingPath = { id: 'a', points: [[10, 10], [300, 40]], closed: false, color: '#000000', widthPx: 8, opacity: 1 };
  it('snaps the painted area out to the grid, including the stroke width and blur', () => {
    expect(paintedRect([stroke])).toEqual({ x: 0, y: 0, width: 512, height: 256 });
    expect(paintedRect([{ ...stroke, points: [[2, 2], [20, 20]], blurPx: 4 }])).toEqual({ x: -256, y: -256, width: 512, height: 512 });
    expect(paintedRect([])).toBeNull();
  });
  it('unions rectangles and reports what visible pixel layers cover', () => {
    expect(unionRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: -5, width: 10, height: 10 })).toEqual({ x: 0, y: -5, width: 30, height: 15 });
    const layer = { ...newPixelLayer('Paint'), pixels: { x: 256, y: 0, width: 256, height: 512, src: PNG } };
    expect(pixelBounds([layer, { ...layer, id: 'b', visible: false, pixels: { ...layer.pixels, x: -4096 } }])).toEqual({ x: 256, y: 0, width: 256, height: 512 });
  });
});

describe('pixel layers in the document', () => {
  const withPixels = (pixels: unknown, extra: object = {}) => { const doc = newDocument(); return JSON.stringify({ ...doc, layers: [{ ...newPixelLayer('Paint'), pixels, ...extra }] }); };
  it('round-trips a pixel layer', () => {
    const doc = { ...newDocument(), layers: [{ ...newPixelLayer('Paint'), pixels: { x: -256, y: 0, width: 512, height: 256, src: PNG } }] };
    expect(readDocument(serializeDocument(doc)).layers[0]).toMatchObject({ kind: 'pixel', pixels: { x: -256, width: 512, src: PNG } });
  });
  it('rejects bitmaps that are not PNG data, too large or off the pixel grid', () => {
    expect(() => readDocument(withPixels({ x: 0, y: 0, width: 256, height: 256, src: 'data:image/svg+xml;base64,PHN2Zz4=' }))).toThrow();
    expect(() => readDocument(withPixels({ x: 0, y: 0, width: 8192, height: 256, src: PNG }))).toThrow();
    expect(() => readDocument(withPixels({ x: .5, y: 0, width: 256, height: 256, src: PNG }))).toThrow();
    expect(() => readDocument(withPixels({ x: 0, y: 0, width: 256, height: 256, src: PNG }, { kind: 'raster' }))).toThrow();
  });
  it('keeps vector paths out of pixel layers', () => {
    expect(() => readDocument(withPixels(undefined, { paths: [{ id: 'p', points: [[0, 0], [1, 1]], closed: false, color: '#000000', widthPx: 1, opacity: 1 }] }))).toThrow();
  });
});

describe('pixel selections', () => {
  const mask = (rows: string[]) => { const { data, width, height } = image(rows); return [data, width, height] as const; };
  it('outlines a block along its pixel edges, offset into the drawing', () => {
    expect(outlinePath(...mask(['#']))).toBe('M0 0H1V1H0Z');
    expect(outlinePath(...mask(['....', '.##.', '.##.', '....']), 10, 20)).toBe('M11 21H13V23H11Z');
  });
  it('outlines an L shape as one ring with six corners', () => {
    expect(outlinePath(...mask(['#.', '##']))).toBe('M0 0H1V1H2V2H0Z');
  });
  it('gives a hole its own ring, wound the other way', () => {
    const d = outlinePath(...mask(['###', '#.#', '###']));
    expect(d.match(/M/g)).toHaveLength(2);
    expect(d).toContain('M0 0H3V3H0Z'); expect(d).toContain('M2 1H1V2H2Z'); // anticlockwise, where the outside runs clockwise
  });
  it('closes every ring when two blocks touch only at a corner', () => {
    const d = outlinePath(...mask(['#.', '.#']));
    expect(d.match(/Z/g)).toHaveLength(d.match(/M/g)!.length);
    // Every edge is walked once: the two pixels have eight unit edges between them.
    const length = [...d.matchAll(/M(\d+) (\d+)([^M]*)Z/g)].reduce((n, [, x0, y0, rest]) => {
      let x = +x0, y = +y0, total = 0;
      for (const [, axis, v] of rest.matchAll(/([HV])(\d+)/g)) { if (axis === 'H') { total += Math.abs(+v - x); x = +v; } else { total += Math.abs(+v - y); y = +v; } }
      return n + total + Math.abs(x - +x0) + Math.abs(y - +y0);
    }, 0);
    expect(length).toBe(8);
  });
  it('ignores pixels less than half selected, and finds the tight box of the rest', () => {
    const data = new Uint8ClampedArray(3 * 2 * 4); data[3] = 100; data[4 + 3] = 200; data[(3 + 2) * 4 + 3] = 255;
    expect(outlinePath(data, 3, 2)).toBe('M1 0H2V1H3V2H2V1H1Z');
    expect(alphaBounds(data, 3, 2, 128)).toEqual({ x: 1, y: 0, width: 2, height: 2 });
    expect(alphaBounds(data, 3, 2)).toEqual({ x: 0, y: 0, width: 3, height: 2 });
    expect(alphaBounds(new Uint8ClampedArray(16), 2, 2)).toBeNull();
  });
  it('the magic wand region is what a flood fill would paint', () => {
    const { data, width, height } = image(['#####.', '#...#.', '#...#.', '#####.']);
    expect([...floodRegion(data, width, height, 2, 1, 0)].join('')).toBe('000000' + '011100' + '011100' + '000000');
  });
});

describe('selection transforms', () => {
  const box = { x: 10, y: 20, width: 40, height: 20 }, apply = (m: Matrix, [x, y]: [number, number]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 9));
  it('moves by whole pixels', () => { expect(moveMatrix(3.4, -7.6)).toEqual([1, 0, 0, 1, 3, -8]); });
  it('stretches one box onto another', () => {
    const m = fitMatrix(box, { x: 0, y: 0, width: 80, height: 10 });
    near(apply(m, [10, 20]), [0, 0]); near(apply(m, [50, 40]), [80, 10]);
    expect(matrixBounds(m, box)).toEqual({ x: 0, y: 0, width: 80, height: 10 });
  });
  it('rotates about the centre, and the bounds grow to hold the turned box', () => {
    const m = rotateMatrix([30, 30], Math.PI / 2);
    near(apply(m, [30, 30]), [30, 30]); near(apply(m, [50, 30]), [30, 50]);
    const b = matrixBounds(m, box); near([b.x, b.y, b.width, b.height], [20, 10, 20, 40]);
  });
  it('skews by sliding one side while the opposite side stays put', () => {
    const top = skewMatrix(box, 'n', [8, 0]);
    near(apply(top, [10, 20]), [18, 20]); near(apply(top, [10, 40]), [10, 40]);
    const right = skewMatrix(box, 'e', [0, -6]);
    near(apply(right, [50, 20]), [50, 14]); near(apply(right, [10, 20]), [10, 20]);
  });
});
