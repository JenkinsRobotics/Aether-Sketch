// Symbols: a drawing kept once in the document and placed many times. An instance is a path whose four points are the
// corners the symbol's box sits on, so moving, scaling, rotating and flipping an instance are ordinary point edits.
import { pathBounds, transformPath, type Point } from '@aether/sketch';
import { type DrawingPath, type Layer, type SketchDocument, type SymbolDef } from './document';

export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];
const apply = (m: Matrix, [x, y]: Point): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
/** The transform that carries the symbol's box onto an instance's corners. */
export function symbolMatrix(def: SymbolDef, instance: DrawingPath): Matrix {
  const [o, x, , y] = instance.points, a = (x[0] - o[0]) / def.width, b = (x[1] - o[1]) / def.width, c = (y[0] - o[0]) / def.height, d = (y[1] - o[1]) / def.height;
  return [a, b, c, d, o[0] - a * def.x - c * def.y, o[1] - b * def.x - d * def.y];
}
/** The symbol an instance shows and where: null for other paths, and for an instance whose symbol is gone. */
export function symbolOf(doc: SketchDocument, p: DrawingPath): { def: SymbolDef; matrix: Matrix } | null {
  const def = p.symbolID ? doc.symbols?.find(s => s.id === p.symbolID) : undefined;
  return def && p.points.length === 4 ? { def, matrix: symbolMatrix(def, p) } : null;
}
const corners = (def: SymbolDef, m: Matrix): Point[] => ([[def.x, def.y], [def.x + def.width, def.y], [def.x + def.width, def.y + def.height], [def.x, def.y + def.height]] as Point[]).map(v => apply(m, v));
/** A new instance: the symbol at its own size, centred on `at` (or where it was made). */
export function newInstance(def: SymbolDef, id: string, at?: Point): DrawingPath {
  const m: Matrix = at ? [1, 0, 0, 1, at[0] - def.x - def.width / 2, at[1] - def.y - def.height / 2] : [1, 0, 0, 1, 0, 0];
  return { id, name: def.name, symbolID: def.id, points: corners(def, m), closed: true, color: '#000000', fill: null, strokeEnabled: false, widthPx: 1, opacity: 1 };
}
/** The symbol's frame around these paths; a line still gets a box with some size. */
const frame = (paths: DrawingPath[]) => { const b = pathBounds(paths) ?? { x: 0, y: 0, width: 1, height: 1 }; return { x: b.x, y: b.y, width: Math.max(b.width, 1e-3), height: Math.max(b.height, 1e-3) }; };
/** Turn the chosen paths of a layer into a symbol, leaving one instance where they were. Instances cannot go inside a symbol. */
export function makeSymbol(doc: SketchDocument, layerID: string, pathIDs: readonly string[], name: string, ids: { symbol: string; instance: string }): SketchDocument | null {
  const layer = doc.layers.find(l => l.id === layerID), chosen = layer?.paths.filter(p => pathIDs.includes(p.id) && !p.symbolID) ?? [];
  if (!layer || !chosen.length) return null;
  // The symbol's paths stand alone: no groups, so a "draw inside" clip is not carried over.
  const def: SymbolDef = { id: ids.symbol, name, ...frame(chosen), paths: chosen.map(({ groupID: _group, ...p }) => p) };
  const top = Math.max(...chosen.map(p => layer.paths.indexOf(p))), kept = layer.paths.filter(p => !chosen.includes(p));
  kept.splice(layer.paths.slice(0, top + 1).filter(p => !chosen.includes(p)).length, 0, newInstance(def, ids.instance));
  return { ...doc, symbols: [...(doc.symbols ?? []), def], layers: doc.layers.map(l => l === layer ? { ...l, paths: kept } : l) };
}
/** An instance as plain paths, where it stands: the link to the symbol is cut. Strokes take the instance's scale. */
export function detachedPaths(doc: SketchDocument, instance: DrawingPath, nextID: () => string): DrawingPath[] | null {
  const found = symbolOf(doc, instance); if (!found) return null;
  const scale = Math.sqrt(Math.abs(found.matrix[0] * found.matrix[3] - found.matrix[1] * found.matrix[2])) || 1;
  return found.def.paths.map(p => ({ ...p, ...transformPath(p, v => apply(found.matrix, v)), id: nextID(), groupID: instance.groupID, widthPx: Math.min(200, Math.max(.1, p.widthPx * scale)), opacity: p.opacity * instance.opacity,
    ...(p.blurPx ? { blurPx: p.blurPx * scale } : {}), ...(p.dashPx ? { dashPx: [p.dashPx[0] * scale, p.dashPx[1] * scale] as [number, number] } : {}) }));
}
const replaceInstances = (layer: Layer, change: (p: DrawingPath) => DrawingPath[]): Layer => layer.paths.some(p => p.symbolID) ? { ...layer, paths: layer.paths.flatMap(p => p.symbolID ? change(p) : [p]) } : layer;
/** Detach the chosen instances on a layer. Returns the new drawing and the ids of the paths that replaced them. */
export function detachInstances(doc: SketchDocument, layerID: string, pathIDs: readonly string[], nextID: () => string = () => crypto.randomUUID()): { doc: SketchDocument; ids: string[] } {
  const ids: string[] = [];
  const layers = doc.layers.map(l => l.id !== layerID ? l : replaceInstances(l, p => { const plain = pathIDs.includes(p.id) ? detachedPaths(doc, p, nextID) : null; if (plain) ids.push(...plain.map(q => q.id)); return plain ?? [p]; }));
  return { doc: { ...doc, layers }, ids };
}
/** Remove a symbol. Its instances stay in the drawing as plain paths. */
export function deleteSymbol(doc: SketchDocument, symbolID: string, nextID: () => string = () => crypto.randomUUID()): SketchDocument {
  const layers = doc.layers.map(l => replaceInstances(l, p => p.symbolID === symbolID ? detachedPaths(doc, p, nextID) ?? [] : [p])), symbols = (doc.symbols ?? []).filter(s => s.id !== symbolID);
  const { symbols: _old, ...rest } = doc; return { ...rest, layers, ...(symbols.length ? { symbols } : {}) };
}
/** Redraw a symbol from the chosen paths of a layer, which become an instance. Every other instance keeps its centre,
 * size ratio and angle, and shows the new drawing. Edit a detached copy made at the symbol's own size, so sizes agree. */
export function redefineSymbol(doc: SketchDocument, symbolID: string, layerID: string, pathIDs: readonly string[], instanceID: string): SketchDocument | null {
  const old = doc.symbols?.find(s => s.id === symbolID), layer = doc.layers.find(l => l.id === layerID), chosen = layer?.paths.filter(p => pathIDs.includes(p.id) && !p.symbolID) ?? [];
  if (!old || !layer || !chosen.length) return null;
  const def: SymbolDef = { ...old, ...frame(chosen), paths: chosen.map(({ groupID: _group, ...p }) => p) };
  const refit = (p: DrawingPath): DrawingPath => {
    const m = symbolMatrix(old, p), centre: Point = [(p.points[0][0] + p.points[2][0]) / 2, (p.points[0][1] + p.points[2][1]) / 2];
    const moved: Matrix = [m[0], m[1], m[2], m[3], 0, 0], middle = apply(moved, [def.x + def.width / 2, def.y + def.height / 2]);
    return { ...p, points: corners(def, [m[0], m[1], m[2], m[3], centre[0] - middle[0], centre[1] - middle[1]]) };
  };
  const top = Math.max(...chosen.map(p => layer.paths.indexOf(p)));
  return { ...doc, symbols: doc.symbols!.map(s => s.id === symbolID ? def : s), layers: doc.layers.map(l => {
    const refitted = replaceInstances(l, p => [p.symbolID === symbolID ? refit(p) : p]);
    if (l !== layer) return refitted;
    const kept = refitted.paths.filter(p => !chosen.some(c => c.id === p.id));
    kept.splice(layer.paths.slice(0, top + 1).filter(p => !chosen.includes(p)).length, 0, newInstance(def, instanceID));
    return { ...refitted, paths: kept };
  }) };
}
