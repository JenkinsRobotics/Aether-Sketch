import { pathContours, pathIntersections, pointInPolygon, replaceContour, samplePath, slicePath, splitCurve, strokeDash, lerp,
  type Bounds, type CubicControls, type NodeMode, type Point, type SketchPath } from '@aether/sketch';
import type { DrawingPath } from './document';

/** Vector tools beyond the engine's: stroke options, the corner tool, the knife and the shape library. All pure geometry. */
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]], add = (a: Point, b: Point, k = 1): Point => [a[0] + b[0] * k, a[1] + b[1] * k];
const length = (a: Point) => Math.hypot(a[0], a[1]), unit = (a: Point): Point => { const l = length(a) || 1; return [a[0] / l, a[1] / l]; };

// ---- Stroke options ----
export const ARROW_HEADS = ['arrow', 'dot', 'bar'] as const;
export type ArrowHead = typeof ARROW_HEADS[number];
/** The dash array a stroke is drawn with: a custom dash and gap in pixels, or the named pattern scaled by the width. */
export const dashArray = (p: Pick<DrawingPath, 'dash' | 'dashPx' | 'widthPx'>): number[] | undefined => p.dashPx ?? strokeDash(p.dash, p.widthPx);
/**
 * The arrowheads of an open path, as paths of their own for every renderer to draw after the line.
 * ponytail: the tip sits a little beyond the path's end so it covers the line's cap, as Illustrator does by default;
 * shorten the line instead if tips must land exactly on the end point.
 */
export function arrowHeads(p: DrawingPath): DrawingPath[] {
  if (p.closed || p.text || p.subpaths?.length || p.points.length < 2 || p.strokeEnabled === false || (!p.arrowStart && !p.arrowEnd)) return [];
  const n = p.points.length, w = p.widthPx, size = 4 * w + 4;
  const head = (kind: ArrowHead | undefined, at: Point, towards: Point, which: string): DrawingPath[] => {
    if (!kind) return [];
    const d = unit(sub(at, towards)), normal: Point = [-d[1], d[0]];
    const base = { id: `${p.id}-arrow-${which}`, groupID: p.groupID, color: p.color, widthPx: w, opacity: p.opacity, strokeOpacity: p.strokeOpacity };
    const solid = { ...base, closed: true, fill: p.color, fillOpacity: p.strokeOpacity ?? 1, strokeEnabled: false };
    if (kind === 'bar') return [{ ...base, closed: false, lineCap: 'butt', points: [add(at, normal, size / 2), add(at, normal, -size / 2)] }];
    if (kind === 'dot') { const { points, curves } = ellipse(at[0], at[1], size * .35, size * .35); return [{ ...solid, points, curves }]; }
    const tip = add(at, d, 1.75 * w), back = add(tip, d, -size);
    return [{ ...solid, points: [tip, add(back, normal, size * .4), add(back, normal, -size * .4)] }];
  };
  // An end points along its curve handle when it has one, otherwise along its edge.
  const differs = (a: Point | undefined, b: Point) => a && length(sub(a, b)) > 1e-9 ? a : undefined;
  return [...head(p.arrowStart, p.points[0], differs(p.curves?.[0]?.c1, p.points[0]) ?? p.points[1], 'start'),
    ...head(p.arrowEnd, p.points[n - 1], differs(p.curves?.[n - 2]?.c2, p.points[n - 1]) ?? p.points[n - 2], 'end')];
}

// ---- Corner tool ----
export type CornerStyle = 'round' | 'straight';
/** Corners that can be rounded: nodes where two straight edges meet at an angle. */
export function cornerIndices(path: SketchPath): number[] {
  const n = path.points.length;
  return path.points.map((_, i) => i).filter(i => {
    if (!path.closed && (i === 0 || i === n - 1)) return false;
    if (path.curves?.[(i - 1 + n) % n] || path.curves?.[i]) return false;
    const u = unit(sub(path.points[(i - 1 + n) % n], path.points[i])), v = unit(sub(path.points[(i + 1) % n], path.points[i]));
    return Math.abs(u[0] * v[0] + u[1] * v[1]) < .9999;
  });
}
/**
 * Round the corners of one contour to `radius`, or cut them straight across. Each corner uses at most half of
 * either edge, so neighbouring corners never overlap. `only` limits it to some nodes.
 * ponytail: the result is plain nodes, not a live corner; a corner between curved edges is left alone.
 */
export function roundCorners(path: SketchPath, radius: number, style: CornerStyle = 'round', only?: number[]): SketchPath {
  if (!(radius > 0)) return path;
  const n = path.points.length, corners = new Set(cornerIndices(path).filter(i => !only || only.includes(i)));
  if (!corners.size) return path;
  const points: Point[] = [], curves: Array<CubicControls | null> = [], modes: NodeMode[] = [];
  path.points.forEach((p, i) => {
    const out = path.curves?.[i] ?? null;
    if (!corners.has(i)) { points.push(p); curves.push(out); modes.push(path.nodeModes?.[i] ?? 'corner'); return; }
    const before = sub(path.points[(i - 1 + n) % n], p), after = sub(path.points[(i + 1) % n], p), u = unit(before), v = unit(after);
    const half = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1]))) / 2;
    const t = Math.min(radius / Math.tan(half), length(before) / 2, length(after) / 2), r = t * Math.tan(half), handle = 4 / 3 * Math.tan((Math.PI - 2 * half) / 4) * r;
    const a = add(p, u, t), b = add(p, v, t);
    points.push(a, b); curves.push(style === 'round' ? { c1: add(a, u, -handle), c2: add(b, v, -handle) } : null, out); modes.push('corner', 'corner');
  });
  return { ...path, points, curves: curves.some(Boolean) ? curves : undefined, nodeModes: modes };
}
/** Round every corner of every contour of a shape. */
export function roundAllCorners<T extends SketchPath>(path: T, radius: number, style: CornerStyle = 'round'): T {
  return pathContours(path).reduce<T>((shape, _, i) => ({ ...shape, ...replaceContour(shape, i, roundCorners(pathContours(shape)[i], radius, style)) }), path);
}

// ---- Knife ----
function pointAt(path: SketchPath, t: number): Point {
  const n = path.points.length, edge = Math.min(Math.floor(t), path.closed ? Infinity : n - 2), i = ((edge % n) + n) % n, a = path.points[i], b = path.points[(i + 1) % n], c = path.curves?.[i];
  return c ? splitCurve(a, c, b, t - edge).point : lerp(a, b, t - edge);
}
/**
 * Cut a path along the straight line from `a` to `b`. An open path splits where the line crosses it; a closed shape
 * splits into closed pieces along the cut, wherever the line passes all the way through. Null when nothing is cut.
 * ponytail: straight cuts only, and not through compound shapes; a freehand knife needs its own line in every piece.
 */
export function knifePath(path: SketchPath, a: Point, b: Point): SketchPath[] | null {
  if (path.subpaths?.length || path.points.length < 2) return null;
  const count = path.closed ? path.points.length : path.points.length - 1;
  const cuts = pathIntersections(path, [{ points: [a, b], closed: false }]).map(t => path.closed && count - t < 1e-6 ? 0 : t)
    .filter(t => path.closed || (t > 1e-6 && t < count - 1e-6)).sort((x, y) => x - y).filter((t, i, all) => !i || t - all[i - 1] > 1e-6);
  if (!path.closed) {
    if (!cuts.length) return null;
    const ends = [0, ...cuts, count];
    return ends.slice(1).map((end, i) => slicePath(path, ends[i], end)).filter((p): p is SketchPath => !!p).map(p => ({ ...p, curves: p.curves?.some(Boolean) ? p.curves : undefined }));
  }
  // Along the knife, crossings alternate between entering and leaving the shape: each entering–leaving pair is one cut.
  const along = (t: number) => { const p = pointAt(path, t); return (p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1]); };
  const ordered = [...cuts].sort((x, y) => along(x) - along(y));
  if (pointInPolygon(samplePath(path), a)) ordered.shift(); // the knife started inside: its first crossing only leaves
  if (ordered.length % 2) ordered.pop();                     // and it ended inside: the last crossing only enters
  if (ordered.length < 2) return null;
  const stops = [...ordered].sort((x, y) => x - y), partner = new Map<number, number>();
  for (let i = 0; i < ordered.length; i += 2) { partner.set(ordered[i], ordered[i + 1]); partner.set(ordered[i + 1], ordered[i]); }
  // Walk the outline from one crossing to the next, step across the cut to its other end, and carry on until back at the start.
  const used = new Set<number>(), pieces: SketchPath[] = [];
  for (let first = 0; first < stops.length; first++) {
    if (used.has(first)) continue;
    const points: Point[] = [], curves: Array<CubicControls | null> = [], modes: NodeMode[] = [];
    for (let arc = first; !used.has(arc); arc = stops.indexOf(partner.get(stops[(arc + 1) % stops.length])!)) {
      used.add(arc);
      const next = stops[(arc + 1) % stops.length], part = slicePath(path, stops[arc], next > stops[arc] ? next : next + count);
      if (part) { points.push(...part.points); curves.push(...(part.curves ?? part.points.map(() => null))); modes.push(...(part.nodeModes ?? part.points.map((): NodeMode => 'corner'))); }
    }
    if (points.length >= 3) pieces.push({ points, curves: curves.some(Boolean) ? curves : undefined, nodeModes: modes, closed: true, fillRule: path.fillRule });
  }
  return pieces.length > 1 ? pieces : null;
}

// ---- Shape library ----
/** Builds a closed contour from lines and elliptical arcs. */
function outline(start: Point) {
  const points: Point[] = [start], curves: Array<CubicControls | null> = [];
  const self = {
    line(p: Point) { curves.push(null); points.push(p); return self; },
    curve(c1: Point, c2: Point, p: Point) { curves.push({ c1, c2 }); points.push(p); return self; },
    /** An arc of the ellipse centred (cx, cy) from angle `from` to `to` (radians, clockwise on screen when increasing), in quarter turns or less. */
    arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number) {
      const steps = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2) - 1e-9)), step = (to - from) / steps, k = 4 / 3 * Math.tan(step / 4);
      for (let i = 0; i < steps; i++) {
        const a0 = from + step * i, a1 = a0 + step;
        const p0: Point = [cx + rx * Math.cos(a0), cy + ry * Math.sin(a0)], p1: Point = [cx + rx * Math.cos(a1), cy + ry * Math.sin(a1)];
        self.curve([p0[0] - k * rx * Math.sin(a0), p0[1] + k * ry * Math.cos(a0)], [p1[0] + k * rx * Math.sin(a1), p1[1] - k * ry * Math.cos(a1)], p1);
      }
      return self;
    },
    close(): SketchPath {
      // An outline that ends where it began keeps one node there, with the last edge closing onto it.
      if (points.length > 1 && length(sub(points[points.length - 1], points[0])) < 1e-9) points.pop(); else curves.push(null);
      return { points, curves: curves.some(Boolean) ? curves : undefined, closed: true };
    },
  };
  return self;
}
const TURN = Math.PI * 2;
function ellipse(cx: number, cy: number, rx: number, ry: number) {
  const made = outline([cx + rx, cy]).arc(cx, cy, rx, ry, 0, TURN).close();
  return { points: made.points, curves: made.curves };
}
export interface ShapeKind {
  id: string; name: string;
  /** The one thing that can be tuned before drawing, such as a corner radius or a number of teeth. */
  amount?: { label: string; min: number; max: number; value: number; step: number; unit?: string };
  make: (box: Bounds, amount: number) => SketchPath;
}
/**
 * Ready-made shapes, drawn by dragging a box. They land as ordinary editable paths.
 * ponytail: one tunable amount per shape, set before drawing; make them live parametric objects if re-editing matters.
 */
export const SHAPES: ShapeKind[] = [
  { id: 'rounded-rectangle', name: 'Rounded rectangle', amount: { label: 'Corner radius', min: 0, max: 50, value: 20, step: 1, unit: '%' },
    make: ({ x, y, width: w, height: h }, amount) => {
      const r = Math.min(w, h) * amount / 100, q = Math.PI / 2;
      if (!r) return { points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], closed: true };
      return outline([x + r, y]).line([x + w - r, y]).arc(x + w - r, y + r, r, r, -q, 0).line([x + w, y + h - r]).arc(x + w - r, y + h - r, r, r, 0, q)
        .line([x + r, y + h]).arc(x + r, y + h - r, r, r, q, 2 * q).line([x, y + r]).arc(x + r, y + r, r, r, 2 * q, 3 * q).close();
    } },
  { id: 'triangle', name: 'Triangle', amount: { label: 'Peak position', min: 0, max: 100, value: 50, step: 1, unit: '%' },
    make: ({ x, y, width: w, height: h }, amount) => ({ points: [[x + w * amount / 100, y], [x + w, y + h], [x, y + h]], closed: true }) },
  { id: 'diamond', name: 'Diamond', make: ({ x, y, width: w, height: h }) => ({ points: [[x + w / 2, y], [x + w, y + h / 2], [x + w / 2, y + h], [x, y + h / 2]], closed: true }) },
  { id: 'trapezoid', name: 'Trapezoid', amount: { label: 'Top inset', min: 0, max: 50, value: 20, step: 1, unit: '%' },
    make: ({ x, y, width: w, height: h }, amount) => ({ points: [[x + w * amount / 100, y], [x + w - w * amount / 100, y], [x + w, y + h], [x, y + h]], closed: true }) },
  { id: 'arrow', name: 'Arrow', amount: { label: 'Head length', min: 10, max: 90, value: 40, step: 1, unit: '%' },
    make: ({ x, y, width: w, height: h }, amount) => { const neck = x + w * (1 - amount / 100);
      return { points: [[x, y + h * .25], [neck, y + h * .25], [neck, y], [x + w, y + h / 2], [neck, y + h], [neck, y + h * .75], [x, y + h * .75]], closed: true }; } },
  { id: 'cross', name: 'Cross', amount: { label: 'Arm thickness', min: 5, max: 95, value: 34, step: 1, unit: '%' },
    make: ({ x, y, width: w, height: h }, amount) => { const a = (1 - amount / 100) / 2, x1 = x + w * a, x2 = x + w * (1 - a), y1 = y + h * a, y2 = y + h * (1 - a);
      return { points: [[x1, y], [x2, y], [x2, y1], [x + w, y1], [x + w, y2], [x2, y2], [x2, y + h], [x1, y + h], [x1, y2], [x, y2], [x, y1], [x1, y1]], closed: true }; } },
  { id: 'donut', name: 'Donut', amount: { label: 'Hole size', min: 5, max: 95, value: 50, step: 1, unit: '%' },
    make: ({ x, y, width: w, height: h }, amount) => { const cx = x + w / 2, cy = y + h / 2, k = amount / 100;
      return { ...ellipse(cx, cy, w / 2, h / 2), closed: true, fillRule: 'evenodd', subpaths: [{ ...ellipse(cx, cy, w / 2 * k, h / 2 * k), closed: true }] }; } },
  { id: 'pie', name: 'Pie', amount: { label: 'Angle', min: 10, max: 350, value: 270, step: 5, unit: '°' },
    make: ({ x, y, width: w, height: h }, amount) => { const cx = x + w / 2, cy = y + h / 2, from = -Math.PI / 2;
      return outline([cx, cy]).line([cx, y]).arc(cx, cy, w / 2, h / 2, from, from + amount * Math.PI / 180).close(); } },
  { id: 'crescent', name: 'Crescent', amount: { label: 'Thickness', min: 5, max: 95, value: 45, step: 1, unit: '%' },
    make: ({ x, y, width: w, height: h }, amount) => { const cx = x + w, cy = y + h / 2, q = Math.PI / 2;
      return outline([cx, y]).arc(cx, cy, w, h / 2, -q, -3 * q).arc(cx, cy, w * (1 - amount / 100), h / 2, q, 3 * q).close(); } },
  { id: 'cog', name: 'Cog', amount: { label: 'Teeth', min: 4, max: 32, value: 10, step: 1 },
    make: ({ x, y, width: w, height: h }, amount) => {
      const cx = x + w / 2, cy = y + h / 2, teeth = Math.round(amount), step = TURN / teeth, at = (angle: number, k: number): Point => [cx + w / 2 * k * Math.cos(angle), cy + h / 2 * k * Math.sin(angle)];
      const points = Array.from({ length: teeth }, (_, i) => { const a = i * step - Math.PI / 2; return [at(a - step * .32, .78), at(a - step * .18, 1), at(a + step * .18, 1), at(a + step * .32, .78)]; }).flat();
      return { points, closed: true, fillRule: 'evenodd', subpaths: [{ ...ellipse(cx, cy, w * .15, h * .15), closed: true }] };
    } },
  { id: 'heart', name: 'Heart', make: ({ x, y, width: w, height: h }) => { const p = (u: number, v: number): Point => [x + w * u, y + h * v];
    return outline(p(.5, .3)).curve(p(.5, .1), p(.35, 0), p(.25, 0)).curve(p(.1, 0), p(0, .12), p(0, .3)).curve(p(0, .55), p(.25, .75), p(.5, 1))
      .curve(p(.75, .75), p(1, .55), p(1, .3)).curve(p(1, .12), p(.9, 0), p(.75, 0)).curve(p(.65, 0), p(.5, .1), p(.5, .3)).close(); } },
  { id: 'callout', name: 'Speech bubble', amount: { label: 'Corner radius', min: 0, max: 50, value: 25, step: 1, unit: '%' },
    make: ({ x, y, width: w, height: full }, amount) => {
      const h = full * .75, r = Math.max(Math.min(w, h) * amount / 100, 1e-6), q = Math.PI / 2;
      return outline([x + r, y]).line([x + w - r, y]).arc(x + w - r, y + r, r, r, -q, 0).line([x + w, y + h - r]).arc(x + w - r, y + h - r, r, r, 0, q)
        .line([x + w * .42, y + h]).line([x + w * .2, y + full]).line([x + w * .26, y + h]).line([x + r, y + h]).arc(x + r, y + h - r, r, r, q, 2 * q).line([x, y + r]).arc(x + r, y + r, r, r, 2 * q, 3 * q).close();
    } },
  { id: 'cloud', name: 'Cloud', amount: { label: 'Bumps', min: 5, max: 16, value: 8, step: 1 },
    make: ({ x, y, width: w, height: h }, amount) => {
      const cx = x + w / 2, cy = y + h / 2, bumps = Math.round(amount), step = TURN / bumps, at = (angle: number, k: number): Point => [cx + w / 2 * k * Math.cos(angle), cy + h / 2 * k * Math.sin(angle)];
      // Each bump swells out between two points on an inner ellipse; .98 keeps the widest part inside the box.
      const shape = outline(at(0, .72));
      for (let i = 0; i < bumps; i++) shape.curve(at(i * step + step * .12, .98 * 1.12), at((i + 1) * step - step * .12, .98 * 1.12), at((i + 1) * step, .72));
      return shape.close();
    } },
];
/** The drawn shape for a dragged box. */
export const makeShape = (id: string, box: Bounds, amount?: number): SketchPath => { const kind = SHAPES.find(s => s.id === id) ?? SHAPES[0]; return kind.make(box, amount ?? kind.amount?.value ?? 0); };
