import type { FreeformItem } from '@aether/ui';

/** Board items: the Freeform-style notes, text boxes, tables, images and
 * connectors that sit on the infinite canvas beside the vector drawing. */
export type BoardItem = FreeformItem;
export const BOARD_KINDS = ['sticky', 'text', 'table', 'image', 'attachment', 'connector', 'rectangle', 'rounded-rectangle', 'ellipse', 'pen'] as const;
const IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;
const COLOR = /^#[\da-f]{6}$/i;

/** Validate untrusted board data from a file. Images must be raster data URLs:
 * nothing is fetched and no SVG or script is loaded. */
export function readBoard(raw: unknown, takenIDs: Set<string>): BoardItem[] {
  const check = (condition: unknown) => { if (!condition) throw new Error('Invalid board in .aethersketch document.'); };
  const number = (v: unknown, min = -1e7, max = 1e7) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const text = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);
  if (raw === undefined) return [];
  check(Array.isArray(raw) && raw.length <= 5000);
  const items = raw as BoardItem[], ids = new Set<string>();
  for (const item of items) {
    check(item && typeof item === 'object' && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 100 && !ids.has(item.id) && !takenIDs.has(item.id));
    ids.add(item.id);
    check((BOARD_KINDS as readonly string[]).includes(item.kind));
    check(number(item.x) && number(item.y) && number(item.width, 0) && number(item.height, 0));
    check(text(item.text, 10000) && text(item.name, 200));
    check(item.fill === undefined || (typeof item.fill === 'string' && COLOR.test(item.fill)));
    check(item.src === undefined || (typeof item.src === 'string' && item.src.length <= 15_000_000 && IMAGE.test(item.src)));
    if (item.points !== undefined) check(Array.isArray(item.points) && item.points.length <= 20000 && item.points.every(p => p && number(p.x) && number(p.y)));
    if (item.cells !== undefined) check(Array.isArray(item.cells) && item.cells.length <= 50 && item.cells.every(row => Array.isArray(row) && row.length <= 50 && row.every(cell => typeof cell === 'string' && cell.length <= 1000)));
    check(item.data === undefined);
  }
  for (const item of items) if (item.kind === 'connector') check(ids.has(item.from ?? '') && ids.has(item.to ?? '') && item.from !== item.to);
  return items.map(({ id, kind, x, y, width, height, text, fill, points, src, name, cells, from, to }) =>
    Object.fromEntries(Object.entries({ id, kind, x, y, width, height, text, fill, points, src, name, cells, from, to }).filter(([, v]) => v !== undefined)) as unknown as BoardItem);
}

export const STICKY_COLORS = [
  { id: '#f6d365', label: 'Yellow' }, { id: '#ffb4a2', label: 'Coral' }, { id: '#b9e4c9', label: 'Mint' },
  { id: '#a0c4ff', label: 'Sky' }, { id: '#d7b9f5', label: 'Lilac' }, { id: '#e9ecef', label: 'Grey' },
] as const;
