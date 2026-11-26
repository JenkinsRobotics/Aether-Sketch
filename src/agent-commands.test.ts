import {expect,it} from 'vitest';
import {ellipsePath,pathBounds} from '@aether/sketch';
import {newDocument,readDocument,serializeDocument} from './document';
import {inspectDrawing,prepareDrawingEdit} from './agent-commands';

it('draws an editable batch, transforms retained curves and preserves unrelated shapes',()=>{
  const source=newDocument(),layer_id=source.layers[0].id;
  const created=prepareDrawingEdit(source,'aether_sketch_draw',{layer_id,shapes:[
    {kind:'rectangle',x_px:10,y_px:20,width_px:80,height_px:40,fill:'#ff0000'},
    {kind:'ellipse',x_px:110,y_px:20,width_px:80,height_px:40},
  ]});
  expect(source.layers[0].paths).toHaveLength(0);
  expect(readDocument(serializeDocument(created.document)).layers[0].paths).toHaveLength(2);
  expect(created.document.layers[0].paths[1].curves).toEqual(ellipsePath([110,20],[190,60]).curves);
  const moved=prepareDrawingEdit(created.document,'aether_sketch_transform',{layer_id,path_ids:[created.ids[1]],dx_px:15,dy_px:5,scale_x:2});
  expect(moved.document.layers[0].paths[0]).toEqual(created.document.layers[0].paths[0]);
  expect(pathBounds([moved.document.layers[0].paths[1]])).toEqual({x:85,y:25,width:160,height:40});
  expect(inspectDrawing(moved.document,{limit:1}).next_offset).toBe(1);
});
it('invalid batches, missing IDs and locked groups do not change a drawing',()=>{
  const doc=newDocument(),layer_id=doc.layers[0].id,before=serializeDocument(doc);
  expect(()=>prepareDrawingEdit(doc,'aether_sketch_draw',{layer_id,shapes:[{kind:'rectangle',x_px:0,y_px:0,width_px:10,height_px:10},{kind:'ellipse',x_px:0,y_px:0,width_px:-1,height_px:20}]})).toThrow();
  expect(serializeDocument(doc)).toBe(before);
  const created=prepareDrawingEdit(doc,'aether_sketch_draw',{layer_id,shapes:[{kind:'rectangle',x_px:0,y_px:0,width_px:10,height_px:10}]}).document;
  created.layers[0].groups=[{id:'locked',name:'Locked',locked:true}];created.layers[0].paths[0].groupID='locked';
  expect(()=>prepareDrawingEdit(created,'aether_sketch_delete',{layer_id,path_ids:[created.layers[0].paths[0].id]})).toThrow(/unlocked/);
  expect(()=>prepareDrawingEdit(created,'aether_sketch_style',{layer_id,path_ids:['missing'],fill:'#ffffff'})).toThrow(/exist/);
});

// ---- Layer tools ----
const stack=()=>{
  let doc=newDocument();const base=doc.layers[0].id;
  doc=prepareDrawingEdit(doc,'aether_sketch_draw',{layer_id:base,shapes:[{kind:'rectangle',x_px:0,y_px:0,width_px:10,height_px:10}]}).document;
  const top=prepareDrawingEdit(doc,'aether_sketch_add_layer',{name:'Top',above_layer_id:base});
  return {doc:top.document,base,top:top.layerID};
};
it('adds a layer above another, and sets opacity, blend, role and effects in one step',()=>{
  const {doc,base,top}=stack();
  expect(doc.layers.map(l=>l.id)).toEqual([top,base]);
  const set=prepareDrawingEdit(doc,'aether_sketch_set_layer',{layer_id:top,name:'Shade',opacity:.5,blend:'multiply',role:'clip',blur_px:4,shadow:{dy_px:10,color:'#112233'},glow:{}});
  expect(doc.layers[0].opacity).toBeUndefined(); // the source drawing is untouched
  expect(set.document.layers[0]).toMatchObject({name:'Shade',opacity:.5,blend:'multiply',role:'clip',effects:{blurPx:4,shadow:{dxPx:6,dyPx:10,blurPx:6,color:'#112233',opacity:.5},glow:{blurPx:8,color:'#ffd24a',opacity:.9}}});
  expect(set.layerID).toBe(top);
  // Only what is named changes; plain values and null clear a setting.
  const cleared=prepareDrawingEdit(set.document,'aether_sketch_set_layer',{layer_id:top,opacity:1,blend:'normal',role:'normal',blur_px:0,shadow:null,glow:null}).document.layers[0];
  expect(cleared.name).toBe('Shade');expect('opacity' in cleared||'blend' in cleared||'role' in cleared||'effects' in cleared).toBe(false);
  const listed=inspectDrawing(set.document).layers[0];
  expect(listed).toMatchObject({name:'Shade',opacity:.5,blend:'multiply',role:'clip',blur_px:4,shadow:{dx_px:6,dy_px:10,blur_px:6,color:'#112233',opacity:.5}});
  expect(inspectDrawing(doc).layers[0]).toEqual({id:top,name:'Top',visible:true,locked:false,kind:'vector',shape_count:0}); // plain layers stay brief
});
it('makes an adjustment layer and updates part of it',()=>{
  const {doc,top}=stack();
  const made=prepareDrawingEdit(doc,'aether_sketch_set_layer',{layer_id:top,adjustment:{saturation:-1,invert:true}}).document;
  expect(made.layers[0].adjust).toEqual({brightness:0,contrast:0,saturation:-1,hueDeg:0,invert:true});
  const changed=prepareDrawingEdit(made,'aether_sketch_set_layer',{layer_id:top,adjustment:{hue_deg:90,invert:false}}).document;
  expect(changed.layers[0].adjust).toEqual({brightness:0,contrast:0,saturation:-1,hueDeg:90});
  expect(inspectDrawing(changed).layers[0].adjustment).toEqual({brightness:0,contrast:0,saturation:-1,hue_deg:90,invert:false});
  expect(prepareDrawingEdit(changed,'aether_sketch_set_layer',{layer_id:top,adjustment:null}).document.layers[0].adjust).toBeUndefined();
});
it('refuses settings that cannot hold, without changing the drawing',()=>{
  const {doc,base,top}=stack(),before=serializeDocument(doc),set=(args:Record<string,unknown>)=>()=>prepareDrawingEdit(doc,'aether_sketch_set_layer',args);
  expect(set({layer_id:base,role:'mask'})).toThrow(/bottom layer/);
  expect(set({layer_id:top,blend:'glow'})).toThrow(/blend modes/);
  expect(set({layer_id:top,opacity:2})).toThrow();
  expect(set({layer_id:top,shadow:{color:'red'}})).toThrow(/hex/);
  expect(set({layer_id:top,shadow:{spread:3}})).toThrow(/only/);
  expect(set({layer_id:top})).toThrow(/at least one/);
  expect(set({layer_id:'missing',opacity:.5})).toThrow(/not a layer/);
  expect(set({layer_id:top,colour:'#ffffff'})).toThrow(/Unknown/);
  expect(serializeDocument(doc)).toBe(before);
});
it('a locked layer takes only lock and visibility until it is unlocked',()=>{
  const {doc,top}=stack(),locked=prepareDrawingEdit(doc,'aether_sketch_set_layer',{layer_id:top,locked:true}).document;
  expect(()=>prepareDrawingEdit(locked,'aether_sketch_set_layer',{layer_id:top,opacity:.5})).toThrow(/locked/);
  expect(()=>prepareDrawingEdit(locked,'aether_sketch_delete_layer',{layer_id:top})).toThrow(/locked/);
  expect(prepareDrawingEdit(locked,'aether_sketch_set_layer',{layer_id:top,visible:false}).document.layers[0].visible).toBe(false);
  const open=prepareDrawingEdit(locked,'aether_sketch_set_layer',{layer_id:top,locked:false,opacity:.5}).document; // unlocking and changing in one call
  expect(open.layers[0]).toMatchObject({locked:false,opacity:.5});
});
it('moves, duplicates and deletes layers',()=>{
  const {doc,base,top}=stack();
  expect(prepareDrawingEdit(doc,'aether_sketch_move_layer',{layer_id:top,to:'bottom'}).document.layers.map(l=>l.id)).toEqual([base,top]);
  expect(prepareDrawingEdit(doc,'aether_sketch_move_layer',{layer_id:base,above_layer_id:top}).document.layers.map(l=>l.id)).toEqual([base,top]);
  expect(prepareDrawingEdit(doc,'aether_sketch_move_layer',{layer_id:base,to:'top'}).document.layers.map(l=>l.id)).toEqual([base,top]);
  expect(()=>prepareDrawingEdit(doc,'aether_sketch_move_layer',{layer_id:top})).toThrow(/exactly one/);
  expect(()=>prepareDrawingEdit(doc,'aether_sketch_move_layer',{layer_id:top,to:'top',above_layer_id:base})).toThrow(/exactly one/);
  expect(()=>prepareDrawingEdit(doc,'aether_sketch_move_layer',{layer_id:top,above_layer_id:top})).toThrow(/itself/);
  // A mask moved to the bottom has nothing to mask, so it is an ordinary layer again in inspect.
  const mask=prepareDrawingEdit(doc,'aether_sketch_set_layer',{layer_id:top,role:'mask'}).document;
  expect(inspectDrawing(mask).layers[0].role).toBe('mask');
  expect(inspectDrawing(prepareDrawingEdit(mask,'aether_sketch_move_layer',{layer_id:top,to:'bottom'}).document).layers[1].role).toBeUndefined();
  const copy=prepareDrawingEdit(doc,'aether_sketch_duplicate_layer',{layer_id:base});
  expect(copy.document.layers.map(l=>l.name)).toEqual(['Top','Layer 1 copy','Layer 1']);expect(copy.layerID).toBe(copy.document.layers[1].id);
  expect(copy.document.layers[1].paths[0].id).not.toBe(copy.document.layers[2].paths[0].id);
  const gone=prepareDrawingEdit(doc,'aether_sketch_delete_layer',{layer_id:top});
  expect(gone.document.layers.map(l=>l.id)).toEqual([base]);expect(gone.layerID).toBe(base);
  expect(()=>prepareDrawingEdit(gone.document,'aether_sketch_delete_layer',{layer_id:base})).toThrow(/at least one/);
});
it('deleting a flipbook frame layer takes it out of the flipbook',()=>{
  const {doc,base,top}=stack(),book=readDocument(serializeDocument({...doc,flipbook:{fps:12,frames:[base,top]}}));
  expect(inspectDrawing(book).layers.map(l=>l.flipbook_frame)).toEqual([2,1]);
  expect(prepareDrawingEdit(book,'aether_sketch_delete_layer',{layer_id:top}).document.flipbook).toEqual({fps:12,frames:[base]});
});
