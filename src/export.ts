import { pathContours, type SketchPath } from '@aether/sketch';
import { dashArray, drawnParts } from './vector';
import { clipPaths, drawingSVG, exportArea } from './paint';
import { pathVisible } from './structure';
import { pathGlyphs, textMatrix } from './text';
import type { DrawingPath, Layer, PixelBitmap, SketchDocument } from './document';
import { depthRegion, layerDepths } from './depth';
import { PIXEL_MAX_SIDE, canvasBitmap } from './pixels';

type Area = ReturnType<typeof exportArea>;
/** Raster exports: the longest side lands between 512 and 8192 px, so an infinite drawing exports at a usable size at any zoom. */
export function rasterSize(area: Area, scale = 2, maxSide = 8192) {
  const longest = Math.max(area.width, area.height) * scale, fit = Math.min(maxSide, Math.max(Math.min(512, maxSide), longest)) / longest;
  return { width: Math.max(1, Math.round(area.width * scale * fit)), height: Math.max(1, Math.round(area.height * scale * fit)) };
}

/** PNG, JPEG or WebP through the browser's own encoder. JPEG has no transparency, so it gets a white page. */
export async function rasterBlob(doc: SketchDocument, type: 'image/png' | 'image/jpeg' | 'image/webp', area = exportArea(doc), maxSide?: number, only?: readonly string[]): Promise<Blob> {
  const size = rasterSize(area, 2, maxSide), url = URL.createObjectURL(new Blob([drawingSVG(doc, area, only)], { type: 'image/svg+xml' })), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Image export is unavailable in this browser.');
    if (type === 'image/jpeg') { context.fillStyle = '#ffffff'; context.fillRect(0, 0, size.width, size.height); }
    context.drawImage(image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, .92));
    if (!blob || blob.type !== type) throw new Error(`This browser cannot encode ${type.slice(6).toUpperCase()}.`);
    return blob;
  } finally { URL.revokeObjectURL(url); }
}

/** The layers `only`, as they look in `doc`, as one layer bitmap at one pixel per document pixel. Null bitmap when they are empty. */
export async function flattenLayers(doc: SketchDocument, only: readonly string[]): Promise<{ bitmap: PixelBitmap | null } | { problem: string }> {
  const region = depthRegion(doc, doc.layers.filter(l => only.includes(l.id))); if (!region) return { bitmap: null };
  const x = Math.floor(region.x), y = Math.floor(region.y), area = { x, y, width: Math.ceil(region.x + region.width) - x, height: Math.ceil(region.y + region.height) - y };
  if (area.width > PIXEL_MAX_SIDE || area.height > PIXEL_MAX_SIDE) return { problem: `These layers cover more than ${PIXEL_MAX_SIDE} px a side, the most one pixel layer holds, so they were not merged.` };
  const url = URL.createObjectURL(new Blob([drawingSVG(doc, area, only)], { type: 'image/svg+xml' })), image = new Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = url; });
    const canvas = document.createElement('canvas'); canvas.width = area.width; canvas.height = area.height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Pixel layers are unavailable in this browser.');
    context.drawImage(image, 0, 0, area.width, area.height);
    return { bitmap: await canvasBitmap(canvas, area) };
  } finally { URL.revokeObjectURL(url); }
}

// ---- PDF (ISO 32000): vectors stay vectors. Each layer is a transparency group, so its opacity and blend are exact.
const PDF_BLEND: Record<string, string> = { normal: 'Normal', multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity' };
const num = (v: number) => +v.toFixed(4);
const rgb = (hex: string) => [1, 3, 5].map(i => num(parseInt(hex.slice(i, i + 2), 16) / 255)).join(' ');
const contourOps = (p: SketchPath) => pathContours(p).map(c => {
  const count = c.closed ? c.points.length : c.points.length - 1;
  let ops = `${num(c.points[0][0])} ${num(c.points[0][1])} m`;
  for (let i = 0; i < count; i++) {
    const end = c.points[(i + 1) % c.points.length], k = c.curves?.[i];
    ops += k ? ` ${num(k.c1[0])} ${num(k.c1[1])} ${num(k.c2[0])} ${num(k.c2[1])} ${num(end[0])} ${num(end[1])} c` : ` ${num(end[0])} ${num(end[1])} l`;
  }
  return ops + (c.closed ? ' h' : '');
}).join(' ');
const pdfString = (s: string) => `(${s.replace(/[^\x20-\x7e]/g, '?').replace(/[\\()]/g, c => `\\${c}`)})`;

export function drawingPDF(doc: SketchDocument, area = exportArea(doc)): Uint8Array {
  // PDF pages are 3–14400 pt; very large or tiny infinite drawings are scaled to a 1000 pt page.
  const side = Math.max(area.width, area.height), s = side > 14400 || side < 72 ? 1000 / side : 1;
  const states = new Map<string, string>(), state = (ca: number, CA: number, bm = 'Normal', more = '') => {
    const key = `<< /Type /ExtGState /ca ${num(ca)} /CA ${num(CA)} /BM /${bm}${more} >>`;
    if (!states.has(key)) states.set(key, `GS${states.size}`); return `/${states.get(key)} gs`;
  };
  const shape = (p: DrawingPath, layer: Layer) => {
    const fill = !((!p.closed && !p.fillOpen) || p.fill === null), stroke = p.strokeEnabled !== false;
    if (!fill && !stroke && !p.text) return '';
    // ponytail: a gradient fill exports as its first stop colour; PDF shading dictionaries if gradients matter in print.
    const fillHex = p.fillGradient?.stops[0]?.color ?? p.fill ?? p.color;
    const ops = [state((p.fillOpacity ?? (p.fill === undefined ? .15 : 1)) * p.opacity, (p.strokeOpacity ?? 1) * p.opacity), `${rgb(fillHex)} rg ${rgb(p.color)} RG ${num(p.widthPx)} w`,
      `${{ butt: 0, round: 1, square: 2 }[p.lineCap ?? 'round']} J ${{ miter: 0, round: 1, bevel: 2 }[p.lineJoin ?? 'round']} j`,
      `[${(dashArray(p) ?? []).map(num).join(' ')}] 0 d`];
    for (const clip of clipPaths(layer, p)) ops.push(`${contourOps(clip)} W${clip.fillRule === 'evenodd' ? '*' : ''} n`);
    if (p.text?.onPath) {
      // Each character is set on its own along the path.
      for (const g of pathGlyphs(p)) { const c = num(Math.cos(g.angle)), s = num(Math.sin(g.angle)); ops.push(`BT /F1 ${num(p.text.fontSizePx)} Tf ${c} ${s} ${s} ${num(-Math.cos(g.angle))} ${num(g.x)} ${num(g.y)} Tm ${pdfString(g.char)} Tj ET`); }
    } else if (p.text) {
      // ponytail: Helvetica (a PDF base font) with ASCII text; embed fonts if documents need other scripts.
      const t = p.text, [a, b, c, d, e, f] = textMatrix(p), x0 = t.align === 'start' ? 0 : t.align === 'middle' ? t.widthPx / 2 : t.widthPx;
      t.content.split('\n').forEach((line, i) => {
        const x = x0 - (t.align === 'start' ? 0 : t.align === 'middle' ? .5 : 1) * line.length * t.fontSizePx * .5, y = t.fontSizePx + i * t.fontSizePx * t.lineHeight;
        ops.push(`BT /F1 ${num(t.fontSizePx)} Tf ${num(a)} ${num(b)} ${num(-c)} ${num(-d)} ${num(a * x + c * y + e)} ${num(b * x + d * y + f)} Tm ${pdfString(line)} Tj ET`);
      });
    } else ops.push(`${contourOps(p)} ${fill && stroke ? 'B' : fill ? 'f' : 'S'}${fill && p.fillRule === 'evenodd' ? '*' : ''}`);
    return `q ${ops.join(' ')} Q`;
  };
  // Clipping and mask layers become soft masks. ponytail: vector content only, like the rest of this export; pixel masks, layer effects and adjustments are left out (the app says so).
  const depths = layerDepths(doc), used = doc.layers.map((l, i) => depths[i].drawn || (depths[i].role === 'mask' && l.visible));
  const draw = (l: Layer, paint = (p: DrawingPath) => p) => l.paths.filter(p => pathVisible(l, p)).flatMap(drawnParts).map(p => shape(paint(p), l)).filter(Boolean).join('\n');
  const contents = doc.layers.map((l, i) => used[i] ? draw(l) : '');
  // Every form is in page space (origin at the frame's corner) and the layer forms shift their own content there. Nothing then
  // sets a soft mask under a shifted matrix, which macOS Preview draws wrongly (it loses most of the mask).
  const matrix = `${num(s)} 0 0 ${num(-s)} 0 ${num(area.height * s)}`, shift = `1 0 0 1 ${num(-area.x)} ${num(-area.y)} cm\n`;
  const width = num(area.width * s), height = num(area.height * s);
  const objects: string[] = [];
  const add = (body: string) => { objects.push(body); return objects.length; };
  const stream = (dict: string, content: string) => `<< ${dict} /Length ${new TextEncoder().encode(content).length} >>\nstream\n${content}\nendstream`;
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const gsRefs: string[] = []; const reserve = () => add(''); // filled once every state is known
  const resourcesID = reserve(), xobjects: string[] = [];
  const form = (name: string, content: string) => {
    const id = add(stream(`/Type /XObject /Subtype /Form /BBox [0 0 ${num(area.width)} ${num(area.height)}] /Group << /S /Transparency /CS /DeviceRGB /I true >> /Resources ${resourcesID} 0 R`, content));
    xobjects.push(`/${name} ${id} 0 R`); return id;
  };
  const layerForm = contents.map((content, i) => used[i] ? form(`L${i}`, shift + content) : 0);
  // A masked layer is drawn through a wrapper. Its soft mask paints the mask layers black on white, so brightness is what stays visible.
  const black = (p: DrawingPath): DrawingPath => ({ ...p, color: '#000000', fill: p.fill === null ? null : '#000000', fillGradient: undefined });
  const shownForm = doc.layers.map((_, i) => {
    const masks = depths[i].hide.filter(m => contents[m]);
    if (!used[i] || !masks.length) return { name: `L${i}`, id: layerForm[i] };
    const hide = form(`H${i}`, shift + masks.map(m => draw(doc.layers[m], black)).join('\n'));
    return { name: `W${i}`, id: form(`W${i}`, `q ${state(1, 1, 'Normal', ` /SMask << /Type /Mask /S /Luminosity /BC [1 1 1] /G ${hide} 0 R >>`)} /L${i} Do Q`) };
  });
  const page = doc.layers.map((layer, i) => {
    if (!depths[i].drawn) return '';
    const base = depths[i].clipTo, clip = base !== undefined && contents[base] ? ` /SMask << /Type /Mask /S /Alpha /G ${shownForm[base].id} 0 R >>` : '';
    return `q ${state(layer.opacity ?? 1, layer.opacity ?? 1, PDF_BLEND[layer.blend ?? 'normal'], clip)} /${shownForm[i].name} Do Q`;
  }).filter(Boolean).reverse().join('\n');
  const pageContent = add(stream('', `q ${matrix} cm\n${page}\nQ`));
  for (const [key] of states) gsRefs.push(`/${states.get(key)} ${add(key)} 0 R`);
  objects[resourcesID - 1] = `<< /Font << /F1 ${font} 0 R >> /ExtGState << ${gsRefs.join(' ')} >> /XObject << ${xobjects.join(' ')} >> >>`;
  const pages = add(''), pageID = add(`<< /Type /Page /Parent ${pages} 0 R /MediaBox [0 0 ${width} ${height}] /Resources ${resourcesID} 0 R /Contents ${pageContent} 0 R /Group << /S /Transparency /CS /DeviceRGB >> >>`);
  objects[pages - 1] = `<< /Type /Pages /Kids [${pageID} 0 R] /Count 1 >>`;
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);
  const encoder = new TextEncoder(), offsets: number[] = [], parts: Uint8Array[] = []; let length = 0;
  const write = (text: string) => { const bytes = encoder.encode(text); parts.push(bytes); length += bytes.length; };
  write('%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n');
  objects.forEach((body, i) => { offsets.push(length); write(`${i + 1} 0 obj\n${body}\nendobj\n`); });
  const xref = length;
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const result = new Uint8Array(length); let at = 0; for (const p of parts) { result.set(p, at); at += p.length; }
  return result;
}

// ---- OpenRaster (.ora): the open layered-image format GIMP, Krita and MyPaint read. A ZIP of one PNG per layer.
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export const crc32 = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** An uncompressed (stored) ZIP: what OpenRaster needs, with `mimetype` first. */
export function storedZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder(), chunks: Uint8Array[] = [], central: Uint8Array[] = []; let offset = 0;
  const header = (size: number) => { const b = new Uint8Array(size); return { b, v: new DataView(b.buffer) }; };
  for (const file of files) {
    const name = encoder.encode(file.name), crc = crc32(file.data), local = header(30 + name.length);
    local.v.setUint32(0, 0x04034b50, true); local.v.setUint16(4, 20, true); local.v.setUint32(14, crc, true);
    local.v.setUint32(18, file.data.length, true); local.v.setUint32(22, file.data.length, true); local.v.setUint16(26, name.length, true); local.b.set(name, 30);
    const entry = header(46 + name.length);
    entry.v.setUint32(0, 0x02014b50, true); entry.v.setUint16(4, 20, true); entry.v.setUint16(6, 20, true); entry.v.setUint32(16, crc, true);
    entry.v.setUint32(20, file.data.length, true); entry.v.setUint32(24, file.data.length, true); entry.v.setUint16(28, name.length, true); entry.v.setUint32(42, offset, true); entry.b.set(name, 46);
    chunks.push(local.b, file.data); central.push(entry.b); offset += local.b.length + file.data.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0), end = header(22);
  end.v.setUint32(0, 0x06054b50, true); end.v.setUint16(8, files.length, true); end.v.setUint16(10, files.length, true); end.v.setUint32(12, size, true); end.v.setUint32(16, offset, true);
  const all = [...chunks, ...central, end.b], out = new Uint8Array(all.reduce((n, c) => n + c.length, 0)); let at = 0;
  for (const c of all) { out.set(c, at); at += c.length; }
  return out;
}

const xmlAttr = (value: string) => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export async function drawingOpenRaster(doc: SketchDocument, area = exportArea(doc)): Promise<Uint8Array> {
  const size = rasterSize(area), bytes = async (d: SketchDocument, only?: string[]) => new Uint8Array(await (await rasterBlob(d, 'image/png', area, undefined, only)).arrayBuffer());
  // OpenRaster has no masks, clips or effects, so each layer's PNG has them applied; mask layers are not layers of their own there.
  // ponytail: an adjustment layer exports as its own (usually empty) content; only the merged image shows the adjustment.
  const depths = layerDepths(doc), solo = (id: string) => ({ ...doc, layers: doc.layers.map(l => l.id === id ? { ...l, visible: true, opacity: 1, blend: undefined } : l) });
  const layers = await Promise.all(doc.layers.flatMap((l, i) => depths[i].role === 'mask' ? [] : [{ l, i }]).map(async ({ l, i }) => ({ l, name: `data/layer${i}.png`, data: await bytes(solo(l.id), [l.id]) })));
  const merged = await bytes(doc), thumbnail = new Uint8Array(await (await rasterBlob(doc, 'image/png', area, 256)).arrayBuffer());
  // OpenRaster lists the top layer first, which is Sketch's order too.
  const stack = `<?xml version="1.0" encoding="UTF-8"?>\n<image version="0.0.5" w="${size.width}" h="${size.height}"><stack>${layers.map(({ l, name }) =>
    `<layer name="${xmlAttr(l.name)}" src="${name}" x="0" y="0" opacity="${l.opacity ?? 1}" visibility="${l.visible ? 'visible' : 'hidden'}" composite-op="svg:${!l.blend || l.blend === 'normal' || l.blend === 'exclusion' ? 'src-over' : l.blend}"/>`).join('')}</stack></image>`;
  const encoder = new TextEncoder();
  return storedZip([{ name: 'mimetype', data: encoder.encode('image/openraster') }, { name: 'stack.xml', data: encoder.encode(stack) },
    ...layers.map(({ name, data }) => ({ name, data })), { name: 'mergedimage.png', data: merged }, { name: 'Thumbnails/thumbnail.png', data: thumbnail }]);
}
