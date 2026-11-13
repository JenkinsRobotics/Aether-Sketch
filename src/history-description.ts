import type { SketchDocument } from './document';

export function describeSketchEdit(before: SketchDocument, after: SketchDocument) {
  const oldPaths = before.layers.flatMap(layer => layer.paths), paths = after.layers.flatMap(layer => layer.paths);
  const added = paths.filter(path => !oldPaths.some(old => old.id === path.id));
  const removed = oldPaths.filter(path => !paths.some(next => next.id === path.id));
  if (added.length) return `Add ${added[0].name || (added[0].text ? 'text' : 'path')}${added.length > 1 ? ` +${added.length - 1}` : ''}`;
  if (removed.length) return `Remove ${removed[0].name || 'path'}${removed.length > 1 ? ` +${removed.length - 1}` : ''}`;
  const changed = paths.find(path => JSON.stringify(path) !== JSON.stringify(oldPaths.find(old => old.id === path.id)));
  if (changed) return `Edit ${changed.name || (changed.text ? 'text' : 'path')}`;
  const painted = after.layers.find(layer => layer.pixels?.src !== before.layers.find(old => old.id === layer.id)?.pixels?.src && before.layers.some(old => old.id === layer.id));
  if (painted) return `Paint on ${painted.name}`;
  if (before.layers.length !== after.layers.length) return after.layers.length > before.layers.length ? 'Add layer' : 'Remove layer';
  return before.widthPx !== after.widthPx || before.heightPx !== after.heightPx ? 'Resize drawing' : 'Edit layers';
}
