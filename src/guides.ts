import { transformPath, type Point, type SketchPath } from '@aether/sketch';

/** Drawing guides (SketchBook-style). All points are document units. */
export interface Ruler { a: Point; b: Point }
export interface EllipseGuide { center: Point; rx: number; ry: number; angle: number }
export type SymmetryMode = 'vertical' | 'horizontal' | 'both' | 'radial';
export interface Symmetry { mode: SymmetryMode; center: Point; sections: number }
/** One-, two- or three-point perspective: strokes run towards a vanishing point, or along the directions that have none
 * (level and upright with one point, upright with two). `kind: 'fisheye'` is five-point perspective: `points` are then the
 * centre and a point on the rim, and strokes follow arcs through the rim's left and right or top and bottom, or run to the centre. */
export interface Perspective { points: Point[]; kind?: 'fisheye' }
/** A French curve template: `size` is half its length, `angle` its rotation; `flip` mirrors it. */
export interface CurveGuide { center: Point; size: number; angle: number; flip?: boolean }
/** An isometric grid: strokes run along its three axes (upright, and 30° either side of level). `size` is the cell edge. */
export interface IsoGrid { origin: Point; size: number }
export interface Guides { ruler?: Ruler; ellipse?: EllipseGuide; curve?: CurveGuide; symmetry?: Symmetry; perspective?: Perspective; isometric?: IsoGrid;
  /** 0–0.95: how much a stroke lags the pointer to smooth it. */ steady?: number; /** Tidy a finished freehand stroke into the line, arc, ellipse or polygon it resembles (predict.ts). */ predict?: boolean }

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const len = (v: Point) => Math.hypot(v[0], v[1]);

export function projectToLine(p: Point, a: Point, b: Point): Point {
  const d = sub(b, a), l2 = d[0] ** 2 + d[1] ** 2 || 1, t = ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2;
  return [a[0] + d[0] * t, a[1] + d[1] * t];
}
export const distanceToLine = (p: Point, a: Point, b: Point) => len(sub(p, projectToLine(p, a, b)));

/** The point on the ellipse at the same parametric angle as `p` (close to the nearest point for a moderate ellipse). */
export function projectToEllipse(p: Point, e: EllipseGuide): Point {
  const c = Math.cos(-e.angle), s = Math.sin(-e.angle), x = (p[0] - e.center[0]) * c - (p[1] - e.center[1]) * s, y = (p[0] - e.center[0]) * s + (p[1] - e.center[1]) * c;
  const t = Math.atan2(y / (e.ry || 1), x / (e.rx || 1)), lx = e.rx * Math.cos(t), ly = e.ry * Math.sin(t);
  return [e.center[0] + lx * Math.cos(e.angle) - ly * Math.sin(e.angle), e.center[1] + lx * Math.sin(e.angle) + ly * Math.cos(e.angle)];
}
export const distanceToEllipse = (p: Point, e: EllipseGuide) => len(sub(p, projectToEllipse(p, e)));

// ---- French curve: one template outline, placed by its centre, size and angle. ----
/** The template in its own units (about -1 to 1, y down): a long blade with a full round end and a fine hooked tip, so
 * every curvature from nearly straight to tight is somewhere along its edge. A closed spline through these points. */
const CURVE_TEMPLATE: Point[] = [[.95, .2], [.78, .58], [.38, .7], [-.05, .56], [-.45, .22], [-.8, -.24], [-1, -.62], [-.93, -.82], [-.74, -.7], [-.55, -.36], [-.2, -.08], [.2, -.02], [.55, -.14], [.84, -.08]];
/** A closed Catmull-Rom spline through `points`, as a polyline with `steps` points per span. */
export function closedSpline(points: Point[], steps = 12): Point[] {
  const n = points.length, out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [points[(i + n - 1) % n], points[i], points[(i + 1) % n], points[(i + 2) % n]];
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(a => .5 * (2 * p1[a] + (p2[a] - p0[a]) * t + (2 * p0[a] - 5 * p1[a] + 4 * p2[a] - p3[a]) * t2 + (3 * p1[a] - p0[a] - 3 * p2[a] + p3[a]) * t3)) as Point);
    }
  }
  return out;
}
const TEMPLATE_OUTLINE = closedSpline(CURVE_TEMPLATE);
/** The French curve's outline in document units: a closed polyline. */
export function frenchCurve(g: CurveGuide): Point[] {
  const c = Math.cos(g.angle), n = Math.sin(g.angle), flip = g.flip ? -1 : 1;
  return TEMPLATE_OUTLINE.map(([x, y]) => { const u = x * g.size, v = y * g.size * flip; return [g.center[0] + u * c - v * n, g.center[1] + u * n + v * c]; });
}
/** The nearest point on a polyline, looking only at the segments in `from`…`from + count` (wrapping when closed). */
function nearestOn(line: Point[], closed: boolean, p: Point, from = 0, count = closed ? line.length : line.length - 1) {
  const segments = closed ? line.length : line.length - 1; let best = { index: 0, point: line[0], distance: Infinity };
  for (let k = 0; k < count; k++) {
    const i = closed ? ((from + k) % segments + segments) % segments : from + k; if (i < 0 || i >= segments) continue;
    const a = line[i], b = line[(i + 1) % line.length], d = sub(b, a), l2 = d[0] ** 2 + d[1] ** 2 || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / l2));
    const point: Point = [a[0] + d[0] * t, a[1] + d[1] * t], distance = len(sub(p, point));
    if (distance < best.distance) best = { index: i, point, distance };
  }
  return best;
}
export const distanceToPolyline = (p: Point, line: Point[], closed: boolean) => nearestOn(line, closed, p).distance;
/** Follow a polyline: each point lands on the nearest spot within a few segments of the last one, so a stroke slides
 * along the edge and never jumps across the shape to another part of it. */
export function followPolyline(line: Point[], closed: boolean, start: Point, window = 12): (p: Point) => Point {
  let at = nearestOn(line, closed, start).index;
  return p => { const best = nearestOn(line, closed, p, at - window, window * 2 + 1); at = best.index; return best.point; };
}

const unit = (v: Point): Point => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };
/** Of several directions, the one closest to the way the stroke set off (either way along it). */
const closest = <T,>(options: T[], direction: (o: T) => Point, dir: Point): T => options.reduce((a, b) => { const u = direction(a), v = direction(b); return Math.abs(u[0] * dir[0] + u[1] * dir[1]) >= Math.abs(v[0] * dir[0] + v[1] * dir[1]) ? a : b; });
const COS30 = Math.cos(Math.PI / 6);
/** The three directions strokes take on an isometric grid. */
export const ISO_AXES: Point[] = [[COS30, .5], [COS30, -.5], [0, 1]];
/** Fisheye perspective at `start`: the arc through the rim's left and right, the arc through its top and bottom, and the line
 * to the centre. Each is `{ tangent, project }`. On an axis the arc is that straight axis. */
export function fisheyeCurves(centre: Point, radius: number, start: Point): { tangent: Point; project: (p: Point) => Point }[] {
  const [dx, dy] = sub(start, centre), flat = radius * 1e-6, line = (d: Point) => { const end: Point = [start[0] + d[0], start[1] + d[1]]; return { tangent: d, project: (p: Point) => projectToLine(p, start, end) }; };
  const arc = (c: Point) => { const r = len(sub(start, c)), out = unit(sub(start, c)); return { tangent: [-out[1], out[0]] as Point, project: (p: Point): Point => { const u = unit(sub(p, c)); return [c[0] + u[0] * r, c[1] + u[1] * r]; } }; };
  const power = (dx * dx + dy * dy - radius * radius) / 2; // a circle through both ends of a diameter is centred this far along the other axis, over the offset
  return [Math.abs(dy) < flat ? line([1, 0]) : arc([centre[0], centre[1] + power / dy]), Math.abs(dx) < flat ? line([0, 1]) : arc([centre[0] + power / dx, centre[1]]),
    ...(len([dx, dy]) < flat ? [] : [line(unit([dx, dy]))])];
}

/**
 * The constraint a stroke follows, decided once from where it starts and its first movement: the ruler, ellipse or
 * French curve when the stroke starts within `reach` of it, else an isometric axis or a perspective line.
 * Returns a projection for every later sample, or null for a free stroke.
 */
export function strokeConstraint(guides: Guides, start: Point, toward: Point, reach: number): ((p: Point) => Point) | null {
  if (guides.ruler && distanceToLine(start, guides.ruler.a, guides.ruler.b) <= reach) { const { a, b } = guides.ruler; return p => projectToLine(p, a, b); }
  if (guides.ellipse && distanceToEllipse(start, guides.ellipse) <= reach) { const e = guides.ellipse; return p => projectToEllipse(p, e); }
  if (guides.curve) { const outline = frenchCurve(guides.curve); if (distanceToPolyline(start, outline, true) <= reach) return followPolyline(outline, true, start); }
  const dir = sub(toward, start); if (len(dir) === 0) return null;
  const straight = (options: Point[]) => { const best = closest(options, o => o, dir), end: Point = [start[0] + best[0], start[1] + best[1]]; return (p: Point) => projectToLine(p, start, end); };
  if (guides.isometric) return straight(ISO_AXES);
  const perspective = guides.perspective, vps = perspective?.points ?? [];
  if (!vps.length) return null;
  if (perspective!.kind === 'fisheye') return vps.length < 2 ? null : closest(fisheyeCurves(vps[0], len(sub(vps[1], vps[0])), start), c => c.tangent, dir).project;
  // Towards each vanishing point, plus the directions that have none: level and upright with one point, upright with two.
  return straight([...vps.map(vp => unit(sub(vp, start))), ...(vps.length === 1 ? [[1, 0] as Point] : []), ...(vps.length < 3 ? [[0, 1] as Point] : [])]);
}

/** Steady stroke: each sample moves part-way from the last one towards the pointer. */
export const steadyPoint = (previous: Point, at: Point, steady: number): Point => [previous[0] + (at[0] - previous[0]) * (1 - steady), previous[1] + (at[1] - previous[1]) * (1 - steady)];

/** How symmetry repeats a point: one map per extra copy (the original is not included). */
export function symmetryMaps(s: Symmetry): ((v: Point) => Point)[] {
  const [cx, cy] = s.center;
  const mirrorX = (v: Point): Point => [2 * cx - v[0], v[1]], mirrorY = (v: Point): Point => [v[0], 2 * cy - v[1]];
  const rotate = (angle: number) => (v: Point): Point => { const c = Math.cos(angle), n = Math.sin(angle), x = v[0] - cx, y = v[1] - cy; return [cx + x * c - y * n, cy + x * n + y * c]; };
  return s.mode === 'vertical' ? [mirrorX] : s.mode === 'horizontal' ? [mirrorY] : s.mode === 'both' ? [mirrorX, mirrorY, (v: Point) => mirrorX(mirrorY(v))]
    : Array.from({ length: Math.max(1, Math.round(s.sections)) - 1 }, (_, i) => rotate((i + 1) * Math.PI * 2 / Math.max(1, Math.round(s.sections))));
}
/** The extra copies symmetry draws for a new path (the original is not included). */
export function symmetryCopies<P extends SketchPath>(path: P, s: Symmetry): P[] {
  return symmetryMaps(s).map(map => ({ ...path, ...transformPath(path, map) }));
}
