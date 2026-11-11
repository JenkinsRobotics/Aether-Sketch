import { Button, ColorField, FieldRow, SegmentedControl } from '@aether/ui';
import { STICKY_COLORS, type BoardItem } from './board';

const FILLED = new Set(['sticky', 'rectangle', 'rounded-rectangle', 'ellipse']);
const NAMES: Record<string, string> = { sticky: 'Sticky note', text: 'Text box', table: 'Table', image: 'Image', attachment: 'Attachment', connector: 'Connector', pen: 'Ink' };

/** Properties for selected board items: colour for notes and shapes, removal for all. */
export function BoardInspector({ items, onChange, onDelete }: { items: BoardItem[]; onChange: (items: BoardItem[]) => void; onDelete: () => void }) {
  const filled = items.filter(i => FILLED.has(i.kind)), fill = filled[0]?.fill;
  const kinds = [...new Set(items.map(i => NAMES[i.kind] ?? i.kind))];
  const setFill = (hex: string) => onChange(filled.map(i => ({ ...i, fill: hex })));
  return <div className="sketch-board-inspector">
    <strong>{items.length === 1 ? kinds[0] : `${items.length} board items`}</strong>
    {filled.length > 0 && <>
      <FieldRow label="Colour"><ColorField ariaLabel="Board item colour" value={fill ?? STICKY_COLORS[0].id} onChange={setFill} /></FieldRow>
      <SegmentedControl ariaLabel="Note colours" value={STICKY_COLORS.some(c => c.id === fill) ? fill! : ''} onChange={setFill}
        options={STICKY_COLORS.map(c => ({ id: c.id, label: c.label }))} />
    </>}
    <Button onClick={onDelete}>Delete {items.length === 1 ? kinds[0].toLowerCase() : 'items'}</Button>
  </div>;
}
