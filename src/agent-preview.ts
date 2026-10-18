import { agentCanvasImage, agentToolContent, AGENT_IMAGE_EDGE } from '@aether/ui/AgentToolResult';
import type { SketchDocument } from './document';
import { drawingSVG } from './paint';

/** Uses the same visible paths, clips, text and paint as SVG export. No app chrome. */
export async function previewDrawing(doc: SketchDocument, signal: AbortSignal) {
  signal.throwIfAborted();
  const svg = drawingSVG(doc);
  if (new TextEncoder().encode(svg).length > 2 * 1024 * 1024) throw Error('The drawing is too complex for an agent preview.');
  const canvas = document.createElement('canvas');
  const scale = Math.min(1, AGENT_IMAGE_EDGE / Math.max(doc.widthPx, doc.heightPx));
  canvas.width = Math.max(1,Math.round(doc.widthPx * scale)); canvas.height = Math.max(1,Math.round(doc.heightPx * scale));
  const context = canvas.getContext('2d');
  if (!context) throw Error('Preview rendering is unavailable.');
  // A Blob-backed SVG image cannot run scripts or load external subresources.
  const url = URL.createObjectURL(new Blob([svg], {type:'image/svg+xml'})), image = new Image();
  try {
    await new Promise<void>((resolve,reject) => {
      const finish = (error?: Error) => { clearTimeout(timer);signal.removeEventListener('abort',cancel);image.onload=null;image.onerror=null;error?reject(error):resolve(); };
      const cancel = () => finish(new Error('Preview cancelled.'));
      const timer = setTimeout(() => finish(new Error('Preview rendering timed out.')),8000);
      signal.addEventListener('abort',cancel,{once:true});
      image.onload=()=>finish(); image.onerror=()=>finish(new Error('The drawing could not be rendered.'));
      image.src=url;
    });
    signal.throwIfAborted();
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return agentToolContent({kind:'drawing',artboard_px:{width:doc.widthPx,height:doc.heightPx},
      background:'white',changed:false},agentCanvasImage(canvas,signal));
  } finally { image.src='';URL.revokeObjectURL(url); }
}
