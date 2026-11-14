import { Button, FieldRow, NumberField, SelectField, TextField } from '@aether/ui';
import { docArtboards, nextArtboard, withArtboards, type Artboard, type SketchDocument } from './document';

/** The drawing's pages: pick the current artboard, name it, place and size it, add and remove artboards.
 * Every artboard shows the same layers; moving one moves the frame, not the drawing under it. */
export function ArtboardPanel({ doc, currentID, onCurrent, commit }: { doc: SketchDocument; currentID: string | undefined; onCurrent: (id: string) => void; commit: (change: (doc: SketchDocument) => SketchDocument) => void }) {
  const boards = docArtboards(doc), current = boards.find(b => b.id === currentID) ?? boards[0];
  if (!current) return <div className="sketch-guide-settings"><strong>Artboards</strong>
    <p className="sketch-guide-hint">This drawing is an infinite canvas: exports frame whatever is drawn. Artboards are fixed pages you export one by one, or together as the pages of a PDF.</p>
    <Button onClick={() => commit(d => ({ ...d, infinite: false }))}>Use artboards</Button></div>;
  const change = (patch: Partial<Artboard>) => commit(d => withArtboards(d, docArtboards(d).map(b => b.id === current.id ? { ...b, ...patch } : b)));
  const field = (label: string, key: 'x' | 'y' | 'width' | 'height') => <FieldRow label={label}><NumberField aria-label={`Artboard ${label.toLowerCase()}`} value={current[key]} unit="px"
    min={key === 'width' || key === 'height' ? 1 : -1e7} max={key === 'width' || key === 'height' ? 16384 : 1e7} onCommit={value => change({ [key]: value })} /></FieldRow>;
  return <div className="sketch-guide-settings"><strong>Artboards</strong>
    <FieldRow label="Artboard"><SelectField aria-label="Current artboard" value={current.id} options={boards.map(b => ({ value: b.id, label: b.name }))} onChange={event => onCurrent(event.target.value)} /></FieldRow>
    <FieldRow label="Name"><TextField aria-label="Artboard name" key={current.id} defaultValue={current.name} maxLength={200} onBlur={event => { const name = event.target.value.trim(); if (name && name !== current.name) change({ name }); }}
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></FieldRow>
    {field('X', 'x')}{field('Y', 'y')}{field('Width', 'width')}{field('Height', 'height')}
    <Button onClick={() => { const added = nextArtboard(doc, current, crypto.randomUUID()); commit(d => withArtboards(d, [...docArtboards(d), added])); onCurrent(added.id); }}>New artboard</Button>
    <Button disabled={boards.length < 2} onClick={() => { commit(d => withArtboards(d, docArtboards(d).filter(b => b.id !== current.id))); onCurrent(boards.find(b => b.id !== current.id)!.id); }}>Delete this artboard</Button>
    <p className="sketch-guide-hint">Image and SVG exports frame the current artboard; PDF export has one page per artboard. Every artboard shows the same layers.</p>
  </div>;
}
