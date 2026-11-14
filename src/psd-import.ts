import { newDocument, newPixelLayer, type Layer, type SketchDocument } from './document';
import { PIXEL_MAX_SIDE, canvasBitmap } from './pixels';
import { readPSD, type PSDLayer } from './psd';

/** A Photoshop file as a drawing of pixel layers, top layer first, with names, opacity, blend, visibility and clipping kept. */
export async function importPSD(bytes: Uint8Array): Promise<{ doc: SketchDocument; warnings: string[] }> {
  const file = readPSD(bytes), warnings = [...file.warnings];
  const stored: PSDLayer[] = file.layers.length ? file.layers : [{ name: 'Background', x: 0, y: 0, width: file.width, height: file.height, rgba: file.merged!, opacity: 1, blend: 'normal', visible: true }];
  const layers: Layer[] = [];
  for (const l of stored) {
    if (l.width > PIXEL_MAX_SIDE || l.height > PIXEL_MAX_SIDE) { warnings.push(`Layers larger than ${PIXEL_MAX_SIDE} px a side were left out.`); continue; }
    const canvas = document.createElement('canvas'); canvas.width = l.width; canvas.height = l.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Pixel layers are unavailable in this browser.');
    context.putImageData(new ImageData(new Uint8ClampedArray(l.rgba), l.width, l.height), 0, 0);
    const pixels = await canvasBitmap(canvas, { x: l.x, y: l.y });
    layers.push({ ...newPixelLayer(l.name.slice(0, 200) || 'Layer'), visible: l.visible, ...(l.opacity < 1 ? { opacity: l.opacity } : {}), ...(l.blend !== 'normal' ? { blend: l.blend } : {}), ...(l.clipped ? { role: 'clip' as const } : {}), ...(pixels ? { pixels } : {}) });
  }
  if (!layers.length) throw new Error('This Photoshop file has no layers small enough to import.');
  return { doc: { ...newDocument(), infinite: false, widthPx: Math.min(file.width, 16384), heightPx: Math.min(file.height, 16384), layers }, warnings: [...new Set(warnings)] };
}
