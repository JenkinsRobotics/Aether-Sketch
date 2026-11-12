import { Button, FieldRow, SegmentedControl, Slider } from '@aether/ui';
import type { Guides, SymmetryMode } from './guides';

/** Settings for the guides switched on from the center tray. */
export function GuidePanel({ guides, onChange }: { guides: Guides; onChange: (guides: Guides) => void }) {
  const { symmetry, perspective } = guides;
  if (!guides.ruler && !guides.ellipse && !symmetry && !perspective && !guides.steady) return null;
  return <div className="sketch-guide-settings"><strong>Guides</strong>
    {(guides.ruler || guides.ellipse) && <p className="sketch-guide-hint">Start a stroke near the {guides.ruler && guides.ellipse ? 'ruler or ellipse' : guides.ruler ? 'ruler' : 'ellipse'} and it follows the edge. Drag the handles to place it.</p>}
    {symmetry && <>
      <FieldRow label="Symmetry"><SegmentedControl ariaLabel="Symmetry mode" value={symmetry.mode} onChange={mode => onChange({ ...guides, symmetry: { ...symmetry, mode: mode as SymmetryMode } })}
        options={[{ id: 'vertical', label: 'Mirror' }, { id: 'horizontal', label: 'Flip' }, { id: 'both', label: 'Quad' }, { id: 'radial', label: 'Radial' }]} /></FieldRow>
      {symmetry.mode === 'radial' && <FieldRow label="Sections"><Slider ariaLabel="Radial sections" min={2} max={32} value={symmetry.sections} onChange={sections => onChange({ ...guides, symmetry: { ...symmetry, sections } })} /></FieldRow>}
    </>}
    {perspective && <FieldRow label="Perspective"><SegmentedControl ariaLabel="Vanishing points" value={String(perspective.points.length)}
      onChange={count => { const [a] = perspective.points, b = perspective.points[1]; const span = b ? Math.abs(b[0] - a[0]) : 800;
        onChange({ ...guides, perspective: { points: count === '1' ? [a] : [a, b ?? [a[0] + span, a[1]]] } }); }}
      options={[{ id: '1', label: '1-point' }, { id: '2', label: '2-point' }]} /></FieldRow>}
    {guides.steady !== undefined && <FieldRow label="Steady stroke"><Slider ariaLabel="Steady stroke amount" min={0} max={90} unit="%" value={Math.round(guides.steady * 100)} onChange={v => onChange({ ...guides, steady: v / 100 })} /></FieldRow>}
    <Button onClick={() => onChange({})}>Turn off all guides</Button>
  </div>;
}
