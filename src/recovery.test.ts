import { expect,it } from 'vitest';
import { recoveryKey,loadRecovery,saveRecovery } from './recovery';
import { newDocument } from './document';
it('isolates draft keys by account/project and validates restored data',()=>{
 const data=new Map<string,string>(),storage={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v);}};
 const a=recoveryKey('alice','one'),b=recoveryKey('bob','one'),c=recoveryKey('alice','two');
 const value={doc:newDocument(),name:'Drawing'};saveRecovery(storage,a,value);
 expect(loadRecovery(storage,a)).toEqual(value);expect(loadRecovery(storage,b)).toBeNull();expect(loadRecovery(storage,c)).toBeNull();
 storage.setItem(a,'{"version":1,"name":"broken","doc":{}}');expect(()=>loadRecovery(storage,a)).toThrow();
});
