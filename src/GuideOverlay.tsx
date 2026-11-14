import type { Point } from '@aether/sketch';
import { frenchCurve, type Guides } from './guides';

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Move one guide handle (`data-guide` key) to `at`. */
export function moveGuide(guides: Guides, key: string, at: Point): Guides {
  const [kind, part] = key.split(':');
  if (kind === 'ruler' && guides.ruler) return { ...guides, ruler: { ...guides.ruler, [part]: at } };
  if (kind === 'ellipse' && guides.ellipse) {
    const e = guides.ellipse;
    if (part === 'center') return { ...guides, ellipse: { ...e, center: at } };
    if (part === 'rx') return { ...guides, ellipse: { ...e, rx: Math.max(1e-6, dist(e.center, at)), angle: Math.atan2(at[1] - e.center[1], at[0] - e.center[0]) } };
    return { ...guides, ellipse: { ...e, ry: Math.max(1e-6, dist(e.center, at)) } };
  }
  if (kind === 'symmetry' && guides.symmetry) return { ...guides, symmetry: { ...guides.symmetry, center: at } };
  if (kind === 'perspective' && guides.perspective) {
    const { points, kind: mode } = guides.perspective;
    // Moving a fisheye's centre carries its rim along, so the size stays.
    if (mode === 'fisheye' && part === '0') return { ...guides, perspective: { kind: mode, points: points.map(p => [p[0] + at[0] - points[0][0], p[1] + at[1] - points[0][1]] as Point) } };
    return { ...guides, perspective: { ...guides.perspective, points: points.map((p, i) => i === Number(part) ? at : p) } };
  }
  if (kind === 'curve' && guides.curve) {
    const c = guides.curve;
    return { ...guides, curve: part === 'center' ? { ...c, center: at } : { ...c, size: Math.max(1e-6, dist(c.center, at)), angle: Math.atan2(at[1] - c.center[1], at[0] - c.center[0]) } };
  }
  if (kind === 'isometric' && guides.isometric) return { ...guides, isometric: { ...guides.isometric, origin: at } };
  return guides;
}

/** Rulers, ellipse guide, symmetry axes and perspective lines, drawn over the drawing with handles to drag. */
export function GuideOverlay({ guides, scale }: { guides: Guides; scale: number }) {
  const r = 7 / scale, far = 1e5 / scale;
  const handle = (key: string, at: Point, label: string) => <circle key={key} className="sketch-guide-handle" data-guide={key} cx={at[0]} cy={at[1]} r={r} vectorEffect="non-scaling-stroke"><title>{label}</title></circle>;
  const extended = (a: Point, b: Point) => { const l = dist(a, b) || 1, d: Point = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; return <line x1={a[0] - d[0] * far} y1={a[1] - d[1] * far} x2={b[0] + d[0] * far} y2={b[1] + d[1] * far} vectorEffect="non-scaling-stroke" />; };
  const { ruler, ellipse, symmetry, perspective, curve, isometric } = guides;
  const fisheye = perspective?.kind === 'fisheye' && perspective.points.length > 1 ? { c: perspective.points[0], r: dist(perspective.points[0], perspective.points[1]) } : null;
  /** Sample arcs of a fisheye: through the ends of one diameter, crossing the other at `f` of the radius. */
  const fisheyeArc = (c: Point, r: number, f: number, upright: boolean) => {
    const k = r * (f * f - 1) / (2 * f), radius = Math.hypot(r, k), a: Point = upright ? [c[0], c[1] - r] : [c[0] - r, c[1]], b: Point = upright ? [c[0], c[1] + r] : [c[0] + r, c[1]];
    return `M${a[0]} ${a[1]}A${radius} ${radius} 0 0 ${(f < 0) !== upright ? 1 : 0} ${b[0]} ${b[1]}`;
  };
  // One tile of the isometric grid: uprights at both edges' halves and the two diagonals, repeating from the grid's origin.
  const tile = isometric ? { w: isometric.size * Math.sqrt(3), h: isometric.size } : null;
  return <g className="sketch-guides" aria-label="Drawing guides">
    {ruler && <g className="sketch-guide sketch-guide-ruler">{extended(ruler.a, ruler.b)}{handle('ruler:a', ruler.a, 'Ruler end')}{handle('ruler:b', ruler.b, 'Ruler end')}</g>}
    {ellipse && <g className="sketch-guide sketch-guide-ellipse">
      <ellipse cx={ellipse.center[0]} cy={ellipse.center[1]} rx={ellipse.rx} ry={ellipse.ry} transform={`rotate(${ellipse.angle * 180 / Math.PI} ${ellipse.center[0]} ${ellipse.center[1]})`} fill="none" vectorEffect="non-scaling-stroke" />
      {handle('ellipse:center', ellipse.center, 'Ellipse centre')}
      {handle('ellipse:rx', [ellipse.center[0] + Math.cos(ellipse.angle) * ellipse.rx, ellipse.center[1] + Math.sin(ellipse.angle) * ellipse.rx], 'Ellipse width and angle')}
      {handle('ellipse:ry', [ellipse.center[0] - Math.sin(ellipse.angle) * ellipse.ry, ellipse.center[1] + Math.cos(ellipse.angle) * ellipse.ry], 'Ellipse height')}
    </g>}
    {curve && <g className="sketch-guide sketch-guide-curve">
      <path d={`M${frenchCurve(curve).map(p => p.join(' ')).join('L')}Z`} vectorEffect="non-scaling-stroke" />
      {handle('curve:center', curve.center, 'French curve position')}
      {handle('curve:size', [curve.center[0] + Math.cos(curve.angle) * curve.size, curve.center[1] + Math.sin(curve.angle) * curve.size], 'French curve size and angle')}
    </g>}
    {isometric && tile && <g className="sketch-guide sketch-guide-isometric">
      <pattern id="sketch-isometric-grid" width={tile.w} height={tile.h} patternUnits="userSpaceOnUse" patternTransform={`translate(${isometric.origin[0]} ${isometric.origin[1]})`}>
        {[[0, 0, 0, tile.h], [tile.w / 2, 0, tile.w / 2, tile.h], [tile.w, 0, tile.w, tile.h], [0, 0, tile.w, tile.h], [0, tile.h, tile.w, 0]].map(([x1, y1, x2, y2], i) =>
          <line key={i} className="sketch-guide-fan" x1={x1} y1={y1} x2={x2} y2={y2} style={{ strokeWidth: 1 / scale }} />)}
      </pattern>
      <rect x={-far} y={-far} width={far * 2} height={far * 2} fill="url(#sketch-isometric-grid)" pointerEvents="none" />
      {handle('isometric:origin', isometric.origin, 'Isometric grid origin')}
    </g>}
    {symmetry && <g className="sketch-guide sketch-guide-symmetry">
      {(symmetry.mode === 'radial' ? Array.from({ length: Math.max(1, Math.round(symmetry.sections)) }, (_, i) => i * Math.PI * 2 / Math.max(1, Math.round(symmetry.sections)) - Math.PI / 2)
        : [...(symmetry.mode !== 'horizontal' ? [-Math.PI / 2] : []), ...(symmetry.mode !== 'vertical' ? [0] : [])]).map((angle, i) => {
        const [cx, cy] = symmetry.center, reach = symmetry.mode === 'radial' ? far : far;
        return <line key={i} x1={symmetry.mode === 'radial' ? cx : cx - Math.cos(angle) * reach} y1={symmetry.mode === 'radial' ? cy : cy - Math.sin(angle) * reach} x2={cx + Math.cos(angle) * reach} y2={cy + Math.sin(angle) * reach} vectorEffect="non-scaling-stroke" />;
      })}
      {handle('symmetry:center', symmetry.center, 'Symmetry centre')}
    </g>}
    {fisheye && <g className="sketch-guide sketch-guide-perspective">
      <ellipse cx={fisheye.c[0]} cy={fisheye.c[1]} rx={fisheye.r} ry={fisheye.r} vectorEffect="non-scaling-stroke" />
      <line x1={fisheye.c[0] - fisheye.r} y1={fisheye.c[1]} x2={fisheye.c[0] + fisheye.r} y2={fisheye.c[1]} vectorEffect="non-scaling-stroke" />
      <line x1={fisheye.c[0]} y1={fisheye.c[1] - fisheye.r} x2={fisheye.c[0]} y2={fisheye.c[1] + fisheye.r} vectorEffect="non-scaling-stroke" />
      {[-2 / 3, -1 / 3, 1 / 3, 2 / 3].flatMap(f => [false, true].map(upright => <path key={`${f}-${upright}`} className="sketch-guide-fan" d={fisheyeArc(fisheye.c, fisheye.r, f, upright)} vectorEffect="non-scaling-stroke" />))}
      {handle('perspective:0', fisheye.c, 'Fisheye centre')}{handle('perspective:1', perspective!.points[1], 'Fisheye size')}
    </g>}
    {perspective && !fisheye && <g className="sketch-guide sketch-guide-perspective">
      {perspective.points.length > 1 ? extended(perspective.points[0], perspective.points[1]) : extended(perspective.points[0], [perspective.points[0][0] + 1, perspective.points[0][1]])}
      {perspective.points.flatMap((vp, v) => Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8; return <line key={`${v}-${i}`} className="sketch-guide-fan" x1={vp[0]} y1={vp[1]} x2={vp[0] + Math.cos(a) * far} y2={vp[1] + Math.sin(a) * far} vectorEffect="non-scaling-stroke" />; }))}
      {perspective.points.map((vp, i) => handle(`perspective:${i}`, vp, i === 2 ? 'Third vanishing point' : 'Vanishing point'))}
    </g>}
  </g>;
}
