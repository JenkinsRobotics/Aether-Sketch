import { booleanPaths, pathBounds, simplify, type Point, type SketchPath } from '@aether/sketch';

/** One pointer sample: position, pen pressure (0–1; a mouse reports 0.5) and time in ms. */
export interface BrushSample { point: Point; pressure: number; timeMs: number }
export interface BrushOptions { sizePx: number; taper: boolean; pen: boolean }

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const circle = (c: Point, r: number, from = 0, to = Math.PI * 2, steps = 12): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => { const a = from + (to - from) * i / steps; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]; });

/** Width at each sample, 0–1 of the brush size. A pen uses its pressure; a mouse or finger thins as it speeds up. */
export function brushWidths(samples: BrushSample[], { sizePx, taper, pen }: BrushOptions): number[] {
  let speed = 0;
  const raw = samples.map((s, i) => {
    if (pen) return Math.max(.05, s.pressure);
    if (i) { const prev = samples[i - 1], ms = Math.max(1, s.timeMs - prev.timeMs); speed = speed * .7 + (dist(s.point, prev.point) / ms) * .3; }
    return .45 + .55 * Math.exp(-speed / Math.max(.05, sizePx * .08));
  });
  const smooth = raw.map((w, i) => (raw[Math.max(0, i - 1)] + w * 2 + raw[Math.min(raw.length - 1, i + 1)]) / 4);
  if (!taper) return smooth;
  const along = samples.reduce<number[]>((acc, s, i) => [...acc, i ? acc[i - 1] + dist(s.point, samples[i - 1].point) : 0], []);
  const total = along.at(-1) ?? 0, length = Math.min(sizePx * 3, total / 3);
  return smooth.map((w, i) => length > 0 ? w * Math.max(.08, Math.sqrt(Math.min(1, along[i] / length, (total - along[i]) / length))) : w);
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
    if (!path.closed || path.text || !b || b.x > area.x + area.width || area.x > b.x + b.width || b.y > area.y + area.height || area.y > b.y + b.height) continue;
    let cut: SketchPath | null;
    try { cut = booleanPaths([path, eraser], 'difference', tolerance); } catch { continue; } // too detailed: leave it whole
    ids.push(path.id);
    if (cut) next.push({ ...path, curves: undefined, nodeModes: undefined, subpaths: undefined, fillRule: undefined, ...cut });
  }
  return { ids, next };
}
