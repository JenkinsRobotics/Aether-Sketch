import { useState } from 'react';
import { Button, Dialog } from '@aether/ui';
import { readDrafts, deleteDraft, type DraftRecord } from './drafts';
import type { Recovery } from './recovery';
export function DraftRecovery({scope,onRestore}:{scope:string|null|undefined;onRestore:(draft:Recovery)=>void}) {
  const [open,setOpen]=useState(false),[records,setRecords]=useState<DraftRecord[]>([]),[error,setError]=useState('');
  const load=async()=>{if(!scope)return;try{setRecords(await readDrafts(scope));setError('');}catch{setError('Browser draft storage is unavailable.');}};
  return <><Button disabled={!scope} onClick={()=>{setOpen(true);void load();}}>Recover drafts</Button>
    <Dialog open={open} title="Local drawing drafts" onClose={()=>setOpen(false)} actions={<Button onClick={()=>setOpen(false)}>Close</Button>}>
      <p>Drafts for this account and project on this browser. Each working tab keeps its own copy. Restoring replaces the current drawing; its saved draft remains here.</p>
      {error&&<p role="alert">{error}</p>}{!records.length&&!error&&<p>No saved drafts yet.</p>}
      {records.map(record=><div key={record.id} style={{display:'flex',gap:12,alignItems:'center',padding:8}}><span>{record.name} · {new Date(record.updated).toLocaleString()}</span>
        <Button onClick={()=>{onRestore(record);setOpen(false);}}>Restore {record.name}</Button><Button onClick={async()=>{if(scope){try{await deleteDraft(record.id,scope);await load();}catch{setError('The draft could not be deleted. Please try again.');}}}}>Delete draft {record.name}</Button></div>)}
    </Dialog>
  </>;
}
