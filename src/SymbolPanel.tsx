import { useState } from 'react';
import { Button, FieldRow, SelectField, TextField } from '@aether/ui';
import type { DrawingPath, Layer, SketchDocument } from './document';
import { deleteSymbol, detachInstances, detachedPaths, makeSymbol, newInstance, redefineSymbol } from './symbols';

/** Symbols: drawings kept once and placed many times. Make one from the selection, place instances, and redraw a symbol
 * from an edited copy so every instance follows. */
export function SymbolPanel({ doc, layer, selected, disabled, centre, commit, onSelect, onPlace }: {
  doc: SketchDocument; layer: Layer; selected: DrawingPath[]; disabled: boolean; centre: () => [number, number];
  commit: (change: (doc: SketchDocument) => SketchDocument) => void; onSelect: (ids: string[]) => void; onPlace: (paths: DrawingPath[]) => void;
}) {
  const symbols = doc.symbols ?? [], [chosenID, setChosenID] = useState<string>();
  const instances = selected.filter(p => p.symbolID), plain = selected.filter(p => !p.symbolID);
  // The symbol in hand: the one a selected instance shows, else the one picked in the list.
  const current = symbols.find(s => s.id === instances[0]?.symbolID) ?? symbols.find(s => s.id === chosenID) ?? symbols[0];
  const used = current ? doc.layers.reduce((n, l) => n + l.paths.filter(p => p.symbolID === current.id).length, 0) : 0;
  const ids = selected.map(p => p.id), vector = layer.kind !== 'pixel' && !disabled;
  return <div className="sketch-guide-settings"><strong>Symbols</strong>
    <Button disabled={!vector || !plain.length} onClick={() => {
      const made = { symbol: crypto.randomUUID(), instance: crypto.randomUUID() }, next = makeSymbol(doc, layer.id, ids, `Symbol ${symbols.length + 1}`, made);
      if (next) { commit(() => next); setChosenID(made.symbol); onSelect([made.instance]); }
    }}>Make a symbol from the selection</Button>
    {!current ? <p className="sketch-guide-hint">A symbol is a drawing you place many times. Redraw the symbol and every copy follows.</p> : <>
      <FieldRow label="Symbol"><SelectField aria-label="Current symbol" value={current.id} options={symbols.map(s => ({ value: s.id, label: s.name }))} onChange={event => { setChosenID(event.target.value); onSelect([]); }} /></FieldRow>
      <FieldRow label="Name"><TextField aria-label="Symbol name" key={current.id} defaultValue={current.name} maxLength={200} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        onBlur={event => { const name = event.target.value.trim(); if (name && name !== current.name) commit(d => ({ ...d, symbols: d.symbols?.map(s => s.id === current.id ? { ...s, name } : s) })); }} /></FieldRow>
      <p className="sketch-guide-hint">{used} {used === 1 ? 'copy' : 'copies'} in this drawing.</p>
      <Button disabled={disabled} onClick={() => onPlace([newInstance(current, crypto.randomUUID(), centre())])}>Place a copy</Button>
      <Button disabled={disabled} onClick={() => { const loose = detachedPaths(doc, newInstance(current, 'editing', centre()), () => crypto.randomUUID()); if (loose) onPlace(loose); }}>Place an editable copy</Button>
      <Button disabled={!vector || !plain.length} onClick={() => { const instance = crypto.randomUUID(), next = redefineSymbol(doc, current.id, layer.id, ids, instance); if (next) { commit(() => next); onSelect([instance]); } }}>Redraw this symbol from the selection</Button>
      <Button disabled={!vector || !instances.length} onClick={() => { const next = detachInstances(doc, layer.id, ids); commit(() => next.doc); onSelect(next.ids); }}>Detach the selected copies</Button>
      <Button disabled={disabled} onClick={() => { commit(d => deleteSymbol(d, current.id)); onSelect([]); }}>Delete this symbol</Button>
      <p className="sketch-guide-hint">To change a symbol: place an editable copy, edit it, select it and choose Redraw. Deleting a symbol leaves its copies as plain paths.</p>
    </>}
  </div>;
}
