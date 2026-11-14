import {isLocalDocument,isStudioHosted} from '@aether/session/home/runtime';
import { SaveRecoveryPanel } from '@aether/session/SaveRecoveryPanel';
import { SketchHistoryPanel } from "./SketchHistoryPanel";
import { useAgentInteraction } from './useAgentInteraction';
import { useContextCommands } from '@aether/ui';
import { useStudioApplications } from "@aether/session/applications";
import { studioAgentService } from "@aether/session/agent";
import { FieldRow, WorkspaceAgent, type AssistantMessage } from "@aether/ui";
import { useHostedDocument } from '@aether/session/useHostedDocument';
import { useDocumentConnection } from '@aether/session/useDocumentConnection';
import { writeDraft } from './drafts';
import { DraftRecovery } from './DraftRecovery';
import { RegionInspector } from './RegionInspector';
import { TextInspector } from './TextInspector';
import { importSVG } from './svg-import';
import { saveRecovery, type Recovery } from './recovery';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { DriveBrowser, DocumentTabBrowser, FileIcon, StandardAppShell, FreeformCanvas, type FreeformCamera, type FreeformCanvasController, type FreeformChange, type FreeformItem, type FreeformPoint, type WorkspacePanelState } from '@aether/ui';
import { pathBounds } from '@aether/sketch';
import { alignPaths, distributePaths, flipPaths, orderPaths, rotatePaths, type AlignMode, type OrderMode } from './arrange';
import { BoardInspector } from './BoardInspector';
import { SelectionInspector } from './SelectionInspector';
import { createDocument } from './create-document';
import { driveRequest, editorURL, encodeFile, fileIcon, fileType, type DriveFile } from '@aether/session/library/drive-api';
import { STICKY_COLORS } from './board';
import { AetherIcon, SelectField, ToolIcon, Slider, MenuButton } from '@aether/ui';
import { SketchCanvas, type BrushSettings, type EditorTool, type PixelSelect } from './SketchCanvas';
import { VectorInspector, type NodeSelection, type SnapSettings } from './VectorInspector';
import { VectorPaintPanel } from './VectorPaintPanel';
import { addInside, duplicatePaintSelection, copyPaint, defaultPaint, drawingSVG, repairClips, type PaintStyle } from './paint';
import { drawingOpenRaster, drawingPDF, flattenLayers, rasterBlob } from './export';
import { BRUSH_PRESETS } from './brush';
import { BrushPanel } from './BrushPanel';
import { SAMPLES } from './sample';
import { ColourPanel } from './ColourPanel';
import { GuidePanel } from './GuidePanel';
import { symmetryCopies, type Guides } from './guides';
import { ancestors, flattenInto, flattenPlan, mergeDown, mergeKind } from './structure';
import { depthRegion, hasEffects, layerDepths } from './depth';
import { LayerEffectsPanel, LayerRoleFields } from './LayerDepthPanel';
import { LayersPanel } from './LayersPanel';
import { groupSelection, ungroupSelection, pathLocked, pathVisible } from './structure';
import { BLEND_MODES, readDocument, serializeDocument, newDocument, newLayer, newPixelLayer, type BlendMode, type DrawingPath, type Layer, type PixelBitmap } from './document';
import { canvasBitmap, clearPixels, compositePixels, fillPixels, invertSelection, paintPixels, paintedBounds, pixelBounds, rectSelection, samplePixel, shapeSelection, transformPixels, transformSelection, unionRect, wandSelection,
  type Matrix, type PixelResult, type PixelSelection, type Rect, type SelectMode, type SelectionResult } from './pixels';
import { useDocument } from './useDocument';
import { SHAPES, knifePath, makeShape, roundAllCorners, type CornerStyle } from './vector';
import { pathData } from '@aether/sketch';
import { Button, NumberField } from '@aether/ui';
import './sketch.css';
/** Every drawing tool, with a name and a recognisable icon. Keys: V select, H hand, Z zoom, B brush, Shift+B pencil,
 * Shift+E eraser, N lasso fill, P pen, L line, M rectangle, E ellipse, G polygon, A edit nodes, Q lasso select. */
// ponytail: the eraser borrows the shared "remove" tool icon until core/assets gains an eraser.
const TOOL_INFO: Record<EditorTool, { label: string; icon: ReactNode }> = {
  select: { label: 'Select and transform (V)', icon: <ToolIcon name="select" /> }, hand: { label: 'Hand: pan (H, or hold Space)', icon: <AetherIcon name="hand" /> },
  zoom: { label: 'Zoom: click in, Alt-click out (Z)', icon: <AetherIcon name="zoom-in" /> },
  // ponytail: smudge borrows the shared variable-scribble icon until core/assets gains a smudge icon.
  smudge: { label: 'Smudge', icon: <AetherIcon name="scribble-variable" /> },
  brush: { label: 'Brush (B)', icon: <AetherIcon name="brush" /> }, paint: { label: 'Pencil (Shift+B)', icon: <AetherIcon name="pencil" /> }, eraser: { label: 'Eraser (Shift+E)', icon: <ToolIcon name="remove" /> },
  fill: { label: 'Fill a shape', icon: <ToolIcon name="fill" /> }, freehand: { label: 'Lasso fill (N)', icon: <AetherIcon name="scribble" /> }, eyedropper: { label: 'Eyedropper: pick a colour and style', icon: <ToolIcon name="eye" /> },
  line: { label: 'Line (L)', icon: <ToolIcon name="line" /> }, pen: { label: 'Pen: Bézier curves (P)', icon: <ToolIcon name="pen" /> },
  rect: { label: 'Rectangle (M)', icon: <ToolIcon name="rectangle" /> }, square: { label: 'Square', icon: <ToolIcon name="rectangle" /> },
  ellipse: { label: 'Ellipse (E)', icon: <AetherIcon name="circle" /> }, circle: { label: 'Circle', icon: <AetherIcon name="circle" /> },
  polygon: { label: 'Polygon (G)', icon: <AetherIcon name="hexagon" /> }, star: { label: 'Star', icon: <AetherIcon name="star" /> }, text: { label: 'Text (T)', icon: <AetherIcon name="text" /> },
  // ponytail: polygon select borrows the polygon tool's hexagon icon, and the wand the sparkles, until core/assets gains their own.
  marquee: { label: 'Rectangle select', icon: <AetherIcon name="rectangle-dashed" /> }, 'marquee-ellipse': { label: 'Ellipse select', icon: <AetherIcon name="circle-dashed" /> },
  'marquee-lasso': { label: 'Freehand select', icon: <AetherIcon name="lasso" /> }, 'marquee-polygon': { label: 'Polygon select', icon: <AetherIcon name="hexagon" /> },
  wand: { label: 'Magic wand: select by colour', icon: <AetherIcon name="sparkles" /> }, transform: { label: 'Move and transform pixels', icon: <AetherIcon name="move" /> },
  corner: { label: 'Corner: drag a corner to round it', icon: <ToolIcon name="fillet" /> }, shape: { label: 'Shape library', icon: <ToolIcon name="smart-shape" /> },
  knife: { label: 'Knife: drag a line to cut shapes', icon: <ToolIcon name="cut" /> },
  lasso: { label: 'Lasso select (Q)', icon: <AetherIcon name="lasso" /> }, node: { label: 'Edit nodes (A)', icon: <AetherIcon name="node-select" /> }, trim: { label: 'Trim at crossings', icon: <AetherIcon name="scissors" /> },
};
/** The tool bar's tabs: drawing first, then shapes, then editing. Guides live in the center tray, board items in the environment tray. */
const TOOL_TABS: { id: string; label: string; groups: { id: string; label: string; tools: EditorTool[] }[] }[] = [
  { id: 'draw', label: 'Draw', groups: [{ id: 'navigate', label: 'Navigate', tools: ['select', 'hand', 'zoom'] }, { id: 'brushes', label: 'Brushes', tools: ['brush', 'paint', 'eraser', 'smudge'] },
    { id: 'colour', label: 'Fill and colour', tools: ['fill', 'freehand', 'eyedropper'] }] },
  { id: 'shapes', label: 'Shapes', groups: [{ id: 'lines', label: 'Lines', tools: ['line', 'pen'] }, { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'star', 'shape'] }, { id: 'text', label: 'Text', tools: ['text'] }] },
  { id: 'edit', label: 'Edit', groups: [{ id: 'select', label: 'Select', tools: ['select', 'lasso', 'node', 'corner', 'trim', 'knife'] }] },
  { id: 'paths', label: 'Paths', groups: [{ id: 'navigate', label: 'Navigate', tools: ['select', 'node', 'corner', 'hand', 'zoom'] }, { id: 'lines', label: 'Lines', tools: ['pen', 'line', 'paint', 'brush'] },
    { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'star', 'shape'] }, { id: 'cut', label: 'Cut', tools: ['trim', 'knife'] }, { id: 'paint', label: 'Paint', tools: ['fill', 'eyedropper'] }, { id: 'text', label: 'Text', tools: ['text'] }] },
  { id: 'select', label: 'Select', groups: [{ id: 'marquee', label: 'Select pixels', tools: ['marquee', 'marquee-ellipse', 'marquee-lasso', 'marquee-polygon', 'wand'] }, { id: 'move', label: 'Move', tools: ['transform'] }] },
];
const SELECT_MODES: { value: SelectMode; label: string }[] = [{ value: 'new', label: 'New selection' }, { value: 'add', label: 'Add to selection' }, { value: 'subtract', label: 'Subtract from selection' }, { value: 'intersect', label: 'Intersect with selection' }];
/** One app, two workspaces on the same drawing (Affinity-style personas): Pixel paints like SketchBook and Fresco, Vector edits paths like Affinity Designer and Illustrator. */
type Workspace = 'pixel' | 'vector';
const WORKSPACES: Record<Workspace, { label: string; icon: ReactNode; tabs: string[] }> = {
  pixel: { label: 'Pixel', icon: <AetherIcon name="brush" />, tabs: ['draw', 'shapes', 'select', 'edit'] },
  vector: { label: 'Vector', icon: <ToolIcon name="pen" />, tabs: ['paths', 'edit'] },
};
const WORKSPACE_KEY = 'aether-sketch.workspace';
/** `?workspace=vector` (the Aether Vector launcher) wins, then this browser's last choice. */
function initialWorkspace(): Workspace {
  const asked = new URLSearchParams(location.search).get('workspace');
  if (asked === 'pixel' || asked === 'vector') return asked;
  try { const saved = localStorage.getItem(WORKSPACE_KEY); if (saved === 'pixel' || saved === 'vector') return saved; } catch { /* a convenience only */ }
  return 'pixel';
}
const workspaceTools = (w: Workspace) => new Set(TOOL_TABS.filter(t => WORKSPACES[w].tabs.includes(t.id)).flatMap(t => t.groups.flatMap(g => g.tools)));
const GUIDES: { id: 'ruler' | 'ellipse' | 'symmetry' | 'perspective' | 'steady'; label: string; icon: ReactNode }[] = [
  { id: 'ruler', label: 'Ruler', icon: <AetherIcon name="ruler" /> }, { id: 'ellipse', label: 'Ellipse guide', icon: <AetherIcon name="circle-dashed" /> },
  { id: 'symmetry', label: 'Symmetry', icon: <ToolIcon name="mirror" /> }, { id: 'perspective', label: 'Perspective guide', icon: <AetherIcon name="grid-cross" /> },
  { id: 'steady', label: 'Steady stroke', icon: <AetherIcon name="scribble-variable" /> },
];
const DRAW_TOOLS = [...new Set(TOOL_TABS.flatMap(t => t.groups.flatMap(g => g.tools)))];
type BoardTool = 'note' | 'textbox' | 'table' | 'connector';
const EXPORTS = [
  { id: 'export', label: 'Export SVG (Inkscape layers)', extension: 'svg', mime: 'image/svg+xml' }, { id: 'export-pdf', label: 'Export PDF', extension: 'pdf', mime: 'application/pdf' },
  { id: 'export-png', label: 'Export PNG', extension: 'png', mime: 'image/png' }, { id: 'export-jpeg', label: 'Export JPEG', extension: 'jpg', mime: 'image/jpeg' },
  { id: 'export-webp', label: 'Export WebP', extension: 'webp', mime: 'image/webp' }, { id: 'export-ora', label: 'Export OpenRaster (GIMP, Krita)', extension: 'ora', mime: 'image/openraster' },
] as const;
/** Deep zoom: 0.1% to 1,000,000%. Brush and eraser sizes are on screen, so zooming in and drawing adds finer detail.
 * ponytail: ceiling set by the browser's float32 rendering; rebase coordinates near the camera to go further. */
const ZOOM_LIMITS = { min: .001, max: 10000 };
type AppTool = EditorTool | BoardTool;
const boardTools: { id: BoardTool; label: string; icon: ReactNode }[] = [
  { id: 'note', label: 'Sticky note', icon: <AetherIcon name="notes" /> }, { id: 'textbox', label: 'Text box', icon: <AetherIcon name="text" /> },
  { id: 'table', label: 'Table', icon: <AetherIcon name="grid-3" /> }, { id: 'connector', label: 'Connector', icon: <ToolIcon name="connector" /> },
];
// Board tools are FreeformCanvas's own; every vector tool except Select is handled by SketchCanvas in the canvas layer.
const CANVAS_TOOL: Record<BoardTool, string> = { note: 'sticky', textbox: 'text', table: 'table', connector: 'connector' };
const HOST_TOOLS = DRAW_TOOLS.filter(t => !['select', 'hand', 'zoom'].includes(t)).map(t => `vector:${t}`);
const isBoardTool = (tool: AppTool): tool is BoardTool => tool in CANVAS_TOOL;
const ALIGN: { id: AlignMode; label: string }[] = [{ id: 'left', label: 'Align left' }, { id: 'center', label: 'Align horizontal centres' }, { id: 'right', label: 'Align right' },
  { id: 'top', label: 'Align top' }, { id: 'middle', label: 'Align vertical centres' }, { id: 'bottom', label: 'Align bottom' }];
const ORDER: { id: OrderMode; label: string }[] = [{ id: 'front', label: 'Bring to front' }, { id: 'forward', label: 'Bring forward' }, { id: 'backward', label: 'Send backward' }, { id: 'back', label: 'Send to back' }];
const PANELS_KEY = 'aether-sketch.panels.v2';
// A controlled layout ignores defaultOpenLeft/Right, so the first-run layout opens Layers and Properties here.
const DEFAULT_PANELS: WorkspacePanelState = { tree: { placement: 'docked' }, properties: { placement: 'docked' } };
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const readDataURL = (file: File) => new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
const imageSize = (src: string) => new Promise<{ width: number; height: number }>(resolve => { const i = new Image(); i.onload = () => resolve({ width: i.naturalWidth, height: i.naturalHeight }); i.onerror = () => resolve({ width: 240, height: 160 }); i.src = src; });
function splicePaths(paths: DrawingPath[], remove: string[], add: DrawingPath[]) {
  const index = paths.findIndex(p => remove.includes(p.id)), remaining = paths.filter(p => !remove.includes(p.id));
  remaining.splice(index < 0 ? remaining.length : index, 0, ...add);
  return remaining;
}
export default function App({ initial, recoveryKey }: { initial?: Recovery; recoveryKey?: string | null }) {
  const applications = useStudioApplications(isStudioHosted());
  const history = useDocument(initial?.doc), { doc } = history;
  const commit = (change: (doc: typeof history.doc) => typeof history.doc) => history.commit(d => repairClips(change(d)));
  const [agentMessages,setAgentMessages]=useState<AssistantMessage[]>([]);
  const [preset, setPreset] = useState<'docked' | 'floating' | 'canvas'>('floating'), [tool, setTool] = useState<AppTool>('select');
  const [camera, setCamera] = useState<FreeformCamera>({ x: 48, y: 48, zoom: 1 }), [boardSelection, setBoardSelection] = useState<string[]>([]);
  const [boardGrid, setBoardGrid] = useState(true), [boardConnectors, setBoardConnectors] = useState(true);
  const [workspace, setWorkspace] = useState(initialWorkspace), [ribbonTab, setRibbonTab] = useState(() => WORKSPACES[initialWorkspace()].tabs[0]), canvasController = useRef<FreeformCanvasController>(null), imageFile = useRef<HTMLInputElement>(null);
  const [panelState, setPanelState] = useState<WorkspacePanelState>(() => { try { const v: unknown = JSON.parse(sessionStorage.getItem(PANELS_KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? v as WorkspacePanelState : DEFAULT_PANELS; } catch { return DEFAULT_PANELS; } });
  const [paint, setPaint] = useState<PaintStyle>(defaultPaint), [insideID, setInsideID] = useState<string | null>(null);
  const [contour, setContour] = useState(0), [recoveryStatus, setRecoveryStatus] = useState(initial ? 'Recovered local draft' : '');
  const draftID = useRef(crypto.randomUUID()), flushRecovery = useRef<() => void>(()=>{});
  const svgFile = useRef<HTMLInputElement>(null);
  const [sides, setSides] = useState(6), [brush, setBrush] = useState<BrushSettings>(() => { const { id: _i, name: _n, group: _g, ...style } = BRUSH_PRESETS.find(b => b.id === 'ink-pen')!; return { style, eraserPx: 32, smudgePx: 40, smudge: .6 }; });
  const [brushPreset, setBrushPreset] = useState<string | null>('ink-pen'), [guides, setGuides] = useState<Guides>({}), [recentColours, setRecentColours] = useState<string[]>([]);
  const [layerID, setLayerID] = useState(doc.layers[0].id), [selected, setSelected] = useState<string[]>([]), [node, setNode] = useState<NodeSelection | null>(null);
  const [notice, setNotice] = useState(''), [name, setName] = useState(initial?.name ?? 'Untitled'), [epoch, setEpoch] = useState(0);
  const [snap, setSnap] = useState<SnapSettings>({ enabled: true, grid: false, gridStepPx: 20, distancePx: 8 });
  const [saved, setSaved] = useState(() => serializeDocument(doc));
  const [documentIdentity,setDocumentIdentity]=useState('initial');
  // Serialised once per drawing state, not once per render: pixel layers make the text megabytes long.
  const documentText = useMemo(() => serializeDocument(doc), [doc]);
  const persistence=useHostedDocument({app:'sketch',identity:documentIdentity,text:documentText,name:`${name}.aethersketch`,onLoad:(text,file)=>{
    const next=readDocument(text);history.open(next);setLayerID(next.layers[0].id);setSelected([]);setNode(null);setInsideID(null);setContour(0);setEpoch(e=>e+1);
    if(file)setName(file.name.replace(/\.aethersketch$/i,''));
  }});
  const documentConnection=useDocumentConnection({app:'sketch',id:persistence.file?.id,name,writable:persistence.file?.writable,flush:persistence.flush,saveCopy:persistence.saveCopy});
  /** Switch to another drawing. `open` must put the next drawing in history in the same render as the identity change:
   * the hosted document reads the text at that render, so opening it later would save and reload the previous drawing. */
  const beginDocument=async(open:()=>void)=>{
    if((isLocalDocument()||isStudioHosted()))await persistence.flush();
    flushRecovery.current();draftID.current=crypto.randomUUID();
    window.history.replaceState(null,'',location.pathname+(isLocalDocument()?'?editor&storage=local':'?editor'));open();setDocumentIdentity(crypto.randomUUID());
  };
  const file = useRef<HTMLInputElement>(null), layer = doc.layers.find(l => l.id === layerID) ?? doc.layers[0];
  const chosen = layer.paths.filter(p => selected.includes(p.id)), disabled = layer.locked || !layer.visible || chosen.some(p => pathLocked(layer, p) || !pathVisible(layer, p));
  const changeLayer = (change: (l: Layer) => Layer) => commit(d => ({ ...d, layers: d.layers.map(l => l.id === layer.id ? change(l) : l) }));
  const replace = (paths: DrawingPath[]) => !disabled && changeLayer(l => l.locked || !l.visible ? l : { ...l, paths: l.paths.map(p => pathLocked(l, p) || !pathVisible(l, p) ? p : paths.find(v => v.id === p.id) ?? p) });
  const splice = (remove: string[], add: DrawingPath[]) => changeLayer(l => l.locked || !l.visible || l.paths.some(p => remove.includes(p.id) && (pathLocked(l, p) || !pathVisible(l, p))) ? l : { ...l, paths: splicePaths(l.paths, remove, add) });
  const remove = () => { if (!disabled) { splice(selected, []); setSelected([]); setNode(null); } };
  const select = (ids: string[]) => { if(ids.join() !== selected.join()) { setContour(0); setNode(null); } setSelected(ids); if (ids.length) setBoardSelection([]); };
  const board = doc.board ?? [];
  const changeBoard = (items: FreeformItem[], change?: FreeformChange) => {
    // New notes take the classic note yellow so they read the same in light and dark themes.
    const next = change?.type === 'create' ? items.map(i => change.ids.includes(i.id) && i.kind === 'sticky' && !i.fill ? { ...i, fill: STICKY_COLORS[0].id } : i) : items;
    commit(d => { const { board: _old, ...rest } = d; return next.length ? { ...rest, board: next } : rest; });
  };
  const selectBoard = (ids: string[]) => { setBoardSelection(ids); if (ids.length) { setSelected([]); setNode(null); } };
  const chosenBoard = board.filter(i => boardSelection.includes(i.id));
  const artboard = { x: 0, y: 0, width: doc.widthPx, height: doc.heightPx };
  const drawn = unionRect(pathBounds(doc.layers.filter(l => l.visible).flatMap(l => l.paths)), pixelBounds(doc.layers));
  const contentBounds = doc.infinite ? drawn ?? artboard : drawn ? { x: Math.min(0, drawn.x), y: Math.min(0, drawn.y), width: Math.max(doc.widthPx, drawn.x + drawn.width) - Math.min(0, drawn.x), height: Math.max(doc.heightPx, drawn.y + drawn.height) - Math.min(0, drawn.y) } : artboard;
  // Gallery-free storage rule: files become items here; images are embedded as data URLs, other files as named cards.
  const attach = async (files: File[], at: FreeformPoint) => {
    const added: FreeformItem[] = [];
    for (const [index, f] of files.entries()) {
      const id = crypto.randomUUID(), x = at.x + index * 24, y = at.y + index * 24;
      if (IMAGE_TYPES.includes(f.type) && f.size <= 10_000_000) {
        const src = await readDataURL(f), size = await imageSize(src), k = Math.min(1, 480 / Math.max(size.width, size.height, 1));
        added.push({ id, kind: 'image', x, y, width: size.width * k, height: size.height * k, src, name: f.name.slice(0, 200) });
      } else added.push({ id, kind: 'attachment', x, y, width: 240, height: 48, name: f.name.slice(0, 200) });
    }
    if (added.length) { changeBoard([...board, ...added]); selectBoard(added.map(i => i.id)); setNotice(files.some(f => !IMAGE_TYPES.includes(f.type)) ? 'Files added as cards; only PNG, JPEG, GIF and WebP images are embedded.' : 'Image added to the board.'); }
  };
  const docRef = useRef(doc); docRef.current = doc;
  const [pending, setPending] = useState<{ id: string; layerID: string; paths: DrawingPath[] }[]>([]), pixelQueue = useRef<Promise<void>>(Promise.resolve());
  /** One bitmap edit at a time, each starting from what the last one left. `shown` stays on screen as vectors until the new bitmap is in the drawing. */
  const editPixels = (layerID: string, shown: DrawingPath[], edit: (current: PixelBitmap | undefined) => Promise<PixelResult>) => {
    const id = crypto.randomUUID(), done = () => setPending(q => q.filter(x => x.id !== id));
    if (shown.length) setPending(q => [...q, { id, layerID, paths: shown }]);
    pixelQueue.current = pixelQueue.current.then(async () => {
      try {
        const result = await edit(docRef.current.layers.find(l => l.id === layerID)?.pixels);
        if (result && 'problem' in result) setNotice(result.problem);
        // Rendered at once, so the next queued edit reads this bitmap and the vector preview never doubles it.
        if (result && 'bitmap' in result) flushSync(() => { commit(d => ({ ...d, layers: d.layers.map(l => l.id === layerID && l.kind === 'pixel' ? { ...l, pixels: result.bitmap } : l) })); done(); });
        // The Studio server stores drawings up to 16 MB; say so before a save can fail.
        const megabytes = docRef.current.layers.reduce((n, l) => n + (l.pixels?.src.length ?? 0), 0) / 1e6;
        if (megabytes > 12) setNotice(`The pixel layers now take about ${Math.round(megabytes)} MB. Drawings over 16 MB cannot be saved to the server, so remove a pixel layer or export before painting much more.`);
      } catch (error) { setNotice(error instanceof Error ? error.message : 'The pixel layer could not be changed.'); }
      done();
    });
    return pixelQueue.current;
  };
  // ---- Pixel selection: where pixel edits land, and what Move and transform works on. Not part of the drawing file. ----
  // ---- Vector tools: the shape library, the corner tool and the knife. ----
  const [shapeID, setShapeID] = useState(SHAPES[0].id), [shapeAmounts, setShapeAmounts] = useState<Record<string, number>>({}), [corner, setCorner] = useState<{ radius: number; style: CornerStyle }>({ radius: 20, style: 'round' });
  const shapeKind = SHAPES.find(k => k.id === shapeID) ?? SHAPES[0], shapeAmount = shapeAmounts[shapeKind.id] ?? shapeKind.amount?.value ?? 0;
  /** The knife cuts the selected paths, or with nothing selected every path on the layer that its line crosses. */
  const knife = (a: [number, number], b: [number, number]) => {
    if (layer.locked || !layer.visible) return;
    const cut = new Map((chosen.length ? chosen : layer.paths).filter(p => !p.text && !pathLocked(layer, p) && pathVisible(layer, p)).flatMap(p => {
      const pieces = knifePath(p, a, b); return pieces ? [[p.id, pieces.map((piece, i) => ({ ...p, ...piece, id: i ? crypto.randomUUID() : p.id }))] as const] : [];
    }));
    if (!cut.size) { setNotice('The knife did not cut through a path on this layer. Drag it all the way across a shape.'); return; }
    changeLayer(l => ({ ...l, paths: l.paths.flatMap(p => cut.get(p.id) ?? [p]) })); setSelected([...cut.values()].flat().map(p => p.id)); setNode(null);
    setNotice(`Cut into ${[...cut.values()].flat().length} pieces.`);
  };
  const [selection, setSelection] = useState<PixelSelection | null>(null), [selectMode, setSelectMode] = useState<SelectMode>('new'), [wandTolerance, setWandTolerance] = useState(32);
  const selectionRef = useRef(selection); selectionRef.current = selection;
  /** Undo and redo bring back the selection that was active at each step of the drawing. */
  const selectionAt = useRef(new WeakMap<object, PixelSelection | null>());
  const changeSelection = (next: PixelSelection | null) => { selectionAt.current.set(docRef.current, next); selectionRef.current = next; setSelection(next); };
  useEffect(() => { const kept = selectionAt.current.get(doc); if (kept !== undefined) setSelection(kept); }, [doc]);
  useEffect(() => setSelection(null), [documentIdentity]);
  const settleSelection = (result: SelectionResult) => { if ('problem' in result) setNotice(result.problem); else changeSelection(result.selection); };
  /** Read this layer's bitmap once the queued edits have landed. */
  const afterPixels = <T,>(read: (bitmap: PixelBitmap | undefined) => Promise<T> | T): Promise<T | undefined> => {
    const id = layer.id, job = pixelQueue.current.then(() => read(docRef.current.layers.find(l => l.id === id)?.pixels));
    pixelQueue.current = job.then(() => {}, error => setNotice(error instanceof Error ? error.message : 'The pixels could not be read.'));
    return job.catch(() => undefined);
  };
  const selectArea = doc.infinite ? drawn ?? artboard : artboard;
  /** Select all: the tight box around everything painted on this layer. */
  const selectPainted = async (): Promise<PixelSelection | null> => {
    if (layer.kind !== 'pixel') { setNotice('Select a pixel layer in Layers to select its pixels.'); return null; }
    const box = await afterPixels(paintedBounds);
    if (!box) { setNotice('Nothing is painted on this layer yet.'); return null; }
    const next = rectSelection(box); changeSelection(next); return next;
  };
  /** Move, scale, rotate, skew or flip the selected pixels; with nothing selected, everything painted on the layer. */
  const transformSelected = async (matrix: Matrix, copy = false) => {
    const sel = selectionRef.current ?? await selectPainted(); if (!sel || layer.kind !== 'pixel') return;
    let landed = false;
    await editPixels(layer.id, [], async current => {
      selectionAt.current.set(docRef.current, sel); // undoing the move brings this selection back
      const result = await transformPixels(current, sel, matrix, copy); landed = !!result && 'bitmap' in result; return result;
    });
    if (landed) changeSelection(transformSelection(sel, matrix));
  };
  const turnPixels = async (id: string) => {
    const sel = selectionRef.current ?? await selectPainted(); if (!sel) return;
    const { x, y, width, height } = sel.rect, cx = x + width / 2, cy = y + height / 2;
    await transformSelected(id === 'pixel-flip-horizontal' ? [-1, 0, 0, 1, 2 * cx, 0] : id === 'pixel-flip-vertical' ? [1, 0, 0, -1, 0, 2 * cy] : [0, 1, -1, 0, Math.round(cx + cy), Math.round(cy - cx)]);
  };
  const pixelSelect: PixelSelect = { selection, mode: selectMode,
    shape: (shape, mode) => settleSelection(shapeSelection(selectionRef.current, shape, mode)),
    wand: (at, mode) => {
      if (layer.kind !== 'pixel') { setNotice('The magic wand selects by colour on a pixel layer. Select one in Layers.'); return; }
      void afterPixels(async bitmap => settleSelection(await wandSelection(selectionRef.current, bitmap, at, selectArea, wandTolerance, mode)));
    },
    all: () => void selectPainted(), none: () => changeSelection(null),
    invert: () => { const sel = selectionRef.current; if (sel) settleSelection(invertSelection(sel, selectArea)); },
    clear: () => { const sel = selectionRef.current; if (sel && layer.kind === 'pixel') void editPixels(layer.id, [], current => clearPixels(current, sel)); },
    transform: transformSelected };
  // ---- Layer depth: merging to pixels, and a mask from the selection. Clips, masks, effects and adjustments draw in depth.ts. ----
  const layerRole = layerDepths(doc)[doc.layers.findIndex(l => l.id === layer.id)]?.role;
  /** Merge a layer into the one below: as vectors when both are plain vector layers, otherwise flattened to pixels once queued paint has landed. */
  const mergeLayerDown = (id: string) => {
    if (mergeKind(docRef.current, id) === 'vector') { commit(d => mergeDown(d, id)); return; }
    pixelQueue.current = pixelQueue.current.then(async () => {
      try {
        const plan = flattenPlan(docRef.current, id); if (!plan) return;
        const result = await flattenLayers(plan.render, plan.only);
        if ('problem' in result) { setNotice(result.problem); return; }
        flushSync(() => commit(d => flattenInto(d, plan.lowerID, plan.remove, result.bitmap ?? undefined)));
        setLayerID(plan.lowerID); setSelected([]); setNode(null); setInsideID(null); setNotice('Merged into a pixel layer.');
      } catch (error) { setNotice(error instanceof Error ? error.message : 'The layers could not be merged.'); }
    });
  };
  /** Hide everything on this layer outside the selection, with a mask layer above it. The layer's own pixels are untouched. */
  const maskOutsideSelection = async () => {
    const sel = selectionRef.current; if (!sel || layerRole === 'mask') return;
    const outside = invertSelection(sel, depthRegion(doc, [layer]) ?? sel.rect);
    if ('problem' in outside) { setNotice(outside.problem); return; }
    const pixels = outside.selection && await canvasBitmap(outside.selection.canvas, outside.selection.rect);
    if (!pixels) { setNotice('The selection already covers everything on this layer.'); return; }
    const mask: Layer = { ...newPixelLayer(`Mask of ${layer.name}`.slice(0, 200)), role: 'mask', pixels };
    commit(d => { const at = Math.max(0, d.layers.findIndex(l => l.id === layer.id)); return { ...d, layers: [...d.layers.slice(0, at), mask, ...d.layers.slice(at)] }; });
    setNotice('Everything outside the selection is hidden by a mask layer. Paint or erase on the mask to change what shows; hide or delete it to bring everything back.');
  };
  const addVector = (paths: DrawingPath[]) => insideID ? changeLayer(l => addInside(l, insideID, paths, crypto.randomUUID())) : splice([], paths);
  /** The Pixel workspace paints pixels and the Vector workspace draws paths, whatever layer is current: when the
   * current layer is the other kind, a layer of the right kind is added above it (Affinity's assistant). Text is always a vector object. */
  /** The pixel layer that paint lands on: the current one; an empty vector layer turned into one, so a new drawing
   * does not start with a spare layer; or a new pixel layer above the current one. */
  const pixelTarget = (): string => {
    if (layer.kind === 'pixel' && !layer.adjust) return layer.id;
    if (!layer.adjust && !layer.paths.length && !layer.groups?.length) { commit(d => ({ ...d, layers: d.layers.map(l => l.id === layer.id ? { ...l, kind: 'pixel' as const } : l) })); return layer.id; }
    const created = newPixelLayer(`Layer ${doc.layers.length + 1}`);
    commit(d => { const at = Math.max(0, d.layers.findIndex(l => l.id === layer.id)); return { ...d, layers: [...d.layers.slice(0, at), created, ...d.layers.slice(at)] }; });
    setLayerID(created.id); setInsideID(null); setNotice('Painting on a new pixel layer.'); return created.id;
  };
  const add = (paths: DrawingPath[]) => {
    if (workspace === 'pixel' && !paths.some(p => p.text)) { const clip = selectionRef.current; editPixels(pixelTarget(), paths, current => paintPixels(current, paths, 'paint', clip)); return; }
    if (layer.kind !== 'pixel' && !layer.adjust) { addVector(paths); return; }
    // Vector drawing on a pixel layer: an unpainted one becomes a vector layer, otherwise a vector layer is added above it.
    if (!layer.pixels && !layer.adjust) { commit(d => ({ ...d, layers: d.layers.map(l => { if (l.id !== layer.id) return l; const { kind: _kind, pixels: _pixels, ...rest } = l; return { ...rest, paths }; }) })); return; }
    const created: Layer = { ...newLayer(`Layer ${doc.layers.length + 1}`), paths };
    commit(d => { const at = Math.max(0, d.layers.findIndex(l => l.id === layer.id)); return { ...d, layers: [...d.layers.slice(0, at), created, ...d.layers.slice(at)] }; });
    setLayerID(created.id); setInsideID(null); setNotice('Drawing on a new vector layer.');
  };
  /** A stamped brush stroke, painted live on its own canvas, lands on the pixel layer at the brush's opacity. */
  const paintStroke = (stroke: HTMLCanvasElement, rect: Rect, opacity: number, clipped: boolean) => {
    if (clipped) setNotice('Part of that stroke fell outside the largest area one pixel layer can hold (4096 px a side).');
    const clip = selectionRef.current; return editPixels(pixelTarget(), [], current => compositePixels(current, stroke, rect, opacity, clip));
  };
  const erasePixels = (outline: [number, number][]) => { const clip = selectionRef.current; return editPixels(layer.id, [], current => paintPixels(current, [{ id: 'eraser', points: outline, closed: true, fill: '#000000', color: '#000000', widthPx: 1, opacity: 1, strokeEnabled: false }], 'erase', clip)); };
  const setStyle = (patch: Partial<DrawingPath>) => { if (!disabled) replace(chosen.map(p => ({ ...p, ...patch }))); };
  const chooseTool = (next: AppTool) => {
    setTool(next); setNode(null);
    if (next === 'smudge' && !layer.pixels) setNotice('Smudge works on a painted pixel layer. Select one in Layers.');
    // Move and transform with nothing selected takes everything painted on the layer.
    if (next === 'transform' && !selectionRef.current) { if (layer.pixels) void selectPainted(); else setNotice('Move and transform work on a painted pixel layer. Select one in Layers.'); }
  };
  /** Where a new guide appears: the middle of the view. */
  const viewCentre = (): [number, number] => { const box = document.querySelector('[aria-label="Sketch board"]')?.getBoundingClientRect(); return [((box?.width ?? 800) / 2 - camera.x) / camera.zoom, ((box?.height ?? 600) / 2 - camera.y) / camera.zoom]; };
  const toggleGuide = (id: string) => {
    const [cx, cy] = viewCentre(), u = 1 / camera.zoom;
    setGuides(g => id === 'ruler' ? { ...g, ruler: g.ruler ? undefined : { a: [cx - 220 * u, cy], b: [cx + 220 * u, cy] } }
      : id === 'ellipse' ? { ...g, ellipse: g.ellipse ? undefined : { center: [cx, cy], rx: 160 * u, ry: 90 * u, angle: 0 } }
      : id === 'symmetry' ? { ...g, symmetry: g.symmetry ? undefined : { mode: 'vertical', center: [cx, cy], sections: 6 } }
      : id === 'perspective' ? { ...g, perspective: g.perspective ? undefined : { points: [[cx, cy - 120 * u]] } }
      : { ...g, steady: g.steady === undefined ? .5 : undefined });
    if (id !== 'steady' && !isBoardTool(tool) && !['brush', 'paint', 'eraser'].includes(tool)) chooseTool('brush');
  };
  /** The palette sets the drawing colour and recolours the selection: brush strokes by fill, lines by stroke. */
  const pickColour = (hex: string) => {
    setPaint(p => ({ ...p, color: hex })); setRecentColours(r => [hex, ...r.filter(c => c !== hex)].slice(0, 10));
    if (chosen.length && !disabled) replace(chosen.map(p => p.strokeEnabled === false ? { ...p, fill: hex, fillGradient: undefined } : { ...p, color: hex }));
  };
  /** Fill and eyedropper on a pixel layer work on its pixels. Fill is bounded by the page, or by everything drawn on an infinite canvas. */
  const pixelPoint = (which: 'fill' | 'eyedropper', at: [number, number]) => {
    if (which === 'fill') { const clip = selectionRef.current; editPixels(layer.id, [], current => fillPixels(current, at, paint.color, selectArea, 32, clip)); return; }
    void samplePixel(layer.pixels, at).then(hex => { if (hex) pickColour(hex); setNotice(hex ? `Picked ${hex}.` : 'Nothing is painted there on this layer.'); }).catch(() => setNotice('The colour could not be read.'));
  };
  const undo = () => { setEpoch(e => e + 1); history.undo(); }, redo = () => { setEpoch(e => e + 1); history.redo(); };
  const agentInteraction=useAgentInteraction({contextKey:`${documentIdentity}:${persistence.file?.id??draftID.current}:${location.search}`,doc,
    writable:!(isLocalDocument()||isStudioHosted())||(persistence.ready&&persistence.file?.writable!==false),commit,
    canUndo:history.canUndo,canRedo:history.canRedo,undo,redo,
    select:(id,ids)=>{setLayerID(id);setSelected(ids);setNode(null);setInsideID(null);setContour(0);setTool('select');setEpoch(e=>e+1);},
  });
  useContextCommands([
    { id:'undo', label:'Undo', heading:'Edit', shortcut:'Mod+Z', disabled:!(history.canUndo), run:undo },
    { id:'redo', label:'Redo', shortcut:'Mod+Shift+Z', disabled:!(history.canRedo), run:redo },
  ]);

  useEffect(() => { if (insideID && !layer.paths.some(p => p.id === insideID && p.closed)) setInsideID(null); }, [insideID, layer]);
  useEffect(() => {
    if (!recoveryKey) { setRecoveryStatus('Local recovery unavailable — use Save'); return; }
    const id=draftID.current;
    const save = () => {
      let tabSaved=false;
      try { saveRecovery(sessionStorage,recoveryKey,{doc,name});tabSaved=true; } catch { /* IndexedDB can still save documents larger than session storage. */ }
      if(!doc.layers.some(l=>l.paths.length||l.pixels)) {setRecoveryStatus(tabSaved?'Empty draft saved in this tab':'Draft recovery failed — use Save');return;}
      void writeDraft({id,scope:recoveryKey,doc,name,updated:Date.now()}).then(()=>setRecoveryStatus('Draft saved locally')).catch(()=>setRecoveryStatus(tabSaved?'Draft saved in this tab; durable storage unavailable':'Draft recovery failed — use Save to keep your drawing'));
    };
    flushRecovery.current=save;
    setRecoveryStatus('Saving draft…'); const timer = setTimeout(save, 300);
    const hide = () => { if(document.visibilityState === 'hidden') save(); };
    window.addEventListener('pagehide',save); document.addEventListener('visibilitychange',hide);
    return () => { clearTimeout(timer); window.removeEventListener('pagehide',save); document.removeEventListener('visibilitychange',hide); };
  }, [doc,name,recoveryKey]);
  useEffect(() => { if(contour > (chosen[0]?.subpaths?.length ?? 0)) setContour(0); }, [contour,chosen]);
  const download = (text: string, filename: string, mime: string) => {
    const url = URL.createObjectURL(new Blob([text], { type: mime })), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  /** Open formats only: SVG (Inkscape layers), PDF, PNG, JPEG, WebP and OpenRaster (GIMP, Krita). */
  const exportAs = async (format: typeof EXPORTS[number]) => {
    try {
      const data = format.id === 'export' ? new Blob([drawingSVG(doc)], { type: format.mime }) : format.id === 'export-pdf' ? new Blob([drawingPDF(doc) as BlobPart], { type: format.mime })
        : format.id === 'export-ora' ? new Blob([await drawingOpenRaster(doc) as BlobPart], { type: format.mime }) : await rasterBlob(doc, format.mime as 'image/png' | 'image/jpeg' | 'image/webp');
      const url = URL.createObjectURL(data), a = document.createElement('a'); a.href = url; a.download = `${name}.${format.extension}`; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(format.id === 'export-pdf' && doc.layers.some(l => l.visible && (l.pixels || l.adjust || hasEffects(l.effects))) ? 'Exported as PDF without pixel layers, layer effects or adjustments: PDF export is vector only for now. PNG and OpenRaster include them.'
        : `${doc.infinite ? 'Drawing' : 'Artboard'} exported as ${format.extension.toUpperCase()}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Export failed.'); }
  };
  const save = () => { const text = documentText; download(text, `${name}.aethersketch`, 'application/json'); setSaved(text); setNotice('Drawing downloaded.'); };
  const editCommand = (id: string) => {
    const format = EXPORTS.find(f => f.id === id); if (format) { void exportAs(format); return; }
    const sample = SAMPLES.find(x => x.id === id); if (sample) { openSample(sample); return; }
    if (id === 'artboard') { commit(d => ({ ...d, infinite: !d.infinite })); return; }
    if (id === 'select-mask') { void maskOutsideSelection(); return; }
    if (id === 'select-all') { pixelSelect.all(); return; } if (id === 'select-none') { pixelSelect.none(); return; }
    if (id === 'select-invert') { pixelSelect.invert(); return; } if (id === 'select-clear') { pixelSelect.clear(); return; }
    if (id.startsWith('pixel-')) { void turnPixels(id); return; }
    if (id in TOOL_INFO || boardTools.some(t => t.id === id)) { chooseTool(id as AppTool); return; }
    if (id.startsWith('guide-')) { toggleGuide(id.slice(6)); return; }
    if (id === 'image') { imageFile.current?.click(); return; }
    if (id === 'fit') { canvasController.current?.fit(); return; }
    if (id === 'zoom-100') { canvasController.current?.zoomTo(1); return; }
    if (disabled) return;
    const align = ALIGN.find(a => `align-${a.id}` === id), order = ORDER.find(o => `order-${o.id}` === id);
    if (align) replace(alignPaths(chosen, align.id, doc.infinite ? pathBounds(chosen) ?? artboard : artboard));
    if (id === 'distribute-horizontal' || id === 'distribute-vertical') replace(distributePaths(chosen, id === 'distribute-horizontal' ? 'horizontal' : 'vertical'));
    if (id === 'flip-horizontal' || id === 'flip-vertical') replace(flipPaths(chosen, id === 'flip-horizontal' ? 'horizontal' : 'vertical'));
    if (id === 'rotate-90') replace(rotatePaths(chosen, Math.PI / 2));
    if (order) changeLayer(l => orderPaths(l, selected, order.id));
    if (id === 'group') changeLayer(l => groupSelection(l, selected, crypto.randomUUID()));
    if (id === 'ungroup') changeLayer(l => ungroupSelection(l, selected));
    if (id === 'delete') remove();
  };
  const openSample=(sample: typeof SAMPLES[number])=>{void beginDocument(()=>{const next=sample.make();history.open(next);setName(sample.name);setLayerID(next.layers[0].id);setSelected([]);setContour(0);setInsideID(null);setEpoch(e=>e+1);}).catch(e=>setNotice(e.message));};
  const newDrawing=()=>{void beginDocument(()=>{history.open(newDocument());setName('Untitled');setSelected([]);setContour(0);setInsideID(null);setEpoch(e=>e+1);}).catch(e=>setNotice(e.message));};
  const fileActions = <MenuButton label="Document controls" items={[
        {id:'new',label:'New drawing',icon:<AetherIcon name="plus"/>},{id:'open',label:'Open drawing…',icon:<AetherIcon name="folder"/>},
        {id:'import',label:'Import SVG…',icon:<AetherIcon name="import"/>},{id:'save',label:'Save drawing',icon:<AetherIcon name="save"/>},...EXPORTS.map(f=>({id:f.id,label:f.label,icon:<AetherIcon name="export"/>})),
        {id:'undo',label:'Undo',disabled:!history.canUndo,separatorBefore:true},{id:'redo',label:'Redo',disabled:!history.canRedo},
      ]} onSelect={id=>{if(id==='new')newDrawing();else runCommand(id);}}><AetherIcon name="menu"/></MenuButton>;
  const searchCommands = [
    ...DRAW_TOOLS.map(id => ({ id, label: TOOL_INFO[id].label, category: 'Tools', icon: TOOL_INFO[id].icon })),
    ...GUIDES.map(g => ({ id: `guide-${g.id}`, label: g.label, category: 'Guides', icon: g.icon })),
    ...boardTools.map(t => ({ id: t.id, label: t.label, category: 'Board', icon: t.icon })),
    { id: 'image', label: 'Add image or file…', category: 'Board' },
    ...ALIGN.map(a => ({ id: `align-${a.id}`, label: a.label, category: 'Arrange', disabled: !chosen.length })),
    { id: 'distribute-horizontal', label: 'Distribute horizontally', category: 'Arrange', disabled: chosen.length < 3 },
    { id: 'distribute-vertical', label: 'Distribute vertically', category: 'Arrange', disabled: chosen.length < 3 },
    ...ORDER.map(o => ({ id: `order-${o.id}`, label: o.label, category: 'Arrange', disabled: !chosen.length })),
    { id: 'flip-horizontal', label: 'Flip horizontal', category: 'Arrange', disabled: !chosen.length },
    { id: 'flip-vertical', label: 'Flip vertical', category: 'Arrange', disabled: !chosen.length },
    { id: 'rotate-90', label: 'Rotate 90°', category: 'Arrange', disabled: !chosen.length },
    { id: 'group', label: 'Group', category: 'Arrange', disabled: selected.length < 2 }, { id: 'ungroup', label: 'Ungroup', category: 'Arrange' },
    { id: 'select-all', label: 'Select all pixels on this layer', category: 'Select' }, { id: 'select-none', label: 'Deselect pixels', category: 'Select', disabled: !selection },
    { id: 'select-invert', label: 'Invert pixel selection', category: 'Select', disabled: !selection }, { id: 'select-mask', label: 'Mask the layer outside the selection', category: 'Select', disabled: !selection }, { id: 'select-clear', label: 'Clear selected pixels', category: 'Select', disabled: !selection },
    { id: 'fit', label: 'Zoom to fit', category: 'View' }, { id: 'zoom-100', label: 'Zoom to 100%', category: 'View' },
    { id: 'save', label: 'Save drawing', category: 'File' }, ...SAMPLES.map(x => ({ id: x.id, label: x.label, category: 'File' })), ...EXPORTS.map(f => ({ id: f.id, label: f.label, category: 'File' })),
    { id: 'artboard', label: doc.infinite ? 'Use a fixed artboard' : 'Infinite canvas (no artboard)', category: 'View' },
    { id: 'import', label: 'Import SVG…', category: 'File' }, { id: 'undo', label: 'Undo', category: 'Edit', disabled: !history.canUndo }, { id: 'redo', label: 'Redo', category: 'Edit', disabled: !history.canRedo },
  ];
  const runCommand = (id: string) => { if (id === 'open') file.current?.click(); else if (id === 'save') save(); else if (id === 'import') svgFile.current?.click(); else if (id === 'undo') undo(); else if (id === 'redo') redo(); else editCommand(id); };
  const boardKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (e.defaultPrevented || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
    const mod = e.metaKey || e.ctrlKey, key = e.key.toLowerCase();
    const run = (id: string) => { e.preventDefault(); runCommand(id); };
    if (mod && key === '0') run('fit'); else if (mod && key === '1') run('zoom-100');
    else if (mod && (key === '=' || key === '+')) { e.preventDefault(); canvasController.current?.zoomTo(camera.zoom * 1.25); }
    else if (mod && key === '-') { e.preventDefault(); canvasController.current?.zoomTo(camera.zoom / 1.25); }
    else if (mod && e.shiftKey && key === ']') run('order-front'); else if (mod && e.shiftKey && key === '[') run('order-back');
    else if (mod && key === ']') run('order-forward'); else if (mod && key === '[') run('order-backward');
    else if (!mod && !e.altKey && key === 's') run('note'); else if (!mod && !e.altKey && key === 't') run('text');
  };
  useEffect(() => { const t = window.setTimeout(() => canvasController.current?.fit(), 0); return () => window.clearTimeout(t); }, [documentIdentity]);
  const saveState = (isLocalDocument() || isStudioHosted())
    ? (persistence.state.phase === 'saved' ? 'Saved' : persistence.state.phase === 'saving' || persistence.state.phase === 'pending' ? 'Saving…' : persistence.ready ? 'Not saved' : 'Opening…')
    : documentText !== saved ? 'Unsaved changes' : '';
  const drive = isStudioHosted()
    ? <DriveBrowser documentID={persistence.file?.id ?? null} app="sketch" documentNoun="drawing" request={driveRequest} flush={persistence.flush}
        describe={f => ({ icon: <FileIcon icon={fileIcon(f as DriveFile)} />, type: fileType(f as DriveFile) })} onOpen={f => { location.assign(editorURL(f as DriveFile)); }}
        createItems={[{ id: 'sketch', label: 'New drawing…' }]} onCreate={async (_kind, drawingName, destination) => {
          const created = createDocument(drawingName);
          const file = await driveRequest<DriveFile>('create', { ...destination, app: 'sketch', kind: 'file', name: created.name, data_base64: await encodeFile(created) });
          location.assign(editorURL(file));
        }} />
    : <p className="sketch-drive-note">Connect to Aether Studio to browse Drive.</p>;
  return <>
    <input hidden ref={svgFile} type="file" accept=".svg,image/svg+xml" aria-label="Import SVG file" onChange={async e => {
      const input=e.currentTarget, f=input.files?.[0]; if(!f)return;
      try { const imported=importSVG(await f.text());
        commit(d=>({...d,...(!d.layers.some(l=>l.paths.length||l.pixels)?{widthPx:imported.doc.widthPx,heightPx:imported.doc.heightPx}:{}),layers:[...imported.doc.layers,...d.layers]}));
        setLayerID(imported.doc.layers[0].id);select(imported.doc.layers[0].paths.filter(p=>!p.hidden).map(p=>p.id));chooseTool('select');
        setNotice(imported.warnings.length ? `SVG imported. ${imported.warnings.join(' ')}` : 'SVG imported as editable vectors.');
      } catch(error) {setNotice(error instanceof Error?error.message:'SVG import failed.');} input.value='';
    }} />
    <input hidden ref={file} aria-label="Open drawing file" type="file" accept=".aethersketch,application/json" onChange={async e => {
      const input = e.currentTarget, selectedFile = input.files?.[0]; if (!selectedFile) return;
      try {
        if (selectedFile.size > 20_000_000) throw new Error('This drawing exceeds the 20 MB limit.');
        const next = readDocument(await selectedFile.text()); await beginDocument(() => { history.open(next); setInsideID(null); setLayerID(next.layers[0].id); setSelected([]); setNode(null); setEpoch(e => e + 1); });
        setName(selectedFile.name.replace(/\.aethersketch$/i, '')); setSaved(serializeDocument(next)); setNotice('Drawing opened.');
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to open drawing.'); }
      input.value = '';
    }} />
    <input hidden ref={imageFile} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.txt,.csv" aria-label="Add image or file to the board" onChange={e => {
      const input = e.currentTarget, files = [...(input.files ?? [])]; input.value = '';
      if (files.length) { const at = { x: (-camera.x + 160) / camera.zoom, y: (-camera.y + 160) / camera.zoom }; void attach(files, at); }
    }} />
    <SaveRecoveryPanel controller={persistence.guard} loading={!persistence.ready} error={persistence.state.message}/>
    <StandardAppShell className="sketch-app" application={{ apps: applications, id: "sketch", name: "Aether Sketch" }} documentName={`${name}.aethersketch`}
      documentMenu={fileActions}
      documentState={<span className="sketch-recovery-status" data-recovery-status="" role="status">{[saveState, recoveryStatus, notice].filter(Boolean).join(' · ')}</span>}
      headerTrailing={<DraftRecovery scope={recoveryKey} onRestore={draft=>{void beginDocument(()=>{history.open(draft.doc);setName(draft.name);setLayerID(draft.doc.layers[0].id);setSelected([]);setInsideID(null);setContour(0);setEpoch(e=>e+1);}).catch(e=>setNotice(e.message));}}/>}
      commands={searchCommands} onCommand={runCommand} layout={preset} onLayoutChange={setPreset}
      panelState={panelState} onPanelStateChange={state => { setPanelState(state); try { sessionStorage.setItem(PANELS_KEY, JSON.stringify(state)); } catch { /* layout is a convenience */ } }}
      sidebarSizing={{ width: 260, minWidth: 216, maxWidth: 480, minCenterWidth: 240 }}
      toolbar={{ workspaces: (Object.keys(WORKSPACES) as Workspace[]).map(id => ({ id, label: WORKSPACES[id].label, icon: WORKSPACES[id].icon })), workspaceID: workspace,
        onWorkspaceSelect: id => { const next = id as Workspace; setWorkspace(next); setRibbonTab(WORKSPACES[next].tabs[0]); if (!isBoardTool(tool) && !workspaceTools(next).has(tool)) chooseTool('select');
          try { localStorage.setItem(WORKSPACE_KEY, next); } catch { /* a convenience only */ } },
        activeTabID: ribbonTab, onTabSelect: setRibbonTab, onCommand: editCommand, tabs: [
      ...TOOL_TABS.filter(t => t.id !== 'edit' && WORKSPACES[workspace].tabs.includes(t.id)).map(t => ({ ...t, groups: [...t.groups.map(g => ({ ...g, tools: g.tools.map(id => ({ id, ...TOOL_INFO[id], active: tool === id })) })),
        ...(t.id !== 'select' ? [] : [
          { id: 'selection', label: 'Selection', tools: [
            { id: 'select-all', label: 'Select all on this layer (Ctrl/Cmd+A)', icon: <AetherIcon name="square-dashed" />, disabled: layer.kind !== 'pixel' },
            { id: 'select-none', label: 'Deselect (Ctrl/Cmd+D)', icon: <AetherIcon name="close-circle" />, disabled: !selection },
            { id: 'select-invert', label: 'Invert selection', icon: <AetherIcon name="contrast" />, disabled: !selection },
            { id: 'select-clear', label: 'Clear selected pixels (Delete)', icon: <AetherIcon name="delete" />, disabled: !selection || layer.kind !== 'pixel' },
            { id: 'select-mask', label: 'Mask: hide this layer outside the selection', icon: <ToolIcon name="mask" />, disabled: !selection || layerRole === 'mask' },
          ] },
          { id: 'turn', label: 'Flip and rotate', tools: [
            { id: 'pixel-flip-horizontal', label: 'Flip pixels horizontally', icon: <AetherIcon name="flip-horizontal" />, disabled: !layer.pixels },
            { id: 'pixel-flip-vertical', label: 'Flip pixels vertically', icon: <ToolIcon name="mirror" />, disabled: !layer.pixels },
            { id: 'pixel-rotate-90', label: 'Rotate pixels 90°', icon: <ToolIcon name="rotate" />, disabled: !layer.pixels },
          ] }])] })),
      { id: 'edit', label: 'Edit', groups: [
        { id: 'select', label: 'Select', tools: TOOL_TABS[2].groups[0].tools.map(id => ({ id, ...TOOL_INFO[id], active: tool === id })) },
        { id: 'organize', label: 'Group', tools: [
          { id: 'group', label: 'Group', icon: <AetherIcon name="rectangle-group" />, disabled: disabled || selected.length < 2 },
          { id: 'ungroup', label: 'Ungroup', icon: <AetherIcon name="squares-dashed" />, disabled: disabled || !chosen.some(p => p.groupID) },
          { id: 'delete', label: 'Delete path', icon: <AetherIcon name="delete" />, disabled: disabled || !chosen.length },
        ] },
        { id: 'align', label: 'Align', tools: [
          { id: 'align-left', label: 'Align left', icon: <AetherIcon name="align-left" />, disabled: disabled || !chosen.length },
          { id: 'align-center', label: 'Align horizontal centres', icon: <AetherIcon name="arrows-horizontal" />, disabled: disabled || !chosen.length },
          { id: 'align-middle', label: 'Align vertical centres', icon: <AetherIcon name="arrows-vertical" />, disabled: disabled || !chosen.length },
        ], menuItems: [...ALIGN.map(a => ({ id: `align-${a.id}`, label: a.label, disabled: disabled || !chosen.length })),
          { id: 'distribute-horizontal', label: 'Distribute horizontally', separatorBefore: true, disabled: disabled || chosen.length < 3 },
          { id: 'distribute-vertical', label: 'Distribute vertically', disabled: disabled || chosen.length < 3 }] },
        { id: 'order', label: 'Order', tools: [
          { id: 'order-front', label: 'Bring to front', icon: <AetherIcon name="arrow-up-to-line" />, disabled: disabled || !chosen.length },
          { id: 'order-back', label: 'Send to back', icon: <AetherIcon name="arrow-down" />, disabled: disabled || !chosen.length },
        ], menuItems: ORDER.map(o => ({ id: `order-${o.id}`, label: o.label, disabled: disabled || !chosen.length })) },
        { id: 'transform', label: 'Transform', tools: [
          { id: 'flip-horizontal', label: 'Flip horizontal', icon: <AetherIcon name="flip-horizontal" />, disabled: disabled || !chosen.length },
          { id: 'flip-vertical', label: 'Flip vertical', icon: <ToolIcon name="mirror" />, disabled: disabled || !chosen.length },
          { id: 'rotate-90', label: 'Rotate 90°', icon: <ToolIcon name="rotate" />, disabled: disabled || !chosen.length },
        ] },
      ] },
    ] }}
      tree={{ title: 'Layers', icon: <AetherIcon name="layers" />, content: <LayersPanel pixel={workspace === 'pixel'} doc={doc} layer={layer} selected={selected} boardSelection={boardSelection} onSelectBoard={selectBoard}
        onDeleteBoard={ids => { changeBoard(board.filter(i => !ids.includes(i.id) && !(i.kind === 'connector' && (ids.includes(i.from ?? '') || ids.includes(i.to ?? ''))))); setBoardSelection([]); }}
        onSelect={(id, ids) => { if (id !== layer.id) setInsideID(null); setLayerID(id); setSelected(ids); setNode(null); }} commit={commit} onMergeDown={mergeLayerDown} /> }}
      advisor={<WorkspaceAgent service={studioAgentService} app="sketch" interaction={agentInteraction} contextText={`Drawing ${name}. Use inspect to read the open drawing and its current layer/shape IDs.`} detail={name} messages={agentMessages} onMessages={setAgentMessages}/>}
      connection={documentConnection} historyTabStorageKey="aether-sketch.history-tab" history={<SketchHistoryPanel history={{...history, goTo: index => { setEpoch(e => e + 1); history.goTo(index); setSelected([]); setNode(null); setInsideID(null); }}} writable={persistence.file?.writable !== false}/>}
      files={{ local: { label: 'This drawing', icon: <AetherIcon name="file-sketch" />, content: <DocumentTabBrowser title="Drawing contents" rootLabel={`${name}.aethersketch`} label="Drawing"
          tabs={[{ id: 'drawing', label: name, detail: `Aether Sketch · ${doc.layers.length} layer${doc.layers.length === 1 ? '' : 's'}${board.length ? ` · ${board.length} board item${board.length === 1 ? '' : 's'}` : ''}`, icon: <AetherIcon name="file-sketch" />, current: true }]}
          onAdd={newDrawing} onReorder={() => {}} onDetach={() => {}} /> }, drive, onFiles: files => void attach(files, { x: (-camera.x + 160) / camera.zoom, y: (-camera.y + 160) / camera.zoom }) }}
      objectTabs={{
        inspector: <SelectionInspector paths={chosen} board={chosenBoard} layer={layer} />,
        properties: <div className="sketch-properties">{chosenBoard.length > 0 && <BoardInspector items={chosenBoard} onChange={next => changeBoard(board.map(i => next.find(n => n.id === i.id) ?? i))}
          onDelete={() => { changeBoard(board.filter(i => !boardSelection.includes(i.id) && !(i.kind === 'connector' && (boardSelection.includes(i.from ?? '') || boardSelection.includes(i.to ?? ''))))); setBoardSelection([]); }} />}
        <div className="sketch-tool-settings">{chosen.length===1 && chosen[0].text && <TextInspector path={chosen[0]} disabled={disabled} onChange={p=>replace([p])} />}<GuidePanel guides={guides} onChange={setGuides} /><strong>{isBoardTool(tool) ? boardTools.find(t => t.id === tool)?.label : TOOL_INFO[tool].label.replace(/ \(.*\)$/, '')}</strong>
          {tool === 'brush' && <BrushPanel pixel={workspace === 'pixel'} style={brush.style} presetID={brushPreset} color={paint.color} onChange={(style, id) => { setBrush(b => ({ ...b, style })); setBrushPreset(id); }} />}
          {tool === 'smudge' && <><FieldRow label="Size"><Slider min={4} max={300} value={brush.smudgePx} unit="px" onChange={smudgePx => setBrush(b => ({ ...b, smudgePx }))} ariaLabel="Smudge size" /></FieldRow>
            <FieldRow label="Strength"><Slider min={5} max={95} value={Math.round(brush.smudge * 100)} unit="%" onChange={v => setBrush(b => ({ ...b, smudge: v / 100 }))} ariaLabel="Smudge strength" /></FieldRow></>}
          {(tool.startsWith('marquee') || tool === 'wand') && <FieldRow label="Mode"><SelectField aria-label="Selection mode" value={selectMode} options={SELECT_MODES} onChange={event => setSelectMode(event.target.value as SelectMode)} /></FieldRow>}
          {tool === 'wand' && <FieldRow label="Tolerance"><Slider min={0} max={255} value={wandTolerance} onChange={setWandTolerance} ariaLabel="Magic wand tolerance" /></FieldRow>}
          {tool === 'shape' && <><div className="sketch-brush-grid" role="group" aria-label="Shape library">
              {SHAPES.map(kind => <button key={kind.id} type="button" className="sketch-brush-preset" aria-pressed={kind.id === shapeKind.id} title={kind.name} onClick={() => setShapeID(kind.id)}>
                <svg viewBox="0 0 28 28" aria-hidden="true"><path d={pathData({ ...makeShape(kind.id, { x: 3, y: 3, width: 22, height: 22 }, shapeAmounts[kind.id]), closed: true })} fill="currentColor" fillRule="evenodd" /></svg><span>{kind.name}</span></button>)}
            </div>
            {shapeKind.amount && <FieldRow label={shapeKind.amount.label}><Slider min={shapeKind.amount.min} max={shapeKind.amount.max} step={shapeKind.amount.step} unit={shapeKind.amount.unit} value={shapeAmount} onChange={value => setShapeAmounts(a => ({ ...a, [shapeKind.id]: value }))} ariaLabel={shapeKind.amount.label} /></FieldRow>}</>}
          {tool === 'corner' && <><FieldRow label="Radius"><NumberField aria-label="Corner radius" value={corner.radius} min={.1} max={10000} unit="px" onCommit={radius => setCorner(c => ({ ...c, radius }))} /></FieldRow>
            <FieldRow label="Corner"><SelectField aria-label="Corner style" value={corner.style} options={[{ value: 'round', label: 'Rounded' }, { value: 'straight', label: 'Straight (chamfer)' }]} onChange={event => setCorner(c => ({ ...c, style: event.target.value as CornerStyle }))} /></FieldRow>
            <Button disabled={disabled || !chosen.some(p => !p.text)} onClick={() => replace(chosen.map(p => p.text ? p : roundAllCorners(p, corner.radius, corner.style)))}>Apply to every corner</Button></>}
          {tool === 'eraser' && <FieldRow label="Size"><Slider min={2} max={400} value={brush.eraserPx} unit="px" onChange={eraserPx => setBrush(b => ({ ...b, eraserPx }))} ariaLabel="Eraser size" /></FieldRow>}
          {(tool === 'polygon' || tool === 'star') && <FieldRow label="Points"><Slider min={3} max={32} value={sides} onChange={setSides} ariaLabel="Polygon sides" /></FieldRow>}
          <details className="sketch-tool-help"><summary>Tool tips</summary><p>{tool === 'shape' ? 'Pick a shape, then drag a box to draw it; Shift keeps it square. Set its one option first. The result is an ordinary path you can edit with nodes.'
            : tool === 'corner' ? 'Select a path, then drag one of its corner dots: the further you drag, the larger the radius; Shift rounds every corner alike. Or type a radius and apply it to every corner. Corners between curved edges are left alone.'
            : tool === 'knife' ? 'Drag a straight line across paths to cut them. Closed shapes split into closed pieces where the line passes all the way through; open paths split where it crosses. With paths selected, only those are cut.'
            : tool === 'transform' ? 'Drag inside the selection to move its pixels; Alt-drag moves a copy. Drag a handle to scale (Shift keeps the proportions), the round handle to rotate, or a side handle with Ctrl or Cmd to skew. Arrow keys nudge. With nothing selected, everything painted on the layer moves.'
            : tool === 'wand' ? 'Click to select the connected area of similar colour on this pixel layer. Tolerance is how different a colour may be. Shift adds, Alt subtracts.'
            : tool === 'marquee-polygon' ? 'Click each corner; click the first corner, double-click or press Enter to finish. Painting, erasing and filling then stay inside the selection.'
            : tool.startsWith('marquee') ? 'Drag to select. Hold Shift as you start to add, Alt to subtract, both to intersect. Painting, erasing and filling then stay inside the selection; Delete clears it; Ctrl or Cmd+D deselects.'
            : tool === 'smudge' ? 'Drag to push paint around on a pixel layer. Size is on screen; strength is how far the paint carries.' : tool === 'brush' && workspace === 'pixel' ? 'Paints pixels as you draw. Pressure from a pen, or speed from a mouse, sets the width. Flow is how much paint each stamp lays down; opacity caps the whole stroke; grain lets paper texture show through.' : tool === 'brush' ? 'Pressure from a pen, or speed from a mouse, sets the width. Size is on screen, so zoom in to draw finer detail. Each stroke is a filled shape.' : tool === 'eraser' ? 'Cuts through closed shapes and brush strokes on this layer. Size is on screen. Open pencil lines are not erased; use Trim.' : tool === 'pen' ? 'Click corners; drag handles. Enter finishes an open path; click the first point or Shift+Enter closes it.' : tool === 'trim' ? 'Click a section between crossings to trim it. Without crossings, the clicked edge is removed.' : tool === 'node' ? 'Drag nodes or handles. Double-click an edge to add a point. Alt breaks linked handles.' : 'Shift adds to selection or constrains a drag. Drag empty space to select several paths.'}</p></details></div>
        <div className="sketch-layer-settings"><strong>Layer · {layer.name}</strong>
          <FieldRow label="Opacity"><Slider min={0} max={100} unit="%" value={Math.round((layer.opacity ?? 1) * 100)} disabled={layer.locked} ariaLabel="Layer opacity"
            onChange={value => changeLayer(l => ({ ...l, opacity: value / 100 }))} /></FieldRow>
          <FieldRow label="Blend"><SelectField aria-label="Layer blend mode" value={layer.blend ?? 'normal'} disabled={layer.locked} options={BLEND_MODES.map(value => ({ value, label: value.replace('-', ' ') }))}
            onChange={event => { const blend = event.target.value as BlendMode; changeLayer(l => ({ ...l, blend: blend === 'normal' ? undefined : blend })); }} /></FieldRow>
          <LayerRoleFields layer={layer} role={layerRole} hasBelow={doc.layers.at(-1)?.id !== layer.id} onChange={changeLayer} /></div></div>,
        appearance: <div className="sketch-properties"><ColourPanel value={paint.color} recent={recentColours} onPick={pickColour} /><VectorPaintPanel value={chosen[0] ? copyPaint(chosen[0]) : paint} disabled={disabled} selected={chosen.length === 1 ? chosen[0] : undefined}
            inside={!!insideID} onInside={() => { setInsideID(insideID ? null : chosen[0]?.id ?? null); chooseTool('paint'); }}
            onChange={patch => { setPaint(p => ({ ...p, ...patch })); setStyle(patch); }}
            canRelease={chosen.some(p => ancestors(layer, p.groupID).some(g => g.clipPathID))}
            onRelease={() => { const ids = new Set(chosen.flatMap(p => ancestors(layer, p.groupID).filter(g => g.clipPathID).map(g => g.id))); changeLayer(l => ({ ...l, groups: l.groups?.map(g => ids.has(g.id) ? { ...g, clipPathID: undefined } : g) })); setInsideID(null); }} /></div>,
        transform: <div className="sketch-properties"><VectorInspector contour={contour} paths={chosen} node={node} disabled={disabled} onReplace={replace} onSplice={splice} onAdd={add} onDuplicate={() => { const next = duplicatePaintSelection(layer, selected); changeLayer(() => next.layer); setSelected(next.selected); }} onSelect={select} snap={snap} onSnap={setSnap} /></div>,
        effects: <div className="sketch-properties"><RegionInspector paths={chosen} disabled={disabled} onSplice={splice} onSelect={select} contour={contour} onContour={index=>{setContour(index);setNode(null);chooseTool('node');}} /><LayerEffectsPanel layer={layer} onChange={changeLayer} /></div>,
      }}
      centerTray={{ onAction: runCommand,
        tools: [{ id: 'undo', label: 'Undo', icon: <AetherIcon name="undo" />, disabled: !history.canUndo }, { id: 'redo', label: 'Redo', icon: <AetherIcon name="redo" />, disabled: !history.canRedo }],
        toggles: GUIDES.map(g => ({ id: `guide-${g.id}`, label: g.label, icon: g.icon, pressed: g.id === 'steady' ? guides.steady !== undefined : !!guides[g.id] })),
        windowCommands: [{ id: 'open', label: 'Open drawing…', icon: <AetherIcon name="open" /> }, ...SAMPLES.map(x => ({ id: x.id, label: x.label, icon: <AetherIcon name="sparkles" /> })), { id: 'import', label: 'Import SVG…', icon: <AetherIcon name="import" /> },
          { id: 'image', label: 'Add image or file…', icon: <AetherIcon name="image" /> }, ...EXPORTS.map(f => ({ id: f.id, label: f.label, icon: <AetherIcon name="export" /> }))] }}
      environment={{ onSelect: id => { if (id === 'grid') setBoardGrid(v => !v); else if (id === 'connectors') setBoardConnectors(v => !v); else if (id === 'snap') setSnap(s => ({ ...s, enabled: !s.enabled })); else runCommand(id); },
        actions: [{ id: 'board', label: 'Board: notes, text boxes, tables, connectors, images', icon: <AetherIcon name="notes" />, pressed: isBoardTool(tool),
            items: [...boardTools.map(t => ({ id: t.id, label: t.label, icon: t.icon })), { id: 'image', label: 'Image or file…', icon: <AetherIcon name="image" /> }] },
          { id: 'fit', label: 'Zoom to fit', icon: <AetherIcon name="fit" /> }, { id: 'zoom-100', label: 'Zoom to 100%', icon: <AetherIcon name="zoom-in" /> },
          { id: 'grid', label: 'Dot grid', icon: <AetherIcon name="grid-dots" />, pressed: boardGrid }, { id: 'connectors', label: 'Show connectors', icon: <ToolIcon name="connector" />, pressed: boardConnectors },
          { id: 'snap', label: 'Snapping', icon: <AetherIcon name="timeline-snap" />, pressed: snap.enabled },
          { id: 'artboard', label: 'Artboard', icon: <AetherIcon name="rectangle-dashed" />, pressed: !doc.infinite }] }}>
      <div className="sketch-board" onKeyDown={boardKeys}>
        <FreeformCanvas aria-label="Sketch board" hud={false} zoomLimits={ZOOM_LIMITS} showGrid={boardGrid} showConnectors={boardConnectors} items={board} onChange={changeBoard} camera={camera} onCameraChange={setCamera}
          selection={boardSelection} onSelectionChange={selectBoard} onUndo={undo} onRedo={redo} tools={[]} controllerRef={canvasController}
          tool={isBoardTool(tool) ? CANVAS_TOOL[tool] : tool === 'select' || tool === 'hand' || tool === 'zoom' ? tool : `vector:${tool}`} hostTools={HOST_TOOLS}
          onToolChange={next => { if (next === 'select') chooseTool('select'); }} onAttachFiles={files => void attach(files, { x: (-camera.x + 160) / camera.zoom, y: (-camera.y + 160) / camera.zoom })}
          contentBounds={contentBounds} createId={() => crypto.randomUUID()}
          layer={<SketchCanvas contour={contour} resetKey={`${layer.id}:${tool}:${epoch}`} doc={doc} layer={layer} tool={isBoardTool(tool) ? 'select' : tool} onTool={chooseTool} paint={paint} polygonSides={sides} brush={brush} drawGuides={guides} onDrawGuides={setGuides}
        selected={selected} onSelect={select} node={node} onNode={setNode} snap={snap} onAdd={path => add(guides.symmetry ? [path, ...symmetryCopies(path, guides.symmetry).map(copy => ({ ...copy, id: crypto.randomUUID() }))] : [path])} onSplice={splice}
        makeShape={box => makeShape(shapeKind.id, box, shapeAmount)} cornerStyle={corner.style} onKnife={knife} select={pixelSelect} pending={pending} onErasePixels={erasePixels} onPixelPoint={pixelPoint} joinPaths={workspace === 'vector'} pixelBrush={workspace === 'pixel'} onPaintStroke={paintStroke}
        openPixels={() => pixelQueue.current.then(() => docRef.current.layers.find(l => l.id === layer.id)?.pixels)} onSmudged={(layerID, stroke) => editPixels(layerID, [], async () => ({ bitmap: await stroke.encode() }))}
        onPickPaint={p => { setPaint(copyPaint(p)); setSelected([]); setNotice("Appearance picked. Choose Fill shape or draw with it."); }} onFill={target => changeLayer(l => l.locked || !l.visible ? l : { ...l, paths: l.paths.map(p => p.id === target.id && p.closed && !pathLocked(l, p) && pathVisible(l, p) ? { ...p, fill: paint.fill, fillGradient: paint.fillGradient, fillOpacity: paint.fillOpacity } : p) })} onReplace={replace} onDelete={remove} undo={undo} redo={redo} />} />
      </div>
    </StandardAppShell>
    <SaveRecoveryPanel controller={persistence.guard} loading={!persistence.ready} error={persistence.state.message}/>
  </>;
}
