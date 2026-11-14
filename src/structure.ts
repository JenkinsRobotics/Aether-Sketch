import type { DrawingPath, Layer, PathGroup, PixelBitmap, SketchDocument } from './document';
import { hasEffects, layerDepths, type Depth } from './depth';
export function ancestors(layer: Layer, groupID?: string): PathGroup[] {
  const result: PathGroup[] = [], seen = new Set<string>();
  while (groupID && !seen.has(groupID)) { seen.add(groupID); const group = layer.groups?.find(g => g.id === groupID); if (!group) break; result.push(group); groupID = group.parentID; }
  return result;
}
export const pathVisible = (layer: Layer, p: DrawingPath) => layer.visible && !p.hidden && !ancestors(layer, p.groupID).some(g => g.hidden);
export const pathLocked = (layer: Layer, p: DrawingPath) => layer.locked || !!p.locked || ancestors(layer, p.groupID).some(g => g.locked);
export const groupPaths = (layer: Layer, id: string) => layer.paths.filter(p => ancestors(layer, p.groupID).some(g => g.id === id));
export const rootGroup = (layer: Layer, path: DrawingPath) => ancestors(layer, path.groupID).at(-1)?.id;
export function groupSelection(layer: Layer, ids: string[], id: string): Layer {
  const selected = layer.paths.filter(p => ids.includes(p.id));
  if (selected.length < 2 || selected.some(p => pathLocked(layer, p))) return layer;
  // Group complete existing groups as children rather than flattening their structure.
  const roots = [...new Set(selected.map(p => rootGroup(layer, p)).filter((id): id is string => !!id))];
  const whole = roots.filter(id => groupPaths(layer, id).every(p => ids.includes(p.id)));
  const groups = [...(layer.groups ?? []).map(g => whole.includes(g.id) ? { ...g, parentID: id } : g), { id, name: 'Group' }];
  const paths = layer.paths.filter(p => !ids.includes(p.id));
  const top = Math.max(...selected.map(p => layer.paths.indexOf(p)));
  const insertion = layer.paths.slice(0, top + 1).filter(p => !ids.includes(p.id)).length;
  paths.splice(insertion, 0, ...selected.map(p => !whole.includes(rootGroup(layer, p) ?? '') ? { ...p, groupID: id } : p));
  return { ...layer, groups, paths };
}
export function ungroupSelection(layer: Layer, ids: string[]): Layer {
  const selected = layer.paths.filter(p => ids.includes(p.id));
  if (selected.some(p => pathLocked(layer, p))) return layer;
  const roots = [...new Set(selected.map(p => rootGroup(layer, p)).filter((id): id is string => !!id))];
  const removing = roots.filter(id => groupPaths(layer, id).every(p => ids.includes(p.id)));
  return { ...layer, groups: layer.groups?.filter(g => !removing.includes(g.id)).map(g => removing.includes(g.parentID ?? '') ? { ...g, parentID: undefined } : g), paths: layer.paths.map(p => removing.includes(p.groupID ?? '') ? { ...p, groupID: undefined } : p) };
}
export function moveTreeItem(doc: SketchDocument, source: string, target: string, position: 'before' | 'inside' | 'after'): SketchDocument {
  if (source === target) return doc;
  const from = doc.layers.find(l => l.id === source || l.paths.some(p => p.id === source) || l.groups?.some(g => g.id === source));
  const to = doc.layers.find(l => l.id === target || l.paths.some(p => p.id === target) || l.groups?.some(g => g.id === target));
  if (!from || !to) return doc;
  if (from.id === source) {
    if (to.id !== target || position === 'inside') return doc;
    const layers = doc.layers.filter(l => l.id !== source), index = layers.findIndex(l => l.id === target) + (position === 'after' ? 1 : 0); layers.splice(index, 0, from); return { ...doc, layers };
  }
  const group = from.groups?.find(g => g.id === source), items = group ? groupPaths(from, source) : from.paths.filter(p => p.id === source);
  if (from.locked || to.locked || group?.locked || items.some(p => pathLocked(from, p))) return doc;
  const targetGroup = to.groups?.find(g => g.id === target), targetPath = to.paths.find(p => p.id === target);
  const parentID = targetGroup ? position === 'inside' ? targetGroup.id : targetGroup.parentID : targetPath?.groupID;
  if (parentID && ancestors(to, parentID).some(g => g.id === source || g.locked)) return doc;
  const movingGroups = group ? (from.groups ?? []).filter(g => g.id === source || ancestors(from, g.parentID).some(a => a.id === source)) : [];
  const ids = new Set(items.map(p => p.id)), groupIDs = new Set(movingGroups.map(g => g.id));
  const moved = items.map(p => ({ ...p, groupID: group ? p.groupID : parentID }));
  return { ...doc, layers: doc.layers.map(l => {
    let next = l.id === from.id ? { ...l, paths: l.paths.filter(p => !ids.has(p.id)), groups: l.groups?.filter(g => !groupIDs.has(g.id)) } : l;
    if (l.id === to.id) {
      const paths = [...next.paths], targetIDs = targetGroup ? new Set(groupPaths(to, target).map(p => p.id)) : new Set([target]);
      const targetIndices = paths.flatMap((p, i) => targetIDs.has(p.id) ? [i] : []);
      const targetIndex = targetIndices.length ? position === 'before' ? Math.max(...targetIndices) : Math.min(...targetIndices) : -1;
      // Tree lists topmost first; path storage paints bottom first.
      paths.splice(targetIndex < 0 ? paths.length : targetIndex + (position === 'before' ? 1 : 0), 0, ...moved);
      next = { ...next, paths, groups: [...(next.groups ?? []), ...movingGroups.map(g => g.id === source ? { ...g, parentID } : g)] };
    }
    return next;
  }) };
}

/** A copy of a layer above it, with new ids throughout (groups, clip boundaries and paths). */
export function duplicateLayer(doc: SketchDocument, id: string, nextID: () => string = () => crypto.randomUUID()): SketchDocument {
  const index = doc.layers.findIndex(l => l.id === id); if (index < 0) return doc;
  const source = doc.layers[index], ids = new Map([...(source.groups ?? []), ...source.paths].map(item => [item.id, nextID()]));
  const copy: Layer = { ...source, id: nextID(), name: `${source.name} copy`.slice(0, 200),
    groups: source.groups?.map(g => ({ ...g, id: ids.get(g.id)!, parentID: g.parentID && ids.get(g.parentID), clipPathID: g.clipPathID && ids.get(g.clipPathID) })),
    paths: source.paths.map(p => ({ ...p, id: ids.get(p.id)!, groupID: p.groupID && ids.get(p.groupID) })) };
  return { ...doc, layers: [...doc.layers.slice(0, index), copy, ...doc.layers.slice(index)] };
}
/** How a layer merges into the one below. Two vector layers merge as vectors when the upper one is plain (normal blend,
 * no effects, masks or adjustment) and has the lower one's role. Anything else is flattened to pixels with all of that
 * applied, and the result is a pixel layer. A layer above a masked layer merges into that layer, masks applied. Null when a layer is locked. */
export function mergeKind(doc: SketchDocument, id: string): 'vector' | 'pixel' | null {
  const index = doc.layers.findIndex(l => l.id === id), upper = doc.layers[index], lower = doc.layers[index + 1];
  if (!upper || !lower || upper.locked || lower.locked) return null;
  const depths = layerDepths(doc), role = depths[index].role, below = depths[index + 1].role;
  if (below === 'mask' && role !== 'mask') return doc.layers[mergeTarget(depths, index)]?.locked === false ? 'pixel' : null;
  const plain = (upper.blend ?? 'normal') === 'normal' && !upper.adjust && !hasEffects(upper.effects) && !depths[index].hide.length && (!role || role === below);
  return plain && upper.kind !== 'pixel' && lower.kind !== 'pixel' ? 'vector' : 'pixel';
}
/** The layer a merge lands on: the one below, or for a layer above another layer's masks, the layer they mask. */
const mergeTarget = (depths: Depth[], index: number) => { let at = index + 1; if (depths[index].role !== 'mask') while (depths[at]?.role === 'mask') at++; return at; };
export const canMergeDown = (doc: SketchDocument, id: string) => mergeKind(doc, id) !== null;
/** Merge a vector layer into the vector layer below. The upper layer's opacity is kept by folding it into its paths. */
export function mergeDown(doc: SketchDocument, id: string): SketchDocument {
  if (mergeKind(doc, id) !== 'vector') return doc;
  const index = doc.layers.findIndex(l => l.id === id), upper = doc.layers[index], lower = doc.layers[index + 1], fade = upper.opacity ?? 1;
  const merged: Layer = { ...lower, groups: [...(lower.groups ?? []), ...(upper.groups ?? [])],
    paths: [...lower.paths, ...upper.paths.map(p => ({ ...p, opacity: p.opacity * fade, hidden: p.hidden || !upper.visible || undefined }))] };
  return { ...doc, layers: [...doc.layers.slice(0, index), merged, ...doc.layers.slice(index + 2)] };
}
/** What flattening a layer into the one below needs: the drawing to render, the layers in that picture, and the layers that go away
 * (the upper layer and the masks of both). The lower layer keeps its own opacity, blend, role and adjustment, so the picture is rendered without them. */
export function flattenPlan(doc: SketchDocument, id: string) {
  if (mergeKind(doc, id) !== 'pixel') return null;
  const index = doc.layers.findIndex(l => l.id === id), depths = layerDepths(doc), target = mergeTarget(depths, index), kept = depths[target].role;
  const plain = (l: Layer): Layer => { const { role: _role, ...rest } = l; return rest; };
  const render: SketchDocument = { ...doc, layers: doc.layers.map((l, i) => i === target ? { ...(kept ? plain(l) : l), visible: true, opacity: 1, blend: undefined, adjust: undefined } : i === index && kept ? plain(l) : l) };
  const masks = [...depths[index].hide, ...(target > index + 1 ? depths[target].hide : [])];
  return { render, lowerID: doc.layers[target].id, only: [id, doc.layers[target].id], remove: [id, ...masks.map(i => doc.layers[i].id)] };
}
/** The drawing once the flattened picture has replaced the lower layer. */
export function flattenInto(doc: SketchDocument, lowerID: string, remove: readonly string[], pixels: PixelBitmap | undefined): SketchDocument {
  return { ...doc, layers: doc.layers.filter(l => !remove.includes(l.id)).map(l => {
    if (l.id !== lowerID) return l;
    const { groups: _groups, effects: _effects, pixels: _pixels, ...rest } = l;
    return { ...rest, kind: 'pixel' as const, paths: [], ...(pixels ? { pixels } : {}) };
  }) };
}
