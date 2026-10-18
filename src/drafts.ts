import { readDocument, serializeDocument } from './document';
import type { Recovery } from './recovery';
export interface DraftRecord extends Recovery { id: string; scope: string; updated: number }
function database(): Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('aether-sketch-local-drafts',1);
    request.onupgradeneeded=()=>{const store=request.result.createObjectStore('drafts',{keyPath:'id'});store.createIndex('scope','scope');};
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
}
export async function writeDraft(record: DraftRecord) {
  readDocument(serializeDocument(record.doc));
  const db=await database();
  try {await new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put(record);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});} finally {db.close();}
}
export async function readDrafts(scope: string):Promise<DraftRecord[]> {
  const db=await database();
  try {return await new Promise((resolve,reject)=>{const request=db.transaction('drafts').objectStore('drafts').index('scope').getAll(scope);request.onsuccess=()=>resolve((request.result as DraftRecord[]).filter(r=>{try{readDocument(serializeDocument(r.doc));return true;}catch{return false;}}).sort((a,b)=>b.updated-a.updated));request.onerror=()=>reject(request.error);});} finally {db.close();}
}
export async function deleteDraft(id: string, scope: string) {
  const db=await database();
  try {await new Promise<void>((resolve,reject)=>{const tx=db.transaction('drafts','readwrite'),store=tx.objectStore('drafts'),get=store.get(id);get.onsuccess=()=>{if(get.result?.scope===scope)store.delete(id);};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});} finally{db.close();}
}
