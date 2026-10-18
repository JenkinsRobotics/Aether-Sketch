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
