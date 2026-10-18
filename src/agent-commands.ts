import { ellipsePath, pathBounds, transformPath, type Point } from '@aether/sketch';
import type { AgentTool } from '@aether/ui/AgentServices';
import { newLayer, readDocument, serializeDocument, type DrawingPath, type SketchDocument } from './document';
import { defaultPaint, repairClips } from './paint';
import { pathLocked, pathVisible } from './structure';
import { newText, updateText } from './text';

const string = {type:'string'}, number = {type:'number'};
const tool = (name:string, description:string, properties:Record<string,unknown>, required:string[]=[]):AgentTool => ({
  name:'aether_sketch_'+name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},
});
const layer = {layer_id:string};
const selection = {...layer,path_ids:{type:'array',items:string,minItems:1,maxItems:100}};
const appearance = {fill:{type:['string','null'],description:'Six digit hex color or null for no fill'},stroke:string,stroke_width_px:number,opacity:number};
export const sketchAgentTools:AgentTool[] = [
  {name:'aether_sketch_preview',description:'Render the current drawing to a PNG for visual review, including visible layers, clips, paint and text, on white. Read-only. Use inspect for exact geometry and sizes.',inputSchema:{type:'object',properties:{},required:[],additionalProperties:false}},
  tool('inspect','Inspect the current drawing, layer IDs, shape IDs and geometry. Coordinates are pixels, origin top left; positive y is down. Use offset/limit to page shapes.',{offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:50}}),
  tool('add_layer','Create an editable layer. Returns its ID.',{name:string},['name']),
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
  return {width_px:doc.widthPx,height_px:doc.heightPx,layers:doc.layers.map(l=>({id:l.id,name:l.name,visible:l.visible,locked:l.locked,shape_count:l.paths.length})),total_shapes:paths.length,offset,shapes:paths.slice(offset,offset+limit),next_offset:offset+limit<paths.length?offset+limit:null};
}
/** Pure document operation. The editor commits this validated candidate once. */
export function prepareDrawingEdit(doc:SketchDocument,name:string,args:Args):{document:SketchDocument;ids:string[];layerID:string} {
  const definition=sketchAgentTools.find(t=>t.name===name);
  if(!definition||!args||Array.isArray(args)||Object.keys(args).some(k=>!Object.hasOwn(definition.inputSchema.properties as object,k)))throw Error('Unknown drawing tool or argument.');
  let next=structuredClone(doc),ids:string[]=[];
  if(name==='aether_sketch_add_layer') {
    const created=newLayer(label(args.name));next.layers.push(created);
    return {document:readDocument(serializeDocument(next)),ids,layerID:created.id};
  }
  const l=next.layers.find(l=>l.id===args.layer_id);
  if(!l||l.locked||!l.visible)throw Error('Select an existing visible, unlocked layer.');
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
