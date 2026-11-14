import type { VectorText } from './text';
import { readBoard, type BoardItem } from './board';
import { isVectorGradient, type VectorAppearance, type SketchPath } from '@aether/sketch';
/** `blurPx` softens a path (airbrush, soft brushes): a Gaussian blur in document units. */
/** `widthProfile` makes the stroke swell or taper along its length; `dashPx` is a custom dash and gap in pixels (it wins over the named `dash`); `arrowStart` and `arrowEnd` put heads on an open path. */
export interface DrawingPath extends SketchPath, VectorAppearance { widthProfile?: 'taper-end' | 'taper-start' | 'taper-both' | 'pinch'; dashPx?: [number, number]; arrowStart?: 'arrow' | 'dot' | 'bar'; arrowEnd?: 'arrow' | 'dot' | 'bar'; text?: VectorText; fillOpen?: boolean; blurPx?: number; id: string; name?: string; groupID?: string; hidden?: boolean; locked?: boolean; fill?: string | null; color: string; widthPx: number; opacity: number }
export interface PathGroup { clipPathID?: string; id: string; name: string; parentID?: string; hidden?: boolean; locked?: boolean }
/** Layer blend modes: the names CSS, SVG, OpenRaster (as svg:…) and PDF (capitalised) share. */
export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'] as const;
export type BlendMode = typeof BLEND_MODES[number];
/** `opacity` (0–1) and `blend` are optional; absent means 1 and normal. */
/** A pixel layer's bitmap: a PNG covering `width`×`height` document pixels from (`x`, `y`). */
export interface PixelBitmap { x: number; y: number; width: number; height: number; src: string }
/** A layer holds vector paths, or (`kind: 'pixel'`) one bitmap and no paths. `pixels` is absent until something is painted. */
/** Layer effects, in document pixels: `blurPx` softens the whole layer, a shadow is offset, a glow is not. */
export interface LayerEffects { blurPx?: number; shadow?: { dxPx: number; dyPx: number; blurPx: number; color: string; opacity: number }; glow?: { blurPx: number; color: string; opacity: number } }
/** What an adjustment layer does to the picture beneath it. Each amount runs -1 to 1 and 0 changes nothing; hue is in degrees. */
export interface Adjustment { brightness: number; contrast: number; saturation: number; hueDeg: number; invert?: boolean }
/** `role`: a `clip` layer shows only where the layer below it is painted; a `mask` layer is not drawn and hides the layer below wherever the mask is painted. Either needs a layer below.
 * `adjust` recolours everything beneath the layer (only the layer below when the layer is also a clip). */
export interface Layer { groups?: PathGroup[]; id: string; name: string; visible: boolean; locked: boolean; paths: DrawingPath[]; opacity?: number; blend?: BlendMode; kind?: 'pixel'; pixels?: PixelBitmap; role?: 'clip' | 'mask'; effects?: LayerEffects; adjust?: Adjustment }
/** `board` (optional) holds the Freeform-style items on the infinite canvas; older drawings have none.
 * `infinite` drawings have no artboard: exports frame whatever is drawn. Older drawings keep their artboard. */
export interface SketchDocument { format: 'aethersketch'; version: 2; widthPx: number; heightPx: number; layers: Layer[]; board?: BoardItem[]; infinite?: boolean }
export function newLayer(name: string): Layer { return { id: crypto.randomUUID(), name, visible: true, locked: false, paths: [] }; }
export function newPixelLayer(name: string): Layer { return { ...newLayer(name), kind: 'pixel' }; }
export function newDocument(): SketchDocument { return { format: 'aethersketch', version: 2, widthPx: 1200, heightPx: 800, infinite: true, layers: [newLayer('Layer 1')] }; }
export const serializeDocument = (doc: SketchDocument) => JSON.stringify(doc, null, 2);

/** Reject unsupported documents before replacing the current drawing. No executable SVG is loaded. */
export function readDocument(text: string): SketchDocument {
  if (text.length > 20_000_000) throw new Error('This drawing exceeds the 20 MB limit.');
  const doc = JSON.parse(text);
  const check = (condition: unknown) => { if (!condition) throw new Error('Invalid or unsupported .aethersketch document.'); };
  const number = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const point = (p: unknown) => Array.isArray(p) && p.length === 2 && p.every(v => number(v, -1e7, 1e7));
  const ids = new Set<string>();
  const id = (v: unknown) => { check(typeof v === 'string' && v.length > 0 && v.length <= 100 && !ids.has(v)); ids.add(v as string); };
  check(doc?.format === 'aethersketch' && [1, 2].includes(doc.version) && number(doc.widthPx, 1, 16384) && number(doc.heightPx, 1, 16384));
  check(Array.isArray(doc.layers) && doc.layers.length > 0 && doc.layers.length <= 500);
  check(doc.infinite === undefined || typeof doc.infinite === 'boolean');
  let vertices = 0;
  const geometry = (p: SketchPath, child = false) => {
    check(p && typeof p === 'object');
    check(Array.isArray(p.points) && p.points.length >= 2 && p.points.every(point));
    vertices += p.points.length; check(vertices <= 100000);
    check(typeof p.closed === 'boolean');
    check(p.fillRule === undefined || ['evenodd', 'nonzero'].includes(p.fillRule));
    if (p.nodeModes !== undefined) check(Array.isArray(p.nodeModes) && p.nodeModes.length === p.points.length && p.nodeModes.every(m => ['corner', 'smooth', 'symmetric'].includes(m)));
    if (p.curves !== undefined) check(Array.isArray(p.curves) && p.curves.length === p.points.length && p.curves.every(c => c === null || (c && point(c.c1) && point(c.c2))));
    if (p.subpaths !== undefined) {
      check(!child && Array.isArray(p.subpaths) && p.subpaths.length <= 1000);
      p.subpaths.forEach(sub => geometry(sub, true));
    }
  };
  for (const layer of doc.layers) {
    check(layer && typeof layer === 'object'); id(layer.id);
    check(typeof layer.name === 'string' && layer.name.length <= 200 && typeof layer.visible === 'boolean' && typeof layer.locked === 'boolean');
    check(Array.isArray(layer.paths) && layer.paths.length <= 10000);
    check(layer.kind === undefined || layer.kind === 'pixel');
    check(layer.pixels === undefined || layer.kind === 'pixel');
    if (layer.kind === 'pixel') check(layer.paths.length === 0 && !layer.groups?.length);
    if (layer.pixels !== undefined) {
      // PNG data only: the bitmap is shown as an image, never run. Sizes match the editor's limit (pixels.ts).
      const b = layer.pixels, whole = (v: unknown, min: number, max: number) => Number.isInteger(v) && number(v, min, max);
      check(b && typeof b === 'object' && whole(b.x, -1e7, 1e7) && whole(b.y, -1e7, 1e7) && whole(b.width, 1, 4096) && whole(b.height, 1, 4096));
      check(typeof b.src === 'string' && b.src.startsWith('data:image/png;base64,') && /^[A-Za-z0-9+/]+=*$/.test(b.src.slice(22)));
    }
    check(layer.opacity === undefined || number(layer.opacity, 0, 1)); check(layer.blend === undefined || BLEND_MODES.includes(layer.blend));
    check(layer.role === undefined || layer.role === 'clip' || layer.role === 'mask');
    const hex = (v: unknown) => typeof v === 'string' && /^#[\da-f]{6}$/i.test(v);
    if (layer.effects !== undefined) {
      const e = layer.effects; check(e && typeof e === 'object' && (e.blurPx === undefined || number(e.blurPx, 0, 500)));
      for (const soft of [e.shadow, e.glow]) check(soft === undefined || (soft && typeof soft === 'object' && number(soft.blurPx, 0, 500) && hex(soft.color) && number(soft.opacity, 0, 1)));
      check(e.shadow === undefined || (number(e.shadow.dxPx, -5000, 5000) && number(e.shadow.dyPx, -5000, 5000)));
    }
    if (layer.adjust !== undefined) {
      const a = layer.adjust; check(a && typeof a === 'object' && ['brightness', 'contrast', 'saturation'].every(key => number(a[key], -1, 1)) && number(a.hueDeg, -180, 180) && (a.invert === undefined || typeof a.invert === 'boolean'));
    }
    check(layer.groups === undefined || (Array.isArray(layer.groups) && layer.groups.length <= 10000));
    for (const group of layer.groups ?? []) { check(group && typeof group === 'object'); id(group.id); check(typeof group.name === 'string' && group.name.length <= 200); }
    const groups = new Map<string, PathGroup>((layer.groups ?? []).map((g: PathGroup) => [g.id, g]));
    for (const group of layer.groups ?? []) {
      const visited = new Set<string>([group.id]); let parent = group.parentID;
      while (parent !== undefined) { check(groups.has(parent) && !visited.has(parent)); visited.add(parent); parent = groups.get(parent)!.parentID; }
      check(group.hidden === undefined || typeof group.hidden === 'boolean'); check(group.locked === undefined || typeof group.locked === 'boolean');
    }
    for (const path of layer.paths) {
      check(path && typeof path === 'object'); id(path.id);
      geometry(path);
      check(path.groupID === undefined || groups.has(path.groupID));
      check(path.name === undefined || (typeof path.name === 'string' && path.name.length <= 200));
      check(path.hidden === undefined || typeof path.hidden === 'boolean'); check(path.locked === undefined || typeof path.locked === 'boolean');
      check(path.fill === undefined || path.fill === null || (typeof path.fill === 'string' && /^#[\da-f]{6}$/i.test(path.fill)));
      check(path.fillOpen === undefined || typeof path.fillOpen === 'boolean');
      check(path.fillGradient === undefined || isVectorGradient(path.fillGradient));
      for (const key of ['fillOpacity', 'strokeOpacity']) check(path[key] === undefined || number(path[key], 0, 1));
      check(path.strokeEnabled === undefined || typeof path.strokeEnabled === 'boolean');
      check(path.lineCap === undefined || ['butt', 'round', 'square'].includes(path.lineCap));
      check(path.lineJoin === undefined || ['miter', 'round', 'bevel'].includes(path.lineJoin));
      check(path.dash === undefined || ['solid', 'dashed', 'dotted'].includes(path.dash));
      check(path.dashPx === undefined || (Array.isArray(path.dashPx) && path.dashPx.length === 2 && path.dashPx.every((v: unknown) => number(v, .1, 10000))));
      check(path.widthProfile === undefined || ['taper-end', 'taper-start', 'taper-both', 'pinch'].includes(path.widthProfile));
      for (const key of ['arrowStart', 'arrowEnd']) check(path[key] === undefined || ['arrow', 'dot', 'bar'].includes(path[key]));
      check(typeof path.color === 'string' && /^#[\da-f]{6}$/i.test(path.color));
      check(number(path.widthPx, .1, 200) && number(path.opacity, 0, 1)); check(path.blurPx === undefined || number(path.blurPx, 0, 1e6));
      if (path.text !== undefined) {
        const t = path.text;
        // Text in a box has four corners; text on a path (`onPath`) follows any single contour.
        check(t && typeof t === 'object' && !path.subpaths && (t.onPath === true || (t.onPath === undefined && path.points.length === 4 && !path.curves)));
        check(typeof t.content === 'string' && t.content.length <= 10000 && typeof t.fontFamily === 'string' && t.fontFamily.length <= 200);
        check(number(t.fontSizePx, 1, 2000) && number(t.fontWeight, 100, 900) && typeof t.italic === 'boolean');
        check(['start', 'middle', 'end'].includes(t.align) && number(t.lineHeight, .5, 5) && number(t.widthPx, .01, 1e7) && number(t.heightPx, .01, 1e7));
      }
    }
    for (const group of layer.groups ?? []) {
      if (group.clipPathID === undefined) continue;
      const clip = layer.paths.find((p: DrawingPath) => p.id === group.clipPathID);
      check(clip?.closed && !clip.text && clip.groupID === group.id);
    }
  }
  const board = readBoard(doc.board, ids), { board: _raw, ...rest } = doc;
  return { ...rest, version: 2, ...(board.length ? { board } : {}) };
}
