import type { DrawingPath } from './document';
import type { Point } from '@aether/sketch';
import { defaultPaint } from './paint';
export interface VectorText { content: string; fontFamily: string; fontSizePx: number; fontWeight: number; italic: boolean; align: 'start' | 'middle' | 'end'; lineHeight: number; widthPx: number; heightPx: number }
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
export function textMatrix(p: DrawingPath): [number, number, number, number, number, number] {
  const t = p.text!, [o, x, , y] = p.points;
  return [(x[0] - o[0]) / t.widthPx, (x[1] - o[1]) / t.widthPx, (y[0] - o[0]) / t.heightPx, (y[1] - o[1]) / t.heightPx, o[0], o[1]];
}
export function updateText(p: DrawingPath, patch: Partial<VectorText>): DrawingPath {
  const old = p.text!, text = { ...old, ...patch }, size = textDimensions(text), m = textMatrix(p);
  const map = (x: number, y: number): Point => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  return { ...p, text: { ...text, ...size }, points: [map(0, 0), map(size.widthPx, 0), map(size.widthPx, size.heightPx), map(0, size.heightPx)] };
}
export function textSVG(p: DrawingPath, attrs: string) {
  const t = p.text!, x = t.align === 'start' ? 0 : t.align === 'middle' ? t.widthPx / 2 : t.widthPx;
  return `<text transform="matrix(${textMatrix(p).join(' ')})" font-family="${escapeXML(t.fontFamily)}" font-size="${t.fontSizePx}" font-weight="${t.fontWeight}" font-style="${t.italic ? 'italic' : 'normal'}" text-anchor="${t.align}" xml:space="preserve" ${attrs}>${t.content.split('\n').map((line, i) => `<tspan x="${x}" y="${t.fontSizePx + i * t.fontSizePx * t.lineHeight}">${escapeXML(line)}</tspan>`).join('')}</text>`;
}
