// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { docArtboards, newDocument, newLayer, nextArtboard, readDocument, serializeDocument, withArtboards, type DrawingPath, type SketchDocument } from './document';
import { drawingSVG, exportArea } from './paint';
import { drawingPDF, type PDFImage } from './export';
import { deleteSymbol, detachInstances, makeSymbol, newInstance, redefineSymbol, symbolMatrix, symbolOf } from './symbols';

const square = (id: string, x = 0, y = 0, size = 10): DrawingPath => ({ id, points: [[x, y], [x + size, y], [x + size, y + size], [x, y + size]], closed: true, color: '#ff0000', fill: '#00ff00', widthPx: 2, opacity: 1 });
const drawing = (...paths: DrawingPath[]): SketchDocument => ({ ...newDocument(), infinite: false, layers: [{ ...newLayer('Layer 1'), id: 'layer', paths }] });
const latin = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

// ---- Artboards ----
it('an older drawing has its one page at the origin, an infinite one has none, and a list replaces both', () => {
  const doc = drawing();
  expect(docArtboards(doc)).toEqual([{ id: 'artboard', name: 'Artboard 1', x: 0, y: 0, width: 1200, height: 800 }]);
  expect(docArtboards({ ...doc, infinite: true })).toEqual([]);
  const second = nextArtboard(doc, docArtboards(doc)[0], 'b');
  expect(second).toEqual({ id: 'b', name: 'Artboard 2', x: 1280, y: 0, width: 1200, height: 800 }); // to the right, with a gap
  const two = withArtboards(doc, [{ ...docArtboards(doc)[0], width: 600 }, second]);
  expect(two.widthPx).toBe(600); expect(docArtboards(two).map(a => a.id)).toEqual(['artboard', 'b']); // the first page's size stays the drawing's size
  expect(exportArea(two)).toEqual({ x: 0, y: 0, width: 600, height: 800 }); expect(exportArea(two, 'b')).toEqual({ x: 1280, y: 0, width: 1200, height: 800 });
  expect(readDocument(serializeDocument(two))).toEqual(two);
  const broken = JSON.parse(serializeDocument(two)); broken.artboards[1].width = 0; expect(() => readDocument(JSON.stringify(broken))).toThrow();
  const twins = JSON.parse(serializeDocument(two)); twins.artboards[1].id = 'artboard'; expect(() => readDocument(JSON.stringify(twins))).toThrow();
});
it('exports frame the chosen artboard, and a PDF has a page for each one', () => {
  const doc = withArtboards(drawing(square('a', 5, 5), square('b', 1300, 20)), [{ id: 'one', name: 'One', x: 0, y: 0, width: 100, height: 80 }, { id: 'two', name: 'Two', x: 1280, y: 0, width: 200, height: 120 }]);
  expect(drawingSVG(doc, exportArea(doc, 'two'))).toContain('viewBox="1280 0 200 120"');
  const pdf = latin(drawingPDF(doc, docArtboards(doc)));
  expect(pdf).toContain('/Count 2'); expect((pdf.match(/\/Type \/Page /g) ?? []).length).toBe(2);
  expect(pdf).toContain('/MediaBox [0 0 100 80]'); expect(pdf).toContain('/MediaBox [0 0 200 120]');
  expect(pdf).toContain('1 0 0 1 -1280 0 cm'); // the second page shifts the drawing to its own corner
});
it('puts pixel layers into the PDF as images with their coverage, and keeps the file well formed around binary data', () => {
  const doc = drawing(); doc.layers.unshift({ ...newLayer('Paint'), id: 'paint', kind: 'pixel', pixels: { x: 10, y: 20, width: 2, height: 2, src: 'data:image/png;base64,AAAA' } });
  const image: PDFImage = { x: 10, y: 20, width: 2, height: 2, rgb: Uint8Array.from([0x78, 0x9c, 200, 255, 0, 13, 10, 37]), alpha: Uint8Array.from([0x78, 0x9c, 1, 2, 3]) };
  const bytes = drawingPDF(doc, exportArea(doc), new Map([[0, image]])), pdf = latin(bytes);
  expect(pdf).toMatch(/\/Subtype \/Image \/Width 2 \/Height 2 [^>]*\/ColorSpace \/DeviceRGB \/SMask \d+ 0 R \/Length 8 >>/);
  expect(pdf).toContain('q 2 0 0 -2 10 22 cm /Im0 Do Q'); // the image's top-left lands on the bitmap's corner
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]); expect(pdf.slice(xref, xref + 4)).toBe('xref');
  [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].forEach((m, i) => expect(pdf.slice(Number(m[1]), Number(m[1]) + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
  expect(latin(drawingPDF(doc))).not.toContain('/Subtype /Image'); // without images a pixel layer is left out, as before
});

// ---- Symbols ----
it('makes a symbol from paths and leaves one instance where they were', () => {
  const doc = makeSymbol(drawing(square('a', 10, 10), square('b', 30, 10), square('keep', 100, 100)), 'layer', ['a', 'b'], 'Bolt', { symbol: 'sym', instance: 'inst' })!;
  expect(doc.symbols).toHaveLength(1); expect(doc.symbols![0]).toMatchObject({ id: 'sym', name: 'Bolt', x: 10, y: 10, width: 30, height: 10 }); expect(doc.symbols![0].paths.map(p => p.id)).toEqual(['a', 'b']);
  expect(doc.layers[0].paths.map(p => p.id)).toEqual(['inst', 'keep']);
  const instance = doc.layers[0].paths[0]; expect(instance.symbolID).toBe('sym'); expect(instance.points).toEqual([[10, 10], [40, 10], [40, 20], [10, 20]]);
  expect(symbolMatrix(doc.symbols![0], instance)).toEqual([1, 0, 0, 1, 0, 0]);
  expect(readDocument(serializeDocument(doc))).toEqual(doc);
  expect(makeSymbol(doc, 'layer', ['inst'], 'Nested', { symbol: 's2', instance: 'i2' })).toBeNull(); // symbols do not nest
});
it('an instance moved, scaled or flipped by its corners shows the symbol transformed, in SVG and PDF', () => {
  const base = makeSymbol(drawing(square('a', 0, 0, 10)), 'layer', ['a'], 'S', { symbol: 'sym', instance: 'inst' })!;
  const moved: SketchDocument = { ...base, layers: [{ ...base.layers[0], paths: [{ ...base.layers[0].paths[0], points: [[100, 50], [120, 50], [120, 80], [100, 80]], opacity: .5 }] }] };
  expect(symbolOf(moved, moved.layers[0].paths[0])!.matrix).toEqual([2, 0, 0, 3, 100, 50]);
  const svg = drawingSVG(moved, { x: 0, y: 0, width: 200, height: 100 });
  expect(svg).toContain('<g transform="matrix(2 0 0 3 100 50)" opacity="0.5"><path d="'); expect(svg).toContain('fill="#00ff00"');
  const pdf = latin(drawingPDF(moved, { x: 0, y: 0, width: 200, height: 100 }));
  expect(pdf).toContain('q 2 0 0 3 100 50 cm'); expect(pdf).toMatch(/\/ca 0\.5 /); // the instance's opacity reaches the symbol's paths
  // Flipped left to right: the top-left corner is now on the right.
  const flipped = { ...moved.layers[0].paths[0], points: [[120, 50], [100, 50], [100, 80], [120, 80]] as [number, number][] };
  expect(symbolMatrix(base.symbols![0], flipped)[0]).toBe(-2);
});
it('detaching gives plain paths where the instance stood, with strokes at its scale', () => {
  const base = makeSymbol(drawing(square('a', 0, 0, 10)), 'layer', ['a'], 'S', { symbol: 'sym', instance: 'inst' })!;
  const doc: SketchDocument = { ...base, layers: [{ ...base.layers[0], paths: [{ ...base.layers[0].paths[0], points: [[100, 50], [120, 50], [120, 70], [100, 70]] }] }] };
  let n = 0; const { doc: loose, ids } = detachInstances(doc, 'layer', ['inst'], () => `new${n++}`);
  expect(ids).toEqual(['new0']); expect(loose.layers[0].paths).toHaveLength(1);
  expect(loose.layers[0].paths[0]).toMatchObject({ id: 'new0', points: [[100, 50], [120, 50], [120, 70], [100, 70]], widthPx: 4, fill: '#00ff00' }); expect(loose.layers[0].paths[0].symbolID).toBeUndefined();
  expect(loose.symbols).toHaveLength(1); // the symbol itself stays
});
it('redrawing a symbol updates every instance, which keep their place, size ratio and angle', () => {
  const base = makeSymbol(drawing(square('a', 0, 0, 10)), 'layer', ['a'], 'S', { symbol: 'sym', instance: 'one' })!;
  const two: SketchDocument = { ...base, layers: [{ ...base.layers[0], paths: [base.layers[0].paths[0], { ...newInstance(base.symbols![0], 'two'), points: [[100, 100], [120, 100], [120, 120], [100, 120]] }, square('edited', 300, 300, 30)] }] };
  const next = redefineSymbol(two, 'sym', 'layer', ['edited'], 'three')!;
  expect(next.symbols![0]).toMatchObject({ x: 300, y: 300, width: 30, height: 30 }); expect(next.symbols![0].paths.map(p => p.id)).toEqual(['edited']);
  const [one, twice, three] = next.layers[0].paths;
  expect(one.points).toEqual([[-10, -10], [20, -10], [20, 20], [-10, 20]]); // same centre (5, 5), same 1:1 scale, three times the content
  expect(twice.points).toEqual([[80, 80], [140, 80], [140, 140], [80, 140]]); // the 2:1 instance stays 2:1 about its centre
  expect(three).toMatchObject({ id: 'three', symbolID: 'sym', points: [[300, 300], [330, 300], [330, 330], [300, 330]] }); // the edited paths became an instance
  expect(() => readDocument(serializeDocument(next))).not.toThrow();
});
it('deleting a symbol leaves its instances as plain paths, and a file with a dangling or malformed instance is refused', () => {
  const base = makeSymbol(drawing(square('a', 0, 0, 10)), 'layer', ['a'], 'S', { symbol: 'sym', instance: 'inst' })!;
  const gone = deleteSymbol(base, 'sym', () => 'plain');
  expect(gone.symbols).toBeUndefined(); expect(gone.layers[0].paths[0]).toMatchObject({ id: 'plain', fill: '#00ff00' }); expect(gone.layers[0].paths[0].symbolID).toBeUndefined();
  const dangling = JSON.parse(serializeDocument(base)); dangling.symbols = []; expect(() => readDocument(JSON.stringify(dangling))).toThrow();
  const bent = JSON.parse(serializeDocument(base)); bent.layers[0].paths[0].points.push([1, 1]); expect(() => readDocument(JSON.stringify(bent))).toThrow();
  const nested = JSON.parse(serializeDocument(base)); nested.symbols[0].paths.push({ ...base.layers[0].paths[0], id: 'inner' }); expect(() => readDocument(JSON.stringify(nested))).toThrow();
});
