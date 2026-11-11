import { FieldRow } from '@aether/ui';
import { pathBounds } from '@aether/sketch';
import type { BoardItem } from './board';
import type { DrawingPath, Layer } from './document';

const round = (n: number) => Math.round(n * 10) / 10;
const pathKind = (p: DrawingPath) => p.text ? 'Text' : p.subpaths?.length ? 'Compound path' : p.closed ? 'Closed path' : 'Open path';

/** Read-only facts about the selection: what it is, where it sits and how big it is. */
export function SelectionInspector({ paths, board, layer }: { paths: DrawingPath[]; board: BoardItem[]; layer: Layer }) {
  if (!paths.length && !board.length) return <p className="sketch-inspector-empty">Select a path, shape or board item to inspect it.</p>;
  const b = paths.length ? pathBounds(paths) : board.length ? { x: Math.min(...board.map(i => i.x)), y: Math.min(...board.map(i => i.y)), width: Math.max(...board.map(i => i.x + i.width)) - Math.min(...board.map(i => i.x)), height: Math.max(...board.map(i => i.y + i.height)) - Math.min(...board.map(i => i.y)) } : null;
  const kinds = [...new Set([...paths.map(pathKind), ...board.map(i => i.kind === 'sticky' ? 'Note' : i.kind === 'text' ? 'Text box' : i.kind[0].toUpperCase() + i.kind.slice(1))])];
  return <div className="sketch-selection-inspector">
    <FieldRow label="Selection"><span>{paths.length + board.length === 1 ? kinds[0] : `${paths.length + board.length} items`}</span></FieldRow>
    {kinds.length > 1 && <FieldRow label="Kinds"><span>{kinds.join(', ')}</span></FieldRow>}
    <FieldRow label="Location"><span>{paths.length ? `Layer · ${layer.name}` : 'Board'}</span></FieldRow>
    {b && <>
      <FieldRow label="Position"><span>{round(b.x)}, {round(b.y)} px</span></FieldRow>
      <FieldRow label="Size"><span>{round(b.width)} × {round(b.height)} px</span></FieldRow>
    </>}
    {paths.length === 1 && !paths[0].text && <FieldRow label="Anchors"><span>{paths[0].points.length + (paths[0].subpaths ?? []).reduce((n, s) => n + s.points.length, 0)}</span></FieldRow>}
  </div>;
}
