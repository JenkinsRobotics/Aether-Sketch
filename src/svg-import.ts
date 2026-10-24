import { parseSVGPath, svgElementPaths, pathData, transformPath, type SketchPath, type VectorGradient } from '@aether/sketch';
import { newDocument, readDocument, serializeDocument, type DrawingPath, type SketchDocument } from './document';
import { defaultPaint } from './paint';
import { newText, updateText } from './text';
interface ImportResult { doc: SketchDocument; warnings: string[] }
const numbers = (s: string) => (s.match(/[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi) ?? []).map(Number);
const num = (e: Element, key: string, fallback = 0) => e.hasAttribute(key) ? Number.parseFloat(e.getAttribute(key)!) : fallback;
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const colors = new Map<string, { color: string; opacity: number }>();
function parsedColor(value: string, fallback: string) {
  const key=value+'|'+fallback, cached=colors.get(key);if(cached)return cached;
  const ctx=document.createElement('canvas').getContext('2d');
  if(!ctx || /url\(/i.test(value))return {color:fallback,opacity:1};
  ctx.fillStyle=fallback;ctx.fillStyle=value;ctx.fillRect(0,0,1,1);
  const rgba=ctx.getImageData(0,0,1,1).data;
  const result={color:'#'+[...rgba].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join(''),opacity:rgba[3]/255};
  colors.set(key,result);return result;
}
const color=(value:string,fallback:string)=>parsedColor(value,fallback).color;
/** Parse a supported SVG drawing into data only. Never mount its DOM, scripts or external resources. */
export function importSVG(xml: string): ImportResult {
  if (xml.length > 20_000_000) throw Error('This SVG exceeds the 20 MB limit.');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw Error('SVG entity declarations are not supported.');
  const dom = new DOMParser().parseFromString(xml, 'image/svg+xml'), root = dom.documentElement;
  if (root.localName !== 'svg' || dom.querySelector('parsererror')) throw Error('Invalid SVG document.');
  if (dom.querySelectorAll('*').length > 12000) throw Error('This SVG has too many elements.');
  const warnings = new Set<string>(), doc = newDocument(), layer = doc.layers[0]; layer.name = 'Imported SVG'; layer.groups = [];
  const vb = numbers(root.getAttribute('viewBox') ?? '');
  doc.widthPx = vb.length === 4 ? vb[2] : num(root, 'width', 1200); doc.heightPx = vb.length === 4 ? vb[3] : num(root, 'height', 800);
  const initial = vb.length === 4 ? `translate(${-vb[0]} ${-vb[1]})` : '';
  const byID = new Map([...dom.querySelectorAll('[id]')].map(e => [e.id, e]));
  const gradient = (value: string, fallback: string): VectorGradient | undefined => {
    const id = value.match(/^url\(\s*['"]?#([^)'"\s]+)['"]?\s*\)$/)?.[1], node = id && byID.get(id);
    if (!node || !['linearGradient', 'radialGradient'].includes(node.localName)) return undefined;
    if (node.getAttribute('gradientUnits') === 'userSpaceOnUse' || node.hasAttribute('gradientTransform') || node.hasAttribute('href')) { warnings.add('Custom gradient coordinates/references use a solid fallback.'); return undefined; }
    const coordinate = (key: string, d: number) => { const v = node.getAttribute(key); return v === null ? d : parseFloat(v) / (v.includes('%') ? 100 : 1); };
    const stops = [...node.children].filter(e => e.localName === 'stop').map(e => {
      const style = Object.fromEntries((e.getAttribute('style') ?? '').split(';').filter(Boolean).map(v => v.split(':').map(s => s.trim())));
      const offset = e.getAttribute('offset') ?? '0';
      return { offset: clamp(parseFloat(offset) / (offset.includes('%') ? 100 : 1)), color: color(e.getAttribute('stop-color') ?? style['stop-color'] ?? '#000000', fallback), opacity: clamp(parseFloat(e.getAttribute('stop-opacity') ?? style['stop-opacity'] ?? '1')) };
    }).sort((a, b) => a.offset - b.offset);
    if (stops.length < 2 || stops.length > 16) { warnings.add('Gradients need 2–16 stops; unsupported gradients use a solid fallback.'); return undefined; }
    if (node.localName === 'radialGradient' && (coordinate('cx', .5) !== .5 || coordinate('cy', .5) !== .5 || coordinate('r', .5) !== .5 || node.hasAttribute('fx') || node.hasAttribute('fy'))) { warnings.add('Off-center radial gradients use a solid fallback.'); return undefined; }
    const x1 = coordinate('x1', 0), y1 = coordinate('y1', 0), x2 = coordinate('x2', 1), y2 = coordinate('y2', 0);
    if (node.localName === 'linearGradient' && (Math.abs(x1 + x2 - 1) > 1e-6 || (y1 !== y2 && Math.abs(y1 + y2 - 1) > 1e-6))) warnings.add('Custom linear gradient extents are fitted to the shape.');
    return { kind: node.localName === 'linearGradient' ? 'linear' : 'radial', angleDeg: Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI, stops };
  };
  function geometry(e: Element, transform: string): SketchPath[] {
    return svgElementPaths(e.localName,Object.fromEntries(Array.from(e.attributes).map(a=>[a.name,a.value])),transform);
  }
  const inherited = ['fill','stroke','stroke-width','fill-opacity','stroke-opacity','fill-rule','stroke-linecap','stroke-linejoin','font-family','font-size','font-weight','font-style','text-anchor','color','stroke-dasharray'];
  function visit(e: Element, parent: Record<string,string>, transform: string, groupID?: string, opacity = 1, depth = 0) {
    if (depth > 100) throw Error('SVG nesting exceeds the import limit.');
    const name = e.localName;
    if (['defs','title','desc','metadata'].includes(name)) return;
    if (['script','foreignObject','image','use','style','filter','mask','symbol'].includes(name)) { warnings.add(`Skipped unsupported ${name} elements.`); return; }
    const style = { ...parent, ...Object.fromEntries((e.getAttribute('style') ?? '').split(';').filter(Boolean).map(v => { const i=v.indexOf(':'); return [v.slice(0,i).trim(),v.slice(i+1).trim()]; })) };
    for (const key of inherited) if(e.hasAttribute(key)) style[key]=e.getAttribute(key)!;
    if (style.display === 'none' || style.visibility === 'hidden' || e.getAttribute('display') === 'none') return;
    const combined = `${transform} ${e.getAttribute('transform') ?? ''}`;
    const localOpacity = clamp(parseFloat(e.getAttribute('opacity') ?? style.opacity ?? '1')); delete style.opacity;
    opacity *= localOpacity;
    if (e.hasAttribute('filter') || e.hasAttribute('mask')) warnings.add('Filters and raster masks are not imported.');
    if (name === 'g' || name === 'svg') {
      if (name === 'g') { const id=crypto.randomUUID(); layer.groups!.push({id,name:e.getAttribute('aria-label') || e.id || 'SVG group',parentID:groupID}); groupID=id; if(localOpacity !== 1) warnings.add('Group opacity is applied to its individual objects.'); }
    }
    const clipID = (e.getAttribute('clip-path') ?? style['clip-path'] ?? '').match(/url\(#([^)]*)\)/)?.[1];
    if (clipID) {
      const clip = byID.get(clipID);
      if (clip?.localName === 'clipPath' && clip.getAttribute('clipPathUnits') !== 'objectBoundingBox') {
        const contours = [...clip.children].flatMap(child=>geometry(child, `${combined} ${clip.getAttribute('transform')??''} ${child.getAttribute('transform')??''}`));
        if (contours.length && contours.every(p=>p.closed)) {
          const id=crypto.randomUUID(), boundary=crypto.randomUUID(); layer.groups!.push({id,name:'Clipping group',parentID:groupID,clipPathID:boundary}); groupID=id;
          layer.paths.push({...defaultPaint,...contours[0],subpaths:contours.slice(1),id:boundary,groupID,hidden:true,fillRule:clip.firstElementChild?.getAttribute('clip-rule') === 'evenodd' ? 'evenodd':'nonzero',name:'Clip boundary'});
        }
      } else warnings.add('Unsupported clip coordinates were skipped.');
    }
    if(name === 'g' || name === 'svg') { for(const child of e.children) visit(child,style,combined,groupID,opacity,depth+1); return; }
    const fill = style.fill ?? '#000000', stroke = style.stroke ?? 'none', fillColor=color(fill === 'currentColor' ? style.color ?? '#000000' : fill, '#000000');
    const paint = { ...defaultPaint, color:color(stroke,'#000000'),fill:fill==='none'?null:fillColor,strokeEnabled:stroke!=='none',widthPx:Math.max(.1,parseFloat(style['stroke-width']??'1')),opacity,fillOpacity:clamp(parseFloat(style['fill-opacity']??'1'))*parsedColor(fillColor===fill?fillColor:fill,fillColor).opacity,strokeOpacity:clamp(parseFloat(style['stroke-opacity']??'1'))*parsedColor(stroke,'#000000').opacity,fillGradient:gradient(fill,fillColor),lineCap: ['butt','round','square'].includes(style['stroke-linecap']) ? style['stroke-linecap'] as DrawingPath['lineCap']:'butt',lineJoin:['miter','round','bevel'].includes(style['stroke-linejoin']) ? style['stroke-linejoin'] as DrawingPath['lineJoin']:'miter' };
    if(style['stroke-dasharray'] && style['stroke-dasharray']!=='none') { const d=numbers(style['stroke-dasharray']); if(d.length===2 && Math.abs(d[0]/paint.widthPx-4)<.01 && Math.abs(d[1]/paint.widthPx-2)<.01) paint.dash='dashed'; else if(d.length===2 && Math.abs(d[0]/paint.widthPx-1)<.01 && Math.abs(d[1]/paint.widthPx-2)<.01) paint.dash='dotted'; else warnings.add('Custom stroke dash patterns use a solid stroke.'); }
    if (name === 'text') {
      const spans=[...e.children].filter(c=>c.localName==='tspan'), content=spans.length?spans.map(c=>c.textContent??'').join('\n'):e.textContent??'';
      const size=parseFloat(style['font-size']??'16');
      const spacing=spans.length>1?(num(spans[1],'y',size*2.2)-num(spans[0],'y',size))/size:1.2;
      const lineHeight=spacing>=.5&&spacing<=5?spacing:1.2;
      if(spans.some((span,i)=>span.hasAttribute('style')||span.hasAttribute('dy')||(i>0&&(num(span,'x')!==num(spans[0],'x')||Math.abs(num(span,'y')-num(spans[0],'y')-i*size*lineHeight)>.01)))) warnings.add('Custom text span positioning or styles were simplified to multiline text.');
      let p=updateText(newText([num(e,'x',spans.length?num(spans[0],'x'):0),num(e,'y',spans.length?num(spans[0],'y'):0)-size]), {content,fontSizePx:size,fontFamily:style['font-family']??'sans-serif',fontWeight:style['font-weight']==='bold'?700:parseFloat(style['font-weight']??'400'),italic:style['font-style']==='italic',align:['middle','end'].includes(style['text-anchor'])?style['text-anchor'] as 'middle'|'end':'start'});
      p=updateText(p,{lineHeight});
      const shift=p.text!.align==='middle'?-p.text!.widthPx/2:p.text!.align==='end'?-p.text!.widthPx:0;
      p={...p,...transformPath(p,v=>[v[0]+shift,v[1]])};
      const transformed=parseSVGPath(pathData(p),combined)[0];
      layer.paths.push({...p,...transformed,curves:undefined,...paint,id:crypto.randomUUID(),groupID,name:e.id||'Text'}); return;
    }
    const paths=geometry(e,combined); if(!paths.length) {warnings.add(`Skipped unsupported or empty ${name} element.`);return;}
    // An SVG path has one fill across every subpath, including open subpaths implicitly closed by SVG.
    layer.paths.push({...paint,...paths[0],subpaths:paths.length>1?paths.slice(1):undefined,fillOpen:fill!=='none',fillRule:style['fill-rule']==='evenodd'?'evenodd':'nonzero',id:crypto.randomUUID(),groupID,name:e.id||'SVG path'});
  }
  visit(root,{},initial);
  if(!layer.paths.length) throw Error('This SVG contains no supported editable vectors.');
  return {doc:readDocument(serializeDocument(doc)),warnings:[...warnings]};
}
