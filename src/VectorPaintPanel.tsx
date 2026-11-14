import { Button, Checkbox, ColorField, GradientControls, FieldRow, NumberField, SelectField } from '@aether/ui';
import type { VectorGradient } from '@aether/sketch';
import type { DrawingPath } from './document';
import type { PaintStyle } from './paint';
import { ARROW_HEADS, WIDTH_PROFILES, type WidthProfile } from './vector';
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
    {(['lineCap', 'lineJoin'] as const).map(key => <FieldRow key={key} label={{ lineCap: 'Line caps', lineJoin: 'Line joins' }[key]}>
      <SelectField aria-label={key} value={value[key] ?? 'round'} options={(key === 'lineCap' ? ['butt', 'round', 'square'] : ['miter', 'round', 'bevel']).map(value => ({ value, label: value }))}
        onChange={e => onChange({ [key]: e.target.value })} />
    </FieldRow>)}
    <FieldRow label="Stroke pattern"><SelectField aria-label="dash" value={value.dashPx ? 'custom' : value.dash ?? 'solid'} options={['solid', 'dashed', 'dotted', 'custom'].map(value => ({ value, label: value }))}
      onChange={e => onChange(e.target.value === 'custom' ? { dashPx: [value.widthPx * 4, value.widthPx * 2] } : { dash: e.target.value as 'solid' | 'dashed' | 'dotted', dashPx: undefined })} /></FieldRow>
    {value.dashPx && (['Dash', 'Gap'] as const).map((label, i) => <FieldRow key={label} label={`${label} length`}><NumberField aria-label={`${label} length`} value={value.dashPx![i]} min={.1} max={10000} unit="px"
      onCommit={v => onChange({ dashPx: i ? [value.dashPx![0], v] : [v, value.dashPx![1]] })} /></FieldRow>)}
    <FieldRow label="Line width profile"><SelectField aria-label="Width profile" value={value.widthProfile ?? 'even'}
      options={[{ value: 'even', label: 'even' }, ...(Object.keys(WIDTH_PROFILES) as WidthProfile[]).map(value => ({ value, label: { 'taper-end': 'taper to the end', 'taper-start': 'taper from the start', 'taper-both': 'taper both ends', pinch: 'pinch the middle' }[value] }))]}
      onChange={e => onChange({ widthProfile: e.target.value === 'even' ? undefined : e.target.value as WidthProfile })} /></FieldRow>
    {(['arrowStart', 'arrowEnd'] as const).map(key => <FieldRow key={key} label={key === 'arrowStart' ? 'Start of line' : 'End of line'}>
      <SelectField aria-label={key === 'arrowStart' ? 'Arrowhead at start' : 'Arrowhead at end'} value={value[key] ?? 'none'} options={[{ value: 'none', label: 'none' }, ...ARROW_HEADS.map(value => ({ value, label: value }))]}
        onChange={e => onChange({ [key]: e.target.value === 'none' ? undefined : e.target.value })} /></FieldRow>)}
    <FieldRow label="Object opacity"><NumberField aria-label="Object opacity" value={value.opacity * 100} min={0} max={100} unit="%" onCommit={v => onChange({ opacity: v / 100 })} /></FieldRow>
    <Button active={inside} disabled={!inside && (!selected?.closed || !!selected.text || !!selected.symbolID)} onClick={onInside}>{inside ? 'Finish drawing inside' : 'Draw inside selected shape'}</Button>
    {canRelease && <Button onClick={onRelease}>Release clipping</Button>}
    {inside && <p>New vector paths are clipped to the selected boundary. The clipping group moves together.</p>}
  </fieldset>;
}
