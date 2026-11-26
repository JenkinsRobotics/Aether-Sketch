import fs from 'node:fs';
import { open, OUT } from './common.mjs';
const { page, svg, at, drag, tool, button, download, grab, check, done } = await open('vector');
/** What the canvas shows of each layer, top first: name:opacity for drawn layers. */
const shown = () => svg.evaluate(el => [...el.querySelectorAll('[data-layer-id]')].reverse().map(g => { const o = getComputedStyle(g).opacity; return `${g.querySelectorAll('[data-path-id]').length}@${(+o).toFixed(2)}`; }).join(' '));
const rows = () => page.locator('[role=tree][aria-label="Drawing layers"] > div > [role=treeitem][aria-level="1"]').evaluateAll(els => els.map(e => `${e.getAttribute('aria-label')}[${e.querySelector('.aui-tree-badge')?.textContent ?? ''}]`).join(' > '));
const badge = () => page.locator('.aui-bottom-panel, [aria-label="Flipbook"]').evaluateAll(els => els.map(e => e.textContent).join(' ').match(/(\d+) \/ (\d+)/)?.[0] ?? '');
const pixels = (bytes, type, pts, frameIndex = 0) => page.evaluate(async ([b64, type, pts, frameIndex]) => {
  const data = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), decoder = new ImageDecoder({ data, type }); await decoder.tracks.ready;
  const count = decoder.tracks.selectedTrack.frameCount, { image } = await decoder.decode({ frameIndex }), c = new OffscreenCanvas(image.displayWidth, image.displayHeight), g = c.getContext('2d'); g.drawImage(image, 0, 0);
  return { count, size: [c.width, c.height], ms: image.duration / 1000, px: pts.map(([x, y]) => [...g.getImageData(Math.round(x * c.width), Math.round(y * c.height), 1, 1).data]) };
}, [bytes.toString('base64'), type, pts, frameIndex]);

// 1. Start a flipbook on a drawn layer, add frames.
await tool('Rectangle (M)'); await drag(200, 200, 400, 320);
await button('Flipbook').first().click(); await page.waitForTimeout(400);
check('Flipbook opens a timeline with this layer as frame 1', await badge() === '1 / 1' && (await rows()) === 'Layer 1[frame 1 · 1]', `${await badge()} | ${await rows()}`);
await button('Add a frame after this one').click(); await page.waitForTimeout(300);
check('a new frame is a new layer, current, with the frame before ghosted under it', await badge() === '2 / 2' && (await rows()).startsWith('Frame 2[frame 2 · 0] > Layer 1[frame 1 · 1]') && await shown() === '0@1.00 1@0.28', `${await rows()} | ${await shown()}`);
await tool('Ellipse (E)'); await drag(420, 220, 520, 300);
await button('Duplicate this frame').click(); await page.waitForTimeout(300);
check('Duplicate copies the frame as the next one', await badge() === '3 / 3' && (await rows()).startsWith('Frame 3[frame 3 · 1] > Frame 2[frame 2 · 1]'), await rows());
await tool('Select and transform (V)'); await drag(470, 260, 620, 260); // move the copy's ellipse along
await page.screenshot({ path: OUT + 'walk-1-frames.png' });
// 2. Step, onion skin, play.
await button('Previous frame').click(); await page.waitForTimeout(250);
check('stepping back shows frame 2 with both neighbours ghosted', await badge() === '2 / 3' && await shown() === '1@0.14 1@1.00 1@0.28', await shown());
await page.getByRole('treeitem', { name: 'Layer 1', exact: true }).click(); await page.waitForTimeout(250);
check('picking a frame\'s layer in Layers goes to that frame', await badge() === '1 / 3' && await shown() === '1@0.14 1@1.00', `${await badge()} ${await shown()}`);
await button('Onion skin: show the frames before and after, faintly').click(); await page.waitForTimeout(250);
check('with onion skin off only the frame in hand shows', await shown() === '1@1.00', await shown());
await page.getByLabel('Frames per second').fill('10'); await page.getByLabel('Frames per second').press('Enter'); await page.waitForTimeout(200);
await page.getByRole('button', { name: /^Play/ }).first().click();
const seen = new Set(); for (let i = 0; i < 12; i++) { seen.add(await badge()); await page.waitForTimeout(60); }
check('Play runs through the frames', seen.size === 3, [...seen].join(' , '));
await page.getByRole('button', { name: /^(Pause|Play|Stop)/ }).first().click(); await page.waitForTimeout(250);
check('stopping returns to the frame in hand', await badge() === '1 / 3' && await shown() === '1@1.00', `${await badge()} ${await shown()}`);
// 3. Exports. The frame area covers every frame: 200..670 wide. Points: the rectangle (frame 1), the first ellipse (frame 2), the moved ellipse (frame 3).
const menu = label => download(async () => { await button('Flipbook export and options').click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); });
const area = await page.evaluate(() => null); // exports frame everything drawn in any frame, with a small margin
const apng = await menu('Export animated PNG'); fs.writeFileSync(OUT + 'flipbook.png', apng.data);
const where = [[.2, .5], [.57, .5], [.88, .5]]; // rectangle, first ellipse, moved ellipse, as fractions of the frame
const f = [await pixels(apng.data, 'image/apng', where, 0), await pixels(apng.data, 'image/apng', where, 1), await pixels(apng.data, 'image/apng', where, 2)], on = c => c[3] > 200;
check('the animated PNG has three frames at a tenth of a second each', f[0].count === 3 && Math.abs(f[0].ms - 100) < 1 && apng.name.endsWith('flipbook.png'), `${f[0].count} frames, ${f[0].ms} ms, ${f[0].size.join('x')}`);
check('and each frame holds only its own drawing', on(f[0].px[0]) && !on(f[0].px[1]) && !on(f[0].px[2]) && !on(f[1].px[0]) && on(f[1].px[1]) && !on(f[1].px[2]) && !on(f[2].px[0]) && !on(f[2].px[1]) && on(f[2].px[2]), f.map(x => x.px.map(c => c[3]).join('/')).join(' | '));
const zip = await menu('Export frames (PNG files in a ZIP)'), names = zip.data.toString('latin1');
check('Export frames gives a ZIP with a numbered PNG for each', names.includes('frame-001.png') && names.includes('frame-003.png') && !names.includes('frame-004.png'), `${zip.data.length} bytes`);
const video = await menu('Export video'); fs.writeFileSync(OUT + 'flipbook.webm', video.data);
const clip = await page.evaluate(async b64 => { const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'video/webm' })); await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('video failed to load')); });
  if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise(r => { v.onseeked = r; }); } const duration = v.duration; v.currentTime = 0.02; await new Promise(r => { v.onseeked = r; });
  const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext('2d'); g.drawImage(v, 0, 0); return { duration, size: [v.videoWidth, v.videoHeight], first: [...g.getImageData(Math.round(c.width * .2), Math.round(c.height * .5), 1, 1).data], blank: [...g.getImageData(Math.round(c.width * .88), Math.round(c.height * .5), 1, 1).data] }; }, video.data.toString('base64'));
check('the video plays: three times through, then holds the last frame', clip.duration > 1.4 && clip.duration < 2.6 && clip.size.every(v => v % 2 === 0) && clip.first[2] > 180 && clip.first[0] < 230 && clip.blank[0] > 240, JSON.stringify(clip));
const still = await grab('Export PNG'), s = await pixels(still, 'image/png', where);
check('an ordinary PNG export is the frame in hand only: just the rectangle', Math.abs(s.size[0] / s.size[1] - 200 / 120) < .08 && on(s.px[1]), `${s.size.join('x')}`);
// 4. Reload, delete a frame, stop using the flipbook.
await page.waitForTimeout(1200); await page.reload(); await svg.waitFor(); await page.waitForTimeout(1500);
check('after a reload the drawing is still a flipbook showing one frame', (await rows()).includes('[frame 3 · 1]') && (await shown()).split(' ').filter(v => v.endsWith('@1.00')).length === 1, `${await rows()} | ${await shown()}`);
await button('Flipbook').first().click(); await page.waitForTimeout(300); await button('Delete this frame').click(); await page.waitForTimeout(300);
check('Delete removes the frame and its layer', /\d \/ 2/.test(await badge()) && (await rows()).split(' > ').length === 2, `${await badge()} | ${await rows()}`);
await button('Flipbook export and options').click(); await page.getByRole('menuitem', { name: 'Stop using a flipbook (frames stay as layers)', exact: true }).click(); await page.waitForTimeout(300);
check('stopping the flipbook leaves ordinary layers, all showing', !(await rows()).includes('frame') && (await shown()).split(' ').every(v => v.endsWith('@1.00')) && await button('Add a frame after this one').count() === 0, `${await rows()} | ${await shown()}`);
// 5. Time-lapse: record three changes, stop, and a video is saved.
await button('Record a time-lapse').first().click(); await page.waitForTimeout(600);
await tool('Rectangle (M)'); await drag(200, 500, 300, 560); await page.waitForTimeout(500); await drag(340, 500, 440, 560); await page.waitForTimeout(500); await tool('Ellipse (E)'); await drag(480, 500, 580, 560); await page.waitForTimeout(700);
const lapse = await download(() => button('Stop and save the time-lapse').first().click()); fs.writeFileSync(OUT + 'timelapse.webm', lapse.data);
const film = await page.evaluate(async b64 => { const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'video/webm' })); await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('video failed to load')); });
  if (!isFinite(v.duration)) { v.currentTime = 1e6; await new Promise(r => { v.onseeked = r; }); } const duration = v.duration; const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; const g = c.getContext('2d');
  const inked = async t => { v.currentTime = t; await new Promise(r => { v.onseeked = r; }); g.drawImage(v, 0, 0); const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) if (d[i] < 235) n++; return n; };
  return { duration, size: [c.width, c.height], start: await inked(0.01), end: await inked(duration - 0.05) }; }, lapse.data.toString('base64'));
check('stopping saves a time-lapse video that fills in as the drawing was made', lapse.name.includes('time-lapse') && film.duration > 1 && film.duration < 2.2 && film.end > film.start * 1.3 && film.end > 50, JSON.stringify(film));
check('recording is off again', await button('Record a time-lapse').count() >= 1);
await done();
