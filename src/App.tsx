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
import { CommandSearch, FreeformCanvas, type FreeformCamera, type FreeformCanvasController, type FreeformChange, type FreeformItem, type FreeformPoint, type WorkspacePanelState } from '@aether/ui';
import { pathBounds } from '@aether/sketch';
import { alignPaths, distributePaths, flipPaths, orderPaths, rotatePaths, type AlignMode, type OrderMode } from './arrange';
import { BoardInspector } from './BoardInspector';
import { STICKY_COLORS } from './board';
import { AetherIcon, ToolIcon, StudioWorkspace as WorkspaceShell, WorkspaceSwitcher, WorkspaceFileBar, standardAuxiliaryPanels, standardWorkspacePanels, WorkspaceRibbon, StudioDocumentBar as DocumentBar,
  Slider, StudioModeButton, WorkspaceWindowMenu, MenuButton, type ToolIconName } from '@aether/ui';
import { SketchCanvas, type EditorTool } from './SketchCanvas';
import { VectorInspector, type NodeSelection, type SnapSettings } from './VectorInspector';
import { VectorPaintPanel } from './VectorPaintPanel';
import { addInside, duplicatePaintSelection, copyPaint, defaultPaint, drawingSVG, repairClips, type PaintStyle } from './paint';
import { ancestors } from './structure';
import { LayersPanel } from './LayersPanel';
import { groupSelection, ungroupSelection, pathLocked, pathVisible } from './structure';
import { readDocument, serializeDocument, newDocument, type DrawingPath, type Layer } from './document';
import { useDocument } from './useDocument';
import './sketch.css';
const tools: { id: EditorTool; label: string; icon: ToolIconName }[] = [
  { id: 'select', label: 'Select', icon: 'select' }, { id: 'node', label: 'Edit nodes', icon: 'pen' },
  { id: 'pen', label: 'Bézier pen', icon: 'curve' }, { id: 'line', label: 'Line', icon: 'line' },
  { id: 'rect', label: 'Rectangle', icon: 'rectangle' }, { id: 'ellipse', label: 'Ellipse', icon: 'ellipse' },
  { id: 'polygon', label: 'Polygon', icon: 'polygon' }, { id: 'paint', label: 'Pencil', icon: 'freehand' },
  { id: 'freehand', label: 'Freehand shape', icon: 'freehand' }, { id: 'trim', label: 'Trim', icon: 'cut' },
  { id: 'text', label: 'Text', icon: 'text' },
  { id: 'fill', label: 'Fill shape', icon: 'fill' }, { id: 'eyedropper', label: 'Pick appearance', icon: 'eye' },
];
type BoardTool = 'note' | 'textbox' | 'table' | 'connector';
type AppTool = EditorTool | BoardTool;
const boardTools: { id: BoardTool; label: string; icon: ReactNode }[] = [
  { id: 'note', label: 'Sticky note', icon: <AetherIcon name="notes" /> }, { id: 'textbox', label: 'Text box', icon: <AetherIcon name="text" /> },
  { id: 'table', label: 'Table', icon: <AetherIcon name="grid-3" /> }, { id: 'connector', label: 'Connector', icon: <ToolIcon name="connector" /> },
];
// Board tools are FreeformCanvas's own; every vector tool except Select is handled by SketchCanvas in the canvas layer.
const CANVAS_TOOL: Record<BoardTool, string> = { note: 'sticky', textbox: 'text', table: 'table', connector: 'connector' };
const HOST_TOOLS = tools.filter(t => t.id !== 'select').map(t => `vector:${t.id}`);
const isBoardTool = (tool: AppTool): tool is BoardTool => tool in CANVAS_TOOL;
const ALIGN: { id: AlignMode; label: string }[] = [{ id: 'left', label: 'Align left' }, { id: 'center', label: 'Align horizontal centres' }, { id: 'right', label: 'Align right' },
  { id: 'top', label: 'Align top' }, { id: 'middle', label: 'Align vertical centres' }, { id: 'bottom', label: 'Align bottom' }];
const ORDER: { id: OrderMode; label: string }[] = [{ id: 'front', label: 'Bring to front' }, { id: 'forward', label: 'Bring forward' }, { id: 'backward', label: 'Send backward' }, { id: 'back', label: 'Send to back' }];
const PANELS_KEY = 'aether-sketch.panels';
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
  const [ribbonTab, setRibbonTab] = useState('draw'), canvasController = useRef<FreeformCanvasController>(null), imageFile = useRef<HTMLInputElement>(null);
  const [panelState, setPanelState] = useState<WorkspacePanelState>(() => { try { const v: unknown = JSON.parse(sessionStorage.getItem(PANELS_KEY) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v as WorkspacePanelState : {}; } catch { return {}; } });
  const [paint, setPaint] = useState<PaintStyle>(defaultPaint), [insideID, setInsideID] = useState<string | null>(null);
  const [contour, setContour] = useState(0), [recoveryStatus, setRecoveryStatus] = useState(initial ? 'Recovered local draft' : '');
  const draftID = useRef(crypto.randomUUID()), flushRecovery = useRef<() => void>(()=>{});
  const svgFile = useRef<HTMLInputElement>(null);
  const [sides, setSides] = useState(6);
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
  const beginDocument=async()=>{
    if((isLocalDocument()||isStudioHosted()))await persistence.flush();
    flushRecovery.current();draftID.current=crypto.randomUUID();
    window.history.replaceState(null,'',location.pathname+(isLocalDocument()?'?editor&storage=local':'?editor'));setDocumentIdentity(crypto.randomUUID());
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
  const contentBounds = drawn ? { x: Math.min(0, drawn.x), y: Math.min(0, drawn.y), width: Math.max(doc.widthPx, drawn.x + drawn.width) - Math.min(0, drawn.x), height: Math.max(doc.heightPx, drawn.y + drawn.height) - Math.min(0, drawn.y) } : artboard;
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
  const exportPNG = async () => {
    const url = URL.createObjectURL(new Blob([drawingSVG(doc)], { type: 'image/svg+xml' })), image = new Image();
    try {
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
      const scale = 2, canvas = document.createElement('canvas'); canvas.width = doc.widthPx * scale; canvas.height = doc.heightPx * scale;
      const context = canvas.getContext('2d'); if (!context) throw new Error('PNG export is unavailable in this browser.');
      context.scale(scale, scale); context.drawImage(image, 0, 0, doc.widthPx, doc.heightPx);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('PNG export failed.');
      const png = URL.createObjectURL(blob), a = document.createElement('a'); a.href = png; a.download = `${name}.png`; a.click(); window.setTimeout(() => URL.revokeObjectURL(png), 1000);
      setNotice('Artboard exported as PNG at 2×.');
    } catch (error) { setNotice(error instanceof Error ? error.message : 'PNG export failed.'); } finally { URL.revokeObjectURL(url); }
  };
  const save = () => { const text = serializeDocument(doc); download(text, `${name}.aethersketch`, 'application/json'); setSaved(text); setNotice('Drawing downloaded.'); };
  const exportSVG = () => {
    download(drawingSVG(doc), `${name}.svg`, 'image/svg+xml'); setNotice('Vector SVG exported.');
  };
  const editCommand = (id: string) => {
    if (tools.some(t => t.id === id) || boardTools.some(t => t.id === id)) { chooseTool(id as AppTool); return; }
    if (id === 'image') { imageFile.current?.click(); return; }
    if (id === 'fit') { canvasController.current?.fit(); return; }
    if (id === 'zoom-100') { canvasController.current?.zoomTo(1); return; }
    if (id === 'export-png') { void exportPNG(); return; }
    if (disabled) return;
    const align = ALIGN.find(a => `align-${a.id}` === id), order = ORDER.find(o => `order-${o.id}` === id);
    if (align) replace(alignPaths(chosen, align.id, artboard));
    if (id === 'distribute-horizontal' || id === 'distribute-vertical') replace(distributePaths(chosen, id === 'distribute-horizontal' ? 'horizontal' : 'vertical'));
    if (id === 'flip-horizontal' || id === 'flip-vertical') replace(flipPaths(chosen, id === 'flip-horizontal' ? 'horizontal' : 'vertical'));
    if (id === 'rotate-90') replace(rotatePaths(chosen, Math.PI / 2));
    if (order) changeLayer(l => orderPaths(l, selected, order.id));
    if (id === 'group') changeLayer(l => groupSelection(l, selected, crypto.randomUUID()));
    if (id === 'ungroup') changeLayer(l => ungroupSelection(l, selected));
    if (id === 'delete') remove();
  };
  const newDrawing=()=>{void beginDocument().then(()=>{history.open(newDocument());setName('Untitled');setSelected([]);setContour(0);setInsideID(null);setEpoch(e=>e+1);}).catch(e=>setNotice(e.message));};
  const fileActions = <MenuButton label="Document controls" items={[
        {id:'new',label:'New drawing',icon:<AetherIcon name="plus"/>},{id:'open',label:'Open drawing…',icon:<AetherIcon name="folder"/>},
        {id:'import',label:'Import SVG…',icon:<AetherIcon name="import"/>},{id:'save',label:'Save drawing',icon:<AetherIcon name="save"/>},{id:'export',label:'Export SVG',icon:<AetherIcon name="export"/>},{id:'export-png',label:'Export PNG (2×)',icon:<AetherIcon name="image"/>},
        {id:'undo',label:'Undo',disabled:!history.canUndo,separatorBefore:true},{id:'redo',label:'Redo',disabled:!history.canRedo},
      ]} onSelect={id=>{if(id==='new')newDrawing();else if(id==='open')file.current?.click();else if(id==='import')svgFile.current?.click();else if(id==='save')save();else if(id==='export')exportSVG();else if(id==='export-png')void exportPNG();else if(id==='undo')undo();else if(id==='redo')redo();}}><AetherIcon name="menu"/></MenuButton>;
  const searchCommands = [
    ...tools.map(t => ({ id: t.id, label: t.label, category: 'Draw', icon: <ToolIcon name={t.icon} /> })),
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
    { id: 'save', label: 'Save drawing', category: 'File' }, { id: 'export', label: 'Export SVG', category: 'File' }, { id: 'export-png', label: 'Export PNG (2×)', category: 'File' },
    { id: 'import', label: 'Import SVG…', category: 'File' }, { id: 'undo', label: 'Undo', category: 'Edit', disabled: !history.canUndo }, { id: 'redo', label: 'Redo', category: 'Edit', disabled: !history.canRedo },
  ];
  const runCommand = (id: string) => { if (id === 'save') save(); else if (id === 'export') exportSVG(); else if (id === 'import') svgFile.current?.click(); else if (id === 'undo') undo(); else if (id === 'redo') redo(); else editCommand(id); };
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
  return <div className="sketch-app aui-studio-app">
    <DocumentBar defaultHeaderPins={["layout","tabs","theme","notifications","comments","apps","share"]}
      search={<CommandSearch commands={searchCommands} onSelect={runCommand} registerShortcut />} application={{ apps: applications, id: "sketch", name: "Aether Sketch" }} documentName={`${name}.aethersketch`}
      documentState={<span className="sketch-recovery-status" data-recovery-status="" role="status">{recoveryStatus}</span>}
      trailing={<DraftRecovery scope={recoveryKey} onRestore={draft=>{void beginDocument().then(()=>{history.open(draft.doc);setName(draft.name);setLayerID(draft.doc.layers[0].id);setSelected([]);setInsideID(null);setContour(0);setEpoch(e=>e+1);}).catch(e=>setNotice(e.message));}}/>} viewControls={<><StudioModeButton preset={preset} onChange={setPreset} /><WorkspaceWindowMenu /></>} />

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
        const next = readDocument(await selectedFile.text()); await beginDocument(); history.open(next); setInsideID(null); setLayerID(next.layers[0].id); setSelected([]); setNode(null); setEpoch(e => e + 1);
        setName(selectedFile.name.replace(/\.aethersketch$/i, '')); setSaved(serializeDocument(next)); setNotice('Drawing opened.');
      } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to open drawing.'); }
      input.value = '';
    }} />
    <input hidden ref={imageFile} type="file" multiple accept="image/png,image/jpeg,image/gif,image/webp,.pdf,.txt,.csv" aria-label="Add image or file to the board" onChange={e => {
      const input = e.currentTarget, files = [...(input.files ?? [])]; input.value = '';
      if (files.length) { const at = { x: (-camera.x + 160) / camera.zoom, y: (-camera.y + 160) / camera.zoom }; void attach(files, at); }
    }} />
    <SaveRecoveryPanel controller={persistence.guard} loading={!persistence.ready} error={persistence.state.message}/>
    <WorkspaceShell workspaceControls={<WorkspaceSwitcher workspaces={[{id:"vector",label:"Vector"}]} workspaceID="vector" onSelect={()=>{}}/>} preset={preset} toolbarSpan={preset === 'docked' ? 'window' : 'center'} toolPosition={preset === 'docked' ? 'top' : 'bottom'} pinnedPanels={['layers']}
      sidebarSizing={{ width: 260, minWidth: 216, maxWidth: 480, minCenterWidth: 240 }} preservePanelContent
      panelState={panelState} onPanelStateChange={state => { setPanelState(state); try { sessionStorage.setItem(PANELS_KEY, JSON.stringify(state)); } catch { /* layout is a convenience */ } }}
      bottom={<WorkspaceFileBar fileActions={fileActions} tabs={[{id:'drawing',label:name,dirty:(isLocalDocument()||isStudioHosted())?persistence.state.phase!=='saved':serializeDocument(doc)!==saved,status:(isLocalDocument()||isStudioHosted())?(persistence.state.phase==='saved'?'Saved':persistence.state.phase==='saving'||persistence.state.phase==='pending'?'Saving…':persistence.ready?'Not saved':'Opening…'):(recoveryStatus||'Unsaved draft'),statusTitle:persistence.state.message,icon:<AetherIcon name="file-sketch"/>}]} activeID="drawing" onSelect={()=>{}} onAdd={newDrawing} addLabel="Create new drawing" trailing={<span className="aui-workspace-file-status" role="status">{notice}</span>}
        manager={{connection:documentConnection,activeID:layer.id,documentGroups:[{id:"layers",label:"Layers",items:doc.layers.map(item=>({id:item.id,name:item.name,kind:"layer",detail:"Layer"}))}],onOpenItem:item=>{setInsideID(null);setLayerID(item.id);setSelected([]);setNode(null);}}}/>}
 toolbar={<WorkspaceRibbon variant={preset === 'docked' ? 'docked' : 'floating'} appearance="glass" workspaceLayout="none"
      workspaces={[]} workspaceID="vector" onWorkspaceSelect={() => {}} activeTabID={ribbonTab} onTabSelect={setRibbonTab} tabs={[
      { id: 'draw', label: 'Draw', groups: [
        { id: 'select', label: 'Select', tools: tools.slice(0, 2).map(t => ({ ...t, icon: <ToolIcon name={t.icon} />, active: tool === t.id })) },
        { id: 'draw', label: 'Draw', tools: tools.slice(2, 7).map(t => ({ ...t, icon: <ToolIcon name={t.icon} />, active: tool === t.id })) },
        { id: 'paths', label: 'Paths', tools: tools.slice(7, 10).map(t => ({ ...t, icon: <ToolIcon name={t.icon} />, active: tool === t.id })) },
        { id: 'paint', label: 'Vector paint', tools: tools.slice(10).map(t => ({ ...t, icon: <ToolIcon name={t.icon} />, active: tool === t.id })) },
      ] },
      { id: 'board', label: 'Board', groups: [
        { id: 'select', label: 'Select', tools: [{ ...tools[0], icon: <ToolIcon name={tools[0].icon} />, active: tool === 'select' }] },
        { id: 'notes', label: 'Notes', tools: boardTools.map(t => ({ ...t, active: tool === t.id })) },
        { id: 'media', label: 'Media', tools: [{ id: 'image', label: 'Image or file', icon: <AetherIcon name="image" /> }] },
      ] },
      { id: 'arrange', label: 'Arrange', groups: [
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
    ]} onCommand={editCommand} />} style={{ flex: 1, minHeight: 0 }} defaultOpenLeft={['layers']} defaultOpenRight={['properties']}
      leftPanels={standardAuxiliaryPanels(standardWorkspacePanels([{ id: 'layers', title: 'Layers', icon: <AetherIcon name="layers" />, collection: true, content: <LayersPanel doc={doc} layer={layer} selected={selected}
        onSelect={(id, ids) => { if (id !== layer.id) setInsideID(null); setLayerID(id); setSelected(ids); setNode(null); }} commit={commit} /> },
      {id:'advisor',title:'AI advisor',icon:null,content:<WorkspaceAgent service={studioAgentService} app="sketch" interaction={agentInteraction} contextText={`Drawing ${name}. Use inspect to read the open drawing and its current layer/shape IDs.`} detail={name} messages={agentMessages} onMessages={setAgentMessages}/>},
      ], { features: "layers" }, documentConnection, { historyTabStorageKey: "aether-sketch.history-tab", history: <SketchHistoryPanel history={{...history, goTo: index => { setEpoch(e => e + 1); history.goTo(index); setSelected([]); setNode(null); setInsideID(null); }}} writable={persistence.file?.writable !== false}/> }))}
      rightPanels={[{ id: 'properties', title: 'Properties', icon: <AetherIcon name="sliders" />, content: <div className="sketch-properties">
        {chosenBoard.length > 0 && <BoardInspector items={chosenBoard} onChange={next => changeBoard(board.map(i => next.find(n => n.id === i.id) ?? i))}
          onDelete={() => { changeBoard(board.filter(i => !boardSelection.includes(i.id) && !(i.kind === 'connector' && (boardSelection.includes(i.from ?? '') || boardSelection.includes(i.to ?? ''))))); setBoardSelection([]); }} />}
        <div className="sketch-tool-settings">{chosen.length===1 && chosen[0].text && <TextInspector path={chosen[0]} disabled={disabled} onChange={p=>replace([p])} />}<strong>{tools.find(t => t.id === tool)?.label ?? boardTools.find(t => t.id === tool)?.label}</strong>
          <VectorPaintPanel value={chosen[0] ? copyPaint(chosen[0]) : paint} disabled={disabled} selected={chosen.length === 1 ? chosen[0] : undefined}
            inside={!!insideID} onInside={() => { setInsideID(insideID ? null : chosen[0]?.id ?? null); chooseTool('paint'); }}
            onChange={patch => { setPaint(p => ({ ...p, ...patch })); setStyle(patch); }}
            canRelease={chosen.some(p => ancestors(layer, p.groupID).some(g => g.clipPathID))}
            onRelease={() => { const ids = new Set(chosen.flatMap(p => ancestors(layer, p.groupID).filter(g => g.clipPathID).map(g => g.id))); changeLayer(l => ({ ...l, groups: l.groups?.map(g => ids.has(g.id) ? { ...g, clipPathID: undefined } : g) })); setInsideID(null); }} />
          {tool === 'polygon' && <FieldRow label="Sides"><Slider min={3} max={32} value={sides} onChange={setSides} ariaLabel="Polygon sides" /></FieldRow>}
          <details className="sketch-tool-help"><summary>Tool tips</summary><p>{tool === 'pen' ? 'Click corners; drag handles. Enter finishes an open path; click the first point or Shift+Enter closes it.' : tool === 'trim' ? 'Click a section between crossings to trim it. Without crossings, the clicked edge is removed.' : tool === 'node' ? 'Drag nodes or handles. Double-click an edge to add a point. Alt breaks linked handles.' : 'Shift adds to selection or constrains a drag. Drag empty space to select several paths.'}</p></details>
        </div>
        <RegionInspector paths={chosen} disabled={disabled} onSplice={splice} onSelect={select} contour={contour} onContour={index=>{setContour(index);setNode(null);chooseTool('node');}} />
        <VectorInspector contour={contour} paths={chosen} node={node} disabled={disabled} onReplace={replace} onSplice={splice} onAdd={add} onDuplicate={() => { const next = duplicatePaintSelection(layer, selected); changeLayer(() => next.layer); setSelected(next.selected); }} onSelect={select} snap={snap} onSnap={setSnap} />
      </div> }]}
    >
      <div className="sketch-board" onKeyDown={boardKeys}>
        <FreeformCanvas aria-label="Sketch board" items={board} onChange={changeBoard} camera={camera} onCameraChange={setCamera}
          selection={boardSelection} onSelectionChange={selectBoard} onUndo={undo} onRedo={redo} tools={[]} controllerRef={canvasController}
          tool={isBoardTool(tool) ? CANVAS_TOOL[tool] : tool === 'select' ? 'select' : `vector:${tool}`} hostTools={HOST_TOOLS}
          onToolChange={next => { if (next === 'select') chooseTool('select'); }} onAttachFiles={files => void attach(files, { x: (-camera.x + 160) / camera.zoom, y: (-camera.y + 160) / camera.zoom })}
          contentBounds={contentBounds} createId={() => crypto.randomUUID()}
          layer={<SketchCanvas contour={contour} resetKey={`${layer.id}:${tool}:${epoch}`} doc={doc} layer={layer} tool={isBoardTool(tool) ? 'select' : tool} onTool={chooseTool} paint={paint} polygonSides={sides}
        selected={selected} onSelect={select} node={node} onNode={setNode} snap={snap} onAdd={path => add([path])} onSplice={splice}
        onPickPaint={p => { setPaint(copyPaint(p)); setSelected([]); setNotice("Appearance picked. Choose Fill shape or draw with it."); }} onFill={target => changeLayer(l => l.locked || !l.visible ? l : { ...l, paths: l.paths.map(p => p.id === target.id && p.closed && !pathLocked(l, p) && pathVisible(l, p) ? { ...p, fill: paint.fill, fillGradient: paint.fillGradient, fillOpacity: paint.fillOpacity } : p) })} onReplace={replace} onDelete={remove} undo={undo} redo={redo} />} />
      </div>
    </WorkspaceShell>

  </div>;
}
