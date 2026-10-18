// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useAgentInteraction } from './useAgentInteraction';
import { previewDrawing } from './agent-preview';
import { newDocument } from './document';
vi.mock('./agent-preview',()=>({previewDrawing:vi.fn()}));
const preview={type:'aether.tool-content' as const,value:{kind:'drawing'},images:[] as never};
const call={id:'preview',name:'aether_sketch_preview',arguments:{}};
const state=()=>({contextKey:'drawing',doc:newDocument(),writable:false,commit:vi.fn(),canUndo:false,canRedo:false,undo:vi.fn(),redo:vi.fn(),select:vi.fn()});
it('read-only drawing previews do not commit, save, select or change history',async()=>{
  vi.mocked(previewDrawing).mockResolvedValue(preview);
  const input=state(),{result}=renderHook(()=>useAgentInteraction(input));
  expect(await result.current.execute(call,new AbortController().signal)).toBe(preview);
  expect(input.commit).not.toHaveBeenCalled();expect(input.select).not.toHaveBeenCalled();
  await expect(result.current.execute({...call,arguments:{url:'https://example.test'}},new AbortController().signal)).rejects.toThrow('no arguments');
});
it('changing document, editing during rendering, and cancellation discard stale images',async()=>{
  for(const change of ['document','edit','cancel']) {
    let finish!:(value:typeof preview)=>void;
    vi.mocked(previewDrawing).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const input=state(),{result,rerender,unmount}=renderHook(props=>useAgentInteraction(props),{initialProps:input});
    const signal=new AbortController(),pending=result.current.execute(call,signal.signal);
    if(change==='cancel')signal.abort();
    else rerender({...input,...(change==='document'?{contextKey:'other'}:{doc:newDocument()})});
    finish(preview);await expect(pending).rejects.toThrow();expect(input.commit).not.toHaveBeenCalled();unmount();
  }
});
