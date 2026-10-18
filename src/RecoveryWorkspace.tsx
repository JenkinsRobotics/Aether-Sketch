import { useEffect, useState } from 'react';
import { Button } from '@aether/ui';
import App from './App';
import { loadRecovery, recoveryKey, type Recovery } from './recovery';
export function RecoveryWorkspace() {
  const [account,setAccount]=useState<string | null>(null);
  useEffect(()=>{
    let active=true, changed=false;
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),5000);
    const sync=(event:Event)=>{ changed=true; const user=(event as CustomEvent<{username?:string}|null>).detail; setAccount(user?.username??'signed-out'); };
    document.addEventListener('aether-account',sync);
    void fetch('/api/status',{credentials:'same-origin',signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();const data=await r.json();if(active&&!changed)setAccount(data.user?.username??'signed-out');}).catch(()=>{if(active&&!changed)setAccount(import.meta.env.DEV?'local-development':'unverified');}).finally(()=>clearTimeout(timeout));
    return()=>{active=false;clearTimeout(timeout);controller.abort();document.removeEventListener('aether-account',sync);};
  },[]);
  if(account===null)return <p>Opening drawing workspace…</p>;
  const project=new URL(location.href).searchParams.get('document')??new URL(location.href).searchParams.get('project')??'untitled';
  const key=['signed-out','unverified'].includes(account)?null:recoveryKey(account,project);
  return <RecoveredApp key={`${account}:${project}`} storageKey={key}/>;
}
function RecoveredApp({storageKey}:{storageKey:string|null}) {
  const [blocked] = useState(() => { try { if(storageKey) loadRecovery(sessionStorage,storageKey); return false; } catch { return true; } });
  const [state,setState]=useState<{recovery:Recovery|null;error:string}>(()=>{
    try{return {recovery:storageKey?loadRecovery(sessionStorage,storageKey):null,error:''};}
    catch{return {recovery:null,error:'The local draft could not be opened. It has been kept in browser storage.'};}
  });
  if(state.error)return <div role="alert"><p>{state.error}</p><Button onClick={()=>setState({recovery:null,error:''})}>Continue without overwriting the draft</Button></div>;
  return <App initial={state.recovery??undefined} recoveryKey={blocked?null:storageKey} />;
}
