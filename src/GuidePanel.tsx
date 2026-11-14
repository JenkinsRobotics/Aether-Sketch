import { Button, FieldRow, SegmentedControl, SelectField, Slider } from '@aether/ui';
import type { Guides, SymmetryMode } from './guides';

/** Settings for the guides switched on from the center tray. */
export function GuidePanel({ guides, onChange }: { guides: Guides; onChange: (guides: Guides) => void }) {
  const { symmetry, perspective, curve, isometric } = guides;
  if (!guides.ruler && !guides.ellipse && !symmetry && !perspective && guides.steady === undefined && !curve && !isometric && !guides.predict) return null;
  return <div className="sketch-guide-settings"><strong>Guides</strong>
    {(guides.ruler || guides.ellipse) && <p className="sketch-guide-hint">Start a stroke near the {guides.ruler && guides.ellipse ? 'ruler or ellipse' : guides.ruler ? 'ruler' : 'ellipse'} and it follows the edge. Drag the handles to place it.</p>}
    {symmetry && <>
      <FieldRow label="Symmetry"><SegmentedControl ariaLabel="Symmetry mode" value={symmetry.mode} onChange={mode => onChange({ ...guides, symmetry: { ...symmetry, mode: mode as SymmetryMode } })}
        options={[{ id: 'vertical', label: 'Mirror' }, { id: 'horizontal', label: 'Flip' }, { id: 'both', label: 'Quad' }, { id: 'radial', label: 'Radial' }]} /></FieldRow>
      {symmetry.mode === 'radial' && <FieldRow label="Sections"><Slider ariaLabel="Radial sections" min={2} max={32} value={symmetry.sections} onChange={sections => onChange({ ...guides, symmetry: { ...symmetry, sections } })} /></FieldRow>}
    </>}
    {curve && <><p className="sketch-guide-hint">Start a stroke near the French curve and it follows the edge. Drag the middle handle to move it and the end handle to turn and resize it, until the part of the edge you need sits where the line should go.</p>
      <Button onClick={() => onChange({ ...guides, curve: { ...curve, flip: !curve.flip } })}>Flip the curve</Button></>}
    {perspective && <><FieldRow label="Perspective"><SelectField aria-label="Perspective kind" value={perspective.kind ?? String(perspective.points.length)}
      options={[{ value: '1', label: '1-point' }, { value: '2', label: '2-point' }, { value: '3', label: '3-point' }, { value: 'fisheye', label: 'Fisheye (5-point)' }]}
      onChange={event => {
        // Keep what is placed: the first point stays, and new vanishing points appear level with it or below it.
        const next = event.target.value, [a, b, c] = perspective.points, span = b ? Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) || 800 : 800;
        const second: [number, number] = perspective.kind !== 'fisheye' && b ? b : [a[0] + span, a[1]];
        onChange({ ...guides, perspective: next === 'fisheye' ? { kind: 'fisheye', points: [a, [a[0] + (b ? span / 2 : 240), a[1]]] }
          : { points: next === '1' ? [a] : next === '2' ? [a, second] : [a, second, perspective.kind !== 'fisheye' && c ? c : [(a[0] + second[0]) / 2, a[1] + span]] } });
      }} /></FieldRow>
      <p className="sketch-guide-hint">{perspective.kind === 'fisheye' ? 'Strokes bend along arcs through the sides or the top and bottom of the circle, or run straight to its centre, whichever is closest to the way you set off.'
        : perspective.points.length === 3 ? 'Strokes run to whichever of the three vanishing points is closest to the way you set off.' : `Strokes run to a vanishing point, or stay ${perspective.points.length === 1 ? 'level or upright' : 'upright'}.`}</p></>}
    {isometric && <><FieldRow label="Grid size"><Slider ariaLabel="Isometric grid size" min={8} max={240} unit="px" value={Math.round(isometric.size)} onChange={size => onChange({ ...guides, isometric: { ...isometric, size } })} /></FieldRow>
      <p className="sketch-guide-hint">Strokes run upright or at 30° either side of level. Drag the handle to line the grid up with your drawing.</p></>}
    {guides.predict && <p className="sketch-guide-hint">Predictive stroke: when you lift the pen, a pencil or brush stroke that looks like a line, arc, circle, ellipse, triangle or box becomes that shape. Other strokes stay as drawn.</p>}
    {guides.steady !== undefined && <FieldRow label="Steady stroke"><Slider ariaLabel="Steady stroke amount" min={0} max={90} unit="%" value={Math.round(guides.steady * 100)} onChange={v => onChange({ ...guides, steady: v / 100 })} /></FieldRow>}
    <Button onClick={() => onChange({})}>Turn off all guides</Button>
  </div>;
}
