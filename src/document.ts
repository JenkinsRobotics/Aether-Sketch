import type { VectorText } from './text';
import { isVectorGradient, type VectorAppearance, type SketchPath } from '@aether/sketch';
export interface DrawingPath extends SketchPath, VectorAppearance { text?: VectorText; fillOpen?: boolean; id: string; name?: string; groupID?: string; hidden?: boolean; locked?: boolean; fill?: string | null; color: string; widthPx: number; opacity: number }
export interface PathGroup { clipPathID?: string; id: string; name: string; parentID?: string; hidden?: boolean; locked?: boolean }
export interface Layer { groups?: PathGroup[]; id: string; name: string; visible: boolean; locked: boolean; paths: DrawingPath[] }
export interface SketchDocument { format: 'aethersketch'; version: 2; widthPx: number; heightPx: number; layers: Layer[] }
export function newLayer(name: string): Layer { return { id: crypto.randomUUID(), name, visible: true, locked: false, paths: [] }; }
export function newDocument(): SketchDocument { return { format: 'aethersketch', version: 2, widthPx: 1200, heightPx: 800, layers: [newLayer('Layer 1')] }; }
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
      check(typeof path.color === 'string' && /^#[\da-f]{6}$/i.test(path.color));
      check(number(path.widthPx, .1, 200) && number(path.opacity, 0, 1));
      if (path.text !== undefined) {
        const t = path.text;
        check(t && typeof t === 'object' && path.points.length === 4 && !path.subpaths && !path.curves);
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
  return { ...doc, version: 2 };
}
