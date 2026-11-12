import type { Point } from '@aether/sketch';
import { BRUSH_PRESETS, brushOpacity, brushOutline, type BrushSample } from './brush';
import { newDocument, newLayer, type DrawingPath, type Layer, type SketchDocument } from './document';

/** A car design sketch built only from Sketch's own brushes, the way an artist would in SketchBook:
 * a soft airbrush ground shadow, marker body colour, ink line art and soft highlights, on blended layers. */
const preset = (id: string) => BRUSH_PRESETS.find(b => b.id === id)!;
const bezier = (p: Point[], t: number): Point => {
  const [a, b, c, d] = p.length === 4 ? p : [p[0], p[0], p[1], p[1]], u = 1 - t;
  return [u ** 3 * a[0] + 3 * u * u * t * b[0] + 3 * u * t * t * c[0] + t ** 3 * d[0], u ** 3 * a[1] + 3 * u * u * t * b[1] + 3 * u * t * t * c[1] + t ** 3 * d[1]];
};
let n = 0;
/** One brush stroke along a cubic (or straight) curve, pressed hardest in the middle like a confident hand. */
function stroke(curve: Point[], brushID: string, color: string, scale = 1, press = 1): DrawingPath {
  const b = preset(brushID), steps = 48;
  const samples: BrushSample[] = Array.from({ length: steps }, (_, i) => ({ point: bezier(curve, i / (steps - 1)), pressure: Math.min(1, press * (.35 + .65 * Math.sin(Math.PI * i / (steps - 1)))), timeMs: i * 16 }));
  const size = b.sizePx * scale;
  return { id: `sample-${n++}`, name: `${b.name} stroke`, points: brushOutline(samples, { sizePx: size, taper: b.taper, pen: true, minSize: b.minSize }), closed: true,
    color, fill: color, strokeEnabled: false, widthPx: 1, opacity: brushOpacity(b, samples), fillOpacity: 1, ...(b.softness ? { blurPx: b.softness * size * .35 } : {}) };
}
const ellipse = (cx: number, cy: number, rx: number, ry: number, from = 0, to = Math.PI * 2): Point[] => [0, 1 / 3, 2 / 3, 1].map(t => { const a = from + (to - from) * t; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]; });
const shape = (points: Point[], fill: string, opacity = 1, blurPx?: number): DrawingPath => ({ id: `sample-${n++}`, name: 'Fill', points, closed: true, color: fill, fill, strokeEnabled: false, widthPx: 1, opacity, fillOpacity: 1, ...(blurPx ? { blurPx } : {}) });
const circle = (cx: number, cy: number, r: number): Point[] => Array.from({ length: 48 }, (_, i) => [cx + Math.cos(i / 48 * Math.PI * 2) * r, cy + Math.sin(i / 48 * Math.PI * 2) * r]);
const layer = (name: string, paths: DrawingPath[], extra: Partial<Layer> = {}): Layer => ({ ...newLayer(name), paths, ...extra });

export function sampleCarSketch(): SketchDocument {
  n = 0;
  const ink = '#17181c', green = '#7fb23a', shade = '#2f3a2a';
  const shadow = layer('Ground shadow', [
    stroke([[180, 505], [1060, 505]], 'airbrush-soft', '#202020', 2.2), stroke([[260, 500], [980, 500]], 'airbrush-soft', '#101010', 1.4),
    stroke([[300, 492], [940, 492]], 'airbrush-hard', '#101010', 1.2, .7),
  ], { blend: 'multiply' });
  const body = layer('Body colour', [
    ...[300, 330, 360, 390, 420].map((y, i) => stroke([[240 + i * 6, y + 20], [520, y], [760, y - 8], [1000 - i * 10, y + 12]], 'marker', green, 1.6)),
    stroke([[300, 435], [600, 445], [800, 442], [980, 430]], 'marker', shade, 1.8), stroke([[320, 450], [960, 448]], 'marker', shade, 1.4),
    shape([[470, 292], [560, 266], [690, 262], [820, 330], [700, 336], [480, 340]], '#23282b', .85),
  ], { blend: 'multiply', opacity: .9 });
  const wheels = layer('Wheels', [
    shape(circle(370, 452, 64), '#141517'), shape(circle(860, 452, 64), '#141517'),
    shape(circle(370, 452, 30), '#8a8f96'), shape(circle(860, 452, 30), '#8a8f96'),
  ]);
  const lines = layer('Line art', [
    stroke([[232, 384], [330, 330], [430, 262], [600, 246]], 'ink-pen', ink, 1.2), stroke([[600, 246], [760, 240], [880, 300], [1012, 352]], 'ink-pen', ink, 1.2),
    stroke([[222, 386], [500, 376], [800, 372], [1024, 366]], 'ink-pen', ink, .9),
    stroke([[262, 452], [300, 452]], 'ink-pen', ink), stroke([[440, 450], [790, 446]], 'ink-pen', ink, 1.1), stroke([[930, 446], [982, 444]], 'ink-pen', ink),
    stroke([[1012, 352], [1034, 380], [1036, 420], [984, 444]], 'ink-pen', ink), stroke([[232, 384], [210, 405], [214, 440], [262, 452]], 'ink-pen', ink),
    stroke([[470, 292], [560, 266], [690, 262], [820, 330]], 'brush-pen', ink, .5), stroke([[480, 340], [650, 338], [820, 330]], 'fine-liner', ink),
    stroke(ellipse(370, 452, 70, 70, Math.PI * 1.02, Math.PI * 1.98), 'ink-pen', ink, 1.1), stroke(ellipse(860, 452, 70, 70, Math.PI * 1.02, Math.PI * 1.98), 'ink-pen', ink, 1.1),
    stroke(ellipse(370, 452, 30, 30, -.4, 2.4), 'fine-liner', '#e6e8ea'), stroke(ellipse(860, 452, 30, 30, -.4, 2.4), 'fine-liner', '#e6e8ea'),
    stroke([[170, 520], [420, 518]], 'pencil-hb', ink, 1.4), stroke([[700, 522], [1090, 520]], 'pencil-hb', ink, 1.4),
    stroke([[640, 250], [640, 372]], 'pencil-hb', '#c0392b', .8, .5),
  ]);
  const highlights = layer('Highlights', [
    stroke([[300, 340], [450, 290], [620, 276], [760, 282]], 'airbrush-hard', '#ffffff', .5), stroke([[930, 350], [1000, 368]], 'airbrush-soft', '#ff3b2f', .9),
    stroke([[480, 300], [600, 280]], 'fine-liner', '#ffffff', 1.2),
  ], { blend: 'screen' });
  return { ...newDocument(), widthPx: 1200, heightPx: 640, infinite: false, layers: [highlights, lines, wheels, body, shadow] };
}
