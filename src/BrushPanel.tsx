import { Checkbox, FieldRow, Slider } from '@aether/ui';
import { BRUSH_PRESETS, brushOutline, type BrushPreset, type BrushStyle } from './brush';

/** A sample stroke drawn with the brush itself: light at the ends, firm in the middle. */
function Preview({ style, color }: { style: BrushStyle; color: string }) {
  const size = Math.min(14, Math.max(2, style.sizePx / 3));
  const samples = Array.from({ length: 24 }, (_, i) => { const t = i / 23; return { point: [6 + t * 68, 14 - Math.sin(t * Math.PI * 2) * 6] as [number, number], pressure: Math.sin(t * Math.PI), timeMs: i * 16 }; });
  const outline = brushOutline(samples, { sizePx: size, taper: style.taper, pen: true, minSize: style.minSize });
  return <svg viewBox="0 0 80 28" aria-hidden="true"><path d={`M${outline.map(p => p.join(',')).join('L')}Z`} fill={color} opacity={(style.opacity + style.minOpacity) / 2}
    style={style.softness ? { filter: `blur(${style.softness * size * .35}px)` } : undefined} /></svg>;
}

/** Brush library (presets by family) and brush properties, the controls SketchBook's Brush Properties give. */
export function BrushPanel({ style, presetID, color, onChange, pixel = false }: { /** Show the stamped-brush controls (the Pixel workspace). */ pixel?: boolean; style: BrushStyle; presetID: string | null; color: string; onChange: (style: BrushStyle, presetID: string | null) => void }) {
  const set = (patch: Partial<BrushStyle>) => onChange({ ...style, ...patch }, null);
  const groups = [...new Set(BRUSH_PRESETS.map(b => b.group))];
  const pick = (b: BrushPreset) => { const { id: _id, name: _name, group: _group, ...preset } = b; onChange(preset, b.id); };
  return <div className="sketch-brush-panel">
    <div className="sketch-brush-library" role="group" aria-label="Brush library">
      {groups.map(group => <section key={group}><h4>{group}</h4><div className="sketch-brush-grid">
        {BRUSH_PRESETS.filter(b => b.group === group).map(b => <button key={b.id} type="button" className="sketch-brush-preset" aria-pressed={b.id === presetID} title={b.name} onClick={() => pick(b)}>
          <Preview style={b} color={color} /><span>{b.name}</span></button>)}
      </div></section>)}
    </div>
    <div className="sketch-brush-properties" role="group" aria-label="Brush properties">
      <strong>{BRUSH_PRESETS.find(b => b.id === presetID)?.name ?? 'Custom brush'}</strong>
      <Preview style={style} color={color} />
      <FieldRow label="Size"><Slider ariaLabel="Brush size" min={1} max={300} unit="px" value={Math.round(style.sizePx)} onChange={sizePx => set({ sizePx })} /></FieldRow>
      <FieldRow label="Light-pressure size"><Slider ariaLabel="Size with light pressure" min={0} max={100} unit="%" value={Math.round(style.minSize * 100)} onChange={v => set({ minSize: v / 100 })} /></FieldRow>
      <FieldRow label="Opacity"><Slider ariaLabel="Opacity with heavy pressure" min={1} max={100} unit="%" value={Math.round(style.opacity * 100)} onChange={v => set({ opacity: v / 100, minOpacity: Math.min(style.minOpacity, v / 100) })} /></FieldRow>
      <FieldRow label="Light-pressure opacity"><Slider ariaLabel="Opacity with light pressure" min={0} max={100} unit="%" value={Math.round(style.minOpacity * 100)} onChange={v => set({ minOpacity: Math.min(style.opacity, v / 100) })} /></FieldRow>
      <FieldRow label="Softness"><Slider ariaLabel="Brush softness" min={0} max={100} unit="%" value={Math.round(style.softness * 100)} onChange={v => set({ softness: v / 100 })} /></FieldRow>
      {pixel ? <>
        <FieldRow label="Flow"><Slider ariaLabel="Paint laid down by each stamp" min={1} max={100} unit="%" value={Math.round((style.flow ?? 1) * 100)} onChange={v => set({ flow: v / 100 })} /></FieldRow>
        <FieldRow label="Spacing"><Slider ariaLabel="Gap between stamps, as a share of the tip width" min={2} max={100} unit="%" value={Math.round((style.spacing ?? .1) * 100)} onChange={v => set({ spacing: v / 100 })} /></FieldRow>
        <FieldRow label="Grain"><Slider ariaLabel="Paper grain" min={0} max={100} unit="%" value={Math.round((style.grain ?? 0) * 100)} onChange={v => set({ grain: v / 100 })} /></FieldRow>
      </> : <FieldRow label="Ends"><Checkbox label="Taper" checked={style.taper} onChange={event => set({ taper: event.target.checked })} /></FieldRow>}
    </div>
  </div>;
}
