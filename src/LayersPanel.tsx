import { useState } from 'react';
import { AetherIcon, TreePanel, type TreeNode } from '@aether/ui';
import { ancestors, groupPaths, pathLocked, pathVisible, moveTreeItem } from './structure';
import { newLayer, type SketchDocument, type Layer } from './document';
export function LayersPanel({ doc, layer, selected, onSelect, commit }: {
  doc: SketchDocument; layer: Layer; selected: string[]; onSelect: (layerID: string, ids: string[]) => void;
  commit: (change: (doc: SketchDocument) => SketchDocument) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null), [treeSelection, setTreeSelection] = useState<string | null>(null);
  const locate = (id: string) => doc.layers.find(l => l.id === id || l.paths.some(p => p.id === id) || l.groups?.some(g => g.id === id));
  const command = (id: string, action: string, value?: string) => {
    const owner = locate(id); if (!owner) return;
    if (action === 'rename' && value === undefined) { setRenaming(id); return; }
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
    ...[...l.paths].reverse().filter(p => p.groupID === parentID).map((p): TreeNode => ({ id: p.id, label: p.name ?? (p.text ? 'Text' : p.subpaths?.length ? 'Compound path' : p.closed ? 'Closed path' : 'Open path'), icon: <AetherIcon name={p.text ? "text" : "spline"} />, dimmed: !pathVisible(l, p), actions: actions(p.name ?? 'path', !p.hidden, !!p.locked) })),
  ].sort((a, b) => {
    const rank = (id: string) => Math.max(-1, ...l.paths.map((p, i) => p.id === id || ancestors(l, p.groupID).some(g => g.id === id) ? i : -1));
    return rank(b.id) - rank(a.id);
  });
  const nodes = doc.layers.map(l => ({ id: l.id, label: l.name, dimmed: !l.visible, icon: <AetherIcon name="layers" />, badge: String(l.paths.length), actions: actions(l.name, l.visible, l.locked), children: children(l) }));
  const treeOwner = treeSelection ? locate(treeSelection) : undefined;
  const treeMatches = treeSelection && treeOwner?.id === layer.id && (selected.includes(treeSelection) ||
    (treeOwner.groups?.some(g => g.id === treeSelection) && groupPaths(treeOwner, treeSelection).every(p => selected.includes(p.id))) ||
    (!selected.length && treeSelection === layer.id));
  const current = treeMatches ? treeSelection : selected[0] ?? layer.id;
  const highlighted = new Set(selected.length ? selected : [layer.id]);
  if (treeMatches) highlighted.add(treeSelection);
  return <TreePanel title="Layers" ariaLabel="Drawing layers" nodes={nodes} selectedIDs={highlighted}
    onSelect={ids => {
      const id = ids.at(-1), owner = id && locate(id); if (!id || !owner) return; setTreeSelection(id);
      const paths = ids.flatMap(id => owner.paths.some(p => p.id === id) ? [id] : groupPaths(owner, id).map(p => p.id)); onSelect(owner.id, paths);
    }}
    renamingID={renaming} onRename={(id, value) => command(id, 'rename', value)} onCancelRename={() => setRenaming(null)} onAction={command}
    onMove={(source, target, position) => commit(d => moveTreeItem(d, source, target, position))}
    menuItems={id => [{ id: 'rename', label: 'Rename' }, { id: 'visibility', label: 'Toggle visibility' }, { id: 'lock', label: 'Toggle lock' }, { id: 'delete', label: 'Delete', disabled: locate(id)?.id === id && (doc.layers.length <= 1 || !!locate(id)?.locked) }]}
    onCommand={command} controls={[
      { id: 'add', label: 'New layer', icon: <AetherIcon name="plus" />, onClick: () => { const l = newLayer(`Layer ${doc.layers.length + 1}`); commit(d => ({ ...d, layers: [l, ...d.layers] })); onSelect(l.id, []); } },
      { id: 'rename', label: 'Rename item', icon: <AetherIcon name="pencil" />, onClick: () => setRenaming(current), shortcut: 'F2' },
      { id: 'delete', label: 'Delete item', icon: <AetherIcon name="delete" />, onClick: () => command(current, 'delete'), shortcut: 'Delete' },
    ]} />;
}
