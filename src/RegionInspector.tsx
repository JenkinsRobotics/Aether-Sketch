import { Button, FieldRow, NumberField, SelectField } from '@aether/ui';
import { compoundPath, pathContours, type BooleanOperation } from '@aether/sketch';
import { useEffect, useRef, useState } from 'react';
import type { DrawingPath } from './document';
export function RegionInspector({ paths, disabled, onSplice, onSelect, contour, onContour }: {paths:DrawingPath[];disabled:boolean;onSplice:(ids:string[],paths:DrawingPath[])=>void;onSelect:(ids:string[])=>void;contour:number;onContour:(index:number)=>void}) {
  const [tolerance,setTolerance]=useState(.25),[error,setError]=useState('');
  const closed=paths.length>1&&paths.every(p=>!p.text&&pathContours(p).every(c=>c.closed));
  const [busy,setBusy]=useState(false), worker=useRef<Worker|null>(null), version=useRef('');
  version.current=JSON.stringify(paths)+disabled;
  useEffect(()=>()=>worker.current?.terminate(),[]);
  const run=async(operation:BooleanOperation|'compound')=>{
    const snapshot=version.current;setBusy(true);setError('');
    try {
      const geometry=operation==='compound'?compoundPath(paths):await new Promise<import('@aether/sketch').SketchPath|null>((resolve,reject)=>{
        const current=new Worker(new URL('./boolean-worker.ts',import.meta.url),{type:'module'});worker.current=current;
        const timer=setTimeout(()=>{current.terminate();reject(Error('This operation took too long. Simplify the shapes or increase the tolerance.'));},15000);
        const finish=()=>{clearTimeout(timer);current.terminate();worker.current=null;};
        current.onmessage=e=>{finish();e.data.error?reject(Error(e.data.error)):resolve(e.data.path);};
        current.onerror=()=>{finish();reject(Error('The Boolean could not be completed. Your shapes were kept.'));};
        current.postMessage({paths,operation,tolerance});
      });
      if(version.current!==snapshot){setError('Selection changed. Run the operation again on the new selection.');return;}
      const result=geometry?[{...paths[0],...geometry,id:crypto.randomUUID(),name:operation==='compound'?'Compound path':operation,groupID:undefined}]:[];
      onSplice(paths.map(p=>p.id),result);onSelect(result.map(p=>p.id));setError(geometry?'':'The operation produced an empty region.');
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const p=paths.length===1?paths[0]:undefined;
  return <fieldset className="sketch-paint-panel" disabled={disabled || busy} aria-busy={busy}><legend>Combine shapes</legend>
    {busy&&<p role="status">Combining shapes…</p>}
    <div className="sketch-region-actions">{(['union','difference','intersection','xor','compound'] as const).map(op=><Button key={op} disabled={!closed} onClick={()=>run(op)}>{({union:'Union',difference:'Subtract front',intersection:'Intersect',xor:'Exclude overlap',compound:'Make compound'})[op]}</Button>)}</div>
    <FieldRow label="Curve tolerance"><NumberField aria-label="Boolean curve tolerance" value={tolerance} min={.001} max={10} unit="px" onCommit={setTolerance}/></FieldRow>
    <p>Subtract cuts the front shapes from the backmost selected shape. Boolean results use editable polygon edges at this tolerance.</p>
    {p?.subpaths?.length ? <>
      <FieldRow label="Edit contour"><SelectField aria-label="Edit contour" value={String(contour)} options={pathContours(p).map((_,i)=>({value:String(i),label:`Contour ${i+1}`}))} onChange={e=>onContour(Number(e.target.value))}/></FieldRow>
      <FieldRow label="Fill rule"><SelectField aria-label="Fill rule" value={p.fillRule??'nonzero'} options={[{value:'evenodd',label:'Even-odd (holes)'},{value:'nonzero',label:'Nonzero winding'}]} onChange={e=>onSplice([p.id],[{...p,fillRule:e.target.value as 'evenodd'|'nonzero'}])}/></FieldRow>
      <Button onClick={()=>{const pieces=pathContours(p).map((c,i)=>({...p,...c,subpaths:undefined,id:i?crypto.randomUUID():p.id,name:`Contour ${i+1}`}));onSplice([p.id],pieces);onSelect(pieces.map(p=>p.id));}}>Release compound</Button>
    </>:null}
    {error&&<p role="status">{error}</p>}
  </fieldset>;
}
