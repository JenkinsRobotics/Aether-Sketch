import { ellipsePath, pathBounds, transformPath, type Point } from '@aether/sketch';
import type { AgentTool } from '@aether/ui/AgentServices';
import { BLEND_MODES, newLayer, readDocument, serializeDocument, type BlendMode, type DrawingPath, type Layer, type SketchDocument } from './document';
import { layerDepths } from './depth';
import { defaultPaint, repairClips } from './paint';
import { duplicateLayer, pathLocked, pathVisible } from './structure';
import { newText, updateText } from './text';

const string = {type:'string'}, number = {type:'number'};
const tool = (name:string, description:string, properties:Record<string,unknown>, required:string[]=[]):AgentTool => ({
  name:'aether_sketch_'+name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
});
const layer = {layer_id:string};
const selection = {...layer,path_ids:{type:'array',items:string,minItems:1,maxItems:100}};
const hex = {type:'string',description:'Six digit hex color, #rrggbb'};
// Layer settings, as the Layers panel and the Properties and Effects tabs offer them.
const layerSettings = {
  name:string, visible:{type:'boolean'}, locked:{type:'boolean'},
  opacity:{type:'number',minimum:0,maximum:1}, blend:{type:'string',enum:[...BLEND_MODES]},
  role:{type:'string',enum:['normal','clip','mask'],description:'clip: shows only where the layer below is painted. mask: not drawn; hides the layer below wherever this layer is painted. Either needs a layer below.'},
  blur_px:{type:'number',minimum:0,maximum:500,description:'Blur of the whole layer; 0 removes it. On a mask layer it feathers the mask.'},
  shadow:{type:['object','null'],description:'Drop shadow; null removes it. Unset fields keep their value or take a default.',properties:{dx_px:number,dy_px:number,blur_px:number,color:hex,opacity:number},additionalProperties:false},
  glow:{type:['object','null'],description:'Glow around the layer; null removes it.',properties:{blur_px:number,color:hex,opacity:number},additionalProperties:false},
  adjustment:{type:['object','null'],description:'Makes this an adjustment layer that recolours everything beneath it (only its base when role is clip); null removes it. brightness, contrast and saturation run -1 to 1 with 0 unchanged.',properties:{brightness:number,contrast:number,saturation:number,hue_deg:number,invert:{type:'boolean'}},additionalProperties:false},
};
const appearance = {fill:{type:['string','null'],description:'Six digit hex color or null for no fill'},stroke:string,stroke_width_px:number,opacity:number};
export const sketchAgentTools:AgentTool[] = [
  {name:'aether_sketch_preview',description:'Render the current drawing to a PNG for visual review, including visible layers, clips, paint and text, on white. Read-only. Use inspect for exact geometry and sizes.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}},
  tool('inspect','Inspect the current drawing: layers (top first) with their settings, shape IDs and geometry. Coordinates are pixels, origin top left; positive y is down. Use offset/limit to page shapes.',{offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}}),
  tool('add_layer','Create an editable vector layer. Returns its ID. With above_layer_id it goes directly above that layer; otherwise at the bottom of the stack.',{name:string,above_layer_id:string},['name']),
  tool('set_layer','Change a layer\'s settings in one undo step: name, visibility, lock, opacity, blend mode, role (clip or mask), blur, shadow, glow and adjustment. Only the given settings change. A locked layer accepts only locked and visible, unless the same call unlocks it.',{...layer,...layerSettings},['layer_id']),
  tool('move_layer','Reorder a layer: directly above another layer (above_layer_id), or to the top or bottom of the stack (to). Give exactly one. Order decides what a clip or mask acts on.',{...layer,above_layer_id:string,to:{type:'string',enum:['top','bottom']}},['layer_id']),
  tool('duplicate_layer','Copy a layer with everything on it, directly above the original. Returns the copy\'s ID.',layer,['layer_id']),
  tool('delete_layer','Delete an unlocked layer and everything on it. The last layer cannot be deleted. This is undoable.',layer,['layer_id']),
  tool('draw','Add up to 100 editable shapes as one undo step. Existing content is preserved. Rectangle/ellipse/text use x_px,y_px,width_px,height_px. A path uses points_px, closed. Colors are #rrggbb.',{...layer,shapes:{type:'array',minItems:1,maxItems:100,items:{type:'object',properties:{kind:{type:'string',enum:['rectangle','ellipse','path','text']},name:string,x_px:number,y_px:number,width_px:number,height_px:number,points_px:{type:'array',items:{type:'array',items:number,minItems:2,maxItems:2},minItems:2,maxItems:500},closed:{type:'boolean'},text:string,font_size_px:number,...appearance},required:['kind'],additionalProperties:false}}},['layer_id','shapes']),
  tool('transform','Move, resize or rotate shapes around their shared center. Positive angles rotate clockwise. Locked/hidden items are refused.',{...selection,dx_px:number,dy_px:number,scale_x:number,scale_y:number,rotation_deg:number},['layer_id','path_ids']),
  tool('style','Change selected shape appearance. Locked/hidden items are refused.',{...selection,...appearance},['layer_id','path_ids']),
  tool('delete','Delete only the specified editable shapes. This is undoable.',selection,['layer_id','path_ids']),
  tool('undo','Undo the most recent drawing edit. Inspect afterward.',{}),
  tool('redo','Redo the most recently undone drawing edit. Inspect afterward.',{}),
];
type Args = Record<string,unknown>;
function finite(value:unknown, fallback?:number, min=-1e6, max=1e6):number {
  if(value===undefined&&fallback!==undefined)return fallback;
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)throw Error(`Expected a number from ${min} to ${max}.`);
  return value;
}
function label(value:unknown, fallback?:string):string {
  if(value===undefined&&fallback!==undefined)return fallback;
  if(typeof value!=='string'||!value.trim()||value.length>200)throw Error('Use a nonempty name of at most 200 characters.');
  return value;
}
function style(a:Args):Partial<DrawingPath> {
  const result:Partial<DrawingPath>={};
  for(const [key,target] of [['fill','fill'],['stroke','color']] as const)if(a[key]!==undefined){
    const value=a[key];if(!(key==='fill'&&value===null)&&!(typeof value==='string'&&/^#[a-f\d]{6}$/i.test(value)))throw Error('Use a six digit hex color.');
    Object.assign(result,{[target]:value});
  }
  if(a.stroke!==undefined)result.strokeEnabled=true;
  if(a.stroke_width_px!==undefined)result.widthPx=finite(a.stroke_width_px,undefined,.1,200);
  if(a.opacity!==undefined)result.opacity=finite(a.opacity,undefined,0,1);
  return result;
}
const colour=(value:unknown,fallback:string)=>{if(value===undefined)return fallback;if(typeof value!=='string'||!/^#[a-f\d]{6}$/i.test(value))throw Error('Use a six digit hex color.');return value;};
const fields=(value:unknown,allowed:string[]):Args=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw Error(`Use an object with only: ${allowed.join(', ')}.`);
  return value as Args;
};
/** A layer with the given settings applied; everything not named is kept. */
function withLayerSettings(l:Layer,a:Args,hasBelow:boolean):Layer {
  const settings=Object.keys(a).filter(k=>k!=='layer_id');
  if(!settings.length)throw Error('Give at least one setting to change.');
  if(l.locked&&a.locked!==false&&settings.some(k=>k!=='locked'&&k!=='visible'))throw Error('This layer is locked: it accepts only locked and visible. Send locked: false, alone or with the other settings.');
  const next:Layer={...l};
  if(a.name!==undefined)next.name=label(a.name);
  for(const key of ['visible','locked'] as const)if(a[key]!==undefined){if(typeof a[key]!=='boolean')throw Error(`${key} must be true or false.`);next[key]=a[key] as boolean;}
  if(a.opacity!==undefined){const opacity=finite(a.opacity,undefined,0,1);if(opacity===1)delete next.opacity;else next.opacity=opacity;}
  if(a.blend!==undefined){if(!BLEND_MODES.includes(a.blend as BlendMode))throw Error(`Use one of these blend modes: ${BLEND_MODES.join(', ')}.`);if(a.blend==='normal')delete next.blend;else next.blend=a.blend as BlendMode;}
  if(a.role!==undefined){
    if(a.role!=='normal'&&a.role!=='clip'&&a.role!=='mask')throw Error('role is normal, clip or mask.');
    if(a.role!=='normal'&&!hasBelow)throw Error('A clip or mask acts on the layer below, and this is the bottom layer. Move it or add a layer below.');
    if(a.role==='normal')delete next.role;else next.role=a.role;
  }
  const effects={...next.effects};
  if(a.blur_px!==undefined){const blur=finite(a.blur_px,undefined,0,500);if(blur)effects.blurPx=blur;else delete effects.blurPx;}
  if(a.shadow===null)delete effects.shadow;
  else if(a.shadow!==undefined){const v=fields(a.shadow,['dx_px','dy_px','blur_px','color','opacity']),old=effects.shadow;
    effects.shadow={dxPx:finite(v.dx_px,old?.dxPx??6,-5000,5000),dyPx:finite(v.dy_px,old?.dyPx??6,-5000,5000),blurPx:finite(v.blur_px,old?.blurPx??6,0,500),color:colour(v.color,old?.color??'#000000'),opacity:finite(v.opacity,old?.opacity??.5,0,1)};}
  if(a.glow===null)delete effects.glow;
  else if(a.glow!==undefined){const v=fields(a.glow,['blur_px','color','opacity']),old=effects.glow;
    effects.glow={blurPx:finite(v.blur_px,old?.blurPx??8,0,500),color:colour(v.color,old?.color??'#ffd24a'),opacity:finite(v.opacity,old?.opacity??.9,0,1)};}
  if(Object.keys(effects).length)next.effects=effects;else delete next.effects;
  if(a.adjustment===null)delete next.adjust;
  else if(a.adjustment!==undefined){const v=fields(a.adjustment,['brightness','contrast','saturation','hue_deg','invert']),old=next.adjust;
    if(v.invert!==undefined&&typeof v.invert!=='boolean')throw Error('invert must be true or false.');
    const invert=v.invert===undefined?old?.invert:v.invert||undefined;
    next.adjust={brightness:finite(v.brightness,old?.brightness??0,-1,1),contrast:finite(v.contrast,old?.contrast??0,-1,1),saturation:finite(v.saturation,old?.saturation??0,-1,1),hueDeg:finite(v.hue_deg,old?.hueDeg??0,-180,180),...(invert?{invert:true}:{})};}
  return next;
}
function shape(value:unknown):DrawingPath {
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Specify a shape object.');
  const a=value as Args, properties=(sketchAgentTools.find(tool=>tool.name==='aether_sketch_draw')!.inputSchema.properties as any).shapes.items.properties;
  if(Object.keys(a).some(k=>!(k in properties)))throw Error('Unknown shape setting.');
  const base={...defaultPaint,id:crypto.randomUUID(),name:label(a.name,String(a.kind)),...style(a)};
  if(a.kind==='path') {
    if(!Array.isArray(a.points_px)||a.points_px.length<2||a.points_px.length>500)throw Error('A path needs 2–500 points.');
    const points=a.points_px.map(p=>{if(!Array.isArray(p)||p.length!==2)throw Error('Use x,y point pairs.');return [finite(p[0]),finite(p[1])] as Point;});
    if(a.closed!==undefined&&typeof a.closed!=='boolean')throw Error('closed must be true or false.');
    return {...base,points,closed:a.closed===true};
  }
  const x=finite(a.x_px),y=finite(a.y_px);
  if(a.kind==='text') {
    if(typeof a.text!=='string'||a.text.length>2000)throw Error('Text must contain at most 2000 characters.');
    const text=updateText(newText([x,y]),{content:a.text,fontSizePx:finite(a.font_size_px,48,1,2000)});
    return {...text,...base,strokeEnabled:a.stroke!==undefined};
  }
  const w=finite(a.width_px,undefined,.01),h=finite(a.height_px,undefined,.01);
  if(a.kind==='ellipse')return {...ellipsePath([x,y],[x+w,y+h]),...base};
  if(a.kind==='rectangle')return {...base,closed:true,points:[[x,y],[x+w,y],[x+w,y+h],[x,y+h]]};
  throw Error('Unknown shape kind.');
}
export function inspectDrawing(doc:SketchDocument,args:Args={}) {
  const offset=finite(args.offset,0,0,100000),limit=finite(args.limit,25,1,50);
  if(!Number.isInteger(offset)||!Number.isInteger(limit))throw Error('Use whole-number pagination.');
  const paths=doc.layers.flatMap(l=>l.paths.map(p=>({layer_id:l.id,id:p.id,name:p.name,locked:l.locked||pathLocked(l,p),visible:l.visible&&pathVisible(l,p),bounds:pathBounds([p]),fill:p.fill,stroke:p.color,stroke_width_px:p.widthPx,closed:p.closed,text:p.text?.content})));
  const depths=layerDepths(doc);
  // Layers are listed top first. `role` is the role in force; settings at their plain value are left out.
  const layers=doc.layers.map((l,i)=>({id:l.id,name:l.name,visible:l.visible,locked:l.locked,kind:l.kind??'vector',shape_count:l.paths.length,
    ...(l.opacity!==undefined&&l.opacity<1?{opacity:l.opacity}:{}),...(l.blend?{blend:l.blend}:{}),...(depths[i].role?{role:depths[i].role}:{}),
    ...(l.effects?.blurPx?{blur_px:l.effects.blurPx}:{}),...(l.effects?.shadow?{shadow:{dx_px:l.effects.shadow.dxPx,dy_px:l.effects.shadow.dyPx,blur_px:l.effects.shadow.blurPx,color:l.effects.shadow.color,opacity:l.effects.shadow.opacity}}:{}),
    ...(l.effects?.glow?{glow:{blur_px:l.effects.glow.blurPx,color:l.effects.glow.color,opacity:l.effects.glow.opacity}}:{}),
    ...(l.adjust?{adjustment:{brightness:l.adjust.brightness,contrast:l.adjust.contrast,saturation:l.adjust.saturation,hue_deg:l.adjust.hueDeg,invert:!!l.adjust.invert}}:{}),
    ...(doc.flipbook?.frames.includes(l.id)?{flipbook_frame:doc.flipbook.frames.indexOf(l.id)+1}:{})}));
  return {width_px:doc.widthPx,height_px:doc.heightPx,layers,total_shapes:paths.length,offset,shapes:paths.slice(offset,offset+limit),next_offset:offset+limit<paths.length?offset+limit:null};
}
/** Pure document operation. The editor commits this validated candidate once. */
export function prepareDrawingEdit(doc:SketchDocument,name:string,args:Args):{document:SketchDocument;ids:string[];layerID:string} {
  const definition=sketchAgentTools.find(t=>t.name===name);
  if(!definition||!args||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(definition.inputSchema.properties as object,k)))throw Error('Unknown drawing tool or argument.');
  let next=structuredClone(doc),ids:string[]=[];
  if(name==='aether_sketch_add_layer') {
    const created=newLayer(label(args.name)),above=args.above_layer_id===undefined?-1:next.layers.findIndex(l=>l.id===args.above_layer_id);
    if(args.above_layer_id!==undefined&&above<0)throw Error('above_layer_id is not a layer of this drawing.');
    if(above<0)next.layers.push(created);else next.layers.splice(above,0,created);
    return {document:readDocument(serializeDocument(next)),ids,layerID:created.id};
  }
  // Layer tools work on any existing layer: hidden ones can be shown, locked ones unlocked.
  if(['aether_sketch_set_layer','aether_sketch_move_layer','aether_sketch_duplicate_layer','aether_sketch_delete_layer'].includes(name)) {
    const at=next.layers.findIndex(l=>l.id===args.layer_id), target=next.layers[at];
    if(!target)throw Error('layer_id is not a layer of this drawing.');
    let layerID=target.id;
    if(name==='aether_sketch_set_layer')next.layers[at]=withLayerSettings(target,args,at<next.layers.length-1);
    else if(name==='aether_sketch_duplicate_layer'){next=duplicateLayer(next,target.id);layerID=next.layers[at].id;}
    else if(name==='aether_sketch_delete_layer'){
      if(target.locked)throw Error('This layer is locked. Unlock it with set_layer first.');
      if(next.layers.length<2)throw Error('A drawing keeps at least one layer.');
      next.layers.splice(at,1);layerID=next.layers[Math.min(at,next.layers.length-1)].id;
    } else {
      if((args.above_layer_id===undefined)===(args.to===undefined))throw Error('Give exactly one of above_layer_id and to.');
      if(args.to!==undefined&&args.to!=='top'&&args.to!=='bottom')throw Error('to is top or bottom.');
      if(args.above_layer_id===target.id)throw Error('A layer cannot go above itself.');
      next.layers.splice(at,1);
      const other=args.above_layer_id===undefined?-1:next.layers.findIndex(l=>l.id===args.above_layer_id);
      if(args.above_layer_id!==undefined&&other<0)throw Error('above_layer_id is not a layer of this drawing.');
      next.layers.splice(args.to==='top'?0:args.to==='bottom'?next.layers.length:other,0,target);
    }
    return {document:readDocument(serializeDocument(repairClips(next))),ids,layerID};
  }
  const l=next.layers.find(l=>l.id===args.layer_id);
  if(!l||l.locked||!l.visible)throw Error('Select an existing visible, unlocked layer.');
  if(l.kind==='pixel')throw Error('This is a pixel layer. Shapes need a vector layer: create one with add_layer.');
  if(name==='aether_sketch_draw') {
    if(!Array.isArray(args.shapes)||!args.shapes.length||args.shapes.length>100)throw Error('Draw 1–100 shapes per step.');
    const created=args.shapes.map(shape);l.paths.push(...created);ids=created.map(p=>p.id);
  } else {
    if(!Array.isArray(args.path_ids)||!args.path_ids.length||args.path_ids.length>100||new Set(args.path_ids).size!==args.path_ids.length)throw Error('Specify 1–100 unique shape IDs.');
    const chosen=args.path_ids.map(id=>l.paths.find(p=>p.id===id));
    if(chosen.some(p=>!p||pathLocked(l,p)||!pathVisible(l,p)))throw Error('Every shape must exist and be visible and unlocked.');
    ids=chosen.map(p=>p!.id);
    if(name==='aether_sketch_delete')l.paths=l.paths.filter(p=>!ids.includes(p.id));
    else if(name==='aether_sketch_style')l.paths=l.paths.map(p=>ids.includes(p.id)?{...p,...style(args)}:p);
    else if(name==='aether_sketch_transform') {
      const b=pathBounds(chosen as DrawingPath[])!,cx=b.x+b.width/2,cy=b.y+b.height/2;
      const dx=finite(args.dx_px,0),dy=finite(args.dy_px,0),sx=finite(args.scale_x,1,.001,1000),sy=finite(args.scale_y,1,.001,1000),r=finite(args.rotation_deg,0,-36000,36000)*Math.PI/180;
      const map=([x,y]:Point):Point=>[cx+(x-cx)*sx*Math.cos(r)-(y-cy)*sy*Math.sin(r)+dx,cy+(x-cx)*sx*Math.sin(r)+(y-cy)*sy*Math.cos(r)+dy];
      l.paths=l.paths.map(p=>ids.includes(p.id)?{...p,...transformPath(p,map)}:p);
    } else throw Error('Unknown drawing edit.');
  }
  next=readDocument(serializeDocument(repairClips(next)));
  return {document:next,ids:name==='aether_sketch_delete'?[]:ids,layerID:l.id};
}
