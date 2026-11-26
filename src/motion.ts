// Motion: flipbook frames (layers shown one at a time), animated PNG and video output, and the time-lapse recorder.
import type { Layer, SketchDocument } from './document';
import { crc32 } from './export';

const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
/** The drawing as frame `index` shows it: every other frame hidden. `onion` ghosts the frame before and the frame after. */
export function frameDoc(doc: SketchDocument, index: number, onion = false): SketchDocument {
  const frames = doc.flipbook?.frames; if (!frames?.length) return doc;
  const at = clamp(Math.round(index), 0, frames.length - 1), ghost = new Map<string, number>(onion ? [[frames[at + 1], .14], [frames[at - 1], .28]] : []);
  return { ...doc, layers: doc.layers.map(l => !frames.includes(l.id) || l.id === frames[at] ? l : ghost.has(l.id) ? { ...l, opacity: (l.opacity ?? 1) * ghost.get(l.id)! } : { ...l, visible: false }) };
}
/** Start a flipbook with one layer as its first frame, or put a new layer in as the frame after `after`: above that frame's layer in the stack. */
export function addFrame(doc: SketchDocument, layer: Layer, after?: number): SketchDocument {
  const book = doc.flipbook ?? { fps: 12, frames: [] }, known = doc.layers.some(l => l.id === layer.id);
  const at = after === undefined ? book.frames.length : clamp(after + 1, 0, book.frames.length), beside = doc.layers.findIndex(l => l.id === book.frames[at - 1]);
  const layers = known ? doc.layers : [...doc.layers.slice(0, Math.max(0, beside)), layer, ...doc.layers.slice(Math.max(0, beside))];
  return { ...doc, layers, flipbook: { ...book, frames: [...book.frames.slice(0, at).filter(id => id !== layer.id), layer.id, ...book.frames.slice(at).filter(id => id !== layer.id)] } };
}
/** Make every frame an ordinary layer again. Nothing is deleted. */
export function endFlipbook(doc: SketchDocument): SketchDocument { const { flipbook: _book, ...rest } = doc; return rest; }

// ---- Animated PNG (APNG): the frames' own PNG data, rewrapped. Lossless, keeps transparency, plays in every browser.
const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
function chunks(png: Uint8Array) {
  if (SIGNATURE.some((b, i) => png[i] !== b)) throw new Error('A frame is not a PNG image.');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength), out: { type: string; data: Uint8Array }[] = [];
  for (let at = 8; at + 12 <= png.length;) { const length = view.getUint32(at); out.push({ type: String.fromCharCode(...png.subarray(at + 4, at + 8)), data: png.subarray(at + 8, at + 8 + length) }); at += 12 + length; }
  return out;
}
/** One animated PNG from PNG frames of the same size, `fps` frames a second, repeating `loops` times (0: for ever). */
export function animatedPNG(frames: Uint8Array[], fps: number, loops = 0): Uint8Array {
  if (!frames.length) throw new Error('There are no frames to export.');
  const parsed = frames.map(chunks), header = parsed[0].find(c => c.type === 'IHDR')!.data, parts: Uint8Array[] = [Uint8Array.from(SIGNATURE)];
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer); view.setUint32(0, data.length);
    out.set(Uint8Array.from(type, c => c.charCodeAt(0)), 4); out.set(data, 8); view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length))); parts.push(out);
  };
  const numbers = (...values: [number, 1 | 2 | 4][]) => { const out = new Uint8Array(values.reduce((n, [, size]) => n + size, 0)), view = new DataView(out.buffer); let at = 0; for (const [v, size] of values) { if (size === 4) view.setUint32(at, v); else if (size === 2) view.setUint16(at, v); else out[at] = v; at += size; } return out; };
  const size = new DataView(header.buffer, header.byteOffset, header.byteLength), width = size.getUint32(0), height = size.getUint32(4), rate = clamp(Math.round(fps), 1, 60);
  chunk('IHDR', header); chunk('acTL', numbers([frames.length, 4], [loops, 4]));
  let sequence = 0;
  parsed.forEach((frame, i) => {
    if (frame.find(c => c.type === 'IHDR')!.data.some((b, k) => b !== header[k])) throw new Error('The frames are not all the same size and kind of PNG.');
    // Each frame replaces the whole picture and shows for 1/fps of a second.
    chunk('fcTL', numbers([sequence++, 4], [width, 4], [height, 4], [0, 4], [0, 4], [1, 2], [rate, 2], [0, 1], [0, 1]));
    for (const c of frame.filter(c => c.type === 'IDAT')) {
      if (i === 0) chunk('IDAT', c.data);
      else { const data = new Uint8Array(4 + c.data.length); new DataView(data.buffer).setUint32(0, sequence++); data.set(c.data, 4); chunk('fdAT', data); }
    }
  });
  chunk('IEND', new Uint8Array(0));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

// ---- Video: frames drawn to a canvas and recorded by the browser. WebM in Chrome and Firefox, MP4 in Safari.
/** Record `count` frames at `fps`. `draw` paints frame `index` on the canvas. The recording runs in real time, so it takes as long as the video lasts. */
export async function canvasVideo(width: number, height: number, fps: number, count: number, draw: (context: CanvasRenderingContext2D, index: number) => void | Promise<void>): Promise<Blob> {
  const kind = typeof MediaRecorder === 'undefined' ? undefined : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find(type => MediaRecorder.isTypeSupported(type));
  if (!kind) throw new Error('This browser cannot record video.');
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); if (!context) throw new Error('Video export is unavailable in this browser.');
  const stream = canvas.captureStream(0), track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void };
  const recorder = new MediaRecorder(stream, { mimeType: kind, videoBitsPerSecond: 8_000_000 }), pieces: Blob[] = [];
  recorder.ondataavailable = event => { if (event.data.size) pieces.push(event.data); };
  const stopped = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error('The video could not be recorded.')); });
  recorder.start();
  // The last frame is held for a second, so the finished picture is seen.
  // (It is drawn again each time: the browser records a frame only when the canvas has been painted.)
  for (let i = 0; i < count + Math.ceil(fps); i++) { await draw(context, Math.min(i, count - 1)); track.requestFrame?.(); await new Promise(resolve => setTimeout(resolve, 1000 / fps)); }
  recorder.stop(); await stopped; track.stop();
  return new Blob(pieces, { type: kind.split(';')[0] });
}
/** Width and height for a video of this area: the longest side at most `longest`, both even (encoders want that). */
export function videoSize(area: { width: number; height: number }, longest = 1280) {
  const k = Math.min(1, longest / Math.max(area.width, area.height)) * (Math.max(area.width, area.height) < 320 ? 320 / Math.max(area.width, area.height) : 1), even = (v: number) => Math.max(2, Math.round(v * k / 2) * 2);
  return { width: even(area.width), height: even(area.height) };
}

// ---- Time-lapse: a picture of the drawing after each change, kept in memory while recording is on.
export interface LapseFrame { blob: Blob; area: { x: number; y: number; width: number; height: number } }
/** Keep a time-lapse within `limit` frames by dropping every other one: the whole session stays, at half the detail. */
export const thinFrames = <T,>(frames: T[], limit = 1500): T[] => frames.length > limit ? frames.filter((_, i) => i % 2 === 0 || i === frames.length - 1) : frames;
/** Where a frame taken of `area` sits in a video framed on `final`, in video pixels. */
export function placeFrame(area: LapseFrame['area'], final: LapseFrame['area'], size: { width: number; height: number }) {
  const kx = size.width / final.width, ky = size.height / final.height;
  return { x: (area.x - final.x) * kx, y: (area.y - final.y) * ky, width: area.width * kx, height: area.height * ky };
}
