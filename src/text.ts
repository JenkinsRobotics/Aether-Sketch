import type { DrawingPath } from './document';
import { pathData, samplePath, type Point, type SketchPath } from '@aether/sketch';
import { defaultPaint } from './paint';
/** `onPath` text follows the path's own geometry instead of sitting in a four-cornered box; `align` then places it at the start, middle or end of the path. */
export interface VectorText { onPath?: true; content: string; fontFamily: string; fontSizePx: number; fontWeight: number; italic: boolean; align: 'start' | 'middle' | 'end'; lineHeight: number; widthPx: number; heightPx: number }
export const escapeXML = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
export function textDimensions(text: VectorText) {
  let width = 0;
  const ctx = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (ctx) ctx.font = `${text.italic ? 'italic ' : ''}${text.fontWeight} ${text.fontSizePx}px ${text.fontFamily}`;
  for (const line of text.content.split('\n')) width = Math.max(width, ctx?.measureText(line).width ?? line.length * text.fontSizePx * .65);
  return { widthPx: Math.max(text.fontSizePx, width), heightPx: text.fontSizePx * text.lineHeight * Math.max(1, text.content.split('\n').length) };
}
export function newText(at: Point): DrawingPath {
  const text: VectorText = { content: 'Text', fontFamily: 'sans-serif', fontSizePx: 48, fontWeight: 400, italic: false, align: 'start', lineHeight: 1.2, widthPx: 1, heightPx: 1 };
  Object.assign(text, textDimensions(text));
  return { ...defaultPaint, id: crypto.randomUUID(), name: 'Text', fill: '#2368ce', strokeEnabled: false, closed: true, points: [at, [at[0] + text.widthPx, at[1]], [at[0] + text.widthPx, at[1] + text.heightPx], [at[0], at[1] + text.heightPx]], text };
}
/** Text set along a copy of `guide`, which stays an ordinary path that the node tool can reshape. */
export function textOnPath(guide: SketchPath): DrawingPath {
  const text: VectorText = { onPath: true, content: 'Text on a path', fontFamily: 'sans-serif', fontSizePx: 32, fontWeight: 400, italic: false, align: 'start', lineHeight: 1.2, widthPx: 1, heightPx: 1 };
  Object.assign(text, textDimensions(text));
  return { ...defaultPaint, id: crypto.randomUUID(), name: 'Text on a path', fill: '#2368ce', fillOpen: true, strokeEnabled: false, points: guide.points, curves: guide.curves, nodeModes: guide.nodeModes, closed: guide.closed, text };
}
/** Text on a path is one line: line breaks become spaces. */
export const pathLine = (t: VectorText) => t.content.replace(/\s*\n\s*/g, ' ');
const ANCHOR = { start: 0, middle: 50, end: 100 } as const;
export const textPathID = (p: DrawingPath) => `sketch-text-path-${p.id.replace(/[^\w-]/g, '_')}`;
/**
 * Where each character of text on a path sits, for renderers without text-on-path of their own (PDF): the baseline
 * point and the direction of travel in radians. ponytail: characters are taken as half an em wide, as the PDF export does for text boxes.
 */
export function pathGlyphs(p: DrawingPath): { char: string; x: number; y: number; angle: number }[] {
  const t = p.text!, line = pathLine(t), advance = t.fontSizePx * .5, sampled = samplePath(p, .25), points = p.closed ? [...sampled, sampled[0]] : sampled;
  const lengths = points.reduce<number[]>((all, q, i) => [...all, i ? all[i - 1] + Math.hypot(q[0] - points[i - 1][0], q[1] - points[i - 1][1]) : 0], []), total = lengths[lengths.length - 1];
  const start = (total - line.length * advance) * ANCHOR[t.align] / 100, glyphs: ReturnType<typeof pathGlyphs> = [];
  for (let i = 0, at = 0; i < line.length; i++) {
    const s = start + i * advance; if (s < 0 || s + advance > total) continue; // what does not fit is left off, as SVG does
    while (at < points.length - 2 && lengths[at + 1] <= s) at++;
    const a = points[at], b = points[at + 1], k = (s - lengths[at]) / (lengths[at + 1] - lengths[at] || 1);
    glyphs.push({ char: line[i], x: a[0] + (b[0] - a[0]) * k, y: a[1] + (b[1] - a[1]) * k, angle: Math.atan2(b[1] - a[1], b[0] - a[0]) });
  }
  return glyphs;
}
export function textMatrix(p: DrawingPath): [number, number, number, number, number, number] {
  const t = p.text!, [o, x, , y] = p.points;
  return [(x[0] - o[0]) / t.widthPx, (x[1] - o[1]) / t.widthPx, (y[0] - o[0]) / t.heightPx, (y[1] - o[1]) / t.heightPx, o[0], o[1]];
}
export function updateText(p: DrawingPath, patch: Partial<VectorText>): DrawingPath {
  const old = p.text!, text = { ...old, ...patch }, size = textDimensions(text);
  if (old.onPath) return { ...p, text: { ...text, ...size } };
  const m = textMatrix(p);
  const map = (x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return { ...p, text: { ...text, ...size }, points: [map(0, 0), map(size.widthPx, 0), map(size.widthPx, size.heightPx), map(0, size.heightPx)] };
}
export function textSVG(p: DrawingPath, attrs: string) {
  const t = p.text!, x = t.align === 'start' ? 0 : t.align === 'middle' ? t.widthPx / 2 : t.widthPx;
  if (t.onPath) return `<defs><path id="${textPathID(p)}" d="${pathData(p)}"/></defs><text font-family="${escapeXML(t.fontFamily)}" font-size="${t.fontSizePx}" font-weight="${t.fontWeight}" font-style="${t.italic ? 'italic' : 'normal'}" text-anchor="${t.align}" xml:space="preserve" ${attrs}><textPath href="#${textPathID(p)}" startOffset="${ANCHOR[t.align]}%">${escapeXML(pathLine(t))}</textPath></text>`;
  return `<text transform="matrix(${textMatrix(p).join(' ')})" font-family="${escapeXML(t.fontFamily)}" font-size="${t.fontSizePx}" font-weight="${t.fontWeight}" font-style="${t.italic ? 'italic' : 'normal'}" text-anchor="${t.align}" xml:space="preserve" ${attrs}>${t.content.split('\n').map((line, i) => `<tspan x="${x}" y="${t.fontSizePx + i * t.fontSizePx * t.lineHeight}">${escapeXML(line)}</tspan>`).join('')}</text>`;
}
