import { pathBounds, rotatePoint, transformPath, type Bounds, type Point } from '@aether/sketch';
import type { DrawingPath, Layer } from './document';

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';
export type OrderMode = 'front' | 'forward' | 'backward' | 'back';

const move = (p: DrawingPath, dx: number, dy: number): DrawingPath => dx || dy ? { ...p, ...transformPath(p, v => [v[0] + dx, v[1] + dy]) } : p;

/** Align paths to each other, or a single path to the artboard (the usual vector-editor rule). */
export function alignPaths(paths: DrawingPath[], mode: AlignMode, artboard: Bounds): DrawingPath[] {
  const target = paths.length > 1 ? pathBounds(paths) : artboard;
  if (!target) return paths;
  return paths.map(p => {
    const b = pathBounds([p]);
    if (!b) return p;
    const dx = mode === 'left' ? target.x - b.x : mode === 'right' ? target.x + target.width - b.x - b.width : mode === 'center' ? target.x + (target.width - b.width) / 2 - b.x : 0;
    const dy = mode === 'top' ? target.y - b.y : mode === 'bottom' ? target.y + target.height - b.y - b.height : mode === 'middle' ? target.y + (target.height - b.height) / 2 - b.y : 0;
    return move(p, dx, dy);
  });
}

/** Even gaps between three or more paths along an axis; the outermost two stay put. */
export function distributePaths(paths: DrawingPath[], axis: 'horizontal' | 'vertical'): DrawingPath[] {
  if (paths.length < 3) return paths;
  const x = axis === 'horizontal';
  const entries = paths.map(p => ({ p, b: pathBounds([p])! })).filter(e => e.b).sort((a, b) => x ? a.b.x - b.b.x : a.b.y - b.b.y);
  const start = x ? entries[0].b.x : entries[0].b.y;
  const last = entries[entries.length - 1].b, end = x ? last.x + last.width : last.y + last.height;
  const gap = (end - start - entries.reduce((sum, e) => sum + (x ? e.b.width : e.b.height), 0)) / (entries.length - 1);
  const moved = new Map<string, DrawingPath>();
  let cursor = start;
  for (const { p, b } of entries) {
    moved.set(p.id, move(p, x ? cursor - b.x : 0, x ? 0 : cursor - b.y));
    cursor += (x ? b.width : b.height) + gap;
  }
  return paths.map(p => moved.get(p.id) ?? p);
}

/** Text boxes keep their reading orientation, so flips and quarter turns skip them. */
export function flipPaths(paths: DrawingPath[], axis: 'horizontal' | 'vertical'): DrawingPath[] {
  const b = pathBounds(paths.filter(p => !p.text));
  if (!b) return paths;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  return paths.map(p => p.text ? p : { ...p, ...transformPath(p, v => axis === 'horizontal' ? [2 * cx - v[0], v[1]] : [v[0], 2 * cy - v[1]]) });
}

export function rotatePaths(paths: DrawingPath[], radians: number): DrawingPath[] {
  const b = pathBounds(paths.filter(p => !p.text));
  if (!b) return paths;
  const center: Point = [b.x + b.width / 2, b.y + b.height / 2];
  return paths.map(p => p.text ? p : { ...p, ...transformPath(p, v => rotatePoint(v, center, radians)) });
}

/** Stacking within a layer: later paths draw on top. */
export function orderPaths(layer: Layer, ids: readonly string[], mode: OrderMode): Layer {
  const chosen = new Set(ids), paths = [...layer.paths];
  if (mode === 'front') return { ...layer, paths: [...paths.filter(p => !chosen.has(p.id)), ...paths.filter(p => chosen.has(p.id))] };
  if (mode === 'back') return { ...layer, paths: [...paths.filter(p => chosen.has(p.id)), ...paths.filter(p => !chosen.has(p.id))] };
  if (mode === 'forward') {
    for (let i = paths.length - 2; i >= 0; i--) if (chosen.has(paths[i].id) && !chosen.has(paths[i + 1].id)) [paths[i], paths[i + 1]] = [paths[i + 1], paths[i]];
  } else {
    for (let i = 1; i < paths.length; i++) if (chosen.has(paths[i].id) && !chosen.has(paths[i - 1].id)) [paths[i], paths[i - 1]] = [paths[i - 1], paths[i]];
  }
  return { ...layer, paths };
}
