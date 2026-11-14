// Photoshop (.psd) files, read and written as plain bytes: 8-bit RGB with layers. Nothing here touches the DOM.
// Written: each layer as uncompressed RGBA with its name, opacity, blend mode, visibility and clipping flag, plus the merged picture.
// Read: the same, with raw or RLE (PackBits) channels. Layer masks, groups, text, smart objects and adjustment layers are not
// interpreted: a layer comes in as the pixels the file stores for it, and group markers are skipped.
// ponytail: channels are written uncompressed (simple, and every reader accepts it); add PackBits if file size matters.
import { BLEND_MODES, type BlendMode } from './document';

/** One layer: its rectangle on the canvas and its pixels as RGBA rows. */
export interface PSDLayer { name: string; x: number; y: number; width: number; height: number; rgba: Uint8Array | Uint8ClampedArray; opacity: number; blend: BlendMode; visible: boolean; clipped?: boolean }
export interface PSDFile { width: number; height: number; /** Top layer first. */ layers: PSDLayer[]; /** The flattened picture, RGBA, when the file has one. */ merged?: Uint8Array; warnings: string[] }

const BLEND_KEYS: Record<BlendMode, string> = { normal: 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over', darken: 'dark', lighten: 'lite', 'color-dodge': 'div ', 'color-burn': 'idiv', 'hard-light': 'hLit', 'soft-light': 'sLit', difference: 'diff', exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ' };
const CHANNELS = [0, 1, 2, -1]; // red, green, blue, then coverage: any order is valid, and this one also suits readers that ignore the channel ids
const OFFSET: Record<number, number> = { [-1]: 3, 0: 0, 1: 1, 2: 2 }; // where each channel sits in an RGBA pixel

class Writer {
  private parts: Uint8Array[] = []; length = 0;
  bytes(b: Uint8Array) { this.parts.push(b); this.length += b.length; }
  u8(...v: number[]) { this.bytes(Uint8Array.from(v)); }
  u16(v: number) { this.u8((v >> 8) & 255, v & 255); }
  u32(v: number) { this.u8((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
  text(s: string) { this.bytes(Uint8Array.from(s, c => c.charCodeAt(0) & 255)); }
  /** A length-prefixed block whose length is known only once it is written. */
  block(fill: (w: Writer) => void, even = false) { const inner = new Writer(); fill(inner); if (even && inner.length % 2) inner.u8(0); this.u32(inner.length); for (const p of inner.parts) this.bytes(p); }
  done() { const out = new Uint8Array(this.length); let at = 0; for (const p of this.parts) { out.set(p, at); at += p.length; } return out; }
}
const plane = (rgba: ArrayLike<number>, count: number, offset: number) => { const out = new Uint8Array(count); for (let i = 0; i < count; i++) out[i] = rgba[i * 4 + offset]; return out; };

/** A layered PSD. `layers` are top first; `merged` is the whole canvas as RGBA. */
export function writePSD(width: number, height: number, layers: PSDLayer[], merged: ArrayLike<number>): Uint8Array {
  const w = new Writer(), stored = [...layers].reverse(); // the file lists the bottom layer first
  w.text('8BPS'); w.u16(1); w.u8(0, 0, 0, 0, 0, 0); w.u16(4); w.u32(height); w.u32(width); w.u16(8); w.u16(3);
  w.u32(0); w.u32(0); // no colour table, no image resources
  w.block(section => {
    section.block(info => {
      info.u16(-stored.length & 0xffff); // negative: the merged picture's fourth channel is its transparency
      for (const l of stored) {
        info.u32(l.y); info.u32(l.x); info.u32(l.y + l.height); info.u32(l.x + l.width);
        info.u16(CHANNELS.length); for (const id of CHANNELS) { info.u16(id & 0xffff); info.u32(2 + l.width * l.height); }
        info.text('8BIM'); info.text(BLEND_KEYS[l.blend] ?? 'norm');
        info.u8(Math.round(Math.max(0, Math.min(1, l.opacity)) * 255), l.clipped ? 1 : 0, l.visible ? 0 : 2, 0);
        info.block(extra => {
          extra.u32(0); extra.u32(0); // no layer mask, no blending ranges
          // The classic name is ASCII, padded with its length byte to a multiple of four; the real name follows as Unicode.
          const ascii = l.name.replace(/[^\x20-\x7e]/g, '?').slice(0, 255); extra.u8(ascii.length); extra.text(ascii); for (let pad = (1 + ascii.length) % 4; pad && pad < 4; pad++) extra.u8(0);
          const name = l.name.slice(0, 255); extra.text('8BIM'); extra.text('luni'); extra.u32(4 + name.length * 2); extra.u32(name.length); for (const c of name) extra.u16(c.charCodeAt(0));
        });
      }
      for (const l of stored) for (const id of CHANNELS) { info.u16(0); info.bytes(plane(l.rgba, l.width * l.height, OFFSET[id])); }
    }, true);
    section.u32(0); // no global layer mask
  });
  w.u16(0); for (const offset of [0, 1, 2, 3]) w.bytes(plane(merged, width * height, offset));
  return w.done();
}

/** PackBits, one row: runs of literal bytes and repeated bytes. */
function unpackRow(data: Uint8Array, from: number, to: number, out: Uint8Array, at: number, width: number) {
  let o = at; const end = at + width;
  for (let i = from; i < to && o < end;) {
    const n = data[i++] << 24 >> 24;
    if (n >= 0) { for (let k = 0; k <= n && o < end; k++) out[o++] = data[i++]; }
    else if (n !== -128) { const v = data[i++]; for (let k = 0; k <= -n && o < end; k++) out[o++] = v; }
  }
}
export function readPSD(bytes: Uint8Array): PSDFile {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), text = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n));
  const fail = (why: string): never => { throw new Error(why); };
  if (bytes.length < 26 || text(0, 4) !== '8BPS') fail('This is not a Photoshop (.psd) file.');
  if (view.getUint16(4) !== 1) fail('Large-document (.psb) files cannot be imported.');
  const channelCount = view.getUint16(12), height = view.getUint32(14), width = view.getUint32(18);
  if (view.getUint16(22) !== 8 || view.getUint16(24) !== 3) fail('Only 8-bit RGB Photoshop files can be imported. Convert the file to RGB, 8 bits per channel, and save it again.');
  if (width < 1 || height < 1 || width > 30000 || height > 30000) fail('This Photoshop file has an invalid size.');
  let at = 26; at += 4 + view.getUint32(at); at += 4 + view.getUint32(at); // colour table, image resources
  const sectionEnd = at + 4 + view.getUint32(at); at += 4;
  const layers: PSDLayer[] = [], warnings = new Set<string>(); let seeThrough = false; // whether the merged picture's fourth channel is its transparency
  /** One channel's bytes, raw or PackBits, as `count` values. Null for a compression this reader does not have. */
  const channel = (start: number, length: number, w: number, h: number): Uint8Array | null => {
    const out = new Uint8Array(w * h), mode = view.getUint16(start);
    if (mode === 0) { out.set(bytes.subarray(start + 2, start + 2 + w * h)); return out; }
    if (mode !== 1) return null;
    let data = start + 2 + h * 2;
    for (let row = 0; row < h; row++) { const n = view.getUint16(start + 2 + row * 2); unpackRow(bytes, data, Math.min(data + n, start + length), out, row * w, w); data += n; }
    return out;
  };
  if (sectionEnd > at && view.getUint32(at) > 0) {
    at += 4; const signed = view.getInt16(at), count = Math.abs(signed); seeThrough = signed < 0; at += 2;
    const records: { name: string; x: number; y: number; width: number; height: number; channels: { id: number; length: number }[]; opacity: number; blend: BlendMode; visible: boolean; clipped: boolean; marker: boolean }[] = [];
    for (let i = 0; i < count; i++) {
      const top = view.getInt32(at), left = view.getInt32(at + 4), bottom = view.getInt32(at + 8), right = view.getInt32(at + 12), n = view.getUint16(at + 16); at += 18;
      const channels = Array.from({ length: n }, (_, k) => ({ id: view.getInt16(at + k * 6), length: view.getUint32(at + k * 6 + 2) })); at += n * 6;
      const key = text(at + 4, 4), opacity = bytes[at + 8] / 255, clipped = bytes[at + 9] === 1, visible = !(bytes[at + 10] & 2); at += 12;
      const extraEnd = at + 4 + view.getUint32(at); at += 4;
      at += 4 + view.getUint32(at); at += 4 + view.getUint32(at); // layer mask, blending ranges
      const nameLength = bytes[at]; let name = text(at + 1, nameLength), marker = false; at += Math.ceil((1 + nameLength) / 4) * 4;
      while (at + 12 <= extraEnd) { // tagged blocks: the Unicode name, and group markers
        const tag = text(at + 4, 4), size = view.getUint32(at + 8), body = at + 12;
        if (tag === 'luni') { const chars = Math.min(view.getUint32(body), (size - 4) >> 1); name = Array.from({ length: chars }, (_, k) => String.fromCharCode(view.getUint16(body + 4 + k * 2))).join('').replace(/\0+$/, ''); }
        if (tag === 'lsct' && view.getUint32(body) !== 0) marker = true;
        at = body + size + (size % 2);
      }
      at = extraEnd;
      records.push({ name: name.slice(0, 200) || `Layer ${i + 1}`, x: left, y: top, width: Math.max(0, right - left), height: Math.max(0, bottom - top), channels, opacity, visible, clipped, marker,
        blend: (Object.entries(BLEND_KEYS).find(([, k]) => k === key)?.[0] as BlendMode | undefined) ?? (key === 'norm' || key === 'pass' ? 'normal' : (warnings.add('Blend modes this app does not have were read as normal.'), 'normal')) });
    }
    for (const r of records) {
      const size = r.width * r.height, rgba = new Uint8Array(size * 4).fill(255); let readable = true, hasAlpha = false;
      for (const c of r.channels) {
        if (c.id in OFFSET && size > 0) { const data = channel(at, c.length, r.width, r.height); if (!data) readable = false; else { if (c.id === -1) hasAlpha = true; const o = OFFSET[c.id]; for (let p = 0; p < size; p++) rgba[p * 4 + o] = data[p]; } }
        else if (c.id < -1) warnings.add('Layer masks were not applied.');
        at += c.length;
      }
      void hasAlpha; // a layer without a coverage channel is opaque: the fill above already says so
      if (r.marker) { warnings.add('Layer groups were flattened into a plain list of layers.'); continue; }
      if (!readable) { warnings.add('Layers stored with ZIP compression were left out.'); continue; }
      if (!BLEND_MODES.includes(r.blend)) r.blend = 'normal';
      if (size > 0) layers.unshift({ name: r.name, x: r.x, y: r.y, width: r.width, height: r.height, rgba, opacity: r.opacity, blend: r.blend, visible: r.visible, clipped: r.clipped || undefined });
    }
  }
  // The merged picture closes the file: planar, every channel raw or every row PackBits.
  let merged: Uint8Array | undefined; at = sectionEnd;
  if (at + 2 <= bytes.length) {
    // A fourth channel is transparency only when the layer count says so; otherwise it is a saved selection and the picture is opaque.
    const mode = view.getUint16(at), size = width * height, planes = Math.min(channelCount, seeThrough ? 4 : 3); merged = new Uint8Array(size * 4).fill(255);
    if (mode === 0) { for (let c = 0; c < planes; c++) { const from = at + 2 + c * size; if (from + size > bytes.length) { merged = undefined; break; } for (let p = 0; p < size; p++) merged[p * 4 + c] = bytes[from + p]; } }
    else if (mode === 1) {
      const counts = at + 2; let data = counts + channelCount * height * 2;
      for (let c = 0; c < channelCount; c++) { const row = new Uint8Array(width); for (let y = 0; y < height; y++) { const n = view.getUint16(counts + (c * height + y) * 2); if (c < planes) { unpackRow(bytes, data, data + n, row, 0, width); for (let x = 0; x < width; x++) merged[(y * width + x) * 4 + c] = row[x]; } data += n; } }
    } else merged = undefined;
  }
  if (!layers.length && !merged) fail('This Photoshop file has no layers this app can read.');
  return { width, height, layers, merged, warnings: [...warnings] };
}
