import { expect, it } from 'vitest';
import { newDocument, readDocument, serializeDocument } from './document';
it('roundtrips layered retained curves and their appearance', () => {
  const doc = newDocument();
  doc.layers[0].paths.push({ id: 'p', points: [[0, 0], [100, 0], [100, 100]], curves: [{ c1: [0, 50], c2: [100, 50] }, null, null], closed: true, color: '#123456', widthPx: 2, opacity: .5 });
  doc.layers[0].locked = true;
  expect(readDocument(serializeDocument(doc))).toEqual(doc);
});
it('rejects incompatible versions, duplicate identities, malformed controls and unbounded data', () => {
  const doc = newDocument();
  expect(() => readDocument(JSON.stringify({ ...doc, version: 3 }))).toThrow();
  expect(() => readDocument(JSON.stringify({ ...doc, layers: [...doc.layers, ...doc.layers] }))).toThrow();
  expect(() => readDocument(JSON.stringify({ ...doc, widthPx: null }))).toThrow();
  doc.layers[0].paths.push({ id: 'p', points: [[0, 0], [1, 1]], closed: false, color: '#123456', widthPx: 1, opacity: 1, curves: [] });
  expect(() => readDocument(serializeDocument(doc))).toThrow();
});
it('roundtrips compound contours and editable text, rejecting malformed child geometry', () => {
  const doc=newDocument();
  const p={id:'compound',points:[[0,0],[100,0],[100,100]] as [number,number][],closed:true,color:'#123456',widthPx:2,opacity:1,fillRule:'evenodd' as const,subpaths:[{points:[[10,10],[50,10],[50,50]] as [number,number][],closed:true}]};
  doc.layers[0].paths.push(p);
  doc.layers[0].paths.push({id:'text',points:[[0,0],[200,0],[200,50],[0,50]],closed:true,color:'#123456',widthPx:1,opacity:1,text:{content:'<Editable & safe>',fontFamily:'sans-serif',fontSizePx:24,fontWeight:400,italic:false,align:'start',lineHeight:1.2,widthPx:200,heightPx:50}});
  expect(readDocument(serializeDocument(doc))).toEqual(doc);
  p.subpaths[0].points[0][0]=NaN;expect(()=>readDocument(serializeDocument(doc))).toThrow();
});

it('upgrades v1 drawings without losing their geometry',()=>{const doc=newDocument();const old={...doc,version:1};expect(readDocument(JSON.stringify(old))).toEqual(doc);});
