import type { Point } from '@aether/sketch';
import type { Guides } from './guides';

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
  if (kind === 'perspective' && guides.perspective) return { ...guides, perspective: { points: guides.perspective.points.map((p, i) => i === Number(part) ? at : p) } };
  return guides;
}

/** Rulers, ellipse guide, symmetry axes and perspective lines, drawn over the drawing with handles to drag. */
export function GuideOverlay({ guides, scale }: { guides: Guides; scale: number }) {
  const r = 7 / scale, far = 1e5 / scale;
  const handle = (key: string, at: Point, label: string) => <circle key={key} className="sketch-guide-handle" data-guide={key} cx={at[0]} cy={at[1]} r={r} vectorEffect="non-scaling-stroke"><title>{label}</title></circle>;
  const extended = (a: Point, b: Point) => { const l = dist(a, b) || 1, d: Point = [(b[0] - a[0]) / l, (b[1] - a[1]) / l]; return <line x1={a[0] - d[0] * far} y1={a[1] - d[1] * far} x2={b[0] + d[0] * far} y2={b[1] + d[1] * far} vectorEffect="non-scaling-stroke" />; };
  const { ruler, ellipse, symmetry, perspective } = guides;
  return <g className="sketch-guides" aria-label="Drawing guides">
    {ruler && <g className="sketch-guide sketch-guide-ruler">{extended(ruler.a, ruler.b)}{handle('ruler:a', ruler.a, 'Ruler end')}{handle('ruler:b', ruler.b, 'Ruler end')}</g>}
    {ellipse && <g className="sketch-guide sketch-guide-ellipse">
      <ellipse cx={ellipse.center[0]} cy={ellipse.center[1]} rx={ellipse.rx} ry={ellipse.ry} transform={`rotate(${ellipse.angle * 180 / Math.PI} ${ellipse.center[0]} ${ellipse.center[1]})`} fill="none" vectorEffect="non-scaling-stroke" />
      {handle('ellipse:center', ellipse.center, 'Ellipse centre')}
      {handle('ellipse:rx', [ellipse.center[0] + Math.cos(ellipse.angle) * ellipse.rx, ellipse.center[1] + Math.sin(ellipse.angle) * ellipse.rx], 'Ellipse width and angle')}
      {handle('ellipse:ry', [ellipse.center[0] - Math.sin(ellipse.angle) * ellipse.ry, ellipse.center[1] + Math.cos(ellipse.angle) * ellipse.ry], 'Ellipse height')}
    </g>}
    {symmetry && <g className="sketch-guide sketch-guide-symmetry">
      {(symmetry.mode === 'radial' ? Array.from({ length: Math.max(1, Math.round(symmetry.sections)) }, (_, i) => i * Math.PI * 2 / Math.max(1, Math.round(symmetry.sections)) - Math.PI / 2)
        : [...(symmetry.mode !== 'horizontal' ? [-Math.PI / 2] : []), ...(symmetry.mode !== 'vertical' ? [0] : [])]).map((angle, i) => {
        const [cx, cy] = symmetry.center, reach = symmetry.mode === 'radial' ? far : far;
        return <line key={i} x1={symmetry.mode === 'radial' ? cx : cx - Math.cos(angle) * reach} y1={symmetry.mode === 'radial' ? cy : cy - Math.sin(angle) * reach} x2={cx + Math.cos(angle) * reach} y2={cy + Math.sin(angle) * reach} vectorEffect="non-scaling-stroke" />;
      })}
      {handle('symmetry:center', symmetry.center, 'Symmetry centre')}
    </g>}
    {perspective && <g className="sketch-guide sketch-guide-perspective">
      {perspective.points.length > 1 ? extended(perspective.points[0], perspective.points[1]) : extended(perspective.points[0], [perspective.points[0][0] + 1, perspective.points[0][1]])}
      {perspective.points.flatMap((vp, v) => Array.from({ length: 16 }, (_, i) => { const a = i * Math.PI / 8; return <line key={`${v}-${i}`} className="sketch-guide-fan" x1={vp[0]} y1={vp[1]} x2={vp[0] + Math.cos(a) * far} y2={vp[1] + Math.sin(a) * far} vectorEffect="non-scaling-stroke" />; }))}
      {perspective.points.map((vp, i) => handle(`perspective:${i}`, vp, 'Vanishing point'))}
    </g>}
  </g>;
}
