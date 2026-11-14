// Predictive stroke: a finished freehand stroke becomes the clean shape it resembles (SketchBook's Predictive Stroke).
// Recognised: a straight line, a circular arc, a circle or level ellipse, and a polygon of three to six corners
// (a near-level four-corner one becomes a true rectangle). Anything else is left as drawn.
// ponytail: thresholds are fixed fractions of the stroke's size, and a tilted ellipse is not recognised; fit a rotated
// ellipse (and expose a strength setting) if people ask for it.
import type { Point } from '@aether/sketch';

export interface Predicted {
  kind: 'line' | 'arc' | 'ellipse' | 'polygon';
  /** The clean stroke as a polyline; a closed shape ends where it starts. */
  points: Point[]; closed: boolean;
  /** For an ellipse, its box, so a vector tool can make a true ellipse. */
  box?: { x: number; y: number; width: number; height: number };
}
const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const offLine = (p: Point, a: Point, b: Point) => { const l = dist(a, b); return l ? Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / l : dist(p, a); };
/** Ramer-Douglas-Peucker: the corners of an open run of points. */
function corners(points: Point[], tolerance: number): Point[] {
  let worst = 0, at = 0;
  for (let i = 1; i < points.length - 1; i++) { const d = offLine(points[i], points[0], points[points.length - 1]); if (d > worst) { worst = d; at = i; } }
  return worst > tolerance ? [...corners(points.slice(0, at + 1), tolerance).slice(0, -1), ...corners(points.slice(at), tolerance)] : [points[0], points[points.length - 1]];
}
/** Least-squares circle (Kåsa): solves x² + y² + ax + by + c = 0. Null when the points are in a line. */
function fitCircle(points: Point[]): { center: Point; radius: number } | null {
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0; const n = points.length;
  for (const [x, y] of points) { const z = x * x + y * y; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
  // Normal equations [sxx sxy sx; sxy syy sy; sx sy n] · [a b c] = −[sxz syz sz], by Cramer's rule.
  const det = (m: number[]) => m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  const d = det([sxx, sxy, sx, sxy, syy, sy, sx, sy, n]); if (Math.abs(d) < 1e-9) return null;
  const a = det([-sxz, sxy, sx, -syz, syy, sy, -sz, sy, n]) / d, b = det([sxx, -sxz, sx, sxy, -syz, sy, sx, -sz, n]) / d, c = det([sxx, sxy, -sxz, sxy, syy, -syz, sx, sy, -sz]) / d;
  const r2 = a * a / 4 + b * b / 4 - c; return r2 > 0 ? { center: [-a / 2, -b / 2], radius: Math.sqrt(r2) } : null;
}

export function predictStroke(raw: Point[]): Predicted | null {
  if (raw.length < 3) return null;
  const xs = raw.map(p => p[0]), ys = raw.map(p => p[1]), x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y, size = Math.hypot(width, height);
  const first = raw[0], last = raw[raw.length - 1], length = raw.reduce((sum, p, i) => i ? sum + dist(raw[i - 1], p) : 0, 0);
  if (size < 1e-6 || length < 1e-6) return null;
  const gap = dist(first, last);
  if (gap > length * .15) {
    // Open: a line when it never strays far from its chord, else an arc when a circle fits it.
    if (Math.max(...raw.map(p => offLine(p, first, last))) < gap * .06 && length < gap * 1.3) return { kind: 'line', points: [first, last], closed: false };
    const circle = fitCircle(raw); if (!circle || circle.radius > length * 4) return null;
    if (Math.max(...raw.map(p => Math.abs(dist(p, circle.center) - circle.radius))) > circle.radius * .08) return null;
    // Sweep: the turning from the first point to the last, the way the stroke went round.
    const angle = (p: Point) => Math.atan2(p[1] - circle.center[1], p[0] - circle.center[0]);
    let sweep = 0; for (let i = 1; i < raw.length; i++) { let d = angle(raw[i]) - angle(raw[i - 1]); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; sweep += d; }
    if (Math.abs(sweep) < Math.PI / 6 || Math.abs(sweep) > Math.PI * 1.95) return null;
    const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 36))), from = angle(first);
    return { kind: 'arc', closed: false, points: Array.from({ length: steps + 1 }, (_, i) => { const t = from + sweep * i / steps; return [circle.center[0] + Math.cos(t) * circle.radius, circle.center[1] + Math.sin(t) * circle.radius] as Point; }) };
  }
  // Closed. An ellipse when every point sits near the ellipse its box holds.
  if (width > size * .05 && height > size * .05) {
    // The box holds the stroke's widest wobble, so the ellipse is that shape at the stroke's average distance from the middle.
    const cx = x + width / 2, cy = y + height / 2, reach = raw.map(p => Math.hypot((p[0] - cx) / (width / 2), (p[1] - cy) / (height / 2))), mean = reach.reduce((a, b) => a + b, 0) / reach.length;
    const off = reach.map(v => Math.abs(v / mean - 1));
    if (off.reduce((a, b) => a + b, 0) / off.length < .08 && Math.max(...off) < .25) {
      // Nearly round is meant round.
      const round = Math.abs(width - height) < Math.max(width, height) * .12, w = (round ? (width + height) / 2 : width) * mean, h = round ? w : height * mean;
      const box = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
      const ring = Array.from({ length: 72 }, (_, i) => { const t = i * Math.PI / 36; return [cx + Math.cos(t) * w / 2, cy + Math.sin(t) * h / 2] as Point; });
      return { kind: 'ellipse', closed: true, box, points: [...ring, ring[0]] };
    }
  }
  // A polygon: the stroke's corners, found on both halves of the loop (split at the point furthest from the start).
  let far = 0; raw.forEach((p, i) => { if (dist(p, first) > dist(raw[far], first)) far = i; });
  let ring = [...corners(raw.slice(0, far + 1), size * .06), ...corners(raw.slice(far), size * .06).slice(1)];
  if (dist(ring[0], ring[ring.length - 1]) < size * .12) ring = ring.slice(0, -1); // the end meets the start
  // Where the stroke started or turned gently is not a corner.
  const bend = (i: number) => { const a = ring[(i + ring.length - 1) % ring.length], b = ring[i], c = ring[(i + 1) % ring.length]; return Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]))); };
  for (let changed = true; changed && ring.length > 3;) { const i = ring.findIndex((_, k) => bend(k) < Math.PI / 7); changed = i >= 0; if (changed) ring = ring.filter((_, k) => k !== i); }
  if (ring.length < 3 || ring.length > 6) return null;
  // Four corners with level and upright sides make a true rectangle.
  const level = ring.length === 4 && ring.every((p, i) => { const q = ring[(i + 1) % 4], a = Math.abs(Math.atan2(q[1] - p[1], q[0] - p[0])) % (Math.PI / 2); return Math.min(a, Math.PI / 2 - a) < Math.PI / 15; });
  const shape: Point[] = level ? [[x, y], [x + width, y], [x + width, y + height], [x, y + height]] : ring;
  return { kind: 'polygon', closed: true, points: [...shape, shape[0]] };
}
