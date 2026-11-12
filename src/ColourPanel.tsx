import { useState } from 'react';
import { ColorField, ColorWheel, FieldRow, SwatchPalette } from '@aether/ui';

const PALETTE_KEY = 'aether-sketch.palette.v1';
/** A starter palette: greys, then hues; empty slots save the current colour. */
const DEFAULT_PALETTE: (string | null)[] = ['#000000', '#3f3f46', '#71717a', '#d4d4d8', '#ffffff', '#7f1d1d', '#dc2626', '#f97316', '#facc15', '#84cc16',
  '#16a34a', '#0d9488', '#0ea5e9', '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#a16207', '#78350f', '#f5d0a9', ...Array<null>(12).fill(null)];
const load = (): (string | null)[] => { try { const v: unknown = JSON.parse(localStorage.getItem(PALETTE_KEY) ?? 'null'); return Array.isArray(v) && v.every(c => c === null || (typeof c === 'string' && /^#[\da-f]{6}$/i.test(c))) ? v : DEFAULT_PALETTE; } catch { return DEFAULT_PALETTE; } };

/** Colour editor: wheel, hex, a saved palette and the colours used recently. */
export function ColourPanel({ value, recent, onPick }: { value: string; recent: readonly string[]; onPick: (hex: string) => void }) {
  const [palette, setPalette] = useState(load);
  const store = (index: number) => { const next = palette.map((c, i) => i === index ? value : c); setPalette(next); try { localStorage.setItem(PALETTE_KEY, JSON.stringify(next)); } catch { /* the palette still works for this visit */ } };
  return <div className="sketch-colour-panel">
    <ColorWheel ariaLabel="Colour" value={value} onChange={onPick} size={168} />
    <FieldRow label="Hex"><ColorField ariaLabel="Colour hex" value={value} onChange={onPick} /></FieldRow>
    <FieldRow label="Palette"><SwatchPalette ariaLabel="Colour palette" swatches={palette} current={value} onPick={onPick} onStore={store} /></FieldRow>
    {recent.length > 0 && <FieldRow label="Recent"><SwatchPalette ariaLabel="Recent colours" swatches={recent} current={value} onPick={onPick} /></FieldRow>}
  </div>;
}
