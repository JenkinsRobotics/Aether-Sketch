import { expect, it } from 'vitest';
import { readPSD, writePSD, type PSDLayer } from './psd';

const solid = (width: number, height: number, [r, g, b, a]: number[]) => { const out = new Uint8Array(width * height * 4); for (let i = 0; i < width * height; i++) out.set([r, g, b, a], i * 4); return out; };
const layers: PSDLayer[] = [
  { name: 'Línea ✎ top', x: 2, y: 1, width: 3, height: 2, rgba: solid(3, 2, [255, 0, 0, 128]), opacity: .5, blend: 'multiply', visible: true, clipped: true },
  { name: 'Base', x: 0, y: 0, width: 8, height: 4, rgba: solid(8, 4, [10, 20, 30, 255]), opacity: 1, blend: 'normal', visible: false },
];

it('writes a PSD header a reader recognises and reads back every layer as it was', () => {
  const merged = solid(8, 4, [9, 8, 7, 255]), file = writePSD(8, 4, layers, merged), text = String.fromCharCode(...file.subarray(0, 4));
  expect(text).toBe('8BPS'); expect([file[4], file[5]]).toEqual([0, 1]); // version 1
  const view = new DataView(file.buffer); expect(view.getUint32(14)).toBe(4); expect(view.getUint32(18)).toBe(8); expect(view.getUint16(22)).toBe(8); expect(view.getUint16(24)).toBe(3);
  const back = readPSD(file);
  expect(back.width).toBe(8); expect(back.height).toBe(4); expect(back.warnings).toEqual([]);
  expect(back.layers.map(l => l.name)).toEqual(['Línea ✎ top', 'Base']); // top first, Unicode names kept
  expect(back.layers[0]).toMatchObject({ x: 2, y: 1, width: 3, height: 2, blend: 'multiply', visible: true, clipped: true }); expect(back.layers[0].opacity).toBeCloseTo(.5, 2);
  expect([...back.layers[0].rgba]).toEqual([...layers[0].rgba]); expect([...back.layers[1].rgba]).toEqual([...layers[1].rgba]);
  expect(back.layers[1]).toMatchObject({ visible: false, blend: 'normal' }); expect(back.layers[1].clipped).toBeUndefined();
  expect([...back.merged!]).toEqual([...merged]);
});
it('reads PackBits rows, as Photoshop writes them', () => {
  // Rebuild the file with the top layer's red channel packed: one run of three 255s per row.
  const file = writePSD(8, 4, layers, solid(8, 4, [0, 0, 0, 255])), view = new DataView(file.buffer);
  // Find the top layer's channel data: it is the second layer stored, after the base layer's four raw channels.
  let at = 26 + 4 + 4; const sectionLength = view.getUint32(at); at += 4 + 4; at += 2; // into the layer records
  const skipRecord = () => { const channels = view.getUint16(at + 16); at += 18 + channels * 6 + 12; at += 4 + view.getUint32(at); };
  skipRecord(); const topRecord = at; skipRecord();
  const baseChannels = 4 * (2 + 8 * 4), red = at + baseChannels; // past the base layer: red is the top layer's first channel
  expect(view.getUint16(red)).toBe(0); expect([...file.subarray(red + 2, red + 8)]).toEqual([255, 255, 255, 255, 255, 255]);
  const packed = Uint8Array.from([0, 1, 0, 2, 0, 2, 0xfe, 255, 0xfe, 255]); // mode 1, two row lengths, two runs of three
  const out = new Uint8Array(file.length + packed.length - 8); out.set(file.subarray(0, red)); out.set(packed, red); out.set(file.subarray(red + 8), red + packed.length);
  const o = new DataView(out.buffer); o.setUint32(26 + 8, sectionLength + 2); o.setUint32(26 + 12, o.getUint32(26 + 12) + 2); o.setUint32(topRecord + 18 + 2, packed.length);
  const back = readPSD(out);
  expect([...back.layers[0].rgba]).toEqual([...layers[0].rgba]); expect([...back.layers[1].rgba]).toEqual([...layers[1].rgba]);
});
it('refuses files that are not 8-bit RGB PSDs, with a reason', () => {
  expect(() => readPSD(Uint8Array.from([1, 2, 3]))).toThrow(/not a Photoshop/);
  const file = writePSD(2, 2, [], solid(2, 2, [0, 0, 0, 255])), cmyk = file.slice(); cmyk[25] = 4;
  expect(() => readPSD(cmyk)).toThrow(/8-bit RGB/);
  expect(readPSD(file).layers).toEqual([]); expect(readPSD(file).merged).toHaveLength(16); // a flat file still has its picture
});
