import { textSVG } from './text';
import { gradientVector, pathBounds, pathData, strokeDash, transformPath } from '@aether/sketch';
import { ancestors, pathLocked, pathVisible } from './structure';
import type { DrawingPath, Layer, SketchDocument } from './document';
import { pixelBounds, unionRect } from './pixels';
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
    filter: p.blurPx ? `url(#${gradientID.replace(/-gradient$/, '-blur')})` : undefined,
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
const xmlText = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
/** What an export frames: the artboard, or for an infinite drawing everything drawn, with a small margin. */
export function exportArea(doc: SketchDocument) {
  const drawn = doc.infinite ? unionRect(pathBounds(doc.layers.filter(l => l.visible).flatMap(l => l.paths.filter(p => pathVisible(l, p)))), pixelBounds(doc.layers)) : null;
  if (!drawn) return { x: 0, y: 0, width: doc.widthPx, height: doc.heightPx };
  const margin = Math.max(drawn.width, drawn.height) * .02, x = drawn.x - margin, y = drawn.y - margin;
  return { x, y, width: Math.max(drawn.width + margin * 2, 1e-6), height: Math.max(drawn.height + margin * 2, 1e-6) };
}
/** Standard SVG. Each layer is an Inkscape layer (name, hidden state, opacity, blend), so layers survive a round trip through Inkscape. */
/** A blur's filter region in drawing units: the path's bounds plus three standard deviations, so soft edges are never cut off. */
export function blurRegion(p: DrawingPath) {
  const b = pathBounds([p]) ?? { x: 0, y: 0, width: 0, height: 0 }, pad = (p.blurPx ?? 0) * 3;
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}
export function drawingSVG(doc: SketchDocument, area = exportArea(doc)): string {
  const ids = paintIDs(doc), all = doc.layers.flatMap(l => l.paths);
  const defs = all.map(p => {
    const id = ids.get(p.id)!, g = p.fillGradient;
    const clip = `<clipPath id="${id}-clip" clipPathUnits="userSpaceOnUse"><path d="${pathData(p)}" clip-rule="${p.fillRule ?? 'nonzero'}"/></clipPath>`;
    const blur = p.blurPx ? `<filter id="${id}-blur" filterUnits="userSpaceOnUse" ${Object.entries(blurRegion(p)).map(([k, v]) => `${k}="${+v.toPrecision(10)}"`).join(' ')}><feGaussianBlur stdDeviation="${p.blurPx}"/></filter>` : '';
    if (!g) return clip + blur;
    const tag = g.kind === 'linear' ? 'linearGradient' : 'radialGradient';
    const position = g.kind === 'linear' ? Object.entries(gradientVector(g.angleDeg)).map(([k, v]) => `${k}="${v}"`).join(' ') : 'cx="0.5" cy="0.5" r="0.5"';
    return clip + blur + `<${tag} id="${id}-gradient" ${position}>${g.stops.map(s => `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.opacity}"/>`).join('')}</${tag}>`;
  }).join('');
  const body = [...doc.layers].reverse().map((l, index) => {
    const shown = { ...l, visible: true };
    const markup = l.paths.filter(p => pathVisible(shown, p)).map(p => {
      const attrs = Object.entries(paintAttributes(p, `${ids.get(p.id)}-gradient`)).filter(([, value]) => value !== undefined).map(([key, value]) => `${attributeNames[key] ?? key}="${value}"`).join(' ');
      return clipPaths(l, p).reduce((m, clip) => `<g clip-path="url(#${ids.get(clip.id)}-clip)">${m}</g>`, (p.text ? textSVG(p, attrs) : `<path d="${pathData(p)}" ${attrs}/>`));
    }).join('');
    const b = l.pixels, bitmap = b ? `<image href="${b.src}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" preserveAspectRatio="none"/>` : '';
    const style = [l.visible ? '' : 'display:none', (l.opacity ?? 1) < 1 ? `opacity:${l.opacity}` : '', l.blend && l.blend !== 'normal' ? `mix-blend-mode:${l.blend}` : ''].filter(Boolean).join(';');
    return `<g id="layer${index + 1}" inkscape:groupmode="layer" inkscape:label="${xmlText(l.name)}"${style ? ` style="${style}"` : ''}>${bitmap}${markup}</g>`;
  }).join('');
  const n = (v: number) => +v.toPrecision(10);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${n(area.width)}" height="${n(area.height)}" viewBox="${n(area.x)} ${n(area.y)} ${n(area.width)} ${n(area.height)}"><defs>${defs}</defs>${body}</svg>`;
}
