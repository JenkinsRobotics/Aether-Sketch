import { transformPath, type Point, type SketchPath } from '@aether/sketch';

/** Drawing guides (SketchBook-style). All points are document units. */
export interface Ruler { a: Point; b: Point }
export interface EllipseGuide { center: Point; rx: number; ry: number; angle: number }
export type SymmetryMode = 'vertical' | 'horizontal' | 'both' | 'radial';
export interface Symmetry { mode: SymmetryMode; center: Point; sections: number }
/** One- or two-point perspective: strokes run towards a vanishing point, or stay vertical. */
export interface Perspective { points: Point[] }
export interface Guides { ruler?: Ruler; ellipse?: EllipseGuide; symmetry?: Symmetry; perspective?: Perspective; /** 0–0.95: how much a stroke lags the pointer to smooth it. */ steady?: number }

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

/**
 * The constraint a stroke follows, decided once from where it starts and its first movement:
 * the ruler or ellipse when the stroke starts within `reach` of it, else a perspective line.
 * Returns a projection for every later sample, or null for a free stroke.
 */
export function strokeConstraint(guides: Guides, start: Point, toward: Point, reach: number): ((p: Point) => Point) | null {
  if (guides.ruler && distanceToLine(start, guides.ruler.a, guides.ruler.b) <= reach) { const { a, b } = guides.ruler; return p => projectToLine(p, a, b); }
  if (guides.ellipse && distanceToEllipse(start, guides.ellipse) <= reach) { const e = guides.ellipse; return p => projectToEllipse(p, e); }
  const vps = guides.perspective?.points ?? [];
  if (!vps.length || len(sub(toward, start)) === 0) return null;
  // Candidates: towards each vanishing point, and vertical. Pick the one closest to the stroke's first direction.
  const dir = sub(toward, start), unit = (v: Point): Point => { const l = len(v) || 1; return [v[0] / l, v[1] / l]; };
  const options = [...vps.map(vp => unit(sub(vp, start))), [0, 1] as Point];
  const best = options.reduce((a, b) => Math.abs(a[0] * dir[0] + a[1] * dir[1]) >= Math.abs(b[0] * dir[0] + b[1] * dir[1]) ? a : b);
  const end: Point = [start[0] + best[0], start[1] + best[1]];
  return p => projectToLine(p, start, end);
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
