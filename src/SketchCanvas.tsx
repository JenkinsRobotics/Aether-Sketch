import { VectorText } from './VectorText';
import { newText } from './text';
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import type { ReactNode } from 'react';
import { PaintDefinitions } from './PaintDefinitions';
import { paintAttributes, clipPaths, paintIDs, type PaintStyle } from './paint';
import { Button } from '@aether/ui';
import { pathContours, replaceContour, beginDraft, moveDraft, endDraft, finishPen, penPointerDown, previewShape, pathData,
  replacePathPoints, transformPath, splitPathEdge, nearestPathEdge, movePathControl,
  pathBounds, boundsContain, resizePoint, resizeBounds, rotatePoint, handlePoint, RESIZE_HANDLES,
  snapPoint, pathSnapTargets, nearestPoint, constrainAngle, TOOL_SHORTCUTS,
  trimPath, type Draft, type DraftStep, type Point, type SketchTool, type ToolOptions, type Bounds, type ResizeHandle, type SnapGuide } from '@aether/sketch';
import type { DrawingPath, Layer, SketchDocument } from './document';
import { pathVisible, pathLocked, rootGroup, groupPaths } from './structure';
import type { NodeSelection, SnapSettings } from './VectorInspector';
export type EditorTool = SketchTool | 'text' | 'trim' | 'fill' | 'eyedropper';
interface Props {
  contour: number; resetKey: string; doc: SketchDocument; layer: Layer | undefined; tool: EditorTool; onTool: (tool: EditorTool) => void;
  paint: PaintStyle; polygonSides: number; onFill: (path: DrawingPath) => void; onPickPaint: (path: DrawingPath) => void;
  selected: string[]; onSelect: (ids: string[]) => void; node: NodeSelection | null; onNode: (node: NodeSelection | null) => void;
  snap: SnapSettings; onAdd: (path: DrawingPath) => void; onReplace: (paths: DrawingPath[]) => void;
  onSplice: (ids: string[], paths: DrawingPath[]) => void; onDelete: () => void; undo: () => void; redo: () => void;
}
type Drag = { origin: Point; paths: DrawingPath[]; node?: number; control?: 'c1' | 'c2'; handle?: ResizeHandle | 'rotate'; bounds: Bounds; anchor: Point };
export function SketchCanvas(props: Props) {
  const svg = useRef<SVGSVGElement>(null), activePointer = useRef<number | null>(null), space = useRef(false);
  const draftRef = useRef<Draft | null>(null), drag = useRef<Drag | null>(null);
  const box = useRef<{ origin: Point; previous: string[] } | null>(null), pan = useRef<{ x: number; y: number; view: Bounds } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [preview, setPreview] = useState<DrawingPath[]>([]);
  const [marquee, setMarquee] = useState<Bounds | null>(null), [guides, setGuides] = useState<SnapGuide[]>([]);
  const [view, setView] = useState<Bounds>({ x: 0, y: 0, width: props.doc.widthPx, height: props.doc.heightPx });
  const updateDraft = (value: Draft | null) => { draftRef.current = value; setDraft(value); };
  const canEdit = !!props.layer?.visible && !props.layer.locked;
  const point = (e: { clientX: number; clientY: number }): Point => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse()); return [p.x, p.y];
  };
  const scale = () => Math.abs(svg.current?.getScreenCTM()?.a ?? 1);
  const options = (): ToolOptions => ({ coordinateStep: 0, minimumArea: 1, curveTolerance: .25 / scale(), freehandTolerance: 1 / scale(), closeTolerance: 9 / scale(), dragThreshold: 2 / scale(), polygonSides: props.polygonSides, curvedPrimitives: true, closePenOnFinish: false });
  const paths = props.layer?.paths ?? [], editable = paths.filter(p => props.layer && pathVisible(props.layer, p) && !pathLocked(props.layer, p)), selectedPaths = paths.some(p => props.selected.includes(p.id) && props.layer && (pathLocked(props.layer, p) || !pathVisible(props.layer, p))) ? [] : editable.filter(p => props.selected.includes(p.id));
  const shown = preview.length ? preview : selectedPaths, selectedObject = shown.length === 1 ? shown[0] : undefined;
  const selected = selectedObject && !selectedObject.text ? { ...selectedObject, ...pathContours(selectedObject)[props.contour], subpaths: undefined } : undefined;
  const replaceNode = (next: DrawingPath | undefined) => next && selectedObject && props.onReplace([{ ...selectedObject, ...replaceContour(selectedObject,props.contour,next) }]);
  const bounds = pathBounds(shown);
  const snap = (at: Point, alt: boolean, exclude: string[] = [], omitNode?: number) => {
    const targets = props.doc.layers.filter(l => l.visible).flatMap(l => l.paths.filter(p => pathVisible(l, p) && !exclude.includes(p.id)).flatMap(pathSnapTargets));
    if (omitNode !== undefined && selected) targets.push(...selected.points.filter((_, i) => i !== omitNode).map(point => ({ point, label: 'Anchor' })));
    targets.push({ point: [0, 0], label: 'Origin' }, { point: [props.doc.widthPx / 2, props.doc.heightPx / 2], label: 'Artboard center' }, ...([[props.doc.widthPx, 0], [0, props.doc.heightPx], [props.doc.widthPx, props.doc.heightPx]] as Point[]).map(point => ({ point, label: 'Artboard corner' })));
    if (draftRef.current?.tool === 'pen') targets.push(...draftRef.current.points.map(point => ({ point, label: 'Anchor' })));
    const result = snapPoint(at, targets, { tolerance: props.snap.distancePx / scale(), gridStep: props.snap.grid ? props.snap.gridStepPx : undefined, bypass: !props.snap.enabled || alt });
    setGuides(result.guides); return result.point;
  };
  const settle = (step: DraftStep) => {
    if (step.kind === 'continue') updateDraft(step.draft);
    else {
      if (step.kind === 'commit') {
        const path: DrawingPath = { id: crypto.randomUUID(), points: step.shape, curves: step.curves, nodeModes: step.nodeModes,
          closed: step.closed ?? (props.tool !== 'paint' && props.tool !== 'line'), ...props.paint };
        props.onAdd(path); props.onSelect([path.id]); props.onNode(null);
      }
      updateDraft(null); setGuides([]);
    }
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.button !== 0 && e.button !== 1) || !e.isPrimary || activePointer.current !== null) return;
    e.preventDefault(); e.currentTarget.focus();
    activePointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId);
    if (space.current || e.button === 1) { pan.current = { x: e.clientX, y: e.clientY, view }; return; }
    if (!canEdit) return;
    const at = point(e), target = e.target as SVGElement;
    if (props.tool === 'text') { const text=newText(snap(at,e.altKey)); props.onAdd(text);props.onSelect([text.id]);props.onTool('select');return; }
    if (props.tool === 'fill' || props.tool === 'eyedropper') {
      const id = target.closest('[data-path-id]')?.getAttribute('data-path-id'), path = editable.find(p => p.id === id);
      if (path) { if (props.tool === 'eyedropper') props.onPickPaint(path); else if (path.closed) { props.onSelect([path.id]); props.onFill(path); } }
      return;
    }
    if (props.tool === 'trim') {
      const id = target.closest('[data-path-id]')?.getAttribute('data-path-id'), path = editable.find(p => p.id === id);
      if (path && !path.text && !path.subpaths?.length) {
        const pieces = trimPath(path, at, props.doc.layers.flatMap(l => l.paths.filter(p => p.id !== path.id && !p.text && pathVisible(l, p))), 10 / scale());
        if (pieces) { const next = pieces.map((p, i) => ({ ...path, ...p, id: i ? crypto.randomUUID() : path.id })); props.onSplice([path.id], next); props.onSelect(next.map(p => p.id)); }
      }
      return;
    }
    if (props.tool === 'select' || props.tool === 'node') {
      const transform = target.getAttribute('data-transform') as ResizeHandle | 'rotate' | null;
      if (transform && bounds) { drag.current = { origin: at, paths: selectedPaths, bounds, handle: transform, anchor: at }; return; }
      const id = target.closest('[data-path-id]')?.getAttribute('data-path-id'), path = editable.find(p => p.id === id);
      props.onNode(null);
      if (!path) { box.current = { origin: at, previous: e.shiftKey ? props.selected : [] }; if (!e.shiftKey) props.onSelect([]); return; }
      const group = props.layer && rootGroup(props.layer, path);
      if (group && props.tool === 'select' && !e.altKey && groupPaths(props.layer!, group).some(p => pathLocked(props.layer!, p))) return;
      const picked = group && props.tool === 'select' && !e.altKey ? groupPaths(props.layer!, group).filter(p => !pathLocked(props.layer!, p) && pathVisible(props.layer!, p)).map(p => p.id) : [path.id];
      const ids = props.tool === 'node' ? [path.id] : e.shiftKey ? picked.every(id => props.selected.includes(id)) ? props.selected.filter(id => !picked.includes(id)) : [...new Set([...props.selected, ...picked])] : picked.every(id => props.selected.includes(id)) ? props.selected : picked;
      props.onSelect(ids); if (!ids.includes(path.id)) return;
      const members = editable.filter(p => ids.includes(p.id)), b = pathBounds(members)!;
      const node = target.getAttribute('data-node'), control = target.getAttribute('data-control') as 'c1' | 'c2' | null;
      const anchor = nearestPoint(at, members.flatMap(pathSnapTargets), Infinity)?.point ?? at;
      drag.current = { origin: at, paths: members, bounds: b, anchor, ...(node !== null ? { node: Number(node) } : {}), ...(control ? { control } : {}) };
      if (node !== null) props.onNode({ index: control === 'c2' ? (Number(node) + 1) % pathContours(path)[props.contour].points.length : Number(node), ...(control ? { edge: Number(node), control } : {}) });
    } else {
      const start = snap(at, e.altKey);
      updateDraft(props.tool === 'pen' ? { ...penPointerDown(draftRef.current, start, options().closeTolerance, options()), penPress: at } : beginDraft(props.tool, start, e.shiftKey, options()));
    }
  };
  const dragged = (d: Drag, e: PointerEvent<SVGSVGElement>): DrawingPath[] => {
    let at = point(e);
    if (d.handle === 'rotate') {
      const center: Point = [d.bounds.x + d.bounds.width / 2, d.bounds.y + d.bounds.height / 2];
      let angle = Math.atan2(at[1] - center[1], at[0] - center[0]) - Math.atan2(d.origin[1] - center[1], d.origin[0] - center[0]);
      if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12;
      return d.paths.map(p => ({ ...p, ...transformPath(p, v => rotatePoint(v, center, angle)) }));
    }
    if (d.handle) {
      const origin = handlePoint(d.bounds, d.handle), hit = snap([origin[0] + at[0] - d.origin[0], origin[1] + at[1] - d.origin[1]], e.altKey, props.selected);
      const next = resizeBounds(d.bounds, d.handle, [hit[0] - origin[0], hit[1] - origin[1]], e.shiftKey, .01);
      return d.paths.map(p => ({ ...p, ...transformPath(p, v => resizePoint(v, d.bounds, next)) }));
    }
    if (d.node !== undefined) {
      const full = d.paths[0], p = pathContours(full)[props.contour];
      if (d.control) {
        const anchor = p.points[d.control === 'c1' ? d.node : (d.node + 1) % p.points.length];
        if (e.shiftKey) at = constrainAngle(anchor, at);
        setGuides([]); return [{ ...full, ...replaceContour(full,props.contour,movePathControl(p, d.node, d.control, at, e.altKey)) }];
      }
      at = snap(at, e.altKey, [full.id], d.node);
      return [{ ...full, ...replaceContour(full,props.contour,replacePathPoints(p, p.points.map((v, i) => i === d.node ? at : v))) }];
    }
    const raw: Point = [d.anchor[0] + at[0] - d.origin[0], d.anchor[1] + at[1] - d.origin[1]];
    const hit = snap(e.shiftKey ? constrainAngle(d.anchor, raw) : raw, e.altKey, d.paths.map(p => p.id));
    return d.paths.map(p => ({ ...p, ...transformPath(p, v => [v[0] + hit[0] - d.anchor[0], v[1] + hit[1] - d.anchor[1]]) }));
  };
  // Selection clicks must not round coordinates, snap geometry or create undo entries.
  const isDrag = (d: Drag, e: PointerEvent<SVGSVGElement>) => {
    const at = point(e);
    return Math.hypot(at[0] - d.origin[0], at[1] - d.origin[1]) * scale() >= 2;
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== null && e.pointerId !== activePointer.current) return;
    if (pan.current) { setView({ ...pan.current.view, x: pan.current.view.x - (e.clientX - pan.current.x) / scale(), y: pan.current.view.y - (e.clientY - pan.current.y) / scale() }); return; }
    const at = point(e);
    if (box.current) { const a = box.current.origin; setMarquee({ x: Math.min(a[0], at[0]), y: Math.min(a[1], at[1]), width: Math.abs(a[0] - at[0]), height: Math.abs(a[1] - at[1]) }); }
    else if (drag.current) setPreview(isDrag(drag.current, e) ? dragged(drag.current, e) : []);
    else if (draftRef.current) {
      const d = draftRef.current, target = d.tool === 'paint' || d.tool === 'freehand' || (d.tool === 'pen' && d.penAnchor !== undefined) ? at : snap(at, e.altKey);
      updateDraft(moveDraft(d, target, e.shiftKey));
    }
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== e.pointerId) return;
    if (pan.current) pan.current = null;
    else if (box.current) {
      if (marquee) props.onSelect([...new Set([...box.current.previous, ...editable.filter(p => { const b = pathBounds([p]); return b && boundsContain(marquee, b); }).map(p => p.id)])]);
      box.current = null; setMarquee(null);
    } else if (drag.current) { if (isDrag(drag.current, e)) props.onReplace(dragged(drag.current, e)); drag.current = null; setPreview([]); }
    else if (draftRef.current) {
      const d = draftRef.current, raw = point(e), at = d.tool === 'paint' || d.tool === 'freehand' || (d.tool === 'pen' && d.penAnchor !== undefined) ? raw : snap(raw, e.altKey);
      settle(endDraft(d, at, e.shiftKey));
    }
    setGuides([]); activePointer.current = null; e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const cancel = () => { activePointer.current = null; drag.current = null; box.current = null; pan.current = null; setMarquee(null); setPreview([]); updateDraft(null); setGuides([]); };
  useEffect(() => { cancel(); }, [props.resetKey]);
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.code === 'Space') { e.preventDefault(); space.current = true; return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); cancel(); e.shiftKey ? props.redo() : props.undo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); props.onSelect(editable.map(p => p.id)); return; }
    if (e.key === 'Escape') { cancel(); return; }
    if (e.key === 'Enter' && draftRef.current) { e.preventDefault(); settle(finishPen(draftRef.current, e.shiftKey)); return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && TOOL_SHORTCUTS[e.key.toLowerCase()]) { cancel(); props.onTool(TOOL_SHORTCUTS[e.key.toLowerCase()]); return; }
    if (!canEdit || !shown.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (props.node && selected && props.tool === 'node') {
        const node = props.node;
        if (!node.control && selected.points.length > (selected.closed ? 3 : 2)) replaceNode({ ...selected, ...replacePathPoints(selected, selected.points.filter((_, i) => i !== node.index)) });
        props.onNode(null);
      } else props.onDelete();
    }
    const delta: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (delta[e.key]) {
      e.preventDefault(); const [x, y] = delta[e.key], amount = e.shiftKey ? 10 : 1;
      const map = (p: Point): Point => [p[0] + x * amount, p[1] + y * amount];
      if (props.node && selected && props.tool === 'node') {
        const n = props.node, c = n.control && n.edge !== undefined ? selected.curves?.[n.edge] : null;
        replaceNode({ ...selected, ...(c && n.control ? movePathControl(selected, n.edge!, n.control, map(c[n.control]), e.altKey)
          : replacePathPoints(selected, selected.points.map((p, i) => i === n.index ? map(p) : p))) });
      } else props.onReplace(shown.map(p => ({ ...p, ...transformPath(p, map) })));
    }
  };
  const ids = paintIDs(props.doc);
  const pin = 4 / scale();
  const zoom = (factor: number) => { cancel(); setView(v => { const width = Math.max(30, Math.min(12000, v.width * factor)), height = width * v.height / v.width; return { x: v.x + (v.width - width) / 2, y: v.y + (v.height - height) / 2, width, height }; }); };
  return <div className="sketch-canvas-wrap">
    <svg ref={svg} className="sketch-canvas" aria-label="Sketch drawing canvas" tabIndex={0}
      viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onPointerDown={down} onPointerMove={move}
      onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={() => { if (activePointer.current !== null) cancel(); }} onKeyDown={key} onKeyUp={e => { if (e.code === 'Space') space.current = false; }} onBlur={() => { space.current = false; }}
      onDoubleClick={e => {
        if (draftRef.current?.tool === 'pen') { settle(finishPen(draftRef.current, e.shiftKey)); return; }
        if (props.tool !== 'node' || !selected || !canEdit || (e.target as SVGElement).hasAttribute('data-node')) return;
        const edge = nearestPathEdge(selected, point(e), 8 / scale());
        if (edge) { replaceNode({ ...selected, ...splitPathEdge(selected, edge.edge, edge.fraction) }); props.onNode({ index: edge.edge + 1 }); }
      }}>
      <defs><pattern id="sketch-grid" width={props.snap.gridStepPx} height={props.snap.gridStepPx} patternUnits="userSpaceOnUse"><path d={`M${props.snap.gridStepPx} 0 H0 V${props.snap.gridStepPx}`} fill="none" stroke="#dce2e8" strokeWidth={1 / scale()} /></pattern></defs>
      <PaintDefinitions doc={props.doc} ids={ids} preview={preview} />
      <rect width={props.doc.widthPx} height={props.doc.heightPx} fill="white" />
      {props.snap.grid && <rect width={props.doc.widthPx} height={props.doc.heightPx} fill="url(#sketch-grid)" pointerEvents="none" />}
      {[...props.doc.layers].reverse().filter(l => l.visible).map(l => <g key={l.id} data-layer-id={l.id} style={{ pointerEvents: l.id === props.layer?.id && !l.locked ? 'auto' : 'none' }}>
        {l.paths.filter(p => pathVisible(l, p)).map(p => { const path = preview.find(v => v.id === p.id) ?? p; const content = <g data-path-id={p.id} style={{ pointerEvents: pathLocked(l, p) ? 'none' : undefined }}>
          {path.text ? <VectorText path={path} gradientID={`${ids.get(p.id)}-gradient`} /> : <path pointerEvents={path.closed && (props.tool === 'fill' || props.tool === 'eyedropper') ? 'all' : undefined} data-vector-paint="true" d={pathData(path)} {...paintAttributes(path, `${ids.get(p.id)}-gradient`)} />}
          <path d={pathData(path)} fill={path.text ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(path.widthPx, 12 / scale())} />
          {props.selected.includes(p.id) && l.id === props.layer?.id && <path className="sketch-selection" d={pathData(path)} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        </g>;
          return <g key={p.id}>{clipPaths(l, p).reduce<ReactNode>((child, clip) => <g clipPath={`url(#${ids.get(clip.id)}-clip)`}>{child}</g>, content)}</g>;
        })}
      </g>)}
      {marquee && <rect {...marquee} className="sketch-marquee" pointerEvents="none" vectorEffect="non-scaling-stroke" />}
      {draft && <polyline className="sketch-draft" points={(draft.tool === 'paint' ? draft.points : previewShape(draft)).map(p => p.join(',')).join(' ')} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      {guides.map((g, i) => <g className="sketch-snap-guide" key={i} pointerEvents="none" aria-label={`Snap ${g.label}`}><line x1={g.from[0]} y1={g.from[1]} x2={g.to[0]} y2={g.to[1]} vectorEffect="non-scaling-stroke" /><circle cx={g.to[0]} cy={g.to[1]} r={pin * 1.5} vectorEffect="non-scaling-stroke" /><text x={g.to[0] + pin * 2} y={g.to[1] - pin * 2} fontSize={11 / scale()}>{g.label}</text></g>)}
      {draft?.tangents?.map((t, i) => { const p = draft.points[i]; return <g key={i} className="sketch-tangent" pointerEvents="none"><line x1={p[0] - t[0]} y1={p[1] - t[1]} x2={p[0] + t[0]} y2={p[1] + t[1]} vectorEffect="non-scaling-stroke" /><circle cx={p[0] + t[0]} cy={p[1] + t[1]} r={pin} /></g>; })}
      {bounds && canEdit && props.tool === 'select' && <g className="sketch-nodes" aria-label="Selection transform">
        <rect {...bounds} fill="none" pointerEvents="none" vectorEffect="non-scaling-stroke" />
        {RESIZE_HANDLES.map(h => { const p = handlePoint(bounds, h); return <rect key={h} data-transform={h} aria-label={`Resize ${h}`} x={p[0] - pin} y={p[1] - pin} width={pin * 2} height={pin * 2} />; })}
        <line x1={bounds.x + bounds.width / 2} y1={bounds.y} x2={bounds.x + bounds.width / 2} y2={bounds.y - pin * 7} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle data-transform="rotate" aria-label="Rotate selection handle" cx={bounds.x + bounds.width / 2} cy={bounds.y - pin * 7} r={pin * 1.3} />
      </g>}
      {selected && canEdit && props.tool === 'node' && <g data-path-id={selected.id} className="sketch-nodes">
        {selected.curves?.map((c, i) => c && (selected.closed || i < selected.points.length - 1) && <g key={i}>
          {(['c1', 'c2'] as const).map(control => { const a = selected.points[control === 'c1' ? i : (i + 1) % selected.points.length]; return <g key={control}>
            <line x1={a[0]} y1={a[1]} x2={c[control][0]} y2={c[control][1]} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            <circle data-node={i} data-control={control} aria-label={`Curve ${i + 1} ${control}`} cx={c[control][0]} cy={c[control][1]} r={pin} />
          </g>;
        })}
        </g>)}
        {selected.points.map((p, i) => <rect key={i} data-node={i} aria-label={`Anchor ${i + 1}`} x={p[0] - pin} y={p[1] - pin} width={pin * 2} height={pin * 2} className={props.node?.index === i ? 'active' : ''} />)}
      </g>}
    </svg>
    <div className="sketch-view-controls" data-workspace-overlay="bottom right"><span>Space-drag to pan</span><Button onClick={() => zoom(1.25)}>Zoom out</Button><Button onClick={() => zoom(.8)}>Zoom in</Button><Button onClick={() => { cancel(); setView({ x: 0, y: 0, width: props.doc.widthPx, height: props.doc.heightPx }); }}>Fit</Button></div>
  </div>;
}
