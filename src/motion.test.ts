import { expect, it } from 'vitest';
import { addFrame, animatedPNG, endFlipbook, frameDoc, placeFrame, thinFrames, videoSize } from './motion';
import { crc32 } from './export';
import { repairClips } from './paint';
import { newDocument, newLayer, readDocument, serializeDocument, type Layer, type SketchDocument } from './document';

const layer = (id: string, extra: Partial<Layer> = {}): Layer => ({ ...newLayer(id), id, ...extra });
const doc = (): SketchDocument => ({ ...newDocument(), layers: [layer('c'), layer('b'), layer('a'), layer('background')], flipbook: { fps: 12, frames: ['a', 'b', 'c'] } });

it('shows one frame at a time, with every other layer in every frame', () => {
  const shown = (d: SketchDocument) => d.layers.filter(l => l.visible).map(l => l.id);
  expect(shown(frameDoc(doc(), 0))).toEqual(['a', 'background']);
  expect(shown(frameDoc(doc(), 2))).toEqual(['c', 'background']);
  expect(shown(frameDoc(doc(), 9))).toEqual(['c', 'background']); // past the end is the last frame
  const plain = { ...doc(), flipbook: undefined }; expect(frameDoc(plain, 1)).toBe(plain); // no flipbook: the drawing as it is
  const hidden = doc(); hidden.layers[2].visible = false; expect(shown(frameDoc(hidden, 0))).toEqual(['background']); // a frame hidden by hand stays hidden
});
it('onion skin ghosts the frame before more than the frame after', () => {
  const skinned = frameDoc(doc(), 1, true), opacity = (id: string) => skinned.layers.find(l => l.id === id)!.opacity;
  expect(skinned.layers.every(l => l.visible)).toBe(true);
  expect(opacity('b')).toBeUndefined(); expect(opacity('a')).toBeCloseTo(.28); expect(opacity('c')).toBeCloseTo(.14); expect(opacity('background')).toBeUndefined();
  expect(frameDoc(doc(), 0, true).layers.find(l => l.id === 'c')!.visible).toBe(false); // two frames away is not shown
});
it('starts a flipbook from a layer, adds frames after the one in hand, and ends without deleting anything', () => {
  const start = addFrame({ ...newDocument(), layers: [layer('one')] }, layer('one'));
  expect(start.flipbook).toEqual({ fps: 12, frames: ['one'] }); expect(start.layers).toHaveLength(1);
  const two = addFrame(start, layer('two'), 0), three = addFrame(two, layer('between'), 0);
  expect(three.flipbook!.frames).toEqual(['one', 'between', 'two']);
  expect(three.layers.map(l => l.id)).toEqual(['two', 'between', 'one']); // each new frame's layer sits just above the frame before it
  expect(() => readDocument(serializeDocument(three))).not.toThrow();
  expect(endFlipbook(three).flipbook).toBeUndefined(); expect(endFlipbook(three).layers).toHaveLength(3);
});
it('a deleted frame layer leaves the flipbook, and a file whose frames do not exist is refused', () => {
  const d = doc(), without = repairClips({ ...d, layers: d.layers.filter(l => l.id !== 'b') });
  expect(without.flipbook!.frames).toEqual(['a', 'c']);
  expect(repairClips({ ...d, layers: [layer('background')] }).flipbook).toBeUndefined();
  const bad = JSON.parse(serializeDocument(d)); bad.flipbook.frames.push('ghost'); expect(() => readDocument(JSON.stringify(bad))).toThrow();
  const fast = JSON.parse(serializeDocument(d)); fast.flipbook.fps = 500; expect(() => readDocument(JSON.stringify(fast))).toThrow();
  expect(readDocument(serializeDocument(d))).toEqual(d);
});

/** A tiny PNG file with the given picture data, built by the PNG rules (the data itself need not decode for these tests). */
const png = (width: number, height: number, ...data: number[][]) => {
  const chunk = (type: string, body: number[]) => { const bytes = Uint8Array.from([...type].map(c => c.charCodeAt(0)).concat(body)), out = new Uint8Array(12 + body.length), view = new DataView(out.buffer); view.setUint32(0, body.length); out.set(bytes, 4); view.setUint32(8 + body.length, crc32(bytes)); return [...out]; };
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, ...chunk('IHDR', [0, 0, 0, width, 0, 0, 0, height, 8, 6, 0, 0, 0]), ...data.flatMap(d => chunk('IDAT', d)), ...chunk('IEND', [])]);
};
it('wraps PNG frames into one animated PNG that a reader can walk', () => {
  const file = animatedPNG([png(4, 3, [1, 2, 3]), png(4, 3, [4, 5], [6]), png(4, 3, [7])], 12), view = new DataView(file.buffer);
  const found: { type: string; at: number; length: number }[] = [];
  for (let at = 8; at < file.length;) { const length = view.getUint32(at), type = String.fromCharCode(...file.subarray(at + 4, at + 8)); expect(view.getUint32(at + 8 + length)).toBe(crc32(file.subarray(at + 4, at + 8 + length))); found.push({ type, at: at + 8, length }); at += 12 + length; }
  expect(found.map(c => c.type).join(' ')).toBe('IHDR acTL fcTL IDAT fcTL fdAT fdAT fcTL fdAT IEND');
  expect(view.getUint32(found[1].at)).toBe(3); expect(view.getUint32(found[1].at + 4)).toBe(0); // three frames, repeating for ever
  const control = found[2].at; expect([view.getUint32(control + 4), view.getUint32(control + 8)]).toEqual([4, 3]); expect([view.getUint16(control + 20), view.getUint16(control + 22)]).toEqual([1, 12]); // 1/12 s a frame
  // Sequence numbers count every control and data chunk after the first picture: 0, 1, 2, 3, 4, 5.
  expect([view.getUint32(found[2].at), view.getUint32(found[4].at), view.getUint32(found[5].at), view.getUint32(found[6].at), view.getUint32(found[7].at), view.getUint32(found[8].at)]).toEqual([0, 1, 2, 3, 4, 5]);
  expect([...file.subarray(found[5].at + 4, found[5].at + found[5].length)]).toEqual([4, 5]); // the frame's own data follows its number
  expect(() => animatedPNG([png(4, 3, [1]), png(5, 3, [1])], 12)).toThrow(/same size/); expect(() => animatedPNG([], 12)).toThrow();
});
it('sizes a video with even sides and places time-lapse pictures on the finished frame', () => {
  expect(videoSize({ width: 2560, height: 1441 })).toEqual({ width: 1280, height: 720 });
  expect(videoSize({ width: 300, height: 201 })).toEqual({ width: 320, height: 214 }); // small drawings are brought up to a watchable size
  expect(videoSize({ width: 801, height: 601 })).toEqual({ width: 802, height: 602 });
  expect(placeFrame({ x: 100, y: 50, width: 200, height: 100 }, { x: 0, y: 0, width: 800, height: 400 }, { width: 400, height: 200 })).toEqual({ x: 50, y: 25, width: 100, height: 50 });
  const many = Array.from({ length: 11 }, (_, i) => i);
  expect(thinFrames(many, 10)).toEqual([0, 2, 4, 6, 8, 10]); expect(thinFrames(many, 20)).toBe(many); // thinning keeps the first and the last
});
