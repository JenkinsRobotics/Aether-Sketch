// @vitest-environment jsdom
import { beforeAll, expect, it } from 'vitest';
import { crc32, drawingPDF, rasterSize, storedZip } from './export';
import { drawingSVG, exportArea } from './paint';
import { newDocument, newLayer } from './document';
import { importSVG } from './svg-import';

// jsdom has no canvas; the importer falls back to its default colours.
beforeAll(() => { HTMLCanvasElement.prototype.getContext = (() => null) as never; });

const square = (id: string, x: number) => ({ id, points: [[x, 0], [x + 10, 0], [x + 10, 10], [x, 10]] as [number, number][], closed: true, color: '#ff0000', fill: '#00ff00', widthPx: 1, opacity: 1 });

it('frames an infinite drawing by what is drawn, and a fixed one by its artboard', () => {
  const doc = newDocument(); doc.layers[0].paths.push(square('a', 1000));
  const area = exportArea(doc); expect(area.x).toBeLessThan(1000); expect(area.x + area.width).toBeGreaterThan(1010);
  expect(exportArea({ ...doc, infinite: false })).toEqual({ x: 0, y: 0, width: 1200, height: 800 });
  expect(rasterSize({ x: 0, y: 0, width: .01, height: .005 })).toEqual({ width: 512, height: 256 });
});

it('writes Inkscape layers with their name, visibility, opacity and blend', () => {
  const doc = newDocument(), top = { ...newLayer('Ink & "wash"'), opacity: .5, blend: 'multiply' as const, visible: false };
  top.paths.push(square('b', 0)); doc.layers.unshift(top);
  const svg = drawingSVG(doc);
  expect(svg).toContain('inkscape:groupmode="layer" inkscape:label="Ink &amp; &quot;wash&quot;" style="display:none;opacity:0.5;mix-blend-mode:multiply"');
  expect(new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror')).toBeNull();
});

it('writes a well-formed vector PDF whose cross-reference table points at every object', () => {
  const doc = newDocument(); doc.layers[0].paths.push(square('a', 0)); doc.layers[0].blend = 'multiply';
  const bytes = drawingPDF(doc), text = new TextDecoder('latin1').decode(bytes);
  expect(text.startsWith('%PDF-1.7')).toBe(true); expect(text).toContain('/BM /Multiply');
  expect(text).toMatch(/0 10 l .* h B/);
  const xref = Number(text.match(/startxref\n(\d+)/)![1]); expect(text.slice(xref, xref + 4)).toBe('xref');
  const offsets = [...text.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
  offsets.forEach((offset, i) => expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
});

it('stores a ZIP that a reader can walk, with the right CRCs', () => {
  expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  const zip = storedZip([{ name: 'mimetype', data: new TextEncoder().encode('image/openraster') }, { name: 'a.txt', data: new Uint8Array([1, 2, 3]) }]);
  const view = new DataView(zip.buffer), end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50); expect(view.getUint16(end + 10, true)).toBe(2);
  expect(new TextDecoder().decode(zip.slice(30 + 8, 30 + 8 + 16))).toBe('image/openraster');
});

it('round-trips layers through SVG: name, hidden state, opacity and blend come back', () => {
  const doc = newDocument(), top = { ...newLayer('Wash'), opacity: .4, blend: 'screen' as const, visible: false };
  top.paths.push(square('b', 0)); doc.layers[0].paths.push(square('a', 20)); doc.layers.unshift(top);
  const back = importSVG(drawingSVG(doc)).doc;
  expect(back.layers.map(l => [l.name, l.visible, l.opacity, l.blend, l.paths.length])).toEqual([['Wash', false, .4, 'screen', 1], ['Layer 1', true, 1, undefined, 1]]);
});
