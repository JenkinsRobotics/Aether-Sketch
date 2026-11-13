import { describe, expect, it } from 'vitest';
import type { DrawingPath } from './document';
import { newDocument, newPixelLayer, readDocument, serializeDocument } from './document';
import { floodFill, paintedRect, pixelBounds, unionRect } from './pixels';

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
