import { pathBounds, pathData, type Point } from '@aether/sketch';
import { dashArray, drawnParts } from './vector';
import type { DrawingPath, Layer, PixelBitmap } from './document';
import type { BrushStyle, Dab } from './brush';

/** Pixel layers: one bitmap per layer, one document pixel per bitmap pixel. Bitmaps grow in grid steps as paint lands outside them. */
export const PIXEL_GRID = 256;
/** ponytail: 4096 px a side (the canvas size every browser, iPad included, accepts). Tile the bitmap when larger pixel layers matter. */
export const PIXEL_MAX_SIDE = 4096;
export interface Rect { x: number; y: number; width: number; height: number }
export const isPixelLayer = (layer: Layer | undefined): boolean => layer?.kind === 'pixel';

const snapOut = (r: Rect): Rect => {
  const x = Math.floor(r.x / PIXEL_GRID) * PIXEL_GRID, y = Math.floor(r.y / PIXEL_GRID) * PIXEL_GRID;
  return { x, y, width: Math.ceil((r.x + r.width) / PIXEL_GRID) * PIXEL_GRID - x, height: Math.ceil((r.y + r.height) / PIXEL_GRID) * PIXEL_GRID - y };
};
export function unionRect(a: Rect | null | undefined, b: Rect | null | undefined): Rect | null {
  if (!a || !b) return a ?? b ?? null;
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
/** Everything one path can mark: its geometry, half its stroke and three blur deviations. */
function markedRect(p: DrawingPath): Rect | null {
  const b = pathBounds([p]); if (!b) return null;
  const pad = (p.strokeEnabled === false ? 0 : p.widthPx / 2) + (p.blurPx ?? 0) * 3 + 1;
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}
/** The bitmap area these paths need, snapped out to the grid. */
export function paintedRect(paths: DrawingPath[]): Rect | null {
  const all = paths.reduce<Rect | null>((r, p) => unionRect(r, markedRect(p)), null);
  return all && snapOut(all);
}
export const gridRect = (r: Rect): Rect => snapOut(r);
/** What the visible pixel layers cover, for fitting the view and framing exports. */
export function pixelBounds(layers: Layer[]): Rect | null {
  return layers.filter(l => l.visible && l.pixels).reduce<Rect | null>((r, { pixels: b }) => unionRect(r, { x: b!.x, y: b!.y, width: b!.width, height: b!.height }), null);
}

/** Every pixel connected to (x, y) whose channels are all within `tolerance` of it, on straight RGBA pixels: 1 in the returned mask. */
export function floodRegion(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, tolerance = 32): Uint8Array {
  const seen = new Uint8Array(width * height);
  if (x < 0 || y < 0 || x >= width || y >= height) return seen;
  const start = (y * width + x) * 4, target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  const matches = (i: number) => !seen[i] && Math.abs(data[i * 4] - target[0]) <= tolerance && Math.abs(data[i * 4 + 1] - target[1]) <= tolerance
    && Math.abs(data[i * 4 + 2] - target[2]) <= tolerance && Math.abs(data[i * 4 + 3] - target[3]) <= tolerance;
  // Scanline fill: take a run, mark it, queue the rows above and below.
  const stack = [y * width + x];
  while (stack.length) {
    const seed = stack.pop()!; if (!matches(seed)) continue;
    const row = Math.floor(seed / width) * width; let left = seed, right = seed;
    while (left > row && matches(left - 1)) left--;
    while (right < row + width - 1 && matches(right + 1)) right++;
    let above = false, below = false; // one seed per run of matching neighbours, not one per pixel
    for (let i = left; i <= right; i++) {
      seen[i] = 1;
      const up = i >= width && matches(i - width), down = i + width < width * height && matches(i + width);
      if (up && !above) stack.push(i - width);
      if (down && !below) stack.push(i + width);
      above = up; below = down;
    }
  }
  return seen;
}
/** Flood fill: the region around (x, y) becomes `color`. Returns how many pixels changed. */
export function floodFill(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, color: readonly [number, number, number, number], tolerance = 32): number {
  const region = floodRegion(data, width, height, x, y, tolerance); let changed = 0;
  for (let i = 0; i < region.length; i++) if (region[i]) { data[i * 4] = color[0]; data[i * 4 + 1] = color[1]; data[i * 4 + 2] = color[2]; data[i * 4 + 3] = color[3]; changed++; }
  return changed;
}
/** The tight box around every pixel whose alpha is at least `threshold`, from straight RGBA data. */
export function alphaBounds(data: Uint8ClampedArray, width: number, height: number, threshold = 1): Rect | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0, i = 3; y < height; y++) for (let x = 0; x < width; x++, i += 4) if (data[i] >= threshold) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
/**
 * The outline of every pixel whose alpha is 128 or more, as SVG path data along the pixel edges: closed rings, holes
 * included, offset by (ox, oy). The selected side is always on the right of the direction of travel.
 * ponytail: one Map entry per boundary corner; trace in tiles if huge speckled selections ever lag.
 */
export function outlinePath(data: Uint8ClampedArray, width: number, height: number, ox = 0, oy = 0): string {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && data[(y * width + x) * 4 + 3] >= 128;
  const stride = width + 1, next = new Map<number, number[]>();
  const edge = (x0: number, y0: number, x1: number, y1: number) => { const from = y0 * stride + x0, list = next.get(from); if (list) list.push(y1 * stride + x1); else next.set(from, [y1 * stride + x1]); };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!inside(x, y)) continue;
    if (!inside(x, y - 1)) edge(x, y, x + 1, y);
    if (!inside(x + 1, y)) edge(x + 1, y, x + 1, y + 1);
    if (!inside(x, y + 1)) edge(x + 1, y + 1, x, y + 1);
    if (!inside(x - 1, y)) edge(x, y + 1, x, y);
  }
  // Every corner has as many edges in as out, so a walk from any corner comes back to it.
  const parts: string[] = [], col = (v: number) => v % stride + ox, line = (v: number) => Math.floor(v / stride) + oy;
  for (const start of next.keys()) while (next.get(start)!.length) {
    let at = start, horizontal: boolean | null = null; parts.push(`M${col(start)} ${line(start)}`);
    do {
      const to = next.get(at)!.pop()!, h = line(to) === line(at);
      if (horizontal !== null && h !== horizontal) parts.push(horizontal ? `H${col(at)}` : `V${line(at)}`); // a corner
      horizontal = h; at = to;
    } while (at !== start);
    parts.push('Z');
  }
  return parts.join('');
}
/** A 2D affine transform as canvas and CSS write it: x′ = a·x + c·y + e, y′ = b·x + d·y + f. */
export type Matrix = [a: number, b: number, c: number, d: number, e: number, f: number];
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
/** The box around a transformed rectangle. */
export function matrixBounds(m: Matrix, r: Rect): Rect {
  const corners = [r.x, r.x + r.width].flatMap(x => [r.y, r.y + r.height].map(y => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]));
  const x = Math.min(...corners.map(c => c[0])), y = Math.min(...corners.map(c => c[1]));
  return { x, y, width: Math.max(...corners.map(c => c[0])) - x, height: Math.max(...corners.map(c => c[1])) - y };
}
/** Whole pixels only, so moved pixels stay exactly as they were. */
export const moveMatrix = (dx: number, dy: number): Matrix => [1, 0, 0, 1, Math.round(dx), Math.round(dy)];
/** Stretch one box onto another. */
export const fitMatrix = (from: Rect, to: Rect): Matrix => { const a = to.width / from.width, d = to.height / from.height; return [a, 0, 0, d, to.x - a * from.x, to.y - d * from.y]; };
export const rotateMatrix = (center: Point, angle: number): Matrix => { const c = Math.cos(angle), s = Math.sin(angle); return [c, s, -s, c, center[0] - c * center[0] + s * center[1], center[1] - s * center[0] - c * center[1]]; };
/** Skew: one side slides along itself by `delta` while the opposite side stays put. */
export function skewMatrix(b: Rect, side: 'n' | 's' | 'e' | 'w', delta: Point): Matrix {
  if (side === 'n' || side === 's') { const anchor = side === 'n' ? b.y + b.height : b.y, k = delta[0] / (side === 'n' ? -b.height : b.height); return [1, 0, k, 1, -k * anchor, 0]; }
  const anchor = side === 'w' ? b.x + b.width : b.x, k = delta[1] / (side === 'w' ? -b.width : b.width); return [1, k, 0, 1, 0, -k * anchor];
}
/** The whole pixels a box touches. */
const wholeRect = (r: Rect): Rect => { const x = Math.floor(r.x), y = Math.floor(r.y); return { x, y, width: Math.max(1, Math.ceil(r.x + r.width) - x), height: Math.max(1, Math.ceil(r.y + r.height) - y) }; };
export const hexRGB = (hex: string): [number, number, number] => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

// ---- Canvas work (browser only) ----
const newCanvas = (width: number, height: number) => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };
const context = (c: HTMLCanvasElement) => { const ctx = c.getContext('2d'); if (!ctx) throw new Error('Pixel layers are unavailable in this browser.'); return ctx; };
/** The canvas behind the bitmap painted last, so the next stroke does not decode the PNG again. */
const surfaces = new Map<string, HTMLCanvasElement>();
async function surface(bitmap: PixelBitmap): Promise<HTMLCanvasElement> {
  const kept = surfaces.get(bitmap.src);
  if (kept) { surfaces.delete(bitmap.src); return kept; } // the caller paints on it, so it stops matching this PNG
  const image = new Image(); image.src = bitmap.src; await image.decode();
  const c = newCanvas(bitmap.width, bitmap.height); context(c).drawImage(image, 0, 0); return c;
}
async function encode(c: HTMLCanvasElement, rect: Rect): Promise<PixelBitmap> {
  const blob = await new Promise<Blob | null>(resolve => c.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('This browser could not save the pixel layer.');
  const src = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(blob); });
  surfaces.set(src, c); for (const key of surfaces.keys()) { if (surfaces.size <= 4) break; surfaces.delete(key); }
  return { ...rect, src };
}
/** A canvas covering `rect` with the current bitmap already on it. */
async function openSurface(current: PixelBitmap | undefined, rect: Rect): Promise<HTMLCanvasElement> {
  if (!current) return newCanvas(rect.width, rect.height);
  const old = await surface(current);
  if (current.x === rect.x && current.y === rect.y && current.width === rect.width && current.height === rect.height) return old;
  const c = newCanvas(rect.width, rect.height); context(c).drawImage(old, current.x - rect.x, current.y - rect.y); return c;
}

/** Draw one path the way the vector renderer shows it. `ctx` is already in document coordinates. */
function drawPath(ctx: CanvasRenderingContext2D, p: DrawingPath, erase: boolean) {
  const shape = new Path2D(pathData(p)), rule = p.fillRule ?? 'nonzero';
  const fills = !((!p.closed && !p.fillOpen) || p.fill === null), strokes = p.strokeEnabled !== false;
  // ponytail: a gradient fill lands as its first stop colour; build a canvas gradient when painted gradients matter.
  const fill = p.fillGradient?.stops[0]?.color ?? p.fill ?? p.color, fillAlpha = p.fillOpacity ?? (p.fill === undefined ? .15 : 1);
  ctx.save();
  if (p.blurPx && fills && !erase) {
    // A soft brush stroke: draw the shape far off the canvas and keep only its blurred shadow, which every browser supports.
    const away = ctx.canvas.width * 2 + 10000;
    ctx.shadowColor = fill; ctx.shadowBlur = p.blurPx * 2; ctx.shadowOffsetX = away; ctx.translate(-away, 0);
    ctx.globalAlpha = fillAlpha * p.opacity; ctx.fillStyle = fill; ctx.fill(shape, rule);
    ctx.restore(); return;
  }
  // Fill and stroke meet at full strength on a scratch canvas, then land with the path's opacity, as SVG group opacity does.
  const m = markedRect(p)!, x = Math.floor(m.x), y = Math.floor(m.y), scratch = newCanvas(Math.ceil(m.width) + 1, Math.ceil(m.height) + 1), s = context(scratch);
  s.translate(-x, -y);
  if (fills) { s.globalAlpha = erase ? 1 : fillAlpha; s.fillStyle = fill; s.fill(shape, rule); }
  if (strokes) {
    s.globalAlpha = erase ? 1 : p.strokeOpacity ?? 1; s.strokeStyle = p.color; s.lineWidth = p.widthPx; s.lineCap = p.lineCap ?? 'round'; s.lineJoin = p.lineJoin ?? 'round';
    s.setLineDash(dashArray(p) ?? []); s.stroke(shape);
  }
  ctx.globalAlpha = erase ? 1 : p.opacity; ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.drawImage(scratch, x, y); ctx.restore();
}

export type PixelResult = { bitmap: PixelBitmap } | { problem: string } | null;
/** A pixel selection: an alpha mask over `rect`, one document pixel per mask pixel, and its outline for the marching ants. */
export interface PixelSelection { rect: Rect; canvas: HTMLCanvasElement; outline: string }
export type SelectMode = 'new' | 'add' | 'subtract' | 'intersect';
export type SelectionResult = { selection: PixelSelection | null } | { problem: string };
/** With a selection, an edit only keeps what falls inside it: remember the canvas now, and afterwards put the outside back. */
function outsideKeeper(c: HTMLCanvasElement, rect: Rect, clip: PixelSelection | null | undefined): () => void {
  if (!clip) return () => {};
  const before = newCanvas(c.width, c.height), b = context(before), mask = newCanvas(c.width, c.height);
  b.drawImage(c, 0, 0); context(mask).drawImage(clip.canvas, clip.rect.x - rect.x, clip.rect.y - rect.y); // a full-size mask, so every browser composites the whole canvas alike
  return () => {
    const ctx = context(c); ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0);  // the edit, inside the selection
    b.globalCompositeOperation = 'destination-out'; b.drawImage(mask, 0, 0);      // what was there, outside it
    ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(before, 0, 0); ctx.restore();
  };
}
const tooLarge = (r: Rect) => r.width > PIXEL_MAX_SIDE || r.height > PIXEL_MAX_SIDE;
const LIMIT = `A pixel layer can be up to ${PIXEL_MAX_SIDE} px wide and tall. Add another pixel layer to paint further away.`;

/** Paint or erase these paths on a pixel layer, inside `clip` when there is a selection. Null when nothing would change. */
export async function paintPixels(current: PixelBitmap | undefined, drawn: DrawingPath[], mode: 'paint' | 'erase', clip?: PixelSelection | null): Promise<PixelResult> {
  const paths = drawn.flatMap(drawnParts);
  const marked = paintedRect(paths); if (!marked || (mode === 'erase' && !current)) return null;
  const rect = mode === 'erase' ? current! : unionRect(current, marked)!;
  if (tooLarge(rect)) return { problem: LIMIT };
  const c = await openSurface(current, rect), ctx = context(c), keep = outsideKeeper(c, rect, clip);
  ctx.save(); ctx.translate(-rect.x, -rect.y); for (const p of paths) drawPath(ctx, p, mode === 'erase'); ctx.restore(); keep();
  return { bitmap: await encode(c, rect) };
}

/** Flood fill from `at` with `color`, inside `area` (the page or everything drawn) plus what the layer already holds. */
export async function fillPixels(current: PixelBitmap | undefined, at: Point, color: string, area: Rect, tolerance = 32, clip?: PixelSelection | null): Promise<PixelResult> {
  const rect = unionRect(current, gridRect(area))!;
  if (tooLarge(rect)) return { problem: LIMIT };
  const x = Math.floor(at[0] - rect.x), y = Math.floor(at[1] - rect.y);
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return { problem: 'Click inside the drawing to fill.' };
  const c = await openSurface(current, rect), ctx = context(c), image = ctx.getImageData(0, 0, rect.width, rect.height);
  if (!floodFill(image.data, rect.width, rect.height, x, y, [...hexRGB(color), 255], tolerance)) { if (current) surfaces.set(current.src, c); return null; }
  const keep = outsideKeeper(c, rect, clip); ctx.putImageData(image, 0, 0); keep();
  return { bitmap: await encode(c, rect) };
}

/** The colour of one pixel as #rrggbb, or null where the layer is empty. */
export async function samplePixel(current: PixelBitmap | undefined, at: Point): Promise<string | null> {
  if (!current) return null;
  const x = Math.floor(at[0] - current.x), y = Math.floor(at[1] - current.y);
  if (x < 0 || y < 0 || x >= current.width || y >= current.height) return null;
  const c = await surface(current); surfaces.set(current.src, c);
  const [r, g, b, a] = context(c).getImageData(x, y, 1, 1).data;
  return a ? `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}` : null;
}

// ---- Stamped pixel brushes ----
let paper: HTMLCanvasElement | null = null;
/** Paper tooth: a repeating noise tile, the same every time, that textured brushes skip over. */
function paperTexture(): HTMLCanvasElement {
  if (paper) return paper;
  let seed = 0x2f6e2b1; const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const noise = (size: number, strength: number) => { const c = newCanvas(size, size), image = context(c).createImageData(size, size);
    for (let i = 3; i < image.data.length; i += 4) image.data[i] = random() * strength; context(c).putImageData(image, 0, 0); return c; };
  const size = 128; paper = newCanvas(size, size); const ctx = context(paper);
  ctx.drawImage(noise(size / 2, 255), 0, 0, size, size); // soft two-pixel tooth
  ctx.drawImage(noise(size, 110), 0, 0);               // fine speckle on top
  return paper;
}

/**
 * One stroke of a stamped brush, painted as it is drawn. The canvas holds the stroke alone at full strength, one document
 * pixel per canvas pixel from `rect`; it is shown over the drawing while painting and lands on the layer with the brush's
 * opacity, so overlapping stamps build up to that opacity and no further.
 */
export class DabStroke {
  readonly canvas = newCanvas(1, 1); rect: Rect | null = null;
  /** Some paint fell outside the largest canvas a pixel layer allows. */
  clipped = false;
  private scratch = newCanvas(1, 1); private pattern: CanvasPattern | null = null;
  private readonly rgb: string; private readonly hardness: number; private readonly reach: number;
  constructor(color: string, private readonly style: BrushStyle) {
    this.rgb = hexRGB(color).join(','); this.hardness = Math.min(1, Math.max(0, 1 - style.softness)); this.reach = 1 + style.softness * .6;
  }
  private fit(boxes: Rect[]): boolean {
    const need = boxes.reduce<Rect | null>((r, b) => unionRect(r, b), null); if (!need) return false;
    const next = unionRect(this.rect, snapOut(need))!, old = this.rect;
    if (old && next.x === old.x && next.y === old.y && next.width === old.width && next.height === old.height) return true;
    if (tooLarge(next)) { this.clipped = true; return !!old; }
    const copy = old && newCanvas(old.width, old.height); if (copy) context(copy).drawImage(this.canvas, 0, 0);
    this.canvas.width = next.width; this.canvas.height = next.height; this.rect = next;
    if (copy && old) context(this.canvas).drawImage(copy, old.x - next.x, old.y - next.y);
    return true;
  }
  /** Stamp these dabs, and their copies under each symmetry map, growing the canvas to hold them. */
  stamp(dabs: Dab[], maps: ((p: Point) => Point)[] = []) {
    const copies = (d: Dab): Dab[] => [d, ...maps.map(map => { const [x, y] = map([d.x, d.y]); return { ...d, x, y }; })];
    const box = (d: Dab): Rect => { const r = d.radius * this.reach + 1; return { x: d.x - r, y: d.y - r, width: r * 2, height: r * 2 }; };
    let all = dabs.flatMap(copies); if (!all.length) return;
    // Symmetry copies can land further apart than one canvas reaches; the stroke under the pen always paints.
    if (!this.fit(all.map(box))) { all = dabs; if (!this.fit(all.map(box))) return; }
    const ctx = context(this.canvas), rect = this.rect!, grain = this.style.grain ?? 0;
    for (const d of all) {
      const r = d.radius * this.reach, x = d.x - rect.x, y = d.y - rect.y;
      if (!grain) { ctx.globalAlpha = d.alpha; this.tip(ctx, x, y, r); continue; }
      // Textured: stamp on a scratch canvas, knock the paper's tooth out of it, then lay it down.
      const side = Math.ceil(r * 2) + 2, x0 = Math.floor(d.x - r) - 1, y0 = Math.floor(d.y - r) - 1;
      if (this.scratch.width < side) { this.scratch.width = this.scratch.height = side; }
      const s = context(this.scratch); s.setTransform(1, 0, 0, 1, 0, 0); s.globalCompositeOperation = 'source-over'; s.globalAlpha = 1; s.clearRect(0, 0, side, side);
      this.tip(s, d.x - x0, d.y - y0, r);
      s.globalCompositeOperation = 'destination-out'; s.globalAlpha = grain; s.fillStyle = this.pattern ??= s.createPattern(paperTexture(), 'repeat')!;
      s.setTransform(1, 0, 0, 1, -x0, -y0); s.fillRect(x0, y0, side, side);
      ctx.globalAlpha = d.alpha; ctx.drawImage(this.scratch, 0, 0, side, side, x0 - rect.x, y0 - rect.y, side, side);
    }
    ctx.globalAlpha = 1;
  }
  /** The brush tip: a hard disc, or one that fades from `hardness` of its radius to the edge. */
  private tip(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
    if (this.hardness >= .98) { ctx.fillStyle = `rgb(${this.rgb})`; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); return; }
    const g = ctx.createRadialGradient(x, y, r * this.hardness * .9, x, y, r), stop = (t: number, a: number) => g.addColorStop(t, `rgba(${this.rgb},${a})`);
    stop(0, 1); stop(.35, .72); stop(.7, .24); stop(1, 0);
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
}

/** Land a finished stroke canvas on a pixel layer at `opacity`. */
export async function compositePixels(current: PixelBitmap | undefined, stroke: HTMLCanvasElement, at: Rect, opacity: number, clip?: PixelSelection | null): Promise<PixelResult> {
  const rect = unionRect(current, at)!;
  if (tooLarge(rect)) return { problem: LIMIT };
  const c = await openSurface(current, rect), ctx = context(c), keep = outsideKeeper(c, rect, clip);
  ctx.save(); ctx.globalAlpha = opacity; ctx.drawImage(stroke, at.x - rect.x, at.y - rect.y); ctx.restore(); keep();
  return { bitmap: await encode(c, rect) };
}

/**
 * Smudge: pushes the paint already on a pixel layer along the stroke. It works on the layer's own canvas, which is shown
 * in place of the layer while smudging. ponytail: it drags paint into empty areas but not emptiness into paint.
 */
export class SmudgeStroke {
  changed = false;
  private last: Point | null = null; private pick = newCanvas(1, 1);
  private constructor(readonly canvas: HTMLCanvasElement, readonly rect: Rect, private readonly src: string, private readonly keep: () => void) {}
  /** With a selection, the smudge shows everywhere while dragging and keeps only what is inside it when saved. */
  static async open(bitmap: PixelBitmap, clip?: PixelSelection | null): Promise<SmudgeStroke> {
    const c = await surface(bitmap), rect = { x: bitmap.x, y: bitmap.y, width: bitmap.width, height: bitmap.height };
    return new SmudgeStroke(c, rect, bitmap.src, outsideKeeper(c, rect, clip));
  }
  /** Move to `point`: at each short step, lift the paint under the last spot through a soft round mask and lay it on the next. */
  to(point: Point, radius: number, strength: number) {
    const from = this.last; this.last = point; if (!from) return;
    const length = Math.hypot(point[0] - from[0], point[1] - from[1]); if (!length) return;
    const steps = Math.min(2000, Math.ceil(length / Math.max(1, radius * .25))), side = Math.ceil(radius * 2) + 2, half = side / 2;
    if (this.pick.width < side) this.pick.width = this.pick.height = side;
    const ctx = context(this.canvas), p = context(this.pick), { x: ox, y: oy } = this.rect;
    for (let i = 1; i <= steps; i++) {
      const a = (i - 1) / steps, b = i / steps, sx = from[0] + (point[0] - from[0]) * a, sy = from[1] + (point[1] - from[1]) * a;
      p.globalCompositeOperation = 'source-over'; p.clearRect(0, 0, side, side);
      p.drawImage(this.canvas, sx - ox - half, sy - oy - half, side, side, 0, 0, side, side);
      const mask = p.createRadialGradient(half, half, radius * .4, half, half, radius); mask.addColorStop(0, 'rgba(0,0,0,1)'); mask.addColorStop(1, 'rgba(0,0,0,0)');
      p.globalCompositeOperation = 'destination-in'; p.fillStyle = mask; p.fillRect(0, 0, side, side);
      ctx.globalAlpha = strength; ctx.drawImage(this.pick, 0, 0, side, side, from[0] + (point[0] - from[0]) * b - ox - half, from[1] + (point[1] - from[1]) * b - oy - half, side, side);
    }
    ctx.globalAlpha = 1; this.changed = true;
  }
  /** Hand an untouched canvas back for the next edit. */
  release() { if (!this.changed) surfaces.set(this.src, this.canvas); }
  encode(): Promise<PixelBitmap> { this.keep(); return encode(this.canvas, this.rect); }
}

// ---- Pixel selections ----
const SELECTION_LIMIT = `A selection can be up to ${PIXEL_MAX_SIDE} px wide and tall.`;
type Piece = { rect: Rect; canvas: HTMLCanvasElement };
/** Trim a mask to what it selects and trace its outline. Null when it selects nothing. */
function finishSelection({ canvas: c, rect }: Piece): PixelSelection | null {
  const data = context(c).getImageData(0, 0, c.width, c.height).data, solid = alphaBounds(data, c.width, c.height, 128);
  if (!solid) return null;
  const outline = outlinePath(data, c.width, c.height, rect.x, rect.y);
  // Keep one pixel of soft edge around the solid part.
  const x = Math.max(0, solid.x - 1), y = Math.max(0, solid.y - 1), width = Math.min(c.width, solid.x + solid.width + 1) - x, height = Math.min(c.height, solid.y + solid.height + 1) - y;
  if (width === c.width && height === c.height) return { rect, canvas: c, outline };
  const cropped = newCanvas(width, height); context(cropped).drawImage(c, -x, -y);
  return { rect: { x: rect.x + x, y: rect.y + y, width, height }, canvas: cropped, outline };
}
function combine(current: PixelSelection | null, piece: Piece, mode: SelectMode): SelectionResult {
  if (mode === 'new' || !current) return { selection: mode === 'new' || mode === 'add' ? finishSelection(piece) : current };
  const rect = mode === 'add' ? unionRect(current.rect, piece.rect)! : current.rect;
  if (tooLarge(rect)) return { problem: SELECTION_LIMIT };
  const c = newCanvas(rect.width, rect.height), ctx = context(c), placed = newCanvas(rect.width, rect.height);
  ctx.drawImage(current.canvas, current.rect.x - rect.x, current.rect.y - rect.y);
  context(placed).drawImage(piece.canvas, piece.rect.x - rect.x, piece.rect.y - rect.y); // full size, so every browser composites the whole canvas alike
  ctx.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'subtract' ? 'destination-out' : 'destination-in';
  ctx.drawImage(placed, 0, 0);
  return { selection: finishSelection({ rect, canvas: c }) };
}
/** Select the inside of a closed shape: a rectangle, ellipse, freehand loop or polygon. */
export function shapeSelection(current: PixelSelection | null, shape: DrawingPath, mode: SelectMode): SelectionResult {
  const b = pathBounds([shape]); if (!b || !b.width || !b.height) return { selection: current };
  const rect = wholeRect(b); if (tooLarge(rect)) return { problem: SELECTION_LIMIT };
  const c = newCanvas(rect.width, rect.height), ctx = context(c);
  ctx.translate(-rect.x, -rect.y); ctx.fill(new Path2D(pathData({ ...shape, closed: true })));
  return combine(current, { rect, canvas: c }, mode);
}
/** Magic wand: select the connected area around `at` whose colour is within `tolerance` of the clicked pixel. */
export async function wandSelection(current: PixelSelection | null, bitmap: PixelBitmap | undefined, at: Point, area: Rect, tolerance: number, mode: SelectMode): Promise<SelectionResult> {
  const rect = unionRect(bitmap, gridRect(area))!;
  if (tooLarge(rect)) return { problem: SELECTION_LIMIT };
  const x = Math.floor(at[0] - rect.x), y = Math.floor(at[1] - rect.y);
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return { problem: 'Click inside the drawing to select.' };
  const c = newCanvas(rect.width, rect.height), ctx = context(c);
  if (bitmap) { const s = await surface(bitmap); surfaces.set(bitmap.src, s); ctx.drawImage(s, bitmap.x - rect.x, bitmap.y - rect.y); }
  const image = ctx.getImageData(0, 0, rect.width, rect.height), region = floodRegion(image.data, rect.width, rect.height, x, y, tolerance);
  for (let i = 0; i < region.length; i++) image.data[i * 4 + 3] = region[i] ? 255 : 0;
  ctx.putImageData(image, 0, 0);
  return combine(current, { rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, canvas: c }, mode);
}
export function rectSelection(r: Rect): PixelSelection {
  const rect = wholeRect(r), c = newCanvas(rect.width, rect.height); context(c).fillRect(0, 0, rect.width, rect.height);
  return { rect, canvas: c, outline: `M${rect.x} ${rect.y}H${rect.x + rect.width}V${rect.y + rect.height}H${rect.x}Z` };
}
/** The tight box around everything painted on a pixel layer. */
export async function paintedBounds(bitmap: PixelBitmap | undefined): Promise<Rect | null> {
  if (!bitmap) return null;
  const c = await surface(bitmap); surfaces.set(bitmap.src, c);
  const b = alphaBounds(context(c).getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  return b && { ...b, x: b.x + bitmap.x, y: b.y + bitmap.y };
}
/** Everything in `area` (the page, or all that is drawn) that was not selected. */
export function invertSelection(current: PixelSelection, area: Rect): SelectionResult {
  const rect = wholeRect(unionRect(current.rect, area)!);
  if (tooLarge(rect)) return { problem: SELECTION_LIMIT };
  const c = newCanvas(rect.width, rect.height), ctx = context(c);
  ctx.fillRect(0, 0, rect.width, rect.height); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(current.canvas, current.rect.x - rect.x, current.rect.y - rect.y);
  return { selection: finishSelection({ rect, canvas: c }) };
}
/** The selection after its pixels were transformed by `m`. */
export function transformSelection(sel: PixelSelection, m: Matrix): PixelSelection | null {
  const rect = wholeRect(matrixBounds(m, sel.rect)); if (tooLarge(rect)) return null;
  const c = newCanvas(rect.width, rect.height), ctx = context(c);
  ctx.setTransform(m[0], m[1], m[2], m[3], m[4] - rect.x, m[5] - rect.y); ctx.drawImage(sel.canvas, sel.rect.x, sel.rect.y);
  return finishSelection({ rect, canvas: c });
}
/** The selected pixels of `src` (a canvas covering `at`) on a canvas of their own, covering the selection's box. */
function cutOut(src: HTMLCanvasElement, at: Rect, sel: PixelSelection): HTMLCanvasElement {
  const c = newCanvas(sel.rect.width, sel.rect.height), ctx = context(c);
  ctx.drawImage(src, at.x - sel.rect.x, at.y - sel.rect.y); ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(sel.canvas, 0, 0);
  return c;
}
const punch = (c: HTMLCanvasElement, at: Rect, sel: PixelSelection) => { const ctx = context(c); ctx.save(); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(sel.canvas, sel.rect.x - at.x, sel.rect.y - at.y); ctx.restore(); };
/** For showing a transform while it is dragged: the layer without the selected pixels (`rest`, covering the bitmap) and those pixels alone (`float`, covering the selection's box). */
export async function liftPixels(bitmap: PixelBitmap, sel: PixelSelection, copy: boolean): Promise<{ rest: HTMLCanvasElement; float: HTMLCanvasElement }> {
  const src = await surface(bitmap); surfaces.set(bitmap.src, src);
  const rest = newCanvas(bitmap.width, bitmap.height); context(rest).drawImage(src, 0, 0); if (!copy) punch(rest, bitmap, sel);
  return { rest, float: cutOut(src, bitmap, sel) };
}
/**
 * Move, scale, rotate or skew the selected pixels by `m`; `copy` leaves the originals where they were.
 * ponytail: every call resamples the pixels once; keep them floating until committed if quality across many drags matters.
 */
export async function transformPixels(current: PixelBitmap | undefined, sel: PixelSelection, m: Matrix, copy = false): Promise<PixelResult> {
  if (!current) return null;
  const src = await surface(current), float = cutOut(src, current, sel), landing = gridRect(matrixBounds(m, sel.rect));
  if (!copy) punch(src, current, sel);
  let rect = unionRect(current, landing)!;
  if (tooLarge(rect)) {
    // Moves leave empty margins behind: trim to what is still painted before giving up.
    const left = alphaBounds(context(src).getImageData(0, 0, src.width, src.height).data, src.width, src.height);
    rect = unionRect(left && gridRect({ ...left, x: left.x + current.x, y: left.y + current.y }), landing)!;
    if (tooLarge(rect)) return { problem: `That would make the pixel layer larger than ${PIXEL_MAX_SIDE} px a side.` };
  }
  const same = rect.x === current.x && rect.y === current.y && rect.width === current.width && rect.height === current.height;
  const c = same ? src : newCanvas(rect.width, rect.height), ctx = context(c);
  if (!same) ctx.drawImage(src, current.x - rect.x, current.y - rect.y);
  ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.setTransform(m[0], m[1], m[2], m[3], m[4] - rect.x, m[5] - rect.y); ctx.drawImage(float, sel.rect.x, sel.rect.y); ctx.restore();
  return { bitmap: await encode(c, rect) };
}
/** Erase the selected pixels. */
export async function clearPixels(current: PixelBitmap | undefined, sel: PixelSelection): Promise<PixelResult> {
  if (!current) return null;
  const c = await surface(current); punch(c, current, sel);
  return { bitmap: await encode(c, { x: current.x, y: current.y, width: current.width, height: current.height }) };
}
