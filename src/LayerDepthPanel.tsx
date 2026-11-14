import { Checkbox, ColorField, FieldRow, NumberField, SelectField, Slider } from '@aether/ui';
import type { Adjustment, Layer, LayerEffects } from './document';

/** A new adjustment layer changes nothing until its sliders move. */
export const NO_ADJUSTMENT: Adjustment = { brightness: 0, contrast: 0, saturation: 0, hueDeg: 0 };
const SHADOW: NonNullable<LayerEffects['shadow']> = { dxPx: 6, dyPx: 6, blurPx: 6, color: '#000000', opacity: .5 };
const GLOW: NonNullable<LayerEffects['glow']> = { blurPx: 8, color: '#ffd24a', opacity: .9 };
type Change = (change: (l: Layer) => Layer) => void;
const ROLES = [{ value: 'normal', label: 'Normal' }, { value: 'clip', label: 'Clip to the layer below' }, { value: 'mask', label: 'Mask for the layer below' }];

/** How a layer works with the one beneath it, and what an adjustment layer does. `role` is the role in force. */
export function LayerRoleFields({ layer, role, hasBelow, onChange }: { layer: Layer; role?: 'clip' | 'mask'; hasBelow: boolean; onChange: Change }) {
  const a = layer.adjust, set = (patch: Partial<Adjustment>) => onChange(l => ({ ...l, adjust: { ...(l.adjust ?? NO_ADJUSTMENT), ...patch } }));
  const amount = (label: string, key: 'brightness' | 'contrast' | 'saturation') => <FieldRow label={label}><Slider min={-100} max={100} unit="%" value={Math.round(a![key] * 100)} disabled={layer.locked}
    ariaLabel={`Adjustment ${label.toLowerCase()}`} onChange={value => set({ [key]: value / 100 })} /></FieldRow>;
  return <>
    <FieldRow label="Role"><SelectField aria-label="Layer role" value={layer.role ?? 'normal'} disabled={layer.locked || !hasBelow} options={ROLES}
      onChange={event => { const next = event.target.value; onChange(l => ({ ...l, role: next === 'clip' || next === 'mask' ? next : undefined })); }} /></FieldRow>
    {role === 'clip' && <p className="sketch-guide-hint">Shows only where the layer below is painted.</p>}
    {role === 'mask' && <p className="sketch-guide-hint">Not drawn. Whatever is painted here hides the layer below; erase to bring it back. Hide this layer to switch the mask off.</p>}
    {a && <>
      <p className="sketch-guide-hint">{role === 'mask' ? 'A mask layer does not adjust.' : role === 'clip' ? 'Adjusts the layer it is clipped to.' : 'Adjusts everything beneath this layer.'}</p>
      {amount('Brightness', 'brightness')}{amount('Contrast', 'contrast')}{amount('Saturation', 'saturation')}
      <FieldRow label="Hue"><Slider min={-180} max={180} unit="°" value={Math.round(a.hueDeg)} disabled={layer.locked} ariaLabel="Adjustment hue" onChange={hueDeg => set({ hueDeg })} /></FieldRow>
      <Checkbox label="Invert colours" checked={!!a.invert} disabled={layer.locked} onChange={event => set({ invert: event.target.checked || undefined })} />
    </>}
  </>;
}

/** Blur, drop shadow and glow for a whole layer. On a mask layer the blur feathers the mask. */
export function LayerEffectsPanel({ layer, onChange }: { layer: Layer; onChange: Change }) {
  const e = layer.effects ?? {}, off = layer.locked;
  const set = (patch: LayerEffects) => onChange(l => {
    const next = { ...l.effects, ...patch }; if (!next.blurPx) delete next.blurPx; if (!next.shadow) delete next.shadow; if (!next.glow) delete next.glow;
    return { ...l, effects: Object.keys(next).length ? next : undefined };
  });
  return <div className="sketch-guide-settings"><strong>Layer effects · {layer.name}</strong>
    <FieldRow label="Blur"><Slider min={0} max={100} unit="px" value={e.blurPx ?? 0} disabled={off} ariaLabel="Layer blur" onChange={blurPx => set({ blurPx })} /></FieldRow>
    <Checkbox label="Drop shadow" checked={!!e.shadow} disabled={off} onChange={event => set({ shadow: event.target.checked ? SHADOW : undefined })} />
    {e.shadow && (shadow => <>
      <FieldRow label="Offset X"><NumberField aria-label="Shadow offset X" value={shadow.dxPx} min={-5000} max={5000} unit="px" disabled={off} onCommit={dxPx => set({ shadow: { ...shadow, dxPx } })} /></FieldRow>
      <FieldRow label="Offset Y"><NumberField aria-label="Shadow offset Y" value={shadow.dyPx} min={-5000} max={5000} unit="px" disabled={off} onCommit={dyPx => set({ shadow: { ...shadow, dyPx } })} /></FieldRow>
      <FieldRow label="Softness"><Slider min={0} max={100} unit="px" value={shadow.blurPx} disabled={off} ariaLabel="Shadow softness" onChange={blurPx => set({ shadow: { ...shadow, blurPx } })} /></FieldRow>
      <FieldRow label="Colour"><ColorField value={shadow.color} disabled={off} ariaLabel="Shadow colour" onChange={color => set({ shadow: { ...shadow, color } })} /></FieldRow>
      <FieldRow label="Opacity"><Slider min={0} max={100} unit="%" value={Math.round(shadow.opacity * 100)} disabled={off} ariaLabel="Shadow opacity" onChange={value => set({ shadow: { ...shadow, opacity: value / 100 } })} /></FieldRow>
    </>)(e.shadow)}
    <Checkbox label="Glow" checked={!!e.glow} disabled={off} onChange={event => set({ glow: event.target.checked ? GLOW : undefined })} />
    {e.glow && (glow => <>
      <FieldRow label="Size"><Slider min={0} max={100} unit="px" value={glow.blurPx} disabled={off} ariaLabel="Glow size" onChange={blurPx => set({ glow: { ...glow, blurPx } })} /></FieldRow>
      <FieldRow label="Colour"><ColorField value={glow.color} disabled={off} ariaLabel="Glow colour" onChange={color => set({ glow: { ...glow, color } })} /></FieldRow>
      <FieldRow label="Opacity"><Slider min={0} max={100} unit="%" value={Math.round(glow.opacity * 100)} disabled={off} ariaLabel="Glow opacity" onChange={value => set({ glow: { ...glow, opacity: value / 100 } })} /></FieldRow>
    </>)(e.glow)}
  </div>;
}
