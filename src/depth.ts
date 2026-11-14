// Layer depth: clipping layers, mask layers, layer effects and adjustment layers.
// Everything here is standard SVG (masks and filters), so the canvas, the SVG export and the raster exports draw alike.
import { pathBounds } from '@aether/sketch';
import type { Adjustment, Layer, LayerEffects, SketchDocument } from './document';
import { unionRect, type Rect } from './pixels';

/** How one layer takes part in the stack. `index` is its place in `doc.layers` (top first). */
export interface Depth {
  index: number;
  /** The role in force: a clip or mask with no layer beneath it is an ordinary layer. */
  role?: 'clip' | 'mask';
  /** Shown as itself. False for hidden layers, working masks and clips whose base is hidden. */
  drawn: boolean;
  /** The visible mask layers that hide parts of this layer. */
  hide: number[];
  /** The layer this one is clipped to. */
  clipTo?: number;
}
export function layerDepths(doc: SketchDocument): Depth[] {
  const out: Depth[] = doc.layers.map((l, index) => ({ index, drawn: l.visible, hide: [] }));
  let target = -1, base = -1; // the nearest layer below that is not a mask; the nearest that is neither a mask nor a clip
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i], d = out[i];
    if (l.role === 'mask' && target >= 0) { d.role = 'mask'; d.drawn = false; if (l.visible) out[target].hide.push(i); continue; }
    if (l.role === 'clip' && base >= 0) { d.role = 'clip'; d.clipTo = base; d.drawn = l.visible && out[base].drawn; } else base = i;
    target = i;
  }
  return out;
}
export const hasEffects = (e: LayerEffects | undefined) => !!e && ((e.blurPx ?? 0) > 0 || !!e.shadow || !!e.glow);
export const usesDepth = (doc: SketchDocument) => doc.layers.some(l => l.role || l.adjust || hasEffects(l.effects));
/** The element id of a layer's content, by position: ids from a file never reach markup. */
export const layerDOMID = (index: number) => `sketch-layer-${index}`;
/** The mask and filter references one layer's elements carry. */
export function depthAttributes(layer: Layer, d: Depth) {
  const id = layerDOMID(d.index);
  return { id, clip: d.clipTo === undefined ? undefined : `url(#${layerDOMID(d.clipTo)}-clip)`, effects: hasEffects(layer.effects) ? `url(#${id}-effects)` : undefined, hide: d.hide.length ? `url(#${id}-hide)` : undefined };
}
/** How far past its content a layer's effects reach: three deviations of each blur, plus the shadow's offset. */
export function effectReach(e: LayerEffects | undefined): number {
  if (!e) return 0;
  const own = (e.blurPx ?? 0) * 3;
  return own + Math.max(0, e.shadow ? Math.max(Math.abs(e.shadow.dxPx), Math.abs(e.shadow.dyPx)) + e.shadow.blurPx * 3 : 0, e.glow ? e.glow.blurPx * 3 : 0);
}
/** Everything the given layers can mark, effects included: the area masks and filters must cover. */
export function depthRegion(doc: SketchDocument, layers: Layer[] = doc.layers): Rect | null {
  const paths = layers.flatMap(l => l.paths);
  const content = layers.reduce<Rect | null>((r, { pixels: b }) => b ? unionRect(r, { x: b.x, y: b.y, width: b.width, height: b.height }) : r, pathBounds(paths));
  if (!content) return null;
  // Strokes, arrowheads and soft paths spill past the geometry; effects spill further.
  const pad = paths.reduce((m, p) => Math.max(m, p.widthPx * 2 + (p.blurPx ?? 0) * 3), 0) + Math.max(0, ...layers.map(l => effectReach(l.effects))) + 8;
  return { x: content.x - pad, y: content.y - pad, width: content.width + pad * 2, height: content.height + pad * 2 };
}

const n = (v: number) => +(Number(v) || 0).toPrecision(10);
const colour = (c: string) => /^#[\da-f]{6}$/i.test(c) ? c : '#000000';
const box = (r: Rect) => `x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"`;
function effectPrimitives(e: LayerEffects): string {
  const blurred = (e.blurPx ?? 0) > 0, source = blurred ? 'soft' : 'SourceGraphic', out: string[] = [], under: string[] = [];
  if (blurred) out.push(`<feGaussianBlur in="SourceGraphic" stdDeviation="${n(e.blurPx!)}" result="soft"/>`);
  if (e.shadow) {
    out.push(`<feGaussianBlur in="${source}" stdDeviation="${n(e.shadow.blurPx)}"/><feOffset dx="${n(e.shadow.dxPx)}" dy="${n(e.shadow.dyPx)}" result="cast"/><feFlood flood-color="${colour(e.shadow.color)}" flood-opacity="${n(e.shadow.opacity)}"/><feComposite in2="cast" operator="in" result="shadow"/>`);
    under.push('shadow');
  }
  if (e.glow) {
    // A blurred edge alone is faint, so the glow's coverage is doubled before it is coloured.
    out.push(`<feGaussianBlur in="${source}" stdDeviation="${n(e.glow.blurPx)}"/><feComponentTransfer result="halo"><feFuncA type="linear" slope="2"/></feComponentTransfer><feFlood flood-color="${colour(e.glow.color)}" flood-opacity="${n(e.glow.opacity)}"/><feComposite in2="halo" operator="in" result="glow"/>`);
    under.push('glow');
  }
  if (under.length) out.push(`<feMerge>${[...under, source].map(name => `<feMergeNode in="${name}"/>`).join('')}</feMerge>`);
  return out.join('');
}
/** The per-channel line an adjustment applies after saturation and hue: brightness scales, contrast pivots on mid grey, invert flips. */
export function adjustLine(a: Adjustment): { slope: number; intercept: number } {
  const contrast = 1 + a.contrast, slope = contrast * (1 + a.brightness), intercept = .5 - .5 * contrast;
  return a.invert ? { slope: -slope, intercept: 1 - intercept } : { slope, intercept };
}
function adjustPrimitives(a: Adjustment): string {
  const { slope, intercept } = adjustLine(a);
  return `<feColorMatrix type="saturate" values="${n(1 + a.saturation)}"/><feColorMatrix type="hueRotate" values="${n(a.hueDeg)}"/><feComponentTransfer>${['R', 'G', 'B'].map(c => `<feFunc${c} type="linear" slope="${n(slope)}" intercept="${n(intercept)}"/>`).join('')}</feComponentTransfer>`;
}
/** The masks and filters the stack refers to, as SVG markup for a `<defs>`. Built from numbers and checked colours only. */
export function depthDefs(doc: SketchDocument, region: Rect, depths = layerDepths(doc)): string {
  const frame = `${box(region)} color-interpolation-filters="sRGB"`, out: string[] = [];
  // Masks work on brightness: clip content is turned white (shown where painted), mask content black (hidden where painted).
  const tone = (id: string, value: 0 | 1) => `<filter id="sketch-depth-${id}" filterUnits="userSpaceOnUse" ${frame}><feColorMatrix values="0 0 0 0 ${value} 0 0 0 0 ${value} 0 0 0 0 ${value} 0 0 0 1 0"/></filter>`;
  if (depths.some(d => d.clipTo !== undefined)) out.push(tone('white', 1));
  if (depths.some(d => d.hide.length)) out.push(tone('black', 0));
  for (const base of new Set(depths.flatMap(d => d.clipTo ?? []))) out.push(`<mask id="${layerDOMID(base)}-clip" maskUnits="userSpaceOnUse" ${box(region)}><use href="#${layerDOMID(base)}" filter="url(#sketch-depth-white)"/></mask>`);
  doc.layers.forEach((l, i) => {
    const d = depths[i], id = layerDOMID(i);
    if (d.hide.length) out.push(`<mask id="${id}-hide" maskUnits="userSpaceOnUse" ${box(region)}><rect ${box(region)} fill="#ffffff"/>${d.hide.map(m => `<use href="#${layerDOMID(m)}" filter="url(#sketch-depth-black)"/>`).join('')}</mask>`);
    if (hasEffects(l.effects)) out.push(`<filter id="${id}-effects" filterUnits="userSpaceOnUse" ${frame}>${effectPrimitives(l.effects!)}</filter>`);
    if (l.adjust && d.drawn) out.push(`<filter id="${id}-adjust" filterUnits="userSpaceOnUse" ${frame}>${adjustPrimitives(l.adjust)}</filter>`);
  });
  return out.join('');
}
/** The layers in drawing order, bottom first, leaving out working masks and anything `include` rejects.
 * A visible adjustment layer first wraps what is beneath it (from its base up when it is a clip), then draws its own content. */
export function composeLayers<T>(doc: SketchDocument, depths: Depth[], draw: (layer: Layer, depth: Depth) => T, adjust: (below: T[], depth: Depth) => T, include: (index: number) => boolean = () => true): T[] {
  let drawn: { index: number; node: T }[] = [];
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const l = doc.layers[i], d = depths[i];
    if (d.role === 'mask' || !include(i)) continue;
    if (l.adjust && d.drawn) {
      const from = d.clipTo === undefined ? 0 : drawn.findIndex(x => x.index <= d.clipTo!);
      if (from >= 0 && from < drawn.length) drawn = [...drawn.slice(0, from), { index: drawn[from].index, node: adjust(drawn.slice(from).map(x => x.node), d) }];
    }
    drawn.push({ index: i, node: draw(l, d) });
  }
  return drawn.map(x => x.node);
}
