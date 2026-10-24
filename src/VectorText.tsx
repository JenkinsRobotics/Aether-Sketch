import { textMatrix } from './text';
import type { DrawingPath } from './document';
import { paintAttributes } from './paint';
export function VectorText({ path, gradientID }: { path: DrawingPath; gradientID: string }) {
  const t = path.text!, x = t.align === 'start' ? 0 : t.align === 'middle' ? t.widthPx / 2 : t.widthPx;
  return <text data-vector-text transform={`matrix(${textMatrix(path).join(' ')})`} fontFamily={t.fontFamily} fontSize={t.fontSizePx} fontWeight={t.fontWeight} fontStyle={t.italic ? 'italic' : 'normal'} textAnchor={t.align} xmlSpace="preserve" {...paintAttributes(path, gradientID)}>
    {t.content.split('\n').map((line, i) => <tspan key={i} x={x} y={t.fontSizePx + i * t.fontSizePx * t.lineHeight}>{line || '\u00a0'}</tspan>)}
  </text>;
}
