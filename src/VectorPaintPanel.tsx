import { Button, Checkbox, ColorField, GradientControls, FieldRow, NumberField, SelectField } from '@aether/ui';
import type { VectorGradient } from '@aether/sketch';
import type { DrawingPath } from './document';
import type { PaintStyle } from './paint';
export function VectorPaintPanel({ value, disabled, onChange, selected, inside, onInside, onRelease, canRelease }: {
  value: PaintStyle; disabled: boolean; onChange: (patch: Partial<PaintStyle>) => void;
  selected?: DrawingPath; inside: boolean; onInside: () => void; onRelease: () => void; canRelease: boolean;
}) {
  const gradient = value.fillGradient;
  const setGradient = (patch: Partial<VectorGradient>) => onChange({ fill: value.fill ?? value.color, fillGradient: { kind: 'linear', angleDeg: 0, stops: [{ offset: 0, color: value.fill ?? value.color, opacity: 1 }, { offset: 1, color: '#ffffff', opacity: 1 }], ...gradient, ...patch } });
  return <fieldset className="sketch-paint-panel" disabled={disabled}><legend>Vector appearance</legend>
    <Checkbox label="Fill closed paths" checked={value.fill !== null} onChange={e => onChange({ fill: e.target.checked ? value.color : null })} />
    <FieldRow label="Fill type"><SelectField aria-label="Fill type" value={gradient?.kind ?? 'solid'} options={['solid', 'linear', 'radial'].map(value => ({ value, label: value }))}
      onChange={e => e.target.value === 'solid' ? onChange({ fillGradient: undefined }) : setGradient({ kind: e.target.value as 'linear' | 'radial' })} /></FieldRow>
    {!gradient ? <FieldRow label="Fill"><ColorField value={value.fill ?? value.color} onChange={fill => onChange({ fill })} ariaLabel="Fill color" /></FieldRow> : <GradientControls value={gradient} onChange={fillGradient => onChange({ fillGradient })} />}
    <FieldRow label="Fill opacity"><NumberField aria-label="Fill opacity" value={(value.fillOpacity ?? (value.fill === undefined ? .15 : 1)) * 100} min={0} max={100} unit="%" onCommit={v => onChange({ fillOpacity: v / 100 })} /></FieldRow>
    <Checkbox label="Stroke enabled" checked={value.strokeEnabled !== false} onChange={e => onChange({ strokeEnabled: e.target.checked })} />
    <FieldRow label="Stroke"><ColorField value={value.color} onChange={color => onChange({ color })} ariaLabel="Stroke color" /></FieldRow>
    <FieldRow label="Stroke width"><NumberField aria-label="Stroke width" value={value.widthPx} min={.1} max={200} unit="px" onCommit={widthPx => onChange({ widthPx })} /></FieldRow>
    <FieldRow label="Stroke opacity"><NumberField aria-label="Stroke opacity" value={(value.strokeOpacity ?? 1) * 100} min={0} max={100} unit="%" onCommit={v => onChange({ strokeOpacity: v / 100 })} /></FieldRow>
    {(['lineCap', 'lineJoin', 'dash'] as const).map(key => <FieldRow key={key} label={{ lineCap: 'Line caps', lineJoin: 'Line joins', dash: 'Stroke pattern' }[key]}>
      <SelectField aria-label={key} value={value[key] ?? (key === 'dash' ? 'solid' : 'round')}
        options={(key === 'lineCap' ? ['butt', 'round', 'square'] : key === 'lineJoin' ? ['miter', 'round', 'bevel'] : ['solid', 'dashed', 'dotted']).map(value => ({ value, label: value }))}
        onChange={e => onChange({ [key]: e.target.value })} />
    </FieldRow>)}
    <FieldRow label="Object opacity"><NumberField aria-label="Object opacity" value={value.opacity * 100} min={0} max={100} unit="%" onCommit={v => onChange({ opacity: v / 100 })} /></FieldRow>
    <Button active={inside} disabled={!inside && (!selected?.closed || !!selected.text)} onClick={onInside}>{inside ? 'Finish drawing inside' : 'Draw inside selected shape'}</Button>
    {canRelease && <Button onClick={onRelease}>Release clipping</Button>}
    {inside && <p>New vector paths are clipped to the selected boundary. The clipping group moves together.</p>}
  </fieldset>;
}
