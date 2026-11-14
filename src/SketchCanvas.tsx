import { VectorText } from './VectorText';
import { newText, textOnPath } from './text';
import { useEffect, useRef, useState, type PointerEvent, type KeyboardEvent } from 'react';
import type { ReactNode } from 'react';
import { PaintDefinitions } from './PaintDefinitions';
import { paintAttributes, clipPaths, paintIDs, type PaintStyle } from './paint';
import { composeLayers, depthAttributes, depthDefs, depthRegion, layerDepths, layerDOMID, usesDepth } from './depth';
import { pathContours, replaceContour, beginDraft, moveDraft, endDraft, finishPen, penPointerDown, previewShape, pathData,
  replacePathPoints, transformPath, splitPathEdge, nearestPathEdge, movePathControl,
  pathBounds, boundsContain, resizePoint, resizeBounds, rotatePoint, handlePoint, RESIZE_HANDLES,
  snapPoint, pathSnapTargets, nearestPoint, constrainAngle, TOOL_SHORTCUTS,
  trimPath, slicePath, type Draft, type DraftStep, type Point, type SketchTool, type ToolOptions, type Bounds, type ResizeHandle, type SnapGuide } from '@aether/sketch';
import { docArtboards, isGeometry, type DrawingPath, type Layer, type SketchDocument, type SymbolDef } from './document';
import { symbolOf } from './symbols';
import { pathVisible, pathLocked, rootGroup, groupPaths } from './structure';
import type { NodeSelection, SnapSettings } from './VectorInspector';
import { brushOpacity, brushOutline, dabsTo, eraseWith, newDabState, type BrushSample, type BrushStyle, type DabState } from './brush';
import { DabStroke, SmudgeStroke, IDENTITY, fitMatrix, liftPixels, moveMatrix, rotateMatrix, skewMatrix, type Matrix, type PixelSelection, type Rect, type SelectMode } from './pixels';
import type { PixelBitmap } from './document';
import { steadyPoint, strokeConstraint, symmetryMaps, type Guides } from './guides';
import { predictStroke } from './predict';
import { GuideOverlay, moveGuide } from './GuideOverlay';
import { joinOpenPath } from './join';
import { cornerIndices, drawnParts, roundCorners, type CornerStyle } from './vector';
import { ellipsePath, type SketchPath } from '@aether/sketch';
export type EditorTool = SketchTool | 'text' | 'trim' | 'fill' | 'eyedropper' | 'brush' | 'eraser' | 'smudge' | 'star' | 'lasso' | 'hand' | 'zoom'
  | 'marquee' | 'marquee-ellipse' | 'marquee-lasso' | 'marquee-polygon' | 'wand' | 'transform' | 'corner' | 'shape' | 'knife';
/** A star from a regular polygon's corners: an inner point between each pair, at half the outer radius. */
export function starShape(corners: Point[]): Point[] {
  const c: Point = [corners.reduce((n, p) => n + p[0], 0) / corners.length, corners.reduce((n, p) => n + p[1], 0) / corners.length], k = .5 / Math.cos(Math.PI / corners.length);
  return corners.flatMap((p, i) => { const q = corners[(i + 1) % corners.length], m: Point = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]; return [p, [c[0] + (m[0] - c[0]) * k, c[1] + (m[1] - c[1]) * k] as Point]; });
}
export function insidePolygon(p: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) if ((ring[i][1] > p[1]) !== (ring[j][1] > p[1]) && p[0] < (ring[j][0] - ring[i][0]) * (p[1] - ring[i][1]) / (ring[j][1] - ring[i][1]) + ring[i][0]) inside = !inside;
  return inside;
}
// The pixel selection tools borrow the engine's drafts: a dragged box or ellipse, a freehand loop, and the pen for a polygon.
// A library shape is drawn by dragging its box, and the knife by dragging its cut line.
const ENGINE_TOOL: Partial<Record<EditorTool, SketchTool>> = { star: 'polygon', lasso: 'freehand', shape: 'rect', knife: 'line', marquee: 'rect', 'marquee-ellipse': 'ellipse', 'marquee-lasso': 'freehand', 'marquee-polygon': 'pen' };
/** The pixel selection and what the canvas can do with it. Selecting works on any layer; clearing and transforming need a pixel layer. */
export interface PixelSelect {
  selection: PixelSelection | null; mode: SelectMode;
  shape: (shape: DrawingPath, mode: SelectMode) => void; wand: (at: Point, mode: SelectMode) => void;
  all: () => void; none: () => void; invert: () => void; clear: () => void;
  transform: (matrix: Matrix, copy: boolean) => Promise<void>;
}
type Lift = { sel: PixelSelection; origin: Point; handle: ResizeHandle | 'rotate' | null; copy: boolean; skew: boolean; matrix: Matrix; moved: boolean; box: HTMLDivElement; float?: HTMLCanvasElement };
/** The active brush and eraser. Sizes are on screen, so zooming in draws finer. */
export interface BrushSettings { style: BrushStyle; eraserPx: number; /** Smudge tip width on screen and how much paint it carries (0–1). */ smudgePx: number; smudge: number }
interface Props {
  contour: number; resetKey: string; doc: SketchDocument; layer: Layer | undefined; tool: EditorTool; onTool: (tool: EditorTool) => void;
  /** The artboard exports frame, marked on the canvas when there are several. */
  artboardID?: string;
  paint: PaintStyle; polygonSides: number; brush: BrushSettings; drawGuides: Guides; onDrawGuides: (guides: Guides) => void; onFill: (path: DrawingPath) => void; onPickPaint: (path: DrawingPath) => void;
  selected: string[]; onSelect: (ids: string[]) => void; node: NodeSelection | null; onNode: (node: NodeSelection | null) => void;
  snap: SnapSettings; onAdd: (path: DrawingPath) => void; onReplace: (paths: DrawingPath[]) => void;
  /** Strokes on their way into a pixel layer: shown as vectors until the bitmap holding them arrives. */
  /** Lines and pen paths continue the open path they start or end on (vector drawing only). */
  joinPaths: boolean;
  /** The brush stamps pixels live (the Pixel workspace) instead of drawing a vector stroke. The finished stroke canvas covers `rect`. */
  /** Smudge reads the layer's bitmap once queued edits have landed, and hands the smudged canvas back to be saved. */
  openPixels: () => Promise<PixelBitmap | undefined>; onSmudged: (layerID: string, stroke: SmudgeStroke) => Promise<void>;
  pixelBrush: boolean; onPaintStroke: (stroke: HTMLCanvasElement, rect: Rect, opacity: number, clipped: boolean) => Promise<void>;
  select: PixelSelect;
  /** The library shape to draw in a dragged box; how the corner tool finishes a corner; what the knife's cut line does. */
  makeShape: (box: Bounds) => SketchPath; cornerStyle: CornerStyle; onKnife: (a: Point, b: Point) => void;
  pending: { layerID: string; paths: DrawingPath[] }[]; onErasePixels: (outline: Point[]) => void; onPixelPoint: (tool: 'fill' | 'eyedropper', at: Point) => void;
  onSplice: (ids: string[], paths: DrawingPath[]) => void; onDelete: () => void; undo: () => void; redo: () => void;
}
type Drag = { origin: Point; paths: DrawingPath[]; node?: number; control?: 'c1' | 'c2'; handle?: ResizeHandle | 'rotate'; bounds: Bounds; anchor: Point };
export function SketchCanvas(props: Props) {
  const svg = useRef<SVGSVGElement>(null), activePointer = useRef<number | null>(null);
  const draftRef = useRef<Draft | null>(null), drag = useRef<Drag | null>(null), stroke = useRef<{ samples: BrushSample[]; pen: boolean; start: Point; last: Point; follow?: ((p: Point) => Point) | null } | null>(null);
  const guideDrag = useRef<string | null>(null);
  // A stamped stroke in progress: its canvas sits over the drawing, in document pixels, until the layer takes it.
  const overlay = useRef<HTMLDivElement>(null), dab = useRef<{ stroke: DabStroke; el: HTMLElement; state: DabState; fed: number; sizePx: number } | null>(null);
  const feedDabs = () => {
    const d = dab.current, st = stroke.current; if (!d || !st) return;
    const maps = props.drawGuides.symmetry ? symmetryMaps(props.drawGuides.symmetry) : [];
    for (; d.fed < st.samples.length; d.fed++) d.stroke.stamp(dabsTo(d.state, st.samples[d.fed], props.brush.style, d.sizePx, st.pen), maps);
    const r = d.stroke.rect; if (r) Object.assign(d.stroke.canvas.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  // Smudging works on the layer's own canvas, shown over the drawing while the layer's image is veiled.
  const smudge = useRef<{ layerID: string; radius: number; job: Promise<SmudgeStroke | null> } | null>(null), [veiled, setVeiled] = useState<string | null>(null);
  const startSmudge = (at: Point) => {
    const target = props.layer; if (target?.kind !== 'pixel') return;
    const radius = props.brush.smudgePx / 2 / scale(), strength = props.brush.smudge;
    smudge.current = { layerID: target.id, radius, job: props.openPixels().then(async bitmap => {
      if (!bitmap) return null;
      const s = await SmudgeStroke.open(bitmap, props.select.selection), r = s.rect;
      Object.assign(s.canvas.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px`, opacity: String(target.opacity ?? 1), mixBlendMode: target.blend ?? 'normal' });
      overlay.current?.appendChild(s.canvas); setVeiled(target.id); s.to(at, radius, strength); return s;
    }) };
  };
  const smudgeTo = (at: Point) => { const m = smudge.current, strength = props.brush.smudge; if (m) m.job = m.job.then(s => { s?.to(at, m.radius, strength); return s; }); };
  const endSmudge = (keep: boolean) => {
    const m = smudge.current; if (!m) return; smudge.current = null;
    void m.job.then(async s => { if (!s) return; try { if (keep && s.changed) await props.onSmudged(m.layerID, s); else s.release(); } finally { s.canvas.remove(); setVeiled(null); } });
  };
  const startDabs = () => {
    const own = props.layer?.kind === 'pixel' ? props.layer : undefined, s = new DabStroke(props.paint.color, props.brush.style), el = document.createElement('div');
    // The holder shows the stroke the way it will land: at the brush's opacity and only inside the selection.
    Object.assign(el.style, { opacity: String(props.brush.style.opacity * (own?.opacity ?? 1)), mixBlendMode: own?.blend ?? 'normal', clipPath: props.select.selection ? `path("${props.select.selection.outline}")` : '' });
    el.appendChild(s.canvas); overlay.current?.appendChild(el); dab.current = { stroke: s, el, state: newDabState(), fed: 0, sizePx: props.brush.style.sizePx / scale() };
  };
  // Pixel selection tools. Shift held as the drag starts adds, Alt subtracts, both intersect; otherwise the panel's mode applies.
  const selecting = props.tool.startsWith('marquee'), selectMode = useRef<SelectMode>('new'), heldShift = useRef(false);
  const modeOf = (e: { shiftKey: boolean; altKey: boolean }): SelectMode => e.shiftKey && e.altKey ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : props.select.mode;
  /** Shift constrains a shape, except while it is still held from choosing "add" for a selection. */
  const constrained = (e: { shiftKey: boolean }) => { if (!e.shiftKey) heldShift.current = false; return e.shiftKey && !(selecting && heldShift.current); };
  // Transforming selected pixels: they are shown lifted out of the layer while dragged, and land when the pointer lifts.
  const lift = useRef<Lift | null>(null), [lifted, setLifted] = useState<Matrix | null>(null);
  const placeLift = (l: Lift) => { if (l.float) l.float.style.transform = `matrix(${l.matrix.join(',')}) translate(${l.sel.rect.x}px, ${l.sel.rect.y}px)`; };
  const startLift = (sel: PixelSelection, at: Point, handle: Lift['handle'], copy: boolean, skew: boolean) => {
    const target = props.layer!, box = document.createElement('div');
    Object.assign(box.style, { opacity: String(target.opacity ?? 1), mixBlendMode: target.blend ?? 'normal' });
    const l: Lift = lift.current = { sel, origin: at, handle, copy, skew, matrix: IDENTITY, moved: false, box };
    void props.openPixels().then(async bitmap => {
      if (!bitmap || lift.current !== l) return;
      const { rest, float } = await liftPixels(bitmap, sel, copy); if (lift.current !== l) return;
      Object.assign(rest.style, { left: `${bitmap.x}px`, top: `${bitmap.y}px`, width: `${bitmap.width}px`, height: `${bitmap.height}px` });
      Object.assign(float.style, { left: '0', top: '0', width: `${sel.rect.width}px`, height: `${sel.rect.height}px`, transformOrigin: '0 0' });
      box.append(rest, float); overlay.current?.appendChild(box); l.float = float; placeLift(l); setVeiled(target.id);
    });
  };
  const liftMatrix = (l: Lift, e: PointerEvent<SVGSVGElement>): Matrix => {
    const at = point(e), b = l.sel.rect, delta: Point = [at[0] - l.origin[0], at[1] - l.origin[1]];
    if (l.handle === 'rotate') {
      const c: Point = [b.x + b.width / 2, b.y + b.height / 2]; let angle = Math.atan2(at[1] - c[1], at[0] - c[0]) - Math.atan2(l.origin[1] - c[1], l.origin[0] - c[0]);
      if (e.shiftKey) angle = Math.round(angle / (Math.PI / 12)) * Math.PI / 12;
      return rotateMatrix(c, angle);
    }
    if (l.handle && l.skew && l.handle.length === 1) return skewMatrix(b, l.handle as 'n' | 's' | 'e' | 'w', delta);
    if (l.handle) { const to = resizeBounds(b, l.handle, delta, e.shiftKey, 1); return fitMatrix(b, { x: Math.round(to.x), y: Math.round(to.y), width: Math.max(1, Math.round(to.width)), height: Math.max(1, Math.round(to.height)) }); }
    const to = e.shiftKey ? constrainAngle(l.origin, at) : at; return moveMatrix(to[0] - l.origin[0], to[1] - l.origin[1]);
  };
  const dropLift = () => { const l = lift.current; if (!l) return; lift.current = null; l.box.remove(); setVeiled(null); setLifted(null); };
  const brushing = props.tool === 'brush' || props.tool === 'eraser';
  // Guides: the first few pixels of a stroke decide whether it follows the ruler, ellipse or a perspective line; steady stroke smooths it.
  const guided = (at: Point): Point => {
    const s = stroke.current; if (!s) return at;
    if (s.follow === undefined && Math.hypot(at[0] - s.start[0], at[1] - s.start[1]) * scale() > 4) s.follow = strokeConstraint(props.drawGuides, s.start, at, 24 / scale());
    const followed = s.follow ? s.follow(at) : at, steadied = props.drawGuides.steady ? steadyPoint(s.last, followed, props.drawGuides.steady) : followed;
    s.last = steadied; return steadied;
  };
  /** Predictive stroke: the finished stroke as the clean shape it resembles. A stroke a guide already steered is left alone. */
  const predicted = (points: Point[]) => props.drawGuides.predict && !stroke.current?.follow ? predictStroke(points) : null;
  /** The tidied stroke as brush samples: evenly spaced and at one pressure, so its width is even all along. */
  const tidySamples = (samples: BrushSample[]): BrushSample[] | null => {
    const shape = predicted(samples.map(s => s.point)); if (!shape) return null;
    const pressure = samples.reduce((n, s) => n + s.pressure, 0) / samples.length, t0 = samples[0].timeMs, span = Math.max(1, samples[samples.length - 1].timeMs - t0);
    const lengths = shape.points.map((p, i) => i ? Math.hypot(p[0] - shape.points[i - 1][0], p[1] - shape.points[i - 1][1]) : 0), total = lengths.reduce((a, b) => a + b, 0) || 1, step = Math.max(2 / scale(), total / 400);
    const out: BrushSample[] = []; let run = 0;
    shape.points.forEach((p, i) => {
      // Long straight runs get points in between, so a line is more than its two ends.
      const a = shape.points[i - 1], pieces = i ? Math.max(1, Math.ceil(lengths[i] / step)) : 1;
      for (let k = 1; k <= pieces; k++) { const t = k / pieces, at = run + lengths[i] * t; out.push({ point: i ? [a[0] + (p[0] - a[0]) * t, a[1] + (p[1] - a[1]) * t] : p, pressure, timeMs: t0 + span * at / total }); }
      run += lengths[i];
    });
    return out;
  };
  const sample = (e: { pressure: number; timeStamp: number }, at: Point) => stroke.current?.samples.push({ point: guided(at), pressure: e.pressure || .5, timeMs: e.timeStamp });
  const strokeOutline = () => stroke.current ? brushOutline(stroke.current.samples, { sizePx: (props.tool === 'eraser' ? props.brush.eraserPx : props.brush.style.sizePx) / scale(), taper: props.tool === 'brush' && props.brush.style.taper, minSize: props.tool === 'eraser' ? 1 : props.brush.style.minSize, pen: stroke.current.pen }) : [];
  const box = useRef<{ origin: Point; previous: string[] } | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null), [preview, setPreview] = useState<DrawingPath[]>([]);
  const [marquee, setMarquee] = useState<Bounds | null>(null), [guides, setGuides] = useState<SnapGuide[]>([]);
  const updateDraft = (value: Draft | null) => { draftRef.current = value; setDraft(value); };
  const canEdit = !!props.layer?.visible && !props.layer.locked;
  const point = (e: { clientX: number; clientY: number }): Point => {
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.current!.getScreenCTM()!.inverse()); return [p.x, p.y];
  };
  // Screen pixels per drawing unit, whichever way the canvas is turned.
  const scale = () => { const m = svg.current?.getScreenCTM(); return m ? Math.hypot(m.a, m.b) || 1 : 1; };
  const options = (): ToolOptions => ({ coordinateStep: 0, minimumArea: 1, curveTolerance: .25 / scale(), freehandTolerance: 1 / scale(), closeTolerance: 9 / scale(), dragThreshold: 2 / scale(), polygonSides: props.polygonSides, curvedPrimitives: true, closePenOnFinish: false });
  const paths = props.layer?.paths ?? [], editable = paths.filter(p => props.layer && pathVisible(props.layer, p) && !pathLocked(props.layer, p)), selectedPaths = paths.some(p => props.selected.includes(p.id) && props.layer && (pathLocked(props.layer, p) || !pathVisible(props.layer, p))) ? [] : editable.filter(p => props.selected.includes(p.id));
  const shown = preview.length ? preview : selectedPaths, selectedObject = shown.length === 1 ? shown[0] : undefined;
  const selected = selectedObject && !selectedObject.symbolID && (!selectedObject.text || selectedObject.text.onPath) ? { ...selectedObject, ...pathContours(selectedObject)[props.contour], subpaths: undefined } : undefined;
  const replaceNode = (next: DrawingPath | undefined) => next && selectedObject && props.onReplace([{ ...selectedObject, ...replaceContour(selectedObject,props.contour,next) }]);
  const bounds = pathBounds(shown);
  const snap = (at: Point, alt: boolean, exclude: string[] = [], omitNode?: number) => {
    const targets = props.doc.layers.filter(l => l.visible).flatMap(l => l.paths.filter(p => pathVisible(l, p) && !exclude.includes(p.id)).flatMap(pathSnapTargets));
    if (omitNode !== undefined && selected) targets.push(...selected.points.filter((_, i) => i !== omitNode).map(point => ({ point, label: 'Anchor' })));
    for (const b of docArtboards(props.doc)) targets.push({ point: [b.x + b.width / 2, b.y + b.height / 2], label: 'Artboard center' }, ...([[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]] as Point[]).map(point => ({ point, label: b.x === 0 && b.y === 0 && point[0] === 0 && point[1] === 0 ? 'Origin' : 'Artboard corner' })));
    if (draftRef.current?.tool === 'pen') targets.push(...draftRef.current.points.map(point => ({ point, label: 'Anchor' })));
    const result = snapPoint(at, targets, { tolerance: props.snap.distancePx / scale(), gridStep: props.snap.grid ? props.snap.gridStepPx : undefined, bypass: !props.snap.enabled || alt });
    setGuides(result.guides); return result.point;
  };
  const settle = (step: DraftStep) => {
    if (step.kind === 'continue') updateDraft(step.draft);
    else {
      if (selecting) {
        // A dragged box lands on whole pixels; a click without a drag drops the selection.
        const whole = (p: Point): Point => props.tool === 'marquee' ? [Math.round(p[0]), Math.round(p[1])] : p;
        if (step.kind === 'commit') props.select.shape({ id: 'selection', points: step.shape.map(whole), curves: step.curves, closed: true, color: '#000000', widthPx: 1, opacity: 1 }, selectMode.current);
        else if (selectMode.current === 'new') props.select.none();
      } else if (step.kind === 'commit' && props.tool === 'knife') props.onKnife(step.shape[0], step.shape[step.shape.length - 1]);
      else if (step.kind === 'commit' && props.tool === 'lasso') {
        // Lasso select: every editable path with all its anchors inside the loop.
        props.onSelect(editable.filter(p => p.points.every(v => insidePolygon(v, step.shape))).map(p => p.id));
      } else if (step.kind === 'commit') {
        const shape = props.tool === 'star' ? starShape(step.shape) : step.shape;
        const box = props.tool === 'shape' ? pathBounds([{ points: shape, closed: true }]) : null;
        const path: DrawingPath = box ? { id: crypto.randomUUID(), ...props.makeShape(box), closed: true, ...props.paint }
          : { id: crypto.randomUUID(), points: shape, curves: props.tool === 'star' ? undefined : step.curves, nodeModes: props.tool === 'star' ? undefined : step.nodeModes,
            closed: step.closed ?? (props.tool !== 'paint' && props.tool !== 'line'), ...props.paint };
        // Lines and pen paths that meet a free end continue that path (and close it on its start).
        // ponytail: not with symmetry on, where each mirrored copy would need its own join.
        const joined = props.joinPaths && (props.tool === 'line' || props.tool === 'pen') && !props.drawGuides.symmetry ? joinOpenPath(path, editable, options().closeTolerance) : { path, removed: [] };
        if (joined.removed.length) props.onSplice(joined.removed, [joined.path]); else props.onAdd(path);
        props.onSelect([joined.path.id]); props.onNode(null);
      }
      updateDraft(null); setGuides([]);
    }
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    // Panning (Space-drag, middle button) and zoom belong to the surrounding FreeformCanvas camera.
    if (e.button !== 0 || !e.isPrimary || activePointer.current !== null) return;
    e.preventDefault(); e.currentTarget.focus();
    activePointer.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId);
    const guideHandle = (e.target as SVGElement).closest('[data-guide]')?.getAttribute('data-guide');
    if (guideHandle) { guideDrag.current = guideHandle; return; }
    if (!canEdit) return;
    const at = point(e), target = e.target as SVGElement;
    if (props.tool === 'brush' || props.tool === 'eraser' || props.tool === 'paint') {
      stroke.current = { samples: [], pen: e.pointerType === 'pen', start: at, last: at };
      // A stroke that starts beside a ruler, ellipse or French curve is on it from its first point. (Directions are chosen once it moves.)
      const hold = strokeConstraint(props.drawGuides, at, at, 24 / scale()); if (hold) stroke.current.follow = hold;
    }
    if (props.tool === 'brush' || props.tool === 'eraser') { sample(e, at); if (props.tool === 'brush' && props.pixelBrush) { startDabs(); feedDabs(); } updateDraft(beginDraft('paint', at, false, options())); return; }
    if (props.tool === 'smudge') { startSmudge(at); return; }
    if (props.tool === 'text') {
      // Clicking the edge of a path sets text along a copy of it; anywhere else makes a text box.
      const under = editable.find(p => p.id === target.closest('[data-path-id]')?.getAttribute('data-path-id') && isGeometry(p)), guide = under && pathContours(under)[0];
      const hit = guide && nearestPathEdge(guide, at, 8 / scale()), from = hit ? hit.edge + hit.fraction : 0;
      // Around a closed shape the text starts where it was clicked.
      const text = guide && hit ? textOnPath(guide.closed ? slicePath(guide, from, from + guide.points.length) ?? guide : guide) : newText(snap(at, e.altKey));
      props.onAdd(text); props.onSelect([text.id]); props.onTool('select'); return;
    }
    if (props.tool === 'fill' || props.tool === 'eyedropper') {
      if (props.layer?.kind === 'pixel') { props.onPixelPoint(props.tool, at); return; }
      const id = target.closest('[data-path-id]')?.getAttribute('data-path-id'), path = editable.find(p => p.id === id);
      if (path) { if (props.tool === 'eyedropper') props.onPickPaint(path); else if (path.closed) { props.onSelect([path.id]); props.onFill(path); } }
      return;
    }
    if (props.tool === 'wand') { props.select.wand(at, modeOf(e)); return; }
    if (props.tool === 'transform') {
      const sel = props.select.selection, handle = target.getAttribute('data-transform') as ResizeHandle | 'rotate' | null;
      if (!sel || props.layer?.kind !== 'pixel') { props.select.all(); return; }
      const b = sel.rect, inside = at[0] >= b.x && at[1] >= b.y && at[0] <= b.x + b.width && at[1] <= b.y + b.height;
      // Alt-drag moves a copy; Ctrl or Cmd on a side handle skews.
      if (handle || inside) startLift(sel, at, handle, e.altKey && !handle, e.metaKey || e.ctrlKey);
      return;
    }
    if (props.tool === 'trim') {
      const id = target.closest('[data-path-id]')?.getAttribute('data-path-id'), path = editable.find(p => p.id === id);
      if (path && isGeometry(path) && !path.subpaths?.length) {
        const pieces = trimPath(path, at, props.doc.layers.flatMap(l => l.paths.filter(p => p.id !== path.id && !p.text && pathVisible(l, p))), 10 / scale());
        if (pieces) { const next = pieces.map((p, i) => ({ ...path, ...p, id: i ? crypto.randomUUID() : path.id })); props.onSplice([path.id], next); props.onSelect(next.map(p => p.id)); }
      }
      return;
    }
    if (props.tool === 'select' || props.tool === 'node' || props.tool === 'corner') {
      const transform = target.getAttribute('data-transform') as ResizeHandle | 'rotate' | null;
      if (transform && bounds) { drag.current = { origin: at, paths: selectedPaths, bounds, handle: transform, anchor: at }; return; }
      const id = target.closest('[data-path-id]')?.getAttribute('data-path-id'), path = editable.find(p => p.id === id);
      props.onNode(null);
      if (!path) { box.current = { origin: at, previous: e.shiftKey ? props.selected : [] }; if (!e.shiftKey) props.onSelect([]); return; }
      const group = props.layer && rootGroup(props.layer, path);
      if (group && props.tool === 'select' && !e.altKey && groupPaths(props.layer!, group).some(p => pathLocked(props.layer!, p))) return;
      const picked = group && props.tool === 'select' && !e.altKey ? groupPaths(props.layer!, group).filter(p => !pathLocked(props.layer!, p) && pathVisible(props.layer!, p)).map(p => p.id) : [path.id];
      const ids = props.tool !== 'select' ? [path.id] : e.shiftKey ? picked.every(id => props.selected.includes(id)) ? props.selected.filter(id => !picked.includes(id)) : [...new Set([...props.selected, ...picked])] : picked.every(id => props.selected.includes(id)) ? props.selected : picked;
      props.onSelect(ids); if (!ids.includes(path.id)) return;
      const members = editable.filter(p => ids.includes(p.id)), b = pathBounds(members)!;
      const node = target.getAttribute('data-node'), control = target.getAttribute('data-control') as 'c1' | 'c2' | null;
      const anchor = nearestPoint(at, members.flatMap(pathSnapTargets), Infinity)?.point ?? at;
      drag.current = { origin: at, paths: members, bounds: b, anchor, ...(node !== null ? { node: Number(node) } : {}), ...(control ? { control } : {}) };
      if (node !== null) props.onNode({ index: control === 'c2' ? (Number(node) + 1) % pathContours(path)[props.contour].points.length : Number(node), ...(control ? { edge: Number(node), control } : {}) });
    } else {
      const engine = ENGINE_TOOL[props.tool] ?? props.tool as SketchTool;
      if (selecting && !draftRef.current) { selectMode.current = modeOf(e); heldShift.current = e.shiftKey; }
      const start = selecting ? at : stroke.current?.follow ? stroke.current.follow(at) : snap(at, e.altKey);
      // Guides steer from where the stroke really starts, which snapping may have moved.
      if (stroke.current) stroke.current.start = stroke.current.last = start;
      updateDraft(engine === 'pen' ? { ...penPointerDown(draftRef.current, start, options().closeTolerance, options()), penPress: at } : beginDraft(engine, start, constrained(e), options()));
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
      // Corner tool: the further the corner is dragged, the larger its radius; Shift rounds every corner alike.
      if (props.tool === 'corner') { setGuides([]); return [{ ...full, ...replaceContour(full, props.contour, roundCorners(p, Math.hypot(at[0] - p.points[d.node][0], at[1] - p.points[d.node][1]), props.cornerStyle, e.shiftKey ? undefined : [d.node])) }]; }
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
    const at = point(e);
    if (guideDrag.current) { props.onDrawGuides(moveGuide(props.drawGuides, guideDrag.current, at)); return; }
    if (smudge.current) { for (const c of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) smudgeTo(point(c)); return; }
    if (lift.current) { const l = lift.current; if (l.moved || Math.hypot(at[0] - l.origin[0], at[1] - l.origin[1]) * scale() >= 2) { l.matrix = liftMatrix(l, e); l.moved = true; placeLift(l); setLifted(l.matrix); } return; }
    if (box.current) { const a = box.current.origin; setMarquee({ x: Math.min(a[0], at[0]), y: Math.min(a[1], at[1]), width: Math.abs(a[0] - at[0]), height: Math.abs(a[1] - at[1]) }); }
    else if (drag.current) setPreview(isDrag(drag.current, e) && (props.tool !== 'corner' || drag.current.node !== undefined) ? dragged(drag.current, e) : []);
    else if (draftRef.current) {
      const d = draftRef.current, target = selecting || d.tool === 'paint' || d.tool === 'freehand' || (d.tool === 'pen' && d.penAnchor !== undefined) ? at : snap(at, e.altKey);
      if (stroke.current && brushing) { for (const c of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) sample(c, point(c)); feedDabs(); }
      updateDraft(moveDraft(d, stroke.current && d.tool === 'paint' ? guided(target) : target, constrained(e)));
    }
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    if (activePointer.current !== e.pointerId) return;
    if (guideDrag.current) { guideDrag.current = null; activePointer.current = null; e.currentTarget.releasePointerCapture(e.pointerId); return; }
    if (smudge.current) endSmudge(true);
    else if (lift.current) {
      const l = lift.current;
      if (!l.moved) dropLift();
      // The lifted pixels stay in view until the layer's bitmap holds them in their new place.
      else { lift.current = null; void props.select.transform(l.matrix, l.copy).finally(() => { l.box.remove(); setVeiled(null); setLifted(null); }); }
    }
    else if (box.current) {
      if (marquee) props.onSelect([...new Set([...box.current.previous, ...editable.filter(p => { const b = pathBounds([p]); return b && boundsContain(marquee, b); }).map(p => p.id)])]);
      box.current = null; setMarquee(null);
    } else if (drag.current) {
      // With the corner tool only a dragged corner changes anything; the path itself never moves.
      const d = drag.current, act = isDrag(d, e) && (props.tool !== 'corner' || d.node !== undefined);
      if (act) props.onReplace(dragged(d, e)); if (act && props.tool === 'corner') props.onNode(null);
      drag.current = null; setPreview([]);
    }
    else if (draftRef.current && stroke.current && dab.current) {
      // Predictive stroke: the live paint is thrown away and the tidied stroke is stamped in its place.
      const tidy = tidySamples(stroke.current.samples); if (tidy) { dab.current.el.remove(); stroke.current.samples = tidy; startDabs(); }
      feedDabs(); const { stroke: painted, el } = dab.current; dab.current = null; stroke.current = null; updateDraft(null);
      // The stroke canvas stays in view until the layer's bitmap holds it.
      if (painted.rect) void props.onPaintStroke(painted.canvas, painted.rect, props.brush.style.opacity, painted.clipped).finally(() => el.remove()); else el.remove();
    }
    else if (draftRef.current && stroke.current && brushing) {
      const tidy = props.tool === 'brush' ? tidySamples(stroke.current.samples) : null; if (tidy) stroke.current.samples = tidy;
      const outline = strokeOutline(), samples = stroke.current.samples, style = props.brush.style; stroke.current = null; updateDraft(null);
      if (props.tool === 'brush' && outline.length > 2) {
        const path: DrawingPath = { ...props.paint, id: crypto.randomUUID(), name: 'Brush stroke', points: outline, closed: true, fill: props.paint.color, fillGradient: undefined, fillOpacity: 1, strokeEnabled: false,
          opacity: brushOpacity(style, samples), ...(style.softness > 0 ? { blurPx: style.softness * style.sizePx / scale() * .35 } : {}) };
        props.onAdd(path); props.onSelect([]);
      } else if (props.tool === 'eraser' && props.layer?.kind === 'pixel') { if (outline.length > 2) props.onErasePixels(outline); }
      else if (props.tool === 'eraser') { const { ids, next } = eraseWith(editable, outline, .5 / scale()); if (ids.length) props.onSplice(ids, next); }
    }
    else if (draftRef.current) {
      const d = draftRef.current, raw = point(e), at = selecting || d.tool === 'paint' || d.tool === 'freehand' || (d.tool === 'pen' && d.penAnchor !== undefined) ? raw : snap(raw, e.altKey);
      const end = stroke.current && d.tool === 'paint' ? guided(at) : at, tidy = d.tool === 'paint' ? predicted([...d.points, end]) : null;
      // A predicted ellipse is a true four-node ellipse; other shapes keep the corners or the arc the predictor found.
      const oval = tidy?.box && ellipsePath([tidy.box.x, tidy.box.y], [tidy.box.x + tidy.box.width, tidy.box.y + tidy.box.height]);
      settle(oval ? { kind: 'commit', shape: oval.points, curves: oval.curves, nodeModes: oval.nodeModes, closed: true } : tidy ? { kind: 'commit', shape: tidy.closed ? tidy.points.slice(0, -1) : tidy.points, closed: tidy.closed } : endDraft(d, end, constrained(e))); stroke.current = null;
    }
    setGuides([]); activePointer.current = null; e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const cancel = () => { endSmudge(false); dab.current?.el.remove(); dab.current = null; dropLift(); stroke.current = null; guideDrag.current = null; activePointer.current = null; drag.current = null; box.current = null; setMarquee(null); setPreview([]); updateDraft(null); setGuides([]); };
  useEffect(() => { cancel(); }, [props.resetKey]);
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); cancel(); e.shiftKey ? props.redo() : props.undo(); return; }
    // On a pixel layer Select All, Deselect and Invert work on the pixel selection.
    const pixel = props.layer?.kind === 'pixel', mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); if (pixel) props.select.all(); else props.onSelect(editable.map(p => p.id)); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); props.select.none(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); props.select.invert(); return; }
    // Esc ends a pen path where it is, like Illustrator and Affinity, instead of discarding it.
    if (e.key === 'Escape') { if (draftRef.current?.tool === 'pen' && activePointer.current === null) settle(finishPen(draftRef.current, false)); cancel(); return; }
    if (e.key === 'Enter' && draftRef.current) { e.preventDefault(); settle(finishPen(draftRef.current, e.shiftKey)); return; }
    // B brush, Shift+B pencil, Shift+E eraser (Illustrator's keys where they do not clash with the engine's).
    const k = e.key.toLowerCase(), own: EditorTool | undefined = k === 'b' ? (e.shiftKey ? 'paint' : 'brush') : e.shiftKey && k === 'e' ? 'eraser' : e.shiftKey ? undefined : ({ h: 'hand', z: 'zoom', q: 'lasso' } as Record<string, EditorTool | undefined>)[k];
    if (!e.metaKey && !e.ctrlKey && !e.altKey && own) { e.preventDefault(); cancel(); props.onTool(own); return; }
    if (!e.metaKey && !e.ctrlKey && !e.altKey && TOOL_SHORTCUTS[e.key.toLowerCase()]) { e.preventDefault(); cancel(); props.onTool(TOOL_SHORTCUTS[e.key.toLowerCase()]); return; }
    const delta: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (pixel && canEdit && props.select.selection && !mod) {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); props.select.clear(); return; }
      if (delta[e.key] && props.tool === 'transform') { e.preventDefault(); const k = e.shiftKey ? 10 : 1; void props.select.transform(moveMatrix(delta[e.key][0] * k, delta[e.key][1] * k), false); return; }
    }
    if (!canEdit || !shown.length) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (props.node && selected && props.tool === 'node') {
        const node = props.node;
        if (!node.control && selected.points.length > (selected.closed ? 3 : 2)) replaceNode({ ...selected, ...replacePathPoints(selected, selected.points.filter((_, i) => i !== node.index)) });
        props.onNode(null);
      } else props.onDelete();
    }
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
  // World-space layer inside FreeformCanvas: one SVG unit is one canvas pixel, and the
  // camera transform above it makes getScreenCTM() map pointers straight to drawing units.
  const artboards = docArtboards(props.doc);
  /** A symbol's own paths, drawn the way a layer draws its paths; the instance supplies the transform. */
  const symbolContent = (def: SymbolDef) => def.paths.filter(q => !q.hidden).map(q => q.text ? <VectorText key={q.id} path={q} gradientID={`${ids.get(q.id)}-gradient`} />
    : drawnParts(q).map(part => <path key={part.id} d={pathData(part)} {...paintAttributes(part, `${ids.get(q.id)}-gradient`)} />));
  // ---- Layer depth: clips, masks, effects and adjustment layers are SVG masks and filters (depth.ts). ----
  const depths = layerDepths(props.doc);
  // Masks and filters cover everything drawn, including a path being dragged and paint still landing.
  // ponytail: measured on every render while the drawing uses layer depth; cache it per document if drawings with thousands of paths drag slowly.
  const region = usesDepth(props.doc) ? depthRegion(props.doc, [...props.doc.layers.map(l => preview.length ? { ...l, paths: l.paths.map(p => preview.find(v => v.id === p.id) ?? p) } : l), { ...props.doc.layers[0], pixels: undefined, effects: undefined, paths: props.pending.flatMap(q => q.paths) }]) ?? { x: 0, y: 0, width: 1, height: 1 } : null;
  /** Every layer in drawing order, an adjustment layer wrapping what is beneath it. Working masks come last and unseen; the current one shows as a ghost so it can be edited. */
  const stack = (draw: (l: Layer, a: ReturnType<typeof depthAttributes>, ghost: boolean) => ReactNode): ReactNode[] => [
    ...composeLayers<ReactNode>(props.doc, depths, (l, d) => d.drawn ? draw(l, depthAttributes(l, d), false) : null,
      (below, d) => <g key={`adjust-${props.doc.layers[d.index].id}`} data-adjusted-by={props.doc.layers[d.index].id} filter={`url(#${layerDOMID(d.index)}-adjust)`}>{below}</g>),
    ...props.doc.layers.map((l, i) => depths[i].role === 'mask' && l.visible ? draw(l, depthAttributes(l, depths[i]), true) : null)];

  return <><svg ref={svg} className="sketch-canvas" aria-label="Sketch drawing canvas" tabIndex={0} width={1} height={1} overflow="visible"
      onPointerDown={down} onPointerMove={move}
      onPointerUp={up} onPointerCancel={cancel} onLostPointerCapture={() => { if (activePointer.current !== null) cancel(); }} onKeyDown={key}
      onDoubleClick={e => {
        if (draftRef.current?.tool === 'pen') { settle(finishPen(draftRef.current, e.shiftKey)); return; }
        if (props.tool !== 'node' || !selected || !canEdit || (e.target as SVGElement).hasAttribute('data-node')) return;
        const edge = nearestPathEdge(selected, point(e), 8 / scale());
        if (edge) { replaceNode({ ...selected, ...splitPathEdge(selected, edge.edge, edge.fraction) }); props.onNode({ index: edge.edge + 1 }); }
      }}>
      <defs><pattern id="sketch-grid" width={props.snap.gridStepPx} height={props.snap.gridStepPx} patternUnits="userSpaceOnUse"><path d={`M${props.snap.gridStepPx} 0 H0 V${props.snap.gridStepPx}`} fill="none" stroke="#dce2e8" strokeWidth={1 / scale()} /></pattern></defs>
      <PaintDefinitions doc={props.doc} ids={ids} preview={preview} />
      <rect className="sketch-capture" x={-5e6} y={-5e6} width={1e7} height={1e7} fill="transparent" />
      {artboards.map(b => <g key={b.id} data-artboard={b.id} data-current={b.id === props.artboardID || undefined} pointerEvents="none">
        <rect className="sketch-artboard" x={b.x} y={b.y} width={b.width} height={b.height} fill="white" />
        {props.snap.grid && <rect x={b.x} y={b.y} width={b.width} height={b.height} fill="url(#sketch-grid)" />}
        {/* Names show once there is more than one page; the current one is marked. */}
        {artboards.length > 1 && <text className="sketch-artboard-name" x={b.x} y={b.y - 6 / scale()} fontSize={12 / scale()}>{b.name}</text>}
        {artboards.length > 1 && b.id === props.artboardID && <rect className="sketch-artboard-current" x={b.x} y={b.y} width={b.width} height={b.height} fill="none" vectorEffect="non-scaling-stroke" />}
      </g>)}
      {region && <defs dangerouslySetInnerHTML={{ __html: depthDefs(props.doc, region, depths) }} />}
      {stack((l, a, ghost) => <g key={l.id} data-layer-id={l.id} data-layer-role={ghost ? 'mask' : undefined} mask={a.clip} style={{ pointerEvents: l.id === props.layer?.id && !l.locked ? 'auto' : 'none', opacity: ghost ? l.id === props.layer?.id ? .35 : 0 : l.opacity, mixBlendMode: ghost ? undefined : l.blend }}><g filter={ghost ? undefined : a.effects}><g id={a.id} mask={a.hide} filter={ghost ? a.effects : undefined}>
        {l.pixels && <image data-pixel-layer={l.id} href={l.pixels.src} x={l.pixels.x} y={l.pixels.y} width={l.pixels.width} height={l.pixels.height} preserveAspectRatio="none" pointerEvents="none" visibility={veiled === l.id ? 'hidden' : undefined} style={{ imageRendering: scale() >= 4 ? 'pixelated' : undefined }} />}
        {props.pending.filter(q => q.layerID === l.id).flatMap(q => q.paths).map(p => <path key={`pending-${p.id}`} data-pixel-pending="true" pointerEvents="none" d={pathData(p)}
          {...paintAttributes({ ...p, fill: p.fillGradient?.stops[0]?.color ?? p.fill, fillGradient: undefined, blurPx: undefined }, '')} style={p.blurPx ? { filter: `blur(${p.blurPx}px)` } : undefined} />)}
        {l.paths.filter(p => pathVisible(l, p)).map(p => { const path = preview.find(v => v.id === p.id) ?? p, [body, ...extras] = drawnParts(path); const content = <g data-path-id={p.id} style={{ pointerEvents: pathLocked(l, p) ? 'none' : undefined }}>
          {path.symbolID ? (symbol => symbol && <g data-symbol-instance={symbol.def.id} transform={`matrix(${symbol.matrix.join(' ')})`} opacity={path.opacity}>{symbolContent(symbol.def)}</g>)(symbolOf(props.doc, path)) : path.text ? <VectorText path={path} gradientID={`${ids.get(p.id)}-gradient`} /> : <path pointerEvents={path.closed && (props.tool === 'fill' || props.tool === 'eyedropper') ? 'all' : undefined} data-vector-paint="true" d={pathData(path)} {...paintAttributes(body, `${ids.get(p.id)}-gradient`)} />}
          {extras.map(part => <path key={part.id} data-stroke-part={part.id.slice(p.id.length + 1)} pointerEvents="none" d={pathData(part)} {...paintAttributes(part, '')} />)}
          {/* The part that takes clicks: a wide invisible stroke, the box of boxed text, or a band along text on a path. */}
          <path d={pathData(path)} fill={path.symbolID || (path.text && !path.text.onPath) ? 'transparent' : 'none'} stroke="transparent" strokeWidth={Math.max(path.widthPx, 12 / scale(), path.text?.onPath ? path.text.fontSizePx * 2 : 0)} />
          {props.selected.includes(p.id) && l.id === props.layer?.id && <path className="sketch-selection" d={pathData(path)} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        </g>;
          return <g key={p.id}>{clipPaths(l, p).reduce<ReactNode>((child, clip) => <g clipPath={`url(#${ids.get(clip.id)}-clip)`}>{child}</g>, content)}</g>;
        })}
      </g></g></g>)}
      <GuideOverlay guides={props.drawGuides} scale={scale()} />
      {marquee && <rect {...marquee} className="sketch-marquee" pointerEvents="none" vectorEffect="non-scaling-stroke" />}
      {draft && brushing && !dab.current && <path className={`sketch-brush-preview${props.tool === 'eraser' ? ' sketch-eraser-preview' : ''}`} d={`M${strokeOutline().map(p => p.join(',')).join('L')}Z`} fill={props.tool === 'brush' ? props.paint.color : undefined} pointerEvents="none"
        // The stroke in progress already looks like the finished one: same opacity, same soft edge.
        {...(props.tool === 'brush' && stroke.current ? { opacity: brushOpacity(props.brush.style, stroke.current.samples), style: props.brush.style.softness > 0 ? { filter: `blur(${props.brush.style.softness * props.brush.style.sizePx / scale() * .35}px)` } : undefined } : {})} />}
      {draft && props.tool === 'shape' && (box => box && <path className="sketch-draft" d={pathData({ ...props.makeShape(box), closed: true })} fill="none" fillRule="evenodd" vectorEffect="non-scaling-stroke" pointerEvents="none" />)(pathBounds([{ points: previewShape(draft), closed: true }]))}
      {draft && !brushing && props.tool !== 'shape' && <polyline className="sketch-draft" points={(draft.tool === 'paint' ? draft.points : props.tool === 'star' ? starShape(previewShape(draft)) : previewShape(draft)).map(p => p.join(',')).join(' ')} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
      {guides.map((g, i) => <g className="sketch-snap-guide" key={i} pointerEvents="none" aria-label={`Snap ${g.label}`}><line x1={g.from[0]} y1={g.from[1]} x2={g.to[0]} y2={g.to[1]} vectorEffect="non-scaling-stroke" /><circle cx={g.to[0]} cy={g.to[1]} r={pin * 1.5} vectorEffect="non-scaling-stroke" /><text x={g.to[0] + pin * 2} y={g.to[1] - pin * 2} fontSize={11 / scale()}>{g.label}</text></g>)}
      {draft?.tangents?.map((t, i) => { const p = draft.points[i]; return <g key={i} className="sketch-tangent" pointerEvents="none"><line x1={p[0] - t[0]} y1={p[1] - t[1]} x2={p[0] + t[0]} y2={p[1] + t[1]} vectorEffect="non-scaling-stroke" /><circle cx={p[0] + t[0]} cy={p[1] + t[1]} r={pin} /></g>; })}
      {bounds && canEdit && props.tool === 'select' && <g className="sketch-nodes" aria-label="Selection transform">
        <rect {...bounds} fill="none" pointerEvents="none" vectorEffect="non-scaling-stroke" />
        {RESIZE_HANDLES.map(h => { const p = handlePoint(bounds, h); return <rect key={h} data-transform={h} aria-label={`Resize ${h}`} x={p[0] - pin} y={p[1] - pin} width={pin * 2} height={pin * 2} />; })}
        <line x1={bounds.x + bounds.width / 2} y1={bounds.y} x2={bounds.x + bounds.width / 2} y2={bounds.y - pin * 7} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle data-transform="rotate" aria-label="Rotate selection handle" cx={bounds.x + bounds.width / 2} cy={bounds.y - pin * 7} r={pin * 1.3} />
      </g>}
      {props.tool === 'transform' && props.select.selection && canEdit && props.layer?.kind === 'pixel' && !lifted && (b => <g className="sketch-nodes" aria-label="Pixel selection transform">
        {RESIZE_HANDLES.map(h => { const p = handlePoint(b, h); return <rect key={h} data-transform={h} aria-label={`Resize ${h}`} x={p[0] - pin} y={p[1] - pin} width={pin * 2} height={pin * 2} />; })}
        <line x1={b.x + b.width / 2} y1={b.y} x2={b.x + b.width / 2} y2={b.y - pin * 7} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        <circle data-transform="rotate" aria-label="Rotate selection handle" cx={b.x + b.width / 2} cy={b.y - pin * 7} r={pin * 1.3} />
      </g>)(props.select.selection.rect)}
      {selected && canEdit && props.tool === 'corner' && !preview.length && <g data-path-id={selected.id} className="sketch-nodes" aria-label="Corners">
        {cornerIndices(selected).map(i => <circle key={i} data-node={i} aria-label={`Corner ${i + 1}`} cx={selected.points[i][0]} cy={selected.points[i][1]} r={pin * 1.2} />)}
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
    </svg><div ref={overlay} className="sketch-pixel-overlay" aria-hidden="true" />
    {/* Marching ants in an svg of their own, so their animation never repaints the drawing. */}
    {props.select.selection && <svg className="sketch-ants" aria-label="Pixel selection" width={1} height={1} overflow="visible">
      <g transform={lifted ? `matrix(${lifted.join(' ')})` : undefined}><path d={props.select.selection.outline} vectorEffect="non-scaling-stroke" /><path className="sketch-ants-march" d={props.select.selection.outline} vectorEffect="non-scaling-stroke" /></g>
    </svg>}</>;
}
