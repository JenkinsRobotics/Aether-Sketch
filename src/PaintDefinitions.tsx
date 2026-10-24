import { gradientVector, pathData } from '@aether/sketch';
import type { DrawingPath, SketchDocument } from './document';
export function PaintDefinitions({ doc, ids, preview }: { doc: SketchDocument; ids: Map<string, string>; preview: DrawingPath[] }) {
  return <defs>{doc.layers.flatMap(l => l.paths).map(original => {
    const p = preview.find(p => p.id === original.id) ?? original, id = ids.get(p.id)!, g = p.fillGradient;
    const stops = g?.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />);
    return <g key={id}>
      <clipPath id={`${id}-clip`} clipPathUnits="userSpaceOnUse"><path d={pathData(p)} clipRule={p.fillRule ?? 'nonzero'} /></clipPath>
      {g?.kind === 'linear' && <linearGradient id={`${id}-gradient`} {...gradientVector(g.angleDeg)}>{stops}</linearGradient>}
      {g?.kind === 'radial' && <radialGradient id={`${id}-gradient`} cx=".5" cy=".5" r=".5">{stops}</radialGradient>}
    </g>;
  })}</defs>;
}
