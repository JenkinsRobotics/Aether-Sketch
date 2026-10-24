import { Checkbox, FieldRow, NumberField, SelectField, TextField } from '@aether/ui';
import type { DrawingPath } from './document';
import { updateText, type VectorText } from './text';
export function TextInspector({ path, disabled, onChange }: { path: DrawingPath; disabled: boolean; onChange: (path: DrawingPath) => void }) {
  const t = path.text!;
  const patch = (value: Partial<VectorText>) => onChange(updateText(path, value));
  return <fieldset className="sketch-paint-panel" disabled={disabled}><legend>Text</legend>
    <FieldRow label="Content" layout="stacked"><textarea aria-label="Text content" value={t.content} maxLength={10000} onChange={e => patch({ content: e.target.value })} /></FieldRow>
    <FieldRow label="Font family"><TextField aria-label="Font family" value={t.fontFamily} maxLength={200} onChange={e => patch({ fontFamily: e.target.value })} /></FieldRow>
    <FieldRow label="Font size"><NumberField aria-label="Font size" value={t.fontSizePx} min={1} max={2000} unit="px" onCommit={fontSizePx => patch({ fontSizePx })} /></FieldRow>
    <FieldRow label="Weight"><SelectField aria-label="Font weight" value={String(t.fontWeight)} options={[100,200,300,400,500,600,700,800,900].map(n => ({value:String(n),label:String(n)}))} onChange={e => patch({fontWeight:Number(e.target.value)})} /></FieldRow>
    <Checkbox label="Italic" checked={t.italic} onChange={e => patch({italic:e.target.checked})} />
    <FieldRow label="Align"><SelectField aria-label="Text alignment" value={t.align} options={['start','middle','end'].map(value=>({value,label:value}))} onChange={e=>patch({align:e.target.value as VectorText['align']})} /></FieldRow>
    <FieldRow label="Line spacing"><NumberField aria-label="Line spacing" value={t.lineHeight} min={.5} max={5} onCommit={lineHeight=>patch({lineHeight})} /></FieldRow>
  </fieldset>;
}
