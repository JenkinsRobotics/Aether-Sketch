import { booleanPaths, pathBounds, simplify, type Point, type SketchPath } from '@aether/sketch';

/** One pointer sample: position, pen pressure (0–1; a mouse reports 0.5) and time in ms. */
export interface BrushSample { point: Point; pressure: number; timeMs: number }
/** `minSize` is the width at the lightest pressure (or fastest mouse), as a fraction of the size. */
export interface BrushOptions { sizePx: number; taper: boolean; pen: boolean; minSize?: number }

/** A brush's character, the controls SketchBook's Brush Properties expose. Sizes are on screen; opacities 0–1; softness 0–1 blurs the stroke. */
export interface BrushStyle { sizePx: number; minSize: number; opacity: number; minOpacity: number; softness: number; taper: boolean;
  /** Pixel brushes stamp the tip along the stroke. `spacing` is the gap between stamps as a fraction of the tip's width (default 0.1),
   * `flow` how much paint each stamp lays down (default 1; `opacity` caps the whole stroke), `grain` how strongly paper texture
   * breaks the paint up (default 0) and `scatter` how far stamps stray, in tip radii (default 0). */
  spacing?: number; flow?: number; grain?: number; scatter?: number }
export interface BrushPreset extends BrushStyle { id: string; name: string; group: 'Sketch' | 'Ink' | 'Paint' | 'Dry media' | 'Airbrush' }
export const BRUSH_PRESETS: readonly BrushPreset[] = [
  { id: 'pencil-hb', name: 'Pencil HB', group: 'Sketch', sizePx: 3, minSize: .45, opacity: .8, minOpacity: .25, softness: .08, taper: true, grain: .5, flow: .6 },
  { id: 'pencil-soft', name: 'Soft pencil 4B', group: 'Sketch', sizePx: 6, minSize: .4, opacity: .7, minOpacity: .15, softness: .2, taper: true, grain: .6, flow: .5 },
  { id: 'ballpoint', name: 'Ballpoint', group: 'Sketch', sizePx: 2, minSize: .7, opacity: 1, minOpacity: .6, softness: 0, taper: false, spacing: .06 },
  { id: 'ink-pen', name: 'Ink pen', group: 'Ink', sizePx: 5, minSize: .15, opacity: 1, minOpacity: 1, softness: 0, taper: true, spacing: .05 },
  { id: 'fine-liner', name: 'Fine liner', group: 'Ink', sizePx: 2.5, minSize: .95, opacity: 1, minOpacity: 1, softness: 0, taper: false, spacing: .05 },
  { id: 'brush-pen', name: 'Brush pen', group: 'Ink', sizePx: 14, minSize: .1, opacity: 1, minOpacity: 1, softness: 0, taper: true, spacing: .05 },
  { id: 'marker', name: 'Marker', group: 'Paint', sizePx: 22, minSize: .9, opacity: .45, minOpacity: .45, softness: .04, taper: false, spacing: .06 },
  { id: 'felt-tip', name: 'Felt tip', group: 'Paint', sizePx: 10, minSize: .75, opacity: .85, minOpacity: .6, softness: .06, taper: false, flow: .8 },
  { id: 'paint-brush', name: 'Paint brush', group: 'Paint', sizePx: 28, minSize: .35, opacity: .9, minOpacity: .5, softness: .1, taper: true, flow: .5, grain: .15 },
  { id: 'charcoal', name: 'Charcoal', group: 'Dry media', sizePx: 26, minSize: .5, opacity: .9, minOpacity: .25, softness: .25, taper: false, grain: .85, flow: .45, scatter: .08 },
  { id: 'chalk', name: 'Chalk', group: 'Dry media', sizePx: 30, minSize: .7, opacity: .9, minOpacity: .4, softness: .1, taper: false, grain: .7, flow: .6 },
  { id: 'crayon', name: 'Crayon', group: 'Dry media', sizePx: 14, minSize: .6, opacity: .95, minOpacity: .5, softness: .05, taper: false, grain: .55, flow: .7 },
  { id: 'airbrush-soft', name: 'Soft airbrush', group: 'Airbrush', sizePx: 90, minSize: .5, opacity: .3, minOpacity: .05, softness: 1, taper: false, flow: .08 },
  { id: 'airbrush-hard', name: 'Hard airbrush', group: 'Airbrush', sizePx: 40, minSize: .6, opacity: .55, minOpacity: .1, softness: .4, taper: false, flow: .15 },
];
/** Stroke opacity from the average pressure (a mouse counts as a medium press). */
export const brushOpacity = (style: Pick<BrushStyle, 'opacity' | 'minOpacity'>, samples: BrushSample[]) => {
  const pressure = samples.length ? samples.reduce((n, s) => n + s.pressure, 0) / samples.length : .5;
  return Math.min(1, Math.max(0, style.minOpacity + (style.opacity - style.minOpacity) * pressure));
};

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const circle = (c: Point, r: number, from = 0, to = Math.PI * 2, steps = 12): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => { const a = from + (to - from) * i / steps; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]; });

/** Width at each sample, 0–1 of the brush size. A pen uses its pressure; a mouse or finger thins as it speeds up. */
export function brushWidths(samples: BrushSample[], { sizePx, taper, pen, minSize }: BrushOptions): number[] {
  let speed = 0;
  const raw = samples.map((s, i) => {
    if (pen) return minSize === undefined ? Math.max(.05, s.pressure) : minSize + (1 - minSize) * s.pressure;
    if (i) { const prev = samples[i - 1], ms = Math.max(1, s.timeMs - prev.timeMs); speed = speed * .7 + (dist(s.point, prev.point) / ms) * .3; }
    const low = minSize ?? .45; return low + (1 - low) * Math.exp(-speed / Math.max(.05, sizePx * .08));
  });
  const smooth = raw.map((w, i) => (raw[Math.max(0, i - 1)] + w * 2 + raw[Math.min(raw.length - 1, i + 1)]) / 4);
  if (!taper) return smooth;
  const along = samples.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + dist(s.point, samples[i - 1].point) : 0], []);
  const total = along.at(-1) ?? 0, length = Math.min(sizePx * 3, total / 3);
  return smooth.map((w, i) => length > 0 ? w * Math.max(.08, Math.sqrt(Math.min(1, along[i] / length, (total - along[i]) / length))) : w);
}

/** One stamp of a pixel brush: where, how big and how much paint (0–1). */
export interface Dab { x: number; y: number; radius: number; alpha: number }
/** What a stroke carries from one sample to the next: the last sample, its size and paint, the mouse's smoothed speed and the distance left to the next stamp. */
export interface DabState { last?: BrushSample; width: number; paint: number; speed: number; toNext: number }
export const newDabState = (): DabState => ({ width: 0, paint: 0, speed: 0, toNext: 0 });
/**
 * The stamps a pixel brush lays from the previous sample to `to`. A pen sets size and paint by pressure; a mouse thins as it
 * speeds up, as vector strokes do. `sizePx` is the tip width in document pixels. The first sample stamps once, so a tap makes a dot.
 */
export function dabsTo(state: DabState, to: BrushSample, style: BrushStyle, sizePx: number, pen: boolean, random: () => number = Math.random): Dab[] {
  const from = state.last, low = style.minSize;
  if (from && !pen) { const ms = Math.max(1, to.timeMs - from.timeMs); state.speed = state.speed * .7 + (dist(to.point, from.point) / ms) * .3; }
  const width = pen ? low + (1 - low) * to.pressure : low + (1 - low) * Math.exp(-state.speed / Math.max(.05, sizePx * .08));
  const top = Math.max(style.opacity, 1e-6), paint = Math.min(1, Math.max(0, (style.minOpacity + (style.opacity - style.minOpacity) * to.pressure) / top)) * (style.flow ?? 1);
  const stamp = (x: number, y: number, w: number, a: number): Dab => {
    const radius = Math.max(.25, w * sizePx / 2), stray = (style.scatter ?? 0) * radius;
    return { x: x + (stray ? (random() * 2 - 1) * stray : 0), y: y + (stray ? (random() * 2 - 1) * stray : 0), radius, alpha: a };
  };
  const dabs: Dab[] = [];
  if (!from) { dabs.push(stamp(to.point[0], to.point[1], width, paint)); state.toNext = Math.max(.25, (style.spacing ?? .1) * width * sizePx); }
  else {
    const length = dist(from.point, to.point); let at = state.toNext;
    // ponytail: at most 4000 stamps a segment, so one wild jump of the pointer cannot stall the page.
    while (at <= length && dabs.length < 4000) {
      const t = length ? at / length : 1, w = state.width + (width - state.width) * t;
      dabs.push(stamp(from.point[0] + (to.point[0] - from.point[0]) * t, from.point[1] + (to.point[1] - from.point[1]) * t, w, state.paint + (paint - state.paint) * t));
      at += Math.max(.25, (style.spacing ?? .1) * w * sizePx);
    }
    state.toNext = at - length;
  }
  state.last = to; state.width = width; state.paint = paint;
  return dabs;
}

/** A brush stroke as one closed outline, so it fills, erases and edits like any other shape. */
export function brushOutline(input: BrushSample[], options: BrushOptions): Point[] {
  const samples = input.filter((s, i) => !i || dist(s.point, input[i - 1].point) > .5);
  if (!samples.length) return [];
  const widths = brushWidths(samples, options).map(w => w * options.sizePx / 2);
  if (samples.length === 1) return circle(samples[0].point, Math.max(.5, widths[0])).slice(0, -1);
  const left: Point[] = [], right: Point[] = [];
  samples.forEach((s, i) => {
    const a = samples[Math.max(0, i - 1)].point, b = samples[Math.min(samples.length - 1, i + 1)].point;
    const len = dist(a, b) || 1, n: Point = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len], w = widths[i];
    left.push([s.point[0] + n[0] * w, s.point[1] + n[1] * w]); right.push([s.point[0] - n[0] * w, s.point[1] - n[1] * w]);
  });
  // Round caps: half circles from one side to the other around each end.
  const cap = (at: number, toward: number) => {
    const c = samples[at].point, o = samples[toward].point, angle = Math.atan2(c[1] - o[1], c[0] - o[0]);
    return circle(c, widths[at], angle + Math.PI / 2, angle - Math.PI / 2, 6).slice(1, -1);
  };
  const outline = [...left, ...cap(samples.length - 1, samples.length - 2), ...right.reverse(), ...cap(0, 1)];
  // ponytail: Douglas–Peucker at a fixed fraction of the size; curve fitting if outlines get heavy.
  return simplify(outline, Math.max(.05, options.sizePx * .02));
}

/** Vector eraser: cuts the eraser stroke out of every closed shape it touches. Open strokes and text are left alone. */
export function eraseWith<P extends SketchPath & { id: string; text?: unknown }>(paths: P[], outline: Point[], tolerance: number): { ids: string[]; next: P[] } {
  const eraser: SketchPath = { points: outline, closed: true }, area = pathBounds([eraser]);
  const ids: string[] = [], next: P[] = [];
  if (!area || outline.length < 3) return { ids, next };
  for (const path of paths) {
    const b = pathBounds([path]);
    if (!path.closed || path.text || (path as { symbolID?: string }).symbolID || !b || b.x > area.x + area.width || area.x > b.x + b.width || b.y > area.y + area.height || area.y > b.y + b.height) continue;
    let cut: SketchPath | null;
    try { cut = booleanPaths([path, eraser], 'difference', tolerance); } catch { continue; } // too detailed: leave it whole
    ids.push(path.id);
    if (cut) next.push({ ...path, curves: undefined, nodeModes: undefined, subpaths: undefined, fillRule: undefined, ...cut });
  }
  return { ids, next };
}
