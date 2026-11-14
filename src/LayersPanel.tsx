import { memo, useState } from 'react';
import { AetherIcon, IconButton, LayerStack, ToolIcon, TreePanel, type TreeNode } from '@aether/ui';
import { pathBounds, pathData } from '@aether/sketch';
import { ancestors, canMergeDown, duplicateLayer, groupPaths, mergeDown, pathLocked, pathVisible, moveTreeItem } from './structure';
import { newLayer, newPixelLayer, type SketchDocument, type Layer } from './document';
import type { BoardItem } from './board';
import { layerDepths } from './depth';
import { NO_ADJUSTMENT } from './LayerDepthPanel';

/** Tree id of the Board section: notes, text boxes, tables and media beside the drawing. */
export const BOARD_NODE = 'aether-sketch-board';
const BOARD_LABEL: Record<string, string> = { sticky: 'Note', text: 'Text box', table: 'Table', image: 'Image', attachment: 'File', pen: 'Ink', rectangle: 'Shape', 'rounded-rectangle': 'Shape', ellipse: 'Shape' };
const BOARD_ICON: Record<string, string> = { sticky: 'notes', text: 'text', table: 'grid-3', image: 'image', attachment: 'file-generic' };
const boardLabel = (item: BoardItem) => {
  const text = (item.text ?? item.name ?? item.cells?.flat().find(Boolean) ?? '').trim().replace(/\s+/g, ' ');
  return `${BOARD_LABEL[item.kind] ?? 'Item'}${text ? ` · ${text.slice(0, 40)}` : ''}`;
};

const VIEW_KEY = 'aether-sketch.layer-view';
/** A layer's content drawn small, for the preview list. */
const LayerThumbnail = memo(function LayerThumbnail({ layer }: { layer: Layer }) {
  if (layer.kind === 'pixel') return layer.pixels ? <svg viewBox={`0 0 ${layer.pixels.width} ${layer.pixels.height}`} preserveAspectRatio="xMidYMid meet"><image href={layer.pixels.src} width={layer.pixels.width} height={layer.pixels.height} /></svg> : <svg viewBox="0 0 4 3" />;
  const shown = layer.paths.filter(p => pathVisible({ ...layer, visible: true }, p) && !p.text && !p.symbolID), b = pathBounds(shown);
  if (!b) return <svg viewBox="0 0 4 3" />;
  const pad = Math.max(b.width, b.height) * .06 || 1;
  return <svg viewBox={`${b.x - pad} ${b.y - pad} ${b.width + pad * 2} ${b.height + pad * 2}`} preserveAspectRatio="xMidYMid meet">
    {shown.map(p => <path key={p.id} d={pathData(p)} fill={(!p.closed && !p.fillOpen) || p.fill === null ? 'none' : p.fillGradient?.stops[0]?.color ?? p.fill ?? p.color}
      fillOpacity={p.fillOpacity ?? (p.fill === undefined ? .15 : 1)} stroke={p.strokeEnabled === false ? 'none' : p.color} strokeWidth={p.widthPx} opacity={p.opacity} />)}
  </svg>;
});

export function LayersPanel({ doc, layer, selected, onSelect, commit, boardSelection = [], onSelectBoard, onDeleteBoard, pixel = false, onMergeDown }: {
  /** Merging that may need pixels rendered; without it only vector layers merge. */
  onMergeDown?: (id: string) => void;
  /** New layers are pixel layers (the Pixel workspace) instead of vector layers. */
  pixel?: boolean; doc: SketchDocument; layer: Layer; selected: string[]; onSelect: (layerID: string, ids: string[]) => void;
  commit: (change: (doc: SketchDocument) => SketchDocument) => void;
  boardSelection?: readonly string[]; onSelectBoard?: (ids: string[]) => void; onDeleteBoard?: (ids: string[]) => void;
}) {
  const board = (doc.board ?? []).filter(i => i.kind !== 'connector'), boardIDs = new Set(board.map(i => i.id));
  const [renaming, setRenaming] = useState<string | null>(null), [treeSelection, setTreeSelection] = useState<string | null>(null);
  const [view, setView] = useState<'tree' | 'previews'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'previews' ? 'previews' : 'tree'; } catch { return 'tree'; } });
  const switchView = () => { const next = view === 'tree' ? 'previews' : 'tree'; setView(next); try { localStorage.setItem(VIEW_KEY, next); } catch { /* per-visit only */ } };
  const footer = <div className="sketch-layer-footer"><IconButton label={view === 'tree' ? 'Show layer previews' : 'Show compact layer tree'} aria-pressed={view === 'previews'} onClick={switchView}>
    <AetherIcon name={view === 'tree' ? 'image' : 'list-tree'} /></IconButton></div>;
  const locate = (id: string) => doc.layers.find(l => l.id === id || l.paths.some(p => p.id === id) || l.groups?.some(g => g.id === id));
  const command = (id: string, action: string, value?: string) => {
    if (id === BOARD_NODE || boardIDs.has(id)) { if (action === 'delete') onDeleteBoard?.(id === BOARD_NODE ? [...boardIDs] : [id]); return; }
    const owner = locate(id); if (!owner) return;
    if (action === 'rename' && value === undefined) { setRenaming(id); return; }
    if (owner.id === id && action === 'duplicate') { commit(d => duplicateLayer(d, id)); return; }
    if (owner.id === id && action === 'merge-down') { if (onMergeDown) onMergeDown(id); else commit(d => mergeDown(d, id)); return; }
    if (owner.id === id && action === 'toggle-clip') { commit(d => ({ ...d, layers: d.layers.map(l => l.id === id ? { ...l, role: l.role === 'clip' ? undefined : 'clip' as const } : l) })); return; }
    if (owner.id === id && (action === 'add-mask' || action === 'add-adjustment')) {
      // Both go directly above the layer they act on. A mask is a pixel or vector layer like any other: paint or draw on it to hide.
      const added: Layer = action === 'add-mask' ? { ...(pixel ? newPixelLayer : newLayer)(`Mask of ${owner.name}`.slice(0, 200)), role: 'mask' } : { ...newLayer('Adjustment'), adjust: NO_ADJUSTMENT };
      commit(d => { const at = Math.max(0, d.layers.findIndex(l => l.id === id)); return { ...d, layers: [...d.layers.slice(0, at), added, ...d.layers.slice(at)] }; });
      onSelect(added.id, []); return;
    }
    commit(d => {
      if (action === 'delete' && owner.id === id && !owner.locked && d.layers.length > 1) return { ...d, layers: d.layers.filter(l => l.id !== id) };
      return { ...d, layers: d.layers.map(l => {
        if (l.id !== owner.id) return l;
        const patch = action === 'visibility' ? { hidden: !(l.paths.find(p => p.id === id)?.hidden ?? l.groups?.find(g => g.id === id)?.hidden) }
          : action === 'lock' ? { locked: !(l.paths.find(p => p.id === id)?.locked ?? l.groups?.find(g => g.id === id)?.locked) }
          : { name: value?.slice(0, 200) ?? '' };
        if (l.id === id) return action === 'visibility' ? { ...l, visible: !l.visible } : action === 'lock' ? { ...l, locked: !l.locked } : action === 'rename' ? { ...l, name: value!.slice(0, 200) } : l;
        if (action === 'delete') {
          const removing = l.groups?.some(g => g.id === id) ? groupPaths(l, id) : l.paths.filter(p => p.id === id);
          if (l.locked || l.groups?.find(g => g.id === id)?.locked || removing.some(p => pathLocked(l, p))) return l;
          return { ...l, paths: l.paths.filter(p => !removing.some(v => v.id === p.id)), groups: l.groups?.filter(g => g.id !== id && !ancestors(l, g.parentID).some(a => a.id === id)) };
        }
        return { ...l, paths: l.paths.map(p => p.id === id ? { ...p, ...patch } : p), groups: l.groups?.map(g => g.id === id ? { ...g, ...patch } : g) };
      }) };
    });
    if (action === 'rename') setRenaming(null);
  };
  const actions = (name: string, visible: boolean, locked: boolean) => [
    { id: 'visibility', label: `${visible ? 'Hide' : 'Show'} ${name}`, icon: <AetherIcon name={visible ? 'visible' : 'hidden'} />, pinned: true },
    { id: 'lock', label: `${locked ? 'Unlock' : 'Lock'} ${name}`, icon: <AetherIcon name={locked ? 'lock' : 'unlock'} />, pinned: true },
  ];
  const children = (l: Layer, parentID?: string): TreeNode[] => [
    ...(l.groups ?? []).filter(g => g.parentID === parentID).map(g => ({ id: g.id, label: g.name, icon: <AetherIcon name="folder" />, children: children(l, g.id), actions: actions(g.name, !g.hidden, !!g.locked) })),
    ...[...l.paths].reverse().filter(p => p.groupID === parentID).map((p): TreeNode => ({ id: p.id, label: p.name ?? (p.symbolID ? 'Symbol' : p.text ? 'Text' : p.subpaths?.length ? 'Compound path' : p.closed ? 'Closed path' : 'Open path'), icon: <AetherIcon name={p.text ? "text" : "spline"} />, dimmed: !pathVisible(l, p), actions: actions(p.name ?? 'path', !p.hidden, !!p.locked) })),
  ].sort((a, b) => {
    const rank = (id: string) => Math.max(-1, ...l.paths.map((p, i) => p.id === id || ancestors(l, p.groupID).some(g => g.id === id) ? i : -1));
    return rank(b.id) - rank(a.id);
  });
  const depths = layerDepths(doc), roleOf = (l: Layer) => depths[doc.layers.indexOf(l)]?.role;
  const kindLabel = (l: Layer) => [roleOf(l), l.adjust ? 'adjust' : ''].filter(Boolean).join(' · ');
  const nodes: TreeNode[] = doc.layers.map(l => ({ id: l.id, label: l.name, dimmed: !l.visible, icon: roleOf(l) === 'mask' ? <ToolIcon name="mask" /> : <AetherIcon name={l.adjust ? 'sliders' : l.kind === 'pixel' ? 'image' : 'layers'} />,
    badge: [kindLabel(l), l.kind === 'pixel' ? 'px' : l.adjust && !l.paths.length ? '' : String(l.paths.length)].filter(Boolean).join(' · '), actions: actions(l.name, l.visible, l.locked), children: children(l) }));
  // Board items draw above every layer, so their section leads the tree, newest first.
  if (board.length) nodes.unshift({ id: BOARD_NODE, label: 'Board', icon: <AetherIcon name="notes" />, badge: String(board.length),
    children: [...board].reverse().map(item => ({ id: item.id, label: boardLabel(item), icon: <AetherIcon name={BOARD_ICON[item.kind] ?? 'rectangle'} /> })) });
  const treeOwner = treeSelection ? locate(treeSelection) : undefined;
  const treeMatches = treeSelection && treeOwner?.id === layer.id && (selected.includes(treeSelection) ||
    (treeOwner.groups?.some(g => g.id === treeSelection) && groupPaths(treeOwner, treeSelection).every(p => selected.includes(p.id))) ||
    (!selected.length && treeSelection === layer.id));
  const current = boardSelection.length ? boardSelection[0] : treeMatches ? treeSelection : selected[0] ?? layer.id;
  // A shape that landed as pixels leaves its id selected with nothing to show for it; the layer is what is current then.
  const highlighted = new Set(boardSelection.length ? boardSelection : selected.some(id => layer.paths.some(p => p.id === id)) ? selected : [layer.id]);
  if (treeMatches) highlighted.add(treeSelection);
  const newLayerControl = { id: 'add', label: pixel ? 'New pixel layer' : 'New layer', icon: <AetherIcon name="plus" />, onClick: () => { const l = (pixel ? newPixelLayer : newLayer)(`Layer ${doc.layers.length + 1}`); commit(d => ({ ...d, layers: [l, ...d.layers] })); onSelect(l.id, []); } };
  const depthControls = [
    { id: 'add-mask', label: 'Add a mask to this layer', icon: <ToolIcon name="mask" />, disabled: roleOf(layer) === 'mask', onClick: () => command(layer.id, 'add-mask') },
    { id: 'add-adjustment', label: 'New adjustment layer', icon: <AetherIcon name="sliders" />, onClick: () => command(layer.id, 'add-adjustment') }];
  if (view === 'previews') return <LayerStack ariaLabel="Drawing layers" selectedID={layer.id} footer={footer} controls={[newLayerControl, ...depthControls,
      { id: 'duplicate', label: 'Duplicate layer', icon: <AetherIcon name="duplicate" />, onClick: () => command(layer.id, 'duplicate') },
      { id: 'merge', label: 'Merge down', icon: <AetherIcon name="merge" />, disabled: !canMergeDown(doc, layer.id), onClick: () => command(layer.id, 'merge-down') },
      { id: 'delete', label: 'Delete layer', icon: <AetherIcon name="delete" />, disabled: doc.layers.length <= 1 || layer.locked, onClick: () => command(layer.id, 'delete') }]}
    layers={doc.layers.map(l => ({ id: l.id, label: l.name, visible: l.visible, locked: l.locked, thumbnail: <LayerThumbnail layer={l} />,
      detail: [kindLabel(l), l.blend && l.blend !== 'normal' ? l.blend.replace('-', ' ') : '', (l.opacity ?? 1) < 1 ? `${Math.round((l.opacity ?? 1) * 100)}%` : '', l.kind === 'pixel' ? 'Pixels' : `${l.paths.length} item${l.paths.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ') }))}
    onSelect={id => onSelect(id, [])} onToggleVisible={id => command(id, 'visibility')} onToggleLock={id => command(id, 'lock')}
    onMove={(source, target, position) => commit(d => moveTreeItem(d, source, target, position))} />;
  return <TreePanel title="Layers" ariaLabel="Drawing layers" footer={footer} nodes={nodes} selectedIDs={highlighted}
    onSelect={ids => {
      const picked = ids.flatMap(id => id === BOARD_NODE ? [...boardIDs] : boardIDs.has(id) ? [id] : []);
      if (picked.length) { setTreeSelection(null); onSelectBoard?.(picked); return; }
      const id = ids.at(-1), owner = id && locate(id); if (!id || !owner) return; setTreeSelection(id);
      const paths = ids.flatMap(id => owner.paths.some(p => p.id === id) ? [id] : groupPaths(owner, id).map(p => p.id)); onSelect(owner.id, paths);
    }}
    renamingID={renaming} onRename={(id, value) => command(id, 'rename', value)} onCancelRename={() => setRenaming(null)} onAction={(id, action) => command(id, action)}
    onMove={(source, target, position) => { if (![source, target].some(id => id === BOARD_NODE || boardIDs.has(id))) commit(d => moveTreeItem(d, source, target, position)); }}
    menuItems={id => id === BOARD_NODE || boardIDs.has(id) ? [{ id: 'delete', label: id === BOARD_NODE ? 'Delete all board items' : 'Delete' }] : [{ id: 'rename', label: 'Rename' }, { id: 'visibility', label: 'Toggle visibility' }, { id: 'lock', label: 'Toggle lock' },
      ...(locate(id)?.id === id ? [{ id: 'duplicate', label: 'Duplicate layer' }, { id: 'merge-down', label: 'Merge down', disabled: !canMergeDown(doc, id) },
        { id: 'add-mask', label: 'Add mask', disabled: roleOf(locate(id)!) === 'mask' }, { id: 'toggle-clip', label: locate(id)!.role === 'clip' ? 'Release clipping' : 'Clip to layer below', disabled: doc.layers.at(-1)?.id === id }, { id: 'add-adjustment', label: 'New adjustment layer above' }] : []), { id: 'delete', label: 'Delete', disabled: locate(id)?.id === id && (doc.layers.length <= 1 || !!locate(id)?.locked) }]}
    onCommand={command} controls={[
      newLayerControl, ...depthControls,
      { id: 'rename', label: 'Rename item', icon: <AetherIcon name="pencil" />, onClick: () => setRenaming(current), shortcut: 'F2' },
      { id: 'delete', label: 'Delete item', icon: <AetherIcon name="delete" />, onClick: () => command(current, 'delete'), shortcut: 'Delete' },
    ]} />;
}
