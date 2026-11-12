import { booleanPaths, type Point } from '@aether/sketch';
import type { VectorGradient } from '@aether/sketch';
import { BRUSH_PRESETS, brushOpacity, brushOutline, type BrushSample } from './brush';
import { newDocument, newLayer, type DrawingPath, type Layer, type SketchDocument } from './document';
import { symmetryCopies } from './guides';

/** Sample drawings made only from Sketch's own brushes, fills and guides, the way an artist would in SketchBook. */
const preset = (id: string) => BRUSH_PRESETS.find(b => b.id === id)!;
let n = 0;
const nextID = () => `sample-${n++}`;
const lerp = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** A smooth curve through `points` (Catmull–Rom), `steps` samples per span. */
function smooth(points: Point[], steps = 12): Point[] {
  if (points.length < 3) return points.length === 2 ? Array.from({ length: steps + 1 }, (_, i) => lerp(points[0], points[1], i / steps)) : points;
  const out: Point[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)], p1 = points[i], p2 = points[i + 1], p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map(k => .5 * (2 * p1[k] + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as Point);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
const arc = (c: Point, r: number, from: number, to: number, steps = 32, ry = r): Point[] =>
  Array.from({ length: steps + 1 }, (_, i) => { const a = from + (to - from) * i / steps; return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * ry]; });

/** One brush stroke along a polyline. `press` shapes the pressure: firm in the middle, light at the ends, like a confident hand. */
function stroke(line: Point[], brushID: string, color: string, scale = 1, press = 1): DrawingPath {
  const b = preset(brushID), along = line.length > 2 ? line : smooth(line, 24);
  const samples: BrushSample[] = along.map((point, i) => ({ point, pressure: Math.min(1, press * (.35 + .65 * Math.sin(Math.PI * i / Math.max(1, along.length - 1)))), timeMs: i * 16 }));
  const size = b.sizePx * scale;
  return { id: nextID(), name: `${b.name} stroke`, points: brushOutline(samples, { sizePx: size, taper: b.taper, pen: true, minSize: b.minSize }), closed: true,
    color, fill: color, strokeEnabled: false, widthPx: 1, opacity: brushOpacity(b, samples), fillOpacity: 1, ...(b.softness ? { blurPx: b.softness * size * .35 } : {}) };
}
/** A filled shape: what the Fill and Lasso-fill tools make. */
const shape = (points: Point[], fill: string, opacity = 1, extra: Partial<DrawingPath> = {}): DrawingPath =>
  ({ id: nextID(), name: 'Fill', points, closed: true, color: fill, fill, strokeEnabled: false, widthPx: 1, opacity, fillOpacity: 1, ...extra });
const gradient = (angleDeg: number, ...colors: string[]): VectorGradient =>
  ({ kind: 'linear', angleDeg, stops: colors.map((color, i) => ({ offset: i / (colors.length - 1), color, opacity: 1 })) });
const radial = (...colors: string[]): VectorGradient => ({ ...gradient(0, ...colors), kind: 'radial' });
/** Paint inside a selection: keep only the part of `path` within `mask` (Combine → Intersect). */
function inside(path: DrawingPath, mask: Point[]): DrawingPath | null {
  const cut = booleanPaths([path, { points: mask, closed: true }], 'intersection', .25);
  return cut ? { ...path, ...cut } : null;
}
const keep = (paths: (DrawingPath | null)[]) => paths.filter((p): p is DrawingPath => p !== null);
const layer = (name: string, paths: DrawingPath[], extra: Partial<Layer> = {}): Layer => ({ ...newLayer(name), paths, ...extra });
const drawing = (widthPx: number, heightPx: number, layers: Layer[]): SketchDocument => ({ ...newDocument(), widthPx, heightPx, infinite: false, layers });

/** Industrial-design side view: blue construction lines, marker body inside the silhouette, ink line art and highlights. */
export function sampleCarSketch(): SketchDocument {
  n = 0;
  const ink = '#16171b', blue = '#3d7fd1', rear: Point = [400, 520], front: Point = [1010, 520], tyre = 78, archR = 92, ground = 598;
  const archFrom = Math.PI + Math.asin(20 / archR), archTo = Math.PI * 2 - Math.asin(20 / archR);
  const roof = smooth([[215, 482], [206, 420], [236, 372], [380, 343], [520, 298], [640, 281], [760, 295], [880, 367], [1040, 383], [1190, 407], [1219, 450], [1202, 498]]);
  const body: Point[] = [...roof, [1110, 500], ...arc(front, archR, archTo, archFrom), [492, 500], ...arc(rear, archR, archTo, archFrom), [250, 500]];
  const glass = [...smooth([[472, 368], [540, 318], [640, 301], [748, 311], [850, 366]]), [660, 370]] as Point[];

  const construction = layer('Construction', [
    stroke([[60, ground], [1340, ground]], 'pencil-hb', blue, 1.2), stroke([[160, rear[1]], [1260, front[1]]], 'pencil-hb', blue, .8, .6),
    ...[rear, front].flatMap(c => [stroke([[c[0], 250], [c[0], 640]], 'pencil-hb', blue, .8, .6), stroke(arc(c, tyre + 4, 0, Math.PI * 2, 48), 'pencil-hb', blue, .8, .6)]),
    stroke([[180, 372], [1240, 420]], 'pencil-hb', blue, .8, .5), stroke([[600, 230], [640, 281]], 'pencil-hb', blue, .8, .5),
  ], { blend: 'multiply', opacity: .55 });
  const shadow = layer('Ground shadow', [
    shape(arc([710, ground + 4], 560, 0, Math.PI * 2, 64, 24), '#1d2023', .55, { blurPx: 18 }),
    ...[rear, front].map(c => shape(arc([c[0], ground + 2], 96, 0, Math.PI * 2, 32, 9), '#000000', .8, { blurPx: 4 })),
  ], { blend: 'multiply' });
  const wheelsPaths: DrawingPath[] = [];
  for (const c of [rear, front]) {
    const spoke = shape([[c[0] - 7, c[1] - 12], [c[0] + 7, c[1] - 12], [c[0] + 4, c[1] - 50], [c[0] - 4, c[1] - 50]], '#c9ced4');
    wheelsPaths.push(shape([...arc(c, archR - 2, Math.PI, Math.PI * 2, 32), [c[0] + archR, c[1]]], '#0b0c0e'),
      shape(arc(c, tyre, 0, Math.PI * 2, 64), '#17181b'), shape(arc(c, 56, 0, Math.PI * 2, 48), '#2a2d31', 1, { fillGradient: radial('#6d737b', '#2a2d31') }),
      // Radial symmetry: one spoke drawn, five placed by the symmetry guide.
      spoke, ...symmetryCopies(spoke, { mode: 'radial', center: c, sections: 5 }).map(s => ({ ...s, id: nextID() })),
      shape(arc(c, 11, 0, Math.PI * 2, 24), '#9aa1a9'), stroke(arc(c, 66, Math.PI * 1.1, Math.PI * 1.45, 16), 'fine-liner', '#4a4f56', 1.2));
  }
  const wheels = layer('Wheels', wheelsPaths);
  const bodyColour = layer('Body colour', [
    shape(body, '#7fb23a', 1, { fillGradient: gradient(90, '#c3e27c', '#86b83f', '#4f7a26', '#2c4416') }),
    ...keep([
      ...[392, 412, 432].map((y, i) => inside(stroke([[190, y + 10], [700, y - 4], [1230, y + 22 + i * 4]], 'marker', '#46702a', 1.4), body)),
      inside(stroke([[190, 470], [700, 470], [1230, 478]], 'marker', '#2c4416', 1.8), body),
      ...[346, 362].map(y => inside(stroke([[250, y + 20], [640, y - 30], [1200, y + 46]], 'marker', '#d9efa0', 1.2, .8), body)),
      inside(shape([[540, 430], [660, 438], [650, 468], [560, 462]], '#1f2a16', .9), body),
    ]),
    shape(glass, '#1c2228', 1, { fillGradient: gradient(90, '#5c6a75', '#1c2228') }),
    ...keep([inside(stroke([[560, 380], [650, 290]], 'airbrush-hard', '#9fb2c0', .7, .7), glass), inside(stroke([[610, 380], [700, 290]], 'marker', '#8ea3b2', .9), glass)]),
    shape(smooth([[1150, 420], [1185, 418], [1212, 434], [1170, 438]], 6), '#f4f7fa', 1), shape(smooth([[206, 398], [240, 386], [246, 398], [210, 412]], 6), '#d23a2a', 1),
  ]);
  const lineArt = layer('Line art', [
    stroke(roof.slice(0, 70), 'ink-pen', ink, 1.1), stroke(roof.slice(66), 'ink-pen', ink, 1.1),
    stroke([[250, 500], [308, 500]], 'ink-pen', ink), stroke([[492, 500], [918, 500]], 'ink-pen', ink, 1.2), stroke([[1102, 500], [1170, 500]], 'ink-pen', ink),
    stroke(arc(rear, archR, archTo, archFrom, 24), 'ink-pen', ink, 1.2), stroke(arc(front, archR, archTo, archFrom, 24), 'ink-pen', ink, 1.2),
    stroke(glass.slice(0, -1), 'brush-pen', ink, .35), stroke([[472, 370], [850, 368]], 'fine-liner', ink),
    stroke([[700, 306], [690, 370]], 'brush-pen', ink, .3), stroke([[684, 372], [700, 492]], 'fine-liner', ink), stroke([[868, 372], [884, 492]], 'fine-liner', ink),
    stroke([[236, 404], [700, 398], [1210, 438]], 'fine-liner', ink, .8, .8), stroke([[540, 430], [660, 438], [650, 468]], 'fine-liner', ink),
    stroke([[760, 420], [800, 420]], 'brush-pen', ink, .25), stroke(arc(rear, tyre, 0, Math.PI * 2, 48), 'ink-pen', ink, .7, .7), stroke(arc(front, tyre, 0, Math.PI * 2, 48), 'ink-pen', ink, .7, .7),
  ]);
  const highlights = layer('Highlights', [
    stroke([[300, 356], [520, 312], [760, 306], [1060, 390]], 'airbrush-hard', '#ffffff', .45, .8),
    stroke([[540, 318], [640, 302], [730, 310]], 'fine-liner', '#ffffff', 1.3), stroke([[1060, 392], [1180, 412]], 'fine-liner', '#ffffff', 1.1),
    stroke([[520, 440], [600, 444]], 'fine-liner', '#ffffff', .9), ...[rear, front].map(c => stroke(arc(c, 46, Math.PI * 1.15, Math.PI * 1.6, 12), 'fine-liner', '#ffffff', 1.1)),
    stroke([[1200, 428], [1240, 426]], 'airbrush-soft', '#fff6c8', .5),
  ], { blend: 'screen' });
  return drawing(1400, 700, [highlights, lineArt, bodyColour, wheels, shadow, construction]);
}

/** Radial symmetry: one petal of ink and colour, repeated twelve times around the centre by the symmetry guide. */
export function sampleSymmetryOrnament(): SketchDocument {
  n = 0;
  const c: Point = [450, 450], ink = '#1b1530', sym = { mode: 'radial' as const, center: c, sections: 12 };
  const ring = (paths: DrawingPath[]) => paths.flatMap(p => [p, ...symmetryCopies(p, sym).map(s => ({ ...s, id: nextID() }))]);
  const petal = smooth([[450, 400], [418, 320], [430, 230], [450, 190], [470, 230], [482, 320], [450, 400]], 8);
  const leaf = smooth([[450, 160], [430, 120], [450, 70], [470, 120], [450, 160]], 8);
  const colour = layer('Colour', [
    shape(arc(c, 410, 0, Math.PI * 2, 96), '#fdf6e3', 1, { fillGradient: radial('#fff7e0', '#f6e2b8') }),
    ...ring([shape(petal, '#e0607e', 1, { fillGradient: gradient(90, '#f6a5b8', '#c0365a') })]),
    ...ring([shape(leaf, '#3c9d8a', 1, { fillGradient: gradient(90, '#7fd3bf', '#2a7c6c') })]),
    shape(arc(c, 46, 0, Math.PI * 2, 48), '#f2b134', 1, { fillGradient: radial('#ffe08a', '#e08a1e') }),
  ]);
  const shading = layer('Shading', ring([stroke([[440, 390], [426, 300], [440, 220]], 'marker', '#8c1f3f', .6), stroke([[452, 150], [445, 100]], 'marker', '#1d5a4e', .5)]), { blend: 'multiply' });
  const lines = layer('Ink', [
    ...ring([stroke(petal.slice(0, 26), 'ink-pen', ink, .8), stroke(petal.slice(24), 'ink-pen', ink, .8), stroke(leaf, 'fine-liner', ink, .9),
      stroke([[450, 380], [450, 230]], 'fine-liner', ink, .6, .6), stroke(arc(c, 300, -Math.PI / 2 + .12, -Math.PI / 2 + .4, 8), 'brush-pen', ink, .25)]),
    stroke(arc(c, 46, 0, Math.PI * 2, 48), 'ink-pen', ink, .9), stroke(arc(c, 395, 0, Math.PI * 2, 120), 'ink-pen', ink, .7, .8),
  ]);
  const glints = layer('Highlights', ring([stroke([[458, 370], [466, 300]], 'fine-liner', '#ffffff', 1.1), stroke([[456, 140], [458, 110]], 'fine-liner', '#ffffff', .9)]), { blend: 'screen' });
  return drawing(900, 900, [glints, lines, shading, colour]);
}

/** Two-point perspective: construction lines to both vanishing points, then marker faces, window grids and ink edges. */
export function samplePerspectiveStreet(): SketchDocument {
  n = 0;
  const ink = '#1a1c20', blue = '#3d7fd1', horizon = 300, left: Point = [-300, horizon], right: Point = [1500, horizon];
  /** The point at `x` on the line from `p` toward vanishing point `vp`. */
  const toward = (p: Point, vp: Point, x: number): Point => [x, p[1] + (vp[1] - p[1]) * (x - p[0]) / (vp[0] - p[0])];
  const block = (x: number, top: number, bottom: number, leftX: number, rightX: number) => {
    const t: Point = [x, top], b: Point = [x, bottom];
    return { t, b, lt: toward(t, left, leftX), lb: toward(b, left, leftX), rt: toward(t, right, rightX), rb: toward(b, right, rightX) };
  };
  // The shop stands back on the line of the tower's base, so both sit on one ground plane.
  const tower = block(560, 50, 610, 400, 790), shop = block(1010, 250, 455, 900, 1150);
  /** Windows on a face from near edge (a top, b bottom) to far edge (d top, c bottom): rows and columns meet at the vanishing point. */
  const windows = (a: Point, b: Point, c: Point, d: Point, rows: number, cols: number, colour: string) => Array.from({ length: rows * cols }, (_, k) => {
    const i = Math.floor(k / cols), j = k % cols, at = (u: number, v: number) => lerp(lerp(a, d, u), lerp(b, c, u), v);
    const u0 = (j + .2) / cols, u1 = (j + .8) / cols, v0 = (i + .25) / rows, v1 = (i + .8) / rows;
    return shape([at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)], colour, 1, { fillGradient: gradient(90, '#cfe4f5', colour) });
  });
  const edges = (k: ReturnType<typeof block>) => [
    stroke([k.t, k.b], 'ink-pen', ink, 1.1), stroke([k.lt, k.lb], 'ink-pen', ink), stroke([k.rt, k.rb], 'ink-pen', ink),
    stroke([k.t, k.lt], 'ink-pen', ink), stroke([k.t, k.rt], 'ink-pen', ink), stroke([k.b, k.lb], 'ink-pen', ink), stroke([k.b, k.rb], 'ink-pen', ink),
  ];
  const construction = layer('Perspective lines', [
    stroke([[0, horizon], [1200, horizon]], 'pencil-hb', blue, 1.1),
    ...[tower.t, tower.b, shop.t, shop.b, [560, 680] as Point, [1010, 680] as Point].flatMap(p => [stroke([p, toward(p, left, 0)], 'pencil-hb', blue, .7, .5), stroke([p, toward(p, right, 1200)], 'pencil-hb', blue, .7, .5)]),
  ], { blend: 'multiply', opacity: .6 });
  const sky = layer('Sky', [shape([[0, 0], [1200, 0], [1200, horizon], [0, horizon]], '#dcebf7', 1, { fillGradient: gradient(90, '#9cc4e8', '#eef5fb') }),
    stroke([[80, 120], [500, 100]], 'airbrush-soft', '#ffffff', 1.2), stroke([[760, 70], [1120, 90]], 'airbrush-soft', '#ffffff', 1)]);
  const ground = layer('Street', [
    shape([[0, horizon], [1200, horizon], [1200, 700], [0, 700]], '#a7aaae', 1, { fillGradient: gradient(90, '#d3d5d8', '#9a9ea3') }),
    shape([toward([560, 640], left, 0), [560, 640], toward([560, 640], right, 1200), [1200, 700], [0, 700]], '#55595e'),
    ...[0, 1, 2, 3, 4].map(i => { const x = 600 + i * 110, p = toward([560, 670], right, x), q = toward([560, 670], right, x + 60); return shape([p, q, [q[0], q[1] + 4], [p[0], p[1] + 4]], '#f3f1e6'); }),
  ]);
  const { t, b, lt, lb, rt, rb } = tower;
  const buildings = layer('Buildings', [
    shape([lt, t, b, lb], '#c9b79c', 1, { fillGradient: gradient(90, '#e3d3b8', '#b39c7c') }), shape([t, rt, rb, b], '#8d7a62', 1, { fillGradient: gradient(90, '#a08a6d', '#6c5a45') }),
    ...windows(t, b, lb, lt, 12, 3, '#4f7fa6'), ...windows(t, b, rb, rt, 12, 4, '#2f4f6a'),
    shape([shop.lt, shop.t, shop.b, shop.lb], '#c1534a', 1, { fillGradient: gradient(90, '#d9776d', '#a63d35') }), shape([shop.t, shop.rt, shop.rb, shop.b], '#8a3530'),
    ...windows(shop.t, shop.b, shop.rb, shop.rt, 2, 3, '#2f4f6a'), ...windows(shop.t, shop.b, shop.lb, shop.lt, 1, 2, '#4f7fa6'),
  ]);
  const shading = layer('Shading', keep([
    inside(stroke([toward(b, right, 560), toward(b, right, 800)], 'airbrush-soft', '#000000', .7), [t, rt, rb, b]),
    inside(stroke([toward(b, left, 560), toward(b, left, 390)], 'airbrush-soft', '#3b2f22', .5), [lt, t, b, lb]),
    inside(stroke([toward(shop.b, right, 1010), toward(shop.b, right, 1160)], 'airbrush-soft', '#000000', .5), [shop.t, shop.rt, shop.rb, shop.b]),
    stroke([toward(b, left, 400), b, toward(b, right, 790)], 'airbrush-hard', '#000000', .5, .6),
  ]), { blend: 'multiply' });
  const lines = layer('Ink', [...edges(tower), ...edges(shop), stroke([toward([560, 640], left, 0), [560, 640], toward([560, 640], right, 1200)], 'brush-pen', ink, .3)]);
  return drawing(1200, 700, [lines, shading, buildings, construction, ground, sky]);
}

/** The samples offered under More in the center tray. */
export const SAMPLES = [
  { id: 'sample-car', label: 'New sample: car sketch', name: 'Car sketch sample', make: sampleCarSketch },
  { id: 'sample-symmetry', label: 'New sample: symmetry ornament', name: 'Symmetry sample', make: sampleSymmetryOrnament },
  { id: 'sample-perspective', label: 'New sample: perspective street', name: 'Perspective sample', make: samplePerspectiveStreet },
] as const;
