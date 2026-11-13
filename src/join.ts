import type { NodeMode, Point } from '@aether/sketch';
import type { DrawingPath } from './document';

const near = (a: Point, b: Point, tolerance: number) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
/** Plain open paths can be chained; closed shapes, compound paths and text cannot. */
export const joinable = (p: DrawingPath) => !p.closed && !p.text && !p.subpaths?.length && p.points.length >= 2;

/** The same path walked from the other end: edge controls swap with their edge. */
function reversed(p: DrawingPath): DrawingPath {
  const n = p.points.length, curves = p.curves && [...Array.from({ length: n - 1 }, (_, i) => { const c = p.curves![n - 2 - i]; return c ? { c1: c.c2, c2: c.c1 } : null; }), null];
  return { ...p, points: [...p.points].reverse(), ...(curves ? { curves } : {}), ...(p.nodeModes ? { nodeModes: [...p.nodeModes].reverse() } : {}) };
}

/** `a` then `b`, where a's last point meets b's first. The shared point keeps a's position. */
function chain(a: DrawingPath, b: DrawingPath): DrawingPath {
  const modes = (p: DrawingPath): NodeMode[] => p.nodeModes ?? p.points.map(() => 'corner');
  const edges = (p: DrawingPath) => Array.from({ length: p.points.length - 1 }, (_, i) => p.curves?.[i] ?? null);
  const curves = a.curves || b.curves ? [...edges(a), ...edges(b), null] : undefined;
  return { ...a, points: [...a.points, ...b.points.slice(1)], curves, nodeModes: a.nodeModes || b.nodeModes ? [...modes(a), ...modes(b).slice(1)] : undefined };
}

/** Meeting its own start closes the path: the last point merges into the first. */
function closeIfMet(p: DrawingPath, tolerance: number): DrawingPath {
  if (p.points.length < 4 || !near(p.points[0], p.points.at(-1)!, tolerance)) return p;
  const n = p.points.length - 1;
  return { ...p, closed: true, points: p.points.slice(0, n), ...(p.curves ? { curves: p.curves.slice(0, n) } : {}), ...(p.nodeModes ? { nodeModes: p.nodeModes.slice(0, n) } : {}) };
}

/**
 * A new open line or pen path that starts or ends on the free end of another open path
 * joins it into one path (Illustrator/Affinity behaviour), and closes when it comes back to
 * its own start. The result keeps the existing path's id and look. `removed` lists the
 * paths the result replaces; empty when nothing joined.
 */
export function joinOpenPath(added: DrawingPath, others: DrawingPath[], tolerance: number): { path: DrawingPath; removed: string[] } {
  if (!joinable(added)) return { path: added, removed: [] };
  let path = added, removed: string[] = [];
  const at = (end: 'start' | 'end') => end === 'start' ? path.points[0] : path.points.at(-1)!;
  for (const end of ['start', 'end'] as const) {
    if (path.closed) break;
    const other = others.find(o => joinable(o) && !removed.includes(o.id) && (near(o.points[0], at(end), tolerance) || near(o.points.at(-1)!, at(end), tolerance)));
    if (!other) continue;
    const touchesEnd = near(other.points.at(-1)!, at(end), tolerance);
    const { points, curves, nodeModes } = end === 'start' ? chain(touchesEnd ? other : reversed(other), path) : chain(path, touchesEnd ? reversed(other) : other);
    // The first path joined lends its id and look; the new stroke just extends it.
    path = { ...(removed.length ? path : other), points, curves, nodeModes, closed: false };
    removed = [...removed, other.id];
    path = closeIfMet(path, tolerance);
  }
  return { path: closeIfMet(path, tolerance), removed };
}
