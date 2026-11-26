import { textSVG } from './text';
import { gradientVector, pathBounds, pathData, transformPath } from '@aether/sketch';
import { dashArray, drawnParts } from './vector';
import { ancestors, pathLocked, pathVisible } from './structure';
import { docArtboards, type DrawingPath, type Layer, type SketchDocument } from './document';
import { pixelBounds, unionRect } from './pixels';
import { symbolOf } from './symbols';
import { composeLayers, depthAttributes, depthDefs, depthRegion, effectReach, layerDepths, layerDOMID, usesDepth, type Depth } from './depth';
export const paintKeys = ['color', 'fill', 'widthPx', 'opacity', 'fillGradient', 'fillOpacity', 'strokeOpacity', 'strokeEnabled', 'lineCap', 'lineJoin', 'dash', 'dashPx', 'arrowStart', 'arrowEnd', 'widthProfile'] as const;
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
    strokeDasharray: dashArray(p)?.join(' '),
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
  // A flipbook frame whose layer is gone (deleted, merged away) leaves the flipbook; a flipbook with no frames is no flipbook.
  if (doc.flipbook && doc.flipbook.frames.some(id => !doc.layers.some(l => l.id === id))) {
    const frames = doc.flipbook.frames.filter(id => doc.layers.some(l => l.id === id)), { flipbook: book, ...rest } = doc;
    doc = frames.length ? { ...rest, flipbook: { ...book, frames } } : rest;
  }
  return { ...doc, layers: doc.layers.map(l => ({ ...l, groups: l.groups?.map(g =>
    g.clipPathID && !l.paths.some(p => p.id === g.clipPathID && p.closed && !p.text && !p.symbolID && p.groupID === g.id)
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
/** Every path that can be drawn: the layers' own and the ones inside symbols. */
export const paintedPaths = (doc: SketchDocument) => [...doc.layers.flatMap(l => l.paths), ...(doc.symbols ?? []).flatMap(s => s.paths)];
export function paintIDs(doc: SketchDocument) {
  return new Map(paintedPaths(doc).map((p, i) => [p.id, `sketch-vector-${i}`]));
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
/** What an export frames: the given artboard (else the first), or for an infinite drawing everything drawn, with a small margin. */
export function exportArea(doc: SketchDocument, artboardID?: string) {
  const boards = docArtboards(doc), board = boards.find(b => b.id === artboardID) ?? boards[0];
  if (board) return { x: board.x, y: board.y, width: board.width, height: board.height };
  // Working masks are not part of the picture; shadows and glows are.
  const depths = layerDepths(doc), seen = doc.layers.filter((_, i) => depths[i].drawn);
  const drawn = doc.infinite ? unionRect(pathBounds(seen.flatMap(l => l.paths.filter(p => pathVisible(l, p)))), pixelBounds(seen)) : null;
  if (!drawn) return { x: 0, y: 0, width: doc.widthPx, height: doc.heightPx };
  const margin = Math.max(drawn.width, drawn.height) * .02 + Math.max(0, ...seen.map(l => effectReach(l.effects))), x = drawn.x - margin, y = drawn.y - margin;
  return { x, y, width: Math.max(drawn.width + margin * 2, 1e-6), height: Math.max(drawn.height + margin * 2, 1e-6) };
}
/** Standard SVG. Each layer is an Inkscape layer (name, hidden state, opacity, blend), so layers survive a round trip through Inkscape. */
/** A blur's filter region in drawing units: the path's bounds plus three standard deviations, so soft edges are never cut off. */
export function blurRegion(p: DrawingPath) {
  const b = pathBounds([p]) ?? { x: 0, y: 0, width: 0, height: 0 }, pad = (p.blurPx ?? 0) * 3;
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}
/** `only` limits the picture to those layers (by id), still clipped and masked as they are in the whole drawing. */
export function drawingSVG(doc: SketchDocument, area = exportArea(doc), only?: readonly string[]): string {
  const n = (v: number) => +v.toPrecision(10);
  const ids = paintIDs(doc), all = paintedPaths(doc);
  const defs = all.map(p => {
    const id = ids.get(p.id)!, g = p.fillGradient;
    const clip = `<clipPath id="${id}-clip" clipPathUnits="userSpaceOnUse"><path d="${pathData(p)}" clip-rule="${p.fillRule ?? 'nonzero'}"/></clipPath>`;
    const blur = p.blurPx ? `<filter id="${id}-blur" filterUnits="userSpaceOnUse" ${Object.entries(blurRegion(p)).map(([k, v]) => `${k}="${+v.toPrecision(10)}"`).join(' ')}><feGaussianBlur stdDeviation="${p.blurPx}"/></filter>` : '';
    if (!g) return clip + blur;
    const tag = g.kind === 'linear' ? 'linearGradient' : 'radialGradient';
    const position = g.kind === 'linear' ? Object.entries(gradientVector(g.angleDeg)).map(([k, v]) => `${k}="${v}"`).join(' ') : 'cx="0.5" cy="0.5" r="0.5"';
    return clip + blur + `<${tag} id="${id}-gradient" ${position}>${g.stops.map(s => `<stop offset="${s.offset}" stop-color="${s.color}" stop-opacity="${s.opacity}"/>`).join('')}</${tag}>`;
  }).join('');
  const depths = layerDepths(doc), region = usesDepth(doc) ? depthRegion(doc) ?? area : null;
  const inPicture = (index: number) => !only || only.includes(doc.layers[index].id);
  // Content other layers point at carries an id: clip bases, and the mask layers of anything shown.
  const bases = new Set(depths.flatMap((d, i) => inPicture(i) && d.clipTo !== undefined ? [d.clipTo] : []));
  const shown = (index: number) => inPicture(index) || bases.has(index);
  const content = (l: Layer, d: Depth) => {
    const drawn = (p: DrawingPath): string => {
      // A symbol instance draws the symbol's paths under the instance's transform.
      const symbol = symbolOf(doc, p);
      if (p.symbolID) return symbol ? `<g transform="matrix(${symbol.matrix.map(n).join(' ')})"${p.opacity < 1 ? ` opacity="${p.opacity}"` : ''}>${symbol.def.paths.filter(q => !q.hidden).map(drawn).join('')}</g>` : '';
      const attributes = (path: DrawingPath) => Object.entries(paintAttributes(path, `${ids.get(p.id)}-gradient`)).filter(([, value]) => value !== undefined).map(([key, value]) => `${attributeNames[key] ?? key}="${value}"`).join(' ');
      return p.text ? textSVG(p, attributes(p)) : drawnParts(p).map(part => `<path d="${pathData(part)}" ${attributes(part)}/>`).join('');
    };
    const markup = l.paths.filter(p => pathVisible({ ...l, visible: true }, p)).map(p => clipPaths(l, p).reduce((m, clip) => `<g clip-path="url(#${ids.get(clip.id)}-clip)">${m}</g>`, drawn(p))).join('');
    const b = l.pixels, bitmap = b ? `<image href="${b.src}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" preserveAspectRatio="none"/>` : '';
    const a = depthAttributes(l, d), named = a.hide || bases.has(d.index) || d.role === 'mask';
    // A mask layer's own effects shape the mask: blurring it feathers the edge.
    return named ? `<g id="${a.id}"${a.hide ? ` mask="${a.hide}"` : ''}${d.role === 'mask' && a.effects ? ` filter="${a.effects}"` : ''}>${bitmap}${markup}</g>` : bitmap + markup;
  };
  let count = 0;
  const body = composeLayers(doc, depths, (l, d) => {
    const a = depthAttributes(l, d), inner = a.effects ? `<g filter="${a.effects}">${content(l, d)}</g>` : content(l, d);
    const style = [d.drawn ? '' : 'display:none', (l.opacity ?? 1) < 1 ? `opacity:${l.opacity}` : '', l.blend && l.blend !== 'normal' ? `mix-blend-mode:${l.blend}` : ''].filter(Boolean).join(';');
    return `<g id="layer${++count}" inkscape:groupmode="layer" inkscape:label="${xmlText(l.name)}"${a.clip ? ` mask="${a.clip}"` : ''}${style ? ` style="${style}"` : ''}>${inner}</g>`;
  }, (below, d) => `<g filter="url(#${layerDOMID(d.index)}-adjust)">${below.join('')}</g>`, inPicture).join('');
  // Never drawn as themselves: mask layers, and clip bases left out of the picture.
  const unseen = doc.layers.map((l, i) => (depths[i].role === 'mask' ? l.visible && shown(depths.findIndex(d => d.hide.includes(i))) : bases.has(i) && !inPicture(i)) ? content(l, depths[i]) : '').join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${n(area.width)}" height="${n(area.height)}" viewBox="${n(area.x)} ${n(area.y)} ${n(area.width)} ${n(area.height)}"><defs>${defs}${region ? depthDefs(doc, region, depths) : ''}${unseen}</defs>${body}</svg>`;
}
