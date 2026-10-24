import { Button, Checkbox, FieldRow, NumberField, SelectField } from '@aether/ui';
import { pathContours, replaceContour, replacePathPoints, movePathControl, pathBounds, resizePoint, rotatePoint, transformPath, setNodeMode, setPathEdgeCurve, reversePath, breakPath, joinPaths, offsetContour, type NodeMode, type Point } from '@aether/sketch';
import { useState } from 'react';
import type { DrawingPath } from './document';
export interface NodeSelection { index: number; edge?: number; control?: 'c1' | 'c2' }
export interface SnapSettings { enabled: boolean; grid: boolean; gridStepPx: number; distancePx: number }
export function VectorInspector({ contour: contourIndex, paths, node, disabled, onReplace, onSplice, onAdd, onDuplicate, onSelect, snap, onSnap }: {
  contour: number; paths: DrawingPath[]; node: NodeSelection | null; disabled: boolean;
  onReplace: (paths: DrawingPath[]) => void; onSplice: (ids: string[], paths: DrawingPath[]) => void; onAdd: (paths: DrawingPath[]) => void;
  onSelect: (ids: string[]) => void; snap: SnapSettings; onSnap: (s: SnapSettings) => void;
  onDuplicate: () => void;
}) {
  const [contour, setContour] = useState(10), [error, setError] = useState('');
  const [angle, setAngle] = useState(0), [aspect, setAspect] = useState(true);
  const b = pathBounds(paths), full = paths.length === 1 && !paths[0].text ? paths[0] : undefined;
  const p = full ? { ...full, ...pathContours(full)[contourIndex], subpaths: undefined } : undefined;
  const edit = (changed: DrawingPath[]) => full && onReplace(changed.map(c=>({...full,...replaceContour(full,contourIndex,c)})));
  const index = node && p?.points[node.index] ? node.index : undefined;
  const handle = node?.control && node.edge !== undefined ? p?.curves?.[node.edge]?.[node.control] : undefined;
  const position = handle ?? (index !== undefined ? p?.points[index] : undefined);
  const map = (f: (p: Point) => Point) => onReplace(paths.map(p => ({ ...p, ...transformPath(p, f) })));
  return <section className="sketch-vector-inspector" aria-label="Vector editing">
    <strong>{paths.length ? `${paths.length} selected` : 'Vector editing'}</strong>
    {p && <fieldset disabled={disabled}><legend>Path</legend>
      {index !== undefined && <>
        {position && ([0, 1] as const).map(axis => {
          const label = `${handle ? 'Handle' : 'Node'} ${axis === 0 ? 'X' : 'Y'}`;
          return <FieldRow key={label} label={label}><NumberField aria-label={label} value={position[axis]} precision={3} min={-1e7} max={1e7} unit="px"
            onCommit={value => {
              const at: Point = [...position]; at[axis] = value;
              edit([{ ...p, ...(handle && node?.control && node.edge !== undefined
                ? movePathControl(p, node.edge, node.control, at)
                : replacePathPoints(p, p.points.map((point, i) => i === index ? at : point))) }]);
            }} /></FieldRow>;
        })}
        <FieldRow label="Node type"><SelectField aria-label="Node type" value={p.nodeModes?.[index] ?? 'corner'} options={['corner', 'smooth', 'symmetric'].map(value => ({ value, label: value }))}
          onChange={e => edit([{ ...p, ...setNodeMode(p, index, e.target.value as NodeMode) }])} /></FieldRow>
        <Button disabled={!p.closed && index === p.points.length - 1} onClick={() => edit([{ ...p, ...setPathEdgeCurve(p, index, !p.curves?.[index]) }])}>{p.curves?.[index] ? 'Straighten edge' : 'Curve edge'}</Button>
        <Button disabled={!!full?.subpaths?.length || (!p.closed && (index === 0 || index === p.points.length - 1))} onClick={() => {
          const pieces = breakPath(p, index).map((path, i) => ({ ...p, ...path, id: i ? crypto.randomUUID() : p.id }));
          onSplice([p.id], pieces); onSelect(pieces.map(p => p.id));
        }}>Break at node</Button>
      </>}

      <Button disabled={!p.closed && p.points.length < 3} onClick={() => edit([{ ...p, closed: !p.closed }])}>{p.closed ? 'Open path' : 'Close path'}</Button>
      <Button onClick={() => edit([{ ...p, ...reversePath(p) }])}>Reverse path</Button>
      <FieldRow label="Contour offset"><NumberField aria-label="Contour offset" value={contour} unit="px" onValueChange={v => v !== null && setContour(v)} /></FieldRow>
      <Button disabled={!p.closed || !contour} onClick={() => { try { const next = { ...p, ...offsetContour(p, contour), curves: undefined, nodeModes: undefined, id: crypto.randomUUID() }; onAdd([next]); onSelect([next.id]); setError(''); } catch (e) { setError((e as Error).message); } }}>Create contour</Button>
      {error && <p role="alert">{error}</p>}
    </fieldset>}
    {paths.length === 2 && <Button disabled={disabled || paths.some(p => p.closed || p.text || p.subpaths?.length)} onClick={() => {
      const joined = joinPaths(paths[0], paths[1]); if (!joined) return;
      onSplice(paths.map(p => p.id), [{ ...paths[0], ...joined }]); onSelect([paths[0].id]);
    }}>Join paths</Button>}
    {b && <fieldset disabled={disabled}><legend>Transform selection</legend>
      {(['x', 'y', 'width', 'height'] as const).map(key => <FieldRow key={key} label={key}><NumberField aria-label={`Selection ${key}`} value={b[key]} precision={2} unit="px"
        min={key === 'width' || key === 'height' ? .01 : undefined}
        onCommit={value => {
          const next = { ...b, [key]: value };
          if (key === 'width' && aspect && b.width) next.height = b.height * value / b.width;
          if (key === 'height' && aspect && b.height) next.width = b.width * value / b.height;
          map(p => resizePoint(p, b, next));
        }} /></FieldRow>)}
      <Checkbox label="Keep proportions" checked={aspect} onChange={e => setAspect(e.target.checked)} />
      <FieldRow label="Rotate by"><NumberField aria-label="Rotation angle" value={angle} unit="°" onValueChange={v => v !== null && setAngle(v)} /></FieldRow>
      <Button onClick={() => map(p => rotatePoint(p, [b.x + b.width / 2, b.y + b.height / 2], angle * Math.PI / 180))}>Rotate selection</Button>
      <Button onClick={() => map(p => [2 * b.x + b.width - p[0], p[1]])}>Flip horizontal</Button>
      <Button onClick={() => map(p => [p[0], 2 * b.y + b.height - p[1]])}>Flip vertical</Button>
      <Button onClick={onDuplicate}>Duplicate selection</Button>
    </fieldset>}
    <details className="sketch-inspector-options"><summary>Snapping options</summary>
    <FieldRow label="Snapping"><Checkbox aria-label="Enable snapping" label="Enabled" checked={snap.enabled} onChange={e => onSnap({ ...snap, enabled: e.target.checked })} /></FieldRow>
    <FieldRow label="Grid"><Checkbox aria-label="Snap to grid" label="Show and snap" checked={snap.grid} onChange={e => onSnap({ ...snap, grid: e.target.checked })} /></FieldRow>
    {snap.grid && <FieldRow label="Grid spacing"><NumberField aria-label="Grid spacing" value={snap.gridStepPx} min={1} max={1000} unit="px" onCommit={gridStepPx => onSnap({ ...snap, gridStepPx })} /></FieldRow>}
    <FieldRow label="Snap distance"><NumberField aria-label="Snap distance" value={snap.distancePx} min={1} max={30} unit="px" onCommit={distancePx => onSnap({ ...snap, distancePx })} /></FieldRow>
    <p>Anchors, midpoints, centers and alignment. Alt temporarily bypasses snapping.</p>
    </details>
  </section>;
}
