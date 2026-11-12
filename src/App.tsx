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
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { DriveBrowser, DocumentTabBrowser, FileIcon, StandardAppShell, FreeformCanvas, type FreeformCamera, type FreeformCanvasController, type FreeformChange, type FreeformItem, type FreeformPoint, type WorkspacePanelState } from '@aether/ui';
import { pathBounds } from '@aether/sketch';
import { alignPaths, distributePaths, flipPaths, orderPaths, rotatePaths, type AlignMode, type OrderMode } from './arrange';
import { BoardInspector } from './BoardInspector';
import { SelectionInspector } from './SelectionInspector';
import { createDocument } from './create-document';
import { driveRequest, editorURL, encodeFile, fileIcon, fileType, type DriveFile } from '@aether/session/library/drive-api';
import { STICKY_COLORS } from './board';
import { AetherIcon, SelectField, ToolIcon, Slider, MenuButton } from '@aether/ui';
import { SketchCanvas, type BrushSettings, type EditorTool } from './SketchCanvas';
import { VectorInspector, type NodeSelection, type SnapSettings } from './VectorInspector';
import { VectorPaintPanel } from './VectorPaintPanel';
import { addInside, duplicatePaintSelection, copyPaint, defaultPaint, drawingSVG, repairClips, type PaintStyle } from './paint';
import { drawingOpenRaster, drawingPDF, rasterBlob } from './export';
import { BRUSH_PRESETS } from './brush';
import { BrushPanel } from './BrushPanel';
import { SAMPLES } from './sample';
import { ColourPanel } from './ColourPanel';
import { GuidePanel } from './GuidePanel';
import { symmetryCopies, type Guides } from './guides';
import { ancestors } from './structure';
import { LayersPanel } from './LayersPanel';
import { groupSelection, ungroupSelection, pathLocked, pathVisible } from './structure';
import { BLEND_MODES, readDocument, serializeDocument, newDocument, type BlendMode, type DrawingPath, type Layer } from './document';
import { useDocument } from './useDocument';
import './sketch.css';
/** Every drawing tool, with a name and a recognisable icon. Keys: V select, H hand, Z zoom, B brush, Shift+B pencil,
 * Shift+E eraser, N lasso fill, P pen, L line, M rectangle, E ellipse, G polygon, A edit nodes, Q lasso select. */
// ponytail: the eraser borrows the shared "remove" tool icon until core/assets gains an eraser.
const TOOL_INFO: Record<EditorTool, { label: string; icon: ReactNode }> = {
  select: { label: 'Select and transform (V)', icon: <ToolIcon name="select" /> }, hand: { label: 'Hand: pan (H, or hold Space)', icon: <AetherIcon name="hand" /> },
  zoom: { label: 'Zoom: click in, Alt-click out (Z)', icon: <AetherIcon name="zoom-in" /> },
  brush: { label: 'Brush (B)', icon: <AetherIcon name="brush" /> }, paint: { label: 'Pencil (Shift+B)', icon: <AetherIcon name="pencil" /> }, eraser: { label: 'Eraser (Shift+E)', icon: <ToolIcon name="remove" /> },
  fill: { label: 'Fill a shape', icon: <ToolIcon name="fill" /> }, freehand: { label: 'Lasso fill (N)', icon: <AetherIcon name="scribble" /> }, eyedropper: { label: 'Eyedropper: pick a colour and style', icon: <ToolIcon name="eye" /> },
  line: { label: 'Line (L)', icon: <ToolIcon name="line" /> }, pen: { label: 'Pen: Bézier curves (P)', icon: <ToolIcon name="pen" /> },
  rect: { label: 'Rectangle (M)', icon: <ToolIcon name="rectangle" /> }, square: { label: 'Square', icon: <ToolIcon name="rectangle" /> },
  ellipse: { label: 'Ellipse (E)', icon: <AetherIcon name="circle" /> }, circle: { label: 'Circle', icon: <AetherIcon name="circle" /> },
  polygon: { label: 'Polygon (G)', icon: <AetherIcon name="hexagon" /> }, star: { label: 'Star', icon: <AetherIcon name="star" /> }, text: { label: 'Text (T)', icon: <AetherIcon name="text" /> },
  lasso: { label: 'Lasso select (Q)', icon: <AetherIcon name="lasso" /> }, node: { label: 'Edit nodes (A)', icon: <AetherIcon name="node-select" /> }, trim: { label: 'Trim at crossings', icon: <AetherIcon name="scissors" /> },
};
/** The tool bar's tabs: drawing first, then shapes, then editing. Guides live in the center tray, board items in the environment tray. */
const TOOL_TABS: { id: string; label: string; groups: { id: string; label: string; tools: EditorTool[] }[] }[] = [
  { id: 'draw', label: 'Draw', groups: [{ id: 'navigate', label: 'Navigate', tools: ['select', 'hand', 'zoom'] }, { id: 'brushes', label: 'Brushes', tools: ['brush', 'paint', 'eraser'] },
    { id: 'colour', label: 'Fill and colour', tools: ['fill', 'freehand', 'eyedropper'] }] },
  { id: 'shapes', label: 'Shapes', groups: [{ id: 'lines', label: 'Lines', tools: ['line', 'pen'] }, { id: 'shapes', label: 'Shapes', tools: ['rect', 'ellipse', 'polygon', 'star'] }, { id: 'text', label: 'Text', tools: ['text'] }] },
  { id: 'edit', label: 'Edit', groups: [{ id: 'select', label: 'Select', tools: ['select', 'lasso', 'node', 'trim'] }] },
];
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
  const [ribbonTab, setRibbonTab] = useState('draw'), canvasController = useRef<FreeformCanvasController>(null), imageFile = useRef<HTMLInputElement>(null);
  const [panelState, setPanelState] = useState<WorkspacePanelState>(() => { try { const v: unknown = JSON.parse(sessionStorage.getItem(PANELS_KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length ? v as WorkspacePanelState : DEFAULT_PANELS; } catch { return DEFAULT_PANELS; } });
  const [paint, setPaint] = useState<PaintStyle>(defaultPaint), [insideID, setInsideID] = useState<string | null>(null);
  const [contour, setContour] = useState(0), [recoveryStatus, setRecoveryStatus] = useState(initial ? 'Recovered local draft' : '');
  const draftID = useRef(crypto.randomUUID()), flushRecovery = useRef<() => void>(()=>{});
  const svgFile = useRef<HTMLInputElement>(null);
  const [sides, setSides] = useState(6), [brush, setBrush] = useState<BrushSettings>(() => { const { id: _i, name: _n, group: _g, ...style } = BRUSH_PRESETS.find(b => b.id === 'ink-pen')!; return { style, eraserPx: 32 }; });
  const [brushPreset, setBrushPreset] = useState<string | null>('ink-pen'), [guides, setGuides] = useState<Guides>({}), [recentColours, setRecentColours] = useState<string[]>([]);
  const [layerID, setLayerID] = useState(doc.layers[0].id), [selected, setSelected] = useState<string[]>([]), [node, setNode] = useState<NodeSelection | null>(null);
  const [notice, setNotice] = useState(''), [name, setName] = useState(initial?.name ?? 'Untitled'), [epoch, setEpoch] = useState(0);
  const [snap, setSnap] = useState<SnapSettings>({ enabled: true, grid: false, gridStepPx: 20, distancePx: 8 });
  const [saved, setSaved] = useState(() => serializeDocument(doc));
  const [documentIdentity,setDocumentIdentity]=useState('initial');
  const persistence=useHostedDocument({app:'sketch',identity:documentIdentity,text:serializeDocument(doc),name:`${name}.aethersketch`,onLoad:(text,file)=>{
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
  const drawn = pathBounds(doc.layers.filter(l => l.visible).flatMap(l => l.paths));
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
  const add = (paths: DrawingPath[]) => insideID ? changeLayer(l => addInside(l, insideID, paths, crypto.randomUUID())) : splice([], paths);
  const setStyle = (patch: Partial<DrawingPath>) => { if (!disabled) replace(chosen.map(p => ({ ...p, ...patch }))); };
  const chooseTool = (next: AppTool) => { setTool(next); setNode(null); };
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
      if(!doc.layers.some(l=>l.paths.length)) {setRecoveryStatus(tabSaved?'Empty draft saved in this tab':'Draft recovery failed — use Save');return;}
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
      setNotice(`${doc.infinite ? 'Drawing' : 'Artboard'} exported as ${format.extension.toUpperCase()}.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Export failed.'); }
  };
  const save = () => { const text = serializeDocument(doc); download(text, `${name}.aethersketch`, 'application/json'); setSaved(text); setNotice('Drawing downloaded.'); };
  const editCommand = (id: string) => {
    const format = EXPORTS.find(f => f.id === id); if (format) { void exportAs(format); return; }
    const sample = SAMPLES.find(x => x.id === id); if (sample) { openSample(sample); return; }
    if (id === 'artboard') { commit(d => ({ ...d, infinite: !d.infinite })); return; }
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
      ]} onSelect={id=>{if(id==='new')newDrawing();else if(id==='open')file.current?.click();else if(id==='import')svgFile.current?.click();else if(id==='save')save();else if(id==='undo')undo();else if(id==='redo')redo();}}><AetherIcon name="menu"/></MenuButton>;
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
    : serializeDocument(doc) !== saved ? 'Unsaved changes' : '';
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
        commit(d=>({...d,...(!d.layers.some(l=>l.paths.length)?{widthPx:imported.doc.widthPx,heightPx:imported.doc.heightPx}:{}),layers:[...imported.doc.layers,...d.layers]}));
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
      toolbar={{ workspaces: [{ id: 'vector', label: 'Vector', icon: <AetherIcon name="sketch" /> }], workspaceID: 'vector', onWorkspaceSelect: () => {},
        activeTabID: ribbonTab, onTabSelect: setRibbonTab, onCommand: editCommand, tabs: [
      ...TOOL_TABS.filter(t => t.id !== 'edit').map(t => ({ ...t, groups: t.groups.map(g => ({ ...g, tools: g.tools.map(id => ({ id, ...TOOL_INFO[id], active: tool === id })) })) })),
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
      tree={{ title: 'Layers', icon: <AetherIcon name="layers" />, content: <LayersPanel doc={doc} layer={layer} selected={selected} boardSelection={boardSelection} onSelectBoard={selectBoard}
        onDeleteBoard={ids => { changeBoard(board.filter(i => !ids.includes(i.id) && !(i.kind === 'connector' && (ids.includes(i.from ?? '') || ids.includes(i.to ?? ''))))); setBoardSelection([]); }}
        onSelect={(id, ids) => { if (id !== layer.id) setInsideID(null); setLayerID(id); setSelected(ids); setNode(null); }} commit={commit} /> }}
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
          {tool === 'brush' && <BrushPanel style={brush.style} presetID={brushPreset} color={paint.color} onChange={(style, id) => { setBrush(b => ({ ...b, style })); setBrushPreset(id); }} />}
          {tool === 'eraser' && <FieldRow label="Size"><Slider min={2} max={400} value={brush.eraserPx} unit="px" onChange={eraserPx => setBrush(b => ({ ...b, eraserPx }))} ariaLabel="Eraser size" /></FieldRow>}
          {(tool === 'polygon' || tool === 'star') && <FieldRow label="Points"><Slider min={3} max={32} value={sides} onChange={setSides} ariaLabel="Polygon sides" /></FieldRow>}
          <details className="sketch-tool-help"><summary>Tool tips</summary><p>{tool === 'brush' ? 'Pressure from a pen, or speed from a mouse, sets the width. Size is on screen, so zoom in to draw finer detail. Each stroke is a filled shape.' : tool === 'eraser' ? 'Cuts through closed shapes and brush strokes on this layer. Size is on screen. Open pencil lines are not erased; use Trim.' : tool === 'pen' ? 'Click corners; drag handles. Enter finishes an open path; click the first point or Shift+Enter closes it.' : tool === 'trim' ? 'Click a section between crossings to trim it. Without crossings, the clicked edge is removed.' : tool === 'node' ? 'Drag nodes or handles. Double-click an edge to add a point. Alt breaks linked handles.' : 'Shift adds to selection or constrains a drag. Drag empty space to select several paths.'}</p></details></div>
        <div className="sketch-layer-settings"><strong>Layer · {layer.name}</strong>
          <FieldRow label="Opacity"><Slider min={0} max={100} unit="%" value={Math.round((layer.opacity ?? 1) * 100)} disabled={layer.locked} ariaLabel="Layer opacity"
            onChange={value => changeLayer(l => ({ ...l, opacity: value / 100 }))} /></FieldRow>
          <FieldRow label="Blend"><SelectField aria-label="Layer blend mode" value={layer.blend ?? 'normal'} disabled={layer.locked} options={BLEND_MODES.map(value => ({ value, label: value.replace('-', ' ') }))}
            onChange={event => { const blend = event.target.value as BlendMode; changeLayer(l => ({ ...l, blend: blend === 'normal' ? undefined : blend })); }} /></FieldRow></div></div>,
        appearance: <div className="sketch-properties"><ColourPanel value={paint.color} recent={recentColours} onPick={pickColour} /><VectorPaintPanel value={chosen[0] ? copyPaint(chosen[0]) : paint} disabled={disabled} selected={chosen.length === 1 ? chosen[0] : undefined}
            inside={!!insideID} onInside={() => { setInsideID(insideID ? null : chosen[0]?.id ?? null); chooseTool('paint'); }}
            onChange={patch => { setPaint(p => ({ ...p, ...patch })); setStyle(patch); }}
            canRelease={chosen.some(p => ancestors(layer, p.groupID).some(g => g.clipPathID))}
            onRelease={() => { const ids = new Set(chosen.flatMap(p => ancestors(layer, p.groupID).filter(g => g.clipPathID).map(g => g.id))); changeLayer(l => ({ ...l, groups: l.groups?.map(g => ids.has(g.id) ? { ...g, clipPathID: undefined } : g) })); setInsideID(null); }} /></div>,
        transform: <div className="sketch-properties"><VectorInspector contour={contour} paths={chosen} node={node} disabled={disabled} onReplace={replace} onSplice={splice} onAdd={add} onDuplicate={() => { const next = duplicatePaintSelection(layer, selected); changeLayer(() => next.layer); setSelected(next.selected); }} onSelect={select} snap={snap} onSnap={setSnap} /></div>,
        effects: <div className="sketch-properties"><RegionInspector paths={chosen} disabled={disabled} onSplice={splice} onSelect={select} contour={contour} onContour={index=>{setContour(index);setNode(null);chooseTool('node');}} /></div>,
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
        onPickPaint={p => { setPaint(copyPaint(p)); setSelected([]); setNotice("Appearance picked. Choose Fill shape or draw with it."); }} onFill={target => changeLayer(l => l.locked || !l.visible ? l : { ...l, paths: l.paths.map(p => p.id === target.id && p.closed && !pathLocked(l, p) && pathVisible(l, p) ? { ...p, fill: paint.fill, fillGradient: paint.fillGradient, fillOpacity: paint.fillOpacity } : p) })} onReplace={replace} onDelete={remove} undo={undo} redo={redo} />} />
      </div>
    </StandardAppShell>
    <SaveRecoveryPanel controller={persistence.guard} loading={!persistence.ready} error={persistence.state.message}/>
  </>;
}
