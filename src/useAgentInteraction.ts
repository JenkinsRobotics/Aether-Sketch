import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { AgentInteraction } from '@aether/ui/AgentServices';
import { inspectDrawing, prepareDrawingEdit, sketchAgentTools } from './agent-commands';
import { previewDrawing } from './agent-preview';
import type { SketchDocument } from './document';

export function useAgentInteraction(state:{
  contextKey:string; doc:SketchDocument; writable:boolean;
  commit:(change:(doc:SketchDocument)=>SketchDocument)=>void;
  canUndo:boolean;canRedo:boolean;undo:()=>void;redo:()=>void;
  select:(layer:string,ids:string[])=>void;
}):AgentInteraction {
  const current=useRef(state);useLayoutEffect(()=>{current.current=state;},[state]);
  return {contextKey:state.contextKey,tools:sketchAgentTools,async execute(call,signal){
    signal.throwIfAborted();
    const editor=current.current;
    if(editor.contextKey!==state.contextKey)throw Error('The active drawing changed.');
    if(call.name==='aether_sketch_inspect')return {...inspectDrawing(editor.doc,call.arguments),can_undo:editor.canUndo,can_redo:editor.canRedo};
    if(call.name==='aether_sketch_preview') {
      if(Object.keys(call.arguments).length)throw Error('Preview takes no arguments.');
      const preview=await previewDrawing(editor.doc,signal);
      signal.throwIfAborted();
      if(current.current.contextKey!==state.contextKey||current.current.doc!==editor.doc)
        throw Error('The drawing changed while rendering. Request a fresh preview.');
      return preview;
    }
    if(!editor.writable)throw Error('This drawing is read-only.');
    if(call.name==='aether_sketch_undo'||call.name==='aether_sketch_redo'){
      const undo=call.name==='aether_sketch_undo';
      if(!(undo?editor.canUndo:editor.canRedo))throw Error('No drawing edit is available to '+(undo?'undo.':'redo.'));
      flushSync(()=>{(undo?editor.undo:editor.redo)();editor.select(editor.doc.layers[0].id,[]);});
      return {changed:true,...inspectDrawing(current.current.doc)};
    }
    const next=prepareDrawingEdit(editor.doc,call.name,call.arguments);
    signal.throwIfAborted();
    flushSync(()=>{editor.commit(()=>next.document);editor.select(next.layerID,next.ids);});
    return {changed:true,layer_id:next.layerID,shape_ids:next.ids,shape_count:next.document.layers.reduce((n,l)=>n+l.paths.length,0)};
  }};
}
