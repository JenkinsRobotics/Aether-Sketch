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
import { useEffect, useRef, useState } from 'react';
import { AetherIcon, ToolIcon, StudioWorkspace as WorkspaceShell, WorkspaceSwitcher, WorkspaceFileBar, standardWorkspacePanels, WorkspaceRibbon, StudioDocumentBar as DocumentBar,
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
function splicePaths(paths: DrawingPath[], remove: string[], add: DrawingPath[]) {
  const index = paths.findIndex(p => remove.includes(p.id)), remaining = paths.filter(p => !remove.includes(p.id));
  remaining.splice(index < 0 ? remaining.length : index, 0, ...add);
  return remaining;
}
export default function App({ initial, recoveryKey }: { initial?: Recovery; recoveryKey?: string | null }) {
  const applications = useStudioApplications();
  const history = useDocument(initial?.doc), { doc } = history;
  const commit = (change: (doc: typeof history.doc) => typeof history.doc) => history.commit(d => repairClips(change(d)));
  const [agentMessages,setAgentMessages]=useState<AssistantMessage[]>([]);
  const [preset, setPreset] = useState<'docked' | 'floating' | 'canvas'>('floating'), [tool, setTool] = useState<EditorTool>('pen');
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
    if(location.pathname.startsWith('/sketch/'))await persistence.flush();
    flushRecovery.current();draftID.current=crypto.randomUUID();
    window.history.replaceState(null,'',location.pathname);setDocumentIdentity(crypto.randomUUID());
  };
  const file = useRef<HTMLInputElement>(null), layer = doc.layers.find(l => l.id === layerID) ?? doc.layers[0];
  const chosen = layer.paths.filter(p => selected.includes(p.id)), disabled = layer.locked || !layer.visible || chosen.some(p => pathLocked(layer, p) || !pathVisible(layer, p));
  const changeLayer = (change: (l: Layer) => Layer) => commit(d => ({ ...d, layers: d.layers.map(l => l.id === layer.id ? change(l) : l) }));
  const replace = (paths: DrawingPath[]) => !disabled && changeLayer(l => l.locked || !l.visible ? l : { ...l, paths: l.paths.map(p => pathLocked(l, p) || !pathVisible(l, p) ? p : paths.find(v => v.id === p.id) ?? p) });
  const splice = (remove: string[], add: DrawingPath[]) => changeLayer(l => l.locked || !l.visible || l.paths.some(p => remove.includes(p.id) && (pathLocked(l, p) || !pathVisible(l, p))) ? l : { ...l, paths: splicePaths(l.paths, remove, add) });
  const remove = () => { if (!disabled) { splice(selected, []); setSelected([]); setNode(null); } };
  const select = (ids: string[]) => { if(ids.join() !== selected.join()) { setContour(0); setNode(null); } setSelected(ids); };
  const add = (paths: DrawingPath[]) => insideID ? changeLayer(l => addInside(l, insideID, paths, crypto.randomUUID())) : splice([], paths);
  const setStyle = (patch: Partial<DrawingPath>) => { if (!disabled) replace(chosen.map(p => ({ ...p, ...patch }))); };
  const chooseTool = (next: EditorTool) => { setTool(next); setNode(null); };
  const undo = () => { setEpoch(e => e + 1); history.undo(); }, redo = () => { setEpoch(e => e + 1); history.redo(); };
  const agentInteraction=useAgentInteraction({contextKey:`${documentIdentity}:${persistence.file?.id??draftID.current}:${location.search}`,doc,
    writable:!location.pathname.startsWith('/sketch/')||(persistence.ready&&persistence.file?.writable!==false),commit,
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
  const save = () => { const text = serializeDocument(doc); download(text, `${name}.aethersketch`, 'application/json'); setSaved(text); setNotice('Drawing downloaded.'); };
  const exportSVG = () => {
    download(drawingSVG(doc), `${name}.svg`, 'image/svg+xml'); setNotice('Vector SVG exported.');
  };
  const editCommand = (id: string) => {
    if (tools.some(t => t.id === id)) { chooseTool(id as EditorTool); return; }
    if (disabled) return;
    if (id === 'group') changeLayer(l => groupSelection(l, selected, crypto.randomUUID()));
    if (id === 'ungroup') changeLayer(l => ungroupSelection(l, selected));
    if (id === 'delete') remove();
  };
  const newDrawing=()=>{void beginDocument().then(()=>{history.open(newDocument());setName('Untitled');setSelected([]);setContour(0);setInsideID(null);setEpoch(e=>e+1);}).catch(e=>setNotice(e.message));};
  const fileActions = <MenuButton label="Document controls" items={[
        {id:'new',label:'New drawing',icon:<AetherIcon name="plus"/>},{id:'open',label:'Open drawing…',icon:<AetherIcon name="folder"/>},
        {id:'import',label:'Import SVG…',icon:<AetherIcon name="import"/>},{id:'save',label:'Save drawing',icon:<AetherIcon name="save"/>},{id:'export',label:'Export SVG',icon:<AetherIcon name="export"/>},
        {id:'undo',label:'Undo',disabled:!history.canUndo,separatorBefore:true},{id:'redo',label:'Redo',disabled:!history.canRedo},
      ]} onSelect={id=>{if(id==='new')newDrawing();else if(id==='open')file.current?.click();else if(id==='import')svgFile.current?.click();else if(id==='save')save();else if(id==='export')exportSVG();else if(id==='undo')undo();else if(id==='redo')redo();}}><AetherIcon name="menu"/></MenuButton>;
  return <div className="sketch-app aui-studio-app">
    <DocumentBar application={{ apps: applications, id: "sketch", name: "Aether Sketch" }} documentName={`${name}.aethersketch`}
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
    <WorkspaceShell workspaceControls={<WorkspaceSwitcher workspaces={[{id:"vector",label:"Vector"}]} workspaceID="vector" onSelect={()=>{}}/>} preset={preset} toolbarSpan="center" pinnedPanels={['layers']}
      bottom={<WorkspaceFileBar fileActions={fileActions} tabs={[{id:'drawing',label:name,dirty:location.pathname.startsWith('/sketch/')?persistence.state.phase!=='saved':serializeDocument(doc)!==saved,status:location.pathname.startsWith('/sketch/')?(persistence.state.phase==='saved'?'Saved':persistence.state.phase==='saving'||persistence.state.phase==='pending'?'Saving…':persistence.ready?'Not saved':'Opening…'):(recoveryStatus||'Unsaved draft'),statusTitle:persistence.state.message,icon:<AetherIcon name="file-sketch"/>}]} activeID="drawing" onSelect={()=>{}} onAdd={newDrawing} addLabel="Create new drawing" trailing={<span className="aui-workspace-file-status" role="status">{notice}</span>}
        manager={{connection:documentConnection,activeID:layer.id,documentGroups:[{id:"layers",label:"Layers",items:doc.layers.map(item=>({id:item.id,name:item.name,kind:"layer",detail:"Layer"}))}],onOpenItem:item=>{setInsideID(null);setLayerID(item.id);setSelected([]);setNode(null);}}}/>}
 toolbar={<WorkspaceRibbon compactTools defaultDensity="compact" workspaceLayout="none"
      workspaces={[]} workspaceID="vector" onWorkspaceSelect={() => {}}
      activeTabID="draw" onTabSelect={() => {}} tabs={[{ id: 'draw', label: 'Vector studio', groups: [
        { id: 'select', label: 'Select', tools: tools.slice(0, 2).map(t => ({ ...t, icon: <ToolIcon name={t.icon} />, active: tool === t.id })) },
        { id: 'draw', label: 'Draw', tools: tools.slice(2, 7).map(t => ({ ...t, icon: <ToolIcon name={t.icon} />, active: tool === t.id })) },
        { id: 'paths', label: 'Paths', tools: tools.slice(7, 10).map(t => ({ ...t, icon: <ToolIcon name={t.icon} />, active: tool === t.id })) },
        { id: 'paint', label: 'Vector paint', tools: tools.slice(10).map(t => ({ ...t, icon: <ToolIcon name={t.icon} />, active: tool === t.id })) },
        { id: 'organize', label: 'Arrange', tools: [
          { id: 'group', label: 'Group', icon: <AetherIcon name="rectangle-group" />, disabled: disabled || selected.length < 2 },
          { id: 'ungroup', label: 'Ungroup', icon: <AetherIcon name="squares-dashed" />, disabled: disabled || !chosen.some(p => p.groupID) },
          { id: 'delete', label: 'Delete path', icon: <AetherIcon name="delete" />, disabled: disabled || !chosen.length },
        ] },
      ] }]} onCommand={editCommand} />} style={{ flex: 1, minHeight: 0 }} defaultOpenLeft={['layers']} defaultOpenRight={['properties']}
      leftPanels={standardWorkspacePanels([{ id: 'layers', title: 'Layers', icon: <AetherIcon name="layers" />, collection: true, content: <LayersPanel doc={doc} layer={layer} selected={selected}
        onSelect={(id, ids) => { if (id !== layer.id) setInsideID(null); setLayerID(id); setSelected(ids); setNode(null); }} commit={commit} /> },
      {id:'advisor',title:'AI advisor',icon:null,content:<WorkspaceAgent service={studioAgentService} app="sketch" interaction={agentInteraction} contextText={`Drawing ${name}. Use inspect to read the open drawing and its current layer/shape IDs.`} detail={name} messages={agentMessages} onMessages={setAgentMessages}/>},
      ], { features: "layers" }, documentConnection).filter(panel=>panel.id!=="part-manager")}
      rightPanels={[{ id: 'properties', title: 'Properties', icon: <AetherIcon name="sliders" />, content: <div className="sketch-properties">
        <div className="sketch-tool-settings">{chosen.length===1 && chosen[0].text && <TextInspector path={chosen[0]} disabled={disabled} onChange={p=>replace([p])} />}<strong>{tools.find(t => t.id === tool)?.label}</strong>
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
      <SketchCanvas contour={contour} resetKey={`${layer.id}:${tool}:${epoch}`} doc={doc} layer={layer} tool={tool} onTool={chooseTool} paint={paint} polygonSides={sides}
        selected={selected} onSelect={select} node={node} onNode={setNode} snap={snap} onAdd={path => add([path])} onSplice={splice}
        onPickPaint={p => { setPaint(copyPaint(p)); setSelected([]); setNotice("Appearance picked. Choose Fill shape or draw with it."); }} onFill={target => changeLayer(l => l.locked || !l.visible ? l : { ...l, paths: l.paths.map(p => p.id === target.id && p.closed && !pathLocked(l, p) && pathVisible(l, p) ? { ...p, fill: paint.fill, fillGradient: paint.fillGradient, fillOpacity: paint.fillOpacity } : p) })} onReplace={replace} onDelete={remove} undo={undo} redo={redo} />
    </WorkspaceShell>

  </div>;
}
