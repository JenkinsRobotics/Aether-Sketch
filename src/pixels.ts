import { pathBounds, pathData, strokeDash, type Point } from '@aether/sketch';
import type { DrawingPath, Layer, PixelBitmap } from './document';

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

/**
 * Flood fill on straight RGBA pixels: every pixel connected to (x, y) whose channels are all within
 * `tolerance` of the clicked pixel becomes `color`. Returns how many pixels changed.
 */
export function floodFill(data: Uint8ClampedArray, width: number, height: number, x: number, y: number, color: readonly [number, number, number, number], tolerance = 32): number {
  if (x < 0 || y < 0 || x >= width || y >= height) return 0;
  const start = (y * width + x) * 4, target = [data[start], data[start + 1], data[start + 2], data[start + 3]];
  const seen = new Uint8Array(width * height);
  const matches = (i: number) => !seen[i] && Math.abs(data[i * 4] - target[0]) <= tolerance && Math.abs(data[i * 4 + 1] - target[1]) <= tolerance
    && Math.abs(data[i * 4 + 2] - target[2]) <= tolerance && Math.abs(data[i * 4 + 3] - target[3]) <= tolerance;
  // Scanline fill: take a run, paint it, queue the rows above and below.
  const stack = [y * width + x]; let changed = 0;
  while (stack.length) {
    const seed = stack.pop()!; if (!matches(seed)) continue;
    const row = Math.floor(seed / width) * width; let left = seed, right = seed;
    while (left > row && matches(left - 1)) left--;
    while (right < row + width - 1 && matches(right + 1)) right++;
    let above = false, below = false; // one seed per run of matching neighbours, not one per pixel
    for (let i = left; i <= right; i++) {
      seen[i] = 1; data[i * 4] = color[0]; data[i * 4 + 1] = color[1]; data[i * 4 + 2] = color[2]; data[i * 4 + 3] = color[3]; changed++;
      const up = i >= width && matches(i - width), down = i + width < width * height && matches(i + width);
      if (up && !above) stack.push(i - width);
      if (down && !below) stack.push(i + width);
      above = up; below = down;
    }
  }
  return changed;
}
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
    s.setLineDash(strokeDash(p.dash, p.widthPx) ?? []); s.stroke(shape);
  }
  ctx.globalAlpha = erase ? 1 : p.opacity; ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
  ctx.drawImage(scratch, x, y); ctx.restore();
}

export type PixelResult = { bitmap: PixelBitmap } | { problem: string } | null;
const tooLarge = (r: Rect) => r.width > PIXEL_MAX_SIDE || r.height > PIXEL_MAX_SIDE;
const LIMIT = `A pixel layer can be up to ${PIXEL_MAX_SIDE} px wide and tall. Add another pixel layer to paint further away.`;

/** Paint or erase these paths on a pixel layer. Null when nothing would change. */
export async function paintPixels(current: PixelBitmap | undefined, paths: DrawingPath[], mode: 'paint' | 'erase'): Promise<PixelResult> {
  const marked = paintedRect(paths); if (!marked || (mode === 'erase' && !current)) return null;
  const rect = mode === 'erase' ? current! : unionRect(current, marked)!;
  if (tooLarge(rect)) return { problem: LIMIT };
  const c = await openSurface(current, rect), ctx = context(c);
  ctx.save(); ctx.translate(-rect.x, -rect.y); for (const p of paths) drawPath(ctx, p, mode === 'erase'); ctx.restore();
  return { bitmap: await encode(c, rect) };
}

/** Flood fill from `at` with `color`, inside `area` (the page or everything drawn) plus what the layer already holds. */
export async function fillPixels(current: PixelBitmap | undefined, at: Point, color: string, area: Rect, tolerance = 32): Promise<PixelResult> {
  const rect = unionRect(current, gridRect(area))!;
  if (tooLarge(rect)) return { problem: LIMIT };
  const x = Math.floor(at[0] - rect.x), y = Math.floor(at[1] - rect.y);
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return { problem: 'Click inside the drawing to fill.' };
  const c = await openSurface(current, rect), ctx = context(c), image = ctx.getImageData(0, 0, rect.width, rect.height);
  if (!floodFill(image.data, rect.width, rect.height, x, y, [...hexRGB(color), 255], tolerance)) { if (current) surfaces.set(current.src, c); return null; }
  ctx.putImageData(image, 0, 0);
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
