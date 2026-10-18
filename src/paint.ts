import { textSVG } from './text';
import { gradientVector, pathData, strokeDash, transformPath } from '@aether/sketch';
import { ancestors, pathLocked, pathVisible } from './structure';
import type { DrawingPath, Layer, SketchDocument } from './document';
export const paintKeys = ['color', 'fill', 'widthPx', 'opacity', 'fillGradient', 'fillOpacity', 'strokeOpacity', 'strokeEnabled', 'lineCap', 'lineJoin', 'dash'] as const;
export type PaintStyle = Pick<DrawingPath, typeof paintKeys[number]>;
export const defaultPaint: PaintStyle = { color: '#2368ce', fill: '#bcd4f5', widthPx: 3, opacity: 1, fillOpacity: 1, strokeOpacity: 1, strokeEnabled: true, lineCap: 'round', lineJoin: 'round', dash: 'solid' };
export const copyPaint = (p: PaintStyle): PaintStyle => Object.fromEntries(paintKeys.map(key => [key, p[key]])) as PaintStyle;
export function paintAttributes(p: DrawingPath, gradientID: string) {
  return {
    fill: (!p.closed && !p.fillOpen) || p.fill === null ? 'none' : p.fillGradient ? `url(#${gradientID})` : p.fill ?? p.color,
    fillRule: p.fillRule ?? 'nonzero',
    fillOpacity: p.fillOpacity ?? (p.fill === undefined ? .15 : 1),
    stroke: p.strokeEnabled === false ? 'none' : p.color, strokeWidth: p.widthPx,
    strokeOpacity: p.strokeOpacity ?? 1, opacity: p.opacity,
    strokeLinecap: p.lineCap ?? 'round', strokeLinejoin: p.lineJoin ?? 'round',
    strokeDasharray: strokeDash(p.dash, p.widthPx)?.join(' '),
  };
}
export function clipPaths(layer: Layer, path: DrawingPath): DrawingPath[] {
  return ancestors(layer, path.groupID).flatMap(g => {
    const clip = layer.paths.find(p => p.id === g.clipPathID);
    return clip?.closed && clip.id !== path.id ? [clip] : [];
  });
}
/** Keep references valid after deletion, ungrouping, opening or moving a boundary. */
export function repairClips(doc: SketchDocument): SketchDocument {
  return { ...doc, layers: doc.layers.map(l => ({ ...l, groups: l.groups?.map(g =>
    g.clipPathID && !l.paths.some(p => p.id === g.clipPathID && p.closed && !p.text && p.groupID === g.id)
      ? { ...g, clipPathID: undefined } : g) })) };
}
/** A live boundary plus its contents form a normal movable clipping group. */
export function addInside(layer: Layer, targetID: string, paths: DrawingPath[], groupID: string): Layer {
  const target = layer.paths.find(p => p.id === targetID);
  if (!target?.closed || !pathVisible(layer, target) || pathLocked(layer, target)) return layer;
  const existing = layer.groups?.find(g => g.clipPathID === targetID);
  const group = existing ?? { id: groupID, name: `Inside ${target.name ?? 'shape'}`, parentID: target.groupID, clipPathID: targetID };
  const next = layer.paths.map(p => p.id === targetID ? { ...p, groupID: group.id } : p);
  const members = layer.paths.filter(p => ancestors(layer, p.groupID).some(g => g.id === group.id));
  const index = Math.max(layer.paths.indexOf(target), ...members.map(p => layer.paths.indexOf(p))) + 1;
  next.splice(index, 0, ...paths.map(p => ({ ...p, groupID: group.id })));
  return { ...layer, groups: existing ? layer.groups : [...(layer.groups ?? []), group], paths: next };
}
export function paintIDs(doc: SketchDocument) {
  return new Map(doc.layers.flatMap(l => l.paths).map((p, i) => [p.id, `sketch-vector-${i}`]));
}
/** Duplicate complete groups with new boundary references; a single child stays independent. */
export function duplicatePaintSelection(layer: Layer, selected: string[], nextID = () => crypto.randomUUID()) {
  const originals = layer.paths.filter(p => selected.includes(p.id));
  if (layer.locked || !layer.visible || originals.some(p => pathLocked(layer, p) || !pathVisible(layer, p))) return { layer, selected };
  const groups = (layer.groups ?? []).filter(g => {
    const members = layer.paths.filter(p => ancestors(layer, p.groupID).some(a => a.id === g.id));
    return members.length && members.every(p => selected.includes(p.id));
  });
  const ids = new Map([...originals, ...groups].map(item => [item.id, nextID()]));
  const clones = originals.map(p => ({ ...p, ...transformPath(p, v => [v[0] + 20, v[1] + 20]), id: ids.get(p.id)!, groupID: p.groupID ? ids.get(p.groupID) : undefined }));
  return {
    layer: { ...layer, paths: [...layer.paths, ...clones], groups: [...(layer.groups ?? []), ...groups.map(g => ({ ...g, id: ids.get(g.id)!, parentID: g.parentID ? ids.get(g.parentID) : undefined, clipPathID: g.clipPathID ? ids.get(g.clipPathID) : undefined }))] },
    selected: clones.map(p => p.id),
  };
}
const attributeNames: Record<string, string> = { fillRule: 'fill-rule', fillOpacity: 'fill-opacity', strokeWidth: 'stroke-width', strokeOpacity: 'stroke-opacity', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', strokeDasharray: 'stroke-dasharray' };
export function drawingSVG(doc: SketchDocument): string {
  const ids = paintIDs(doc), all = doc.layers.flatMap(l => l.paths);
  const defs = all.map(p => {
    const id = ids.get(p.id)!, g = p.fillGradient;
    const clip = `<clipPath id="${id}-clip" clipPathUnits="userSpaceOnUse"><path d="${pathData(p)}" clip-rule="${p.fillRule ?? 'nonzero'}"/></clipPath>`;
    if (!g) return clip;
    const tag = g.kind === 'linear' ? 'linearGradient' : 'radialGradient';
    const position = g.kind === 'linear' ? Object.entries(gradientVector(g.angleDeg)).map(([k, v]) => `${k}="${v}"`).join(' ') : 'cx="0.5" cy="0.5" r="0.5"';
    return clip + `<${tag} id="${id}-gradient" ${position}>${g.stops.map(s => `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.opacity}"/>`).join('')}</${tag}>`;
  }).join('');
  const body = [...doc.layers].reverse().flatMap(l => l.paths.filter(p => pathVisible(l, p)).map(p => {
    const attrs = Object.entries(paintAttributes(p, `${ids.get(p.id)}-gradient`)).filter(([, value]) => value !== undefined).map(([key, value]) => `${attributeNames[key] ?? key}="${value}"`).join(' ');
    return clipPaths(l, p).reduce((markup, clip) => `<g clip-path="url(#${ids.get(clip.id)}-clip)">${markup}</g>`, (p.text ? textSVG(p, attrs) : `<path d="${pathData(p)}" ${attrs}/>`));
  })).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${doc.widthPx}" height="${doc.heightPx}" viewBox="0 0 ${doc.widthPx} ${doc.heightPx}"><defs>${defs}</defs>${body}</svg>`;
}
