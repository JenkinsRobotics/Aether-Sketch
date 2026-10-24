import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('vector paint gradients, appearance sampling, live draw-inside clipping and export', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, 200, 200, 600, 500);
  await page.getByRole('combobox', { name: 'Fill type', exact: true }).selectOption('linear');
  const color = page.getByRole('textbox', { name: 'Stop 1 color', exact: true }); await color.fill('#ed408a'); await color.press('Enter');
  await page.getByRole('button', { name: 'Add gradient stop', exact: true }).click();
  const opacity = page.getByRole('textbox', { name: 'Stop 2 opacity', exact: true }); await opacity.fill('50'); await opacity.press('Enter');
  const first = (await saved(page)).doc.layers[0].paths[0]; expect(first.fillGradient.stops).toHaveLength(3); expect(first.fillGradient.stops[1].opacity).toBe(.5);
  await page.getByRole('button', { name: 'Draw inside selected shape', exact: true }).click();
  await drag(page, 100, 350, 750, 350);
  await page.getByRole('button', { name: 'Finish drawing inside', exact: true }).click();
  const clipped = (await saved(page)).doc;
  expect(clipped.layers[0].groups[0].clipPathID).toBe(first.id); expect(clipped.layers[0].paths[1].groupID).toBe(clipped.layers[0].groups[0].id);
  await expect(canvas(page).locator('[clip-path]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Select', exact: true }).click(); await drag(page, 300, 250, 340, 280);
  const moved = (await saved(page)).doc; expect(moved.layers[0].paths[0].points[0][0]).toBeCloseTo(first.points[0][0] + 40);
  expect(moved.layers[0].paths[1].points[0][0]).toBeCloseTo(clipped.layers[0].paths[1].points[0][0] + 40);
  await page.getByRole('button', { name: 'Duplicate selection', exact: true }).click();
  const duplicate = (await saved(page)).doc; expect(duplicate.layers[0].groups).toHaveLength(2);
  expect(duplicate.layers[0].groups[1].clipPathID).toBe(duplicate.layers[0].paths[2].id);
  await documentAction(page, 'Undo');
  await page.getByRole('button', { name: 'Pick appearance', exact: true }).click(); await click(page, 350, 290);
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click(); await drag(page, 800, 220, 1050, 520);
  expect((await saved(page)).doc.layers[0].paths[2].fillGradient).toEqual(first.fillGradient);
  await page.getByRole('combobox', { name: 'Fill type', exact: true }).selectOption('radial');
  await expect(canvas(page).locator('radialGradient')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Stop 1 color', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('radial-paint-controls.png') });
  await page.getByRole('checkbox', { name: 'Fill closed paths', exact: true }).uncheck();
  // The fill tool must hit the empty interior of an unfilled closed contour.
  await page.getByRole('button', { name: 'Pick appearance', exact: true }).click(); await click(page, 350, 290);
  await page.getByRole('button', { name: 'Fill shape', exact: true }).click(); await click(page, 920, 360);
  expect((await saved(page)).doc.layers[0].paths[2].fillGradient).toEqual(first.fillGradient);
  const promise = page.waitForEvent('download'); await documentAction(page, 'Export SVG');
  const exported = await readFile((await (await promise).path())!, 'utf8'); expect(exported).toContain('<linearGradient'); expect(exported).toContain('clip-path=');
  const final = (await saved(page)).doc;
  await page.reload(); await page.getByLabel('Open drawing file', { exact: true }).setInputFiles({ name: 'Paint.aethersketch', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(final)) });
  expect((await saved(page)).doc).toEqual(final);
  await page.screenshot({ path: info.outputPath('vector-paint-clipping.png') }); expect(errors).toEqual([]);
});
const canvas = (page: Page) => page.locator('svg[aria-label="Sketch drawing canvas"]');
async function at(page: Page, x: number, y: number) {
  return canvas(page).evaluate(async (el, [x, y]) => {
    // The shared shell animates measured safe areas on mount and layout changes.
    // Side-panel width transitions also resize the canvas from a sibling.
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    for (let i = 0; i < 10; i++) {
      await frame(); await frame();
      const moving = document.getAnimations().filter(animation => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && el.closest('.aui-shell')?.contains(target) && animation.playState === 'running';
      });
      if (!moving.length) break;
      await Promise.all(moving.map(animation => animation.finished.catch(() => {})));
    }
    const p = new DOMPoint(x, y).matrixTransform((el as SVGSVGElement).getScreenCTM()!); return { x: p.x, y: p.y };
  }, [x, y]);
}
async function click(page: Page, x: number, y: number) { const p = await at(page, x, y); await page.mouse.click(p.x, p.y); }
async function drag(page: Page, x: number, y: number, a: number, b: number) {
  const start = await at(page, x, y), end = await at(page, a, b);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up();
}
async function saved(page: Page) {
  const promise = page.waitForEvent('download'); await documentAction(page, 'Save drawing');
  const download = await promise, file = (await download.path())!; return { file, doc: JSON.parse(await readFile(file, 'utf8')) };
}
test('shared pen, anchor handles, one-step undo, subdivision and document reopen', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await drag(page, 200, 200, 300, 200); await drag(page, 700, 400, 800, 400); await click(page, 250, 600); await click(page, 200, 200);
  await expect(canvas(page).locator('[data-path-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Edit nodes', exact: true }).click();
  const handles = canvas(page).locator('[data-control]'); await expect(handles).toHaveCount(6);
  await drag(page, 300, 200, 320, 160);
  const first = await saved(page); expect(first.doc.layers[0].paths[0].curves[0].c1[0]).toBeCloseTo(320);
  await documentAction(page, 'Undo');
  expect((await saved(page)).doc.layers[0].paths[0].curves[0].c1[0]).toBeCloseTo(300);
  await documentAction(page, 'Redo');
  // Split the authored cubic at its midpoint, preserving its shape.
  const path = first.doc.layers[0].paths[0], c = path.curves[0];
  const midpoint = [0, 1].map(axis => .125 * path.points[0][axis] + .375 * c.c1[axis] + .375 * c.c2[axis] + .125 * path.points[1][axis]);
  const middle = await at(page, midpoint[0], midpoint[1]); await page.mouse.dblclick(middle.x, middle.y);
  const after = await saved(page); expect(after.doc.layers[0].paths[0].points.length).toBe(4);
  await page.reload(); await page.getByLabel('Open drawing file', { exact: true }).setInputFiles({ name: 'Roundtrip.aethersketch', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(after.doc)) });
  await expect(canvas(page).locator('[data-path-id]')).toHaveCount(1);
  expect((await saved(page)).doc).toEqual(after.doc);
  await page.getByRole('button', { name: 'Edit nodes', exact: true }).click();
  await click(page, 200, 200);
  await page.screenshot({ path: info.outputPath('bezier-editor.png') });
  await expect(page.locator('[data-icon-missing]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Appearance System', exact: true }).click();
  await page.getByRole('button', { name: 'Appearance Light', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Zoom in', exact: true })).toHaveCSS('background-color', 'rgb(32, 44, 59)');
  await page.screenshot({ path: info.outputPath('bezier-editor-dark.png') });
  expect(errors).toEqual([]);
});
test('layer isolation, visibility, locking, shape selection and gesture cancellation', async ({ page }, info) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, 200, 200, 500, 400); await page.getByRole('button', { name: 'New layer', exact: true }).click();
  await page.getByRole('button', { name: 'Ellipse', exact: true }).click(); await drag(page, 450, 350, 850, 650);
  const two = await saved(page); expect(two.doc.layers.map((l: { paths: unknown[] }) => l.paths.length)).toEqual([1, 1]);
  await page.getByRole('button', { name: 'Hide Layer 2', exact: true }).click();
  await expect(canvas(page).locator('[data-layer-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show Layer 2', exact: true }).click();
  await page.getByRole('button', { name: 'Lock Layer 2', exact: true }).click();
  await drag(page, 200, 300, 700, 500); expect((await saved(page)).doc.layers[0].paths).toHaveLength(1);
  await page.getByRole('button', { name: 'Unlock Layer 2', exact: true }).click();
  const start = await at(page, 100, 100), end = await at(page, 300, 300);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y); await page.keyboard.press('Escape'); await page.mouse.up();
  expect((await saved(page)).doc.layers[0].paths).toHaveLength(1);
  await page.getByRole('combobox', { name: 'Workspace layout' }).selectOption('floating');
  await page.screenshot({ path: info.outputPath('floating-layers.png') });
  await page.getByRole('combobox', { name: 'Workspace layout' }).selectOption('docked');
  await page.getByRole('button', { name: 'Select', exact: true }).click(); await drag(page, 650, 480, 700, 530);
  const moved = await saved(page); expect(moved.doc.layers[0].paths[0].points[0][0]).toBeCloseTo(two.doc.layers[0].paths[0].points[0][0] + 50);
  await documentAction(page, 'Undo'); expect((await saved(page)).doc.layers[0].paths).toEqual(two.doc.layers[0].paths);
});
test('invalid file does not replace drawing', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Rectangle', exact: true }).click(); await drag(page, 100, 100, 500, 500);
  const before = await saved(page);
  await page.getByLabel('Open drawing file', { exact: true }).setInputFiles({ name: 'bad.aethersketch', mimeType: 'application/json', buffer: Buffer.from('{"version":99}') });
  await expect(page.getByRole('status', { name: 'Workspace status' })).toContainText('Invalid or unsupported');
  expect((await saved(page)).doc).toEqual(before.doc);
});

test('open pen paths, node types, edge conversion, break and SVG export', async ({ page }) => {
  await page.goto('/');
  await click(page, 200, 200); await click(page, 500, 300); await click(page, 800, 200); await page.keyboard.press('Enter');
  let doc = (await saved(page)).doc; expect(doc.layers[0].paths[0].closed).toBe(false);
  await page.getByRole('button', { name: 'Edit nodes', exact: true }).click(); await click(page, 500, 300);
  await page.getByRole('combobox', { name: 'Node type' }).selectOption('symmetric');
  doc = (await saved(page)).doc; expect(doc.layers[0].paths[0].nodeModes[1]).toBe('symmetric');
  const c = doc.layers[0].paths[0].curves[1].c1;
  await drag(page, c[0], c[1], 600, 350);
  const coupled = (await saved(page)).doc.layers[0].paths[0];
  expect(coupled.curves[0].c2[0]).toBeCloseTo(400); expect(coupled.curves[0].c2[1]).toBeCloseTo(250);
  // Alt makes a corner without moving the opposite handle.
  await page.keyboard.down('Alt'); await drag(page, 600, 350, 620, 320); await page.keyboard.up('Alt');
  const corner = (await saved(page)).doc.layers[0].paths[0]; expect(corner.nodeModes[1]).toBe('corner'); expect(corner.curves[0].c2).toEqual(coupled.curves[0].c2);
  await click(page, 500, 300); await page.getByRole('button', { name: 'Straighten edge', exact: true }).click();
  expect((await saved(page)).doc.layers[0].paths[0].curves[1]).toBeNull();
  await page.getByRole('button', { name: 'Break at node', exact: true }).click();
  expect((await saved(page)).doc.layers[0].paths).toHaveLength(2);
  await documentAction(page, 'Undo'); expect((await saved(page)).doc.layers[0].paths).toHaveLength(1);
  const download = page.waitForEvent('download'); await documentAction(page, 'Export SVG');
  const xml = await readFile((await (await download).path())!, 'utf8'); expect(xml).toContain('fill="none"'); expect(xml).toContain('C');
});

test('group resize, move, visibility and ungroup are functional and undoable', async ({ page }, info) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await drag(page, 100, 100, 300, 300); await drag(page, 500, 100, 700, 300);
  await page.getByRole('button', { name: 'Select', exact: true }).click(); await canvas(page).focus(); await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  const before = (await saved(page)).doc.layers[0]; expect(before.groups).toHaveLength(1); expect(new Set(before.paths.map((p: any) => p.groupID)).size).toBe(1);
  await expect(canvas(page).locator('[data-transform]')).toHaveCount(9);
  await drag(page, 700, 300, 800, 400);
  const resized = (await saved(page)).doc.layers[0]; expect(resized.paths[1].points[2][0]).toBeCloseTo(800); expect(resized.paths[0].points[2][1]).toBeCloseTo(400);
  await documentAction(page, 'Undo'); expect((await saved(page)).doc.layers[0]).toEqual(before);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); const view = await canvas(page).getAttribute('viewBox');
  await page.getByRole('button', { name: 'Edit nodes', exact: true }).click(); await page.getByRole('button', { name: 'Select', exact: true }).click(); expect(await canvas(page).getAttribute('viewBox')).toBe(view);
  await drag(page, 200, 200, 250, 250);
  const moved = (await saved(page)).doc.layers[0]; expect(moved.paths[0].points[0][0]).toBeCloseTo(before.paths[0].points[0][0] + 50); expect(moved.paths[1].points[0][1]).toBeCloseTo(before.paths[1].points[0][1] + 50);
  await page.getByRole('button', { name: 'Hide Group', exact: true }).click(); await expect(canvas(page).locator('[data-path-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Group', exact: true }).click();
  await page.getByRole('button', { name: 'Ungroup', exact: true }).click(); expect((await saved(page)).doc.layers[0].groups).toHaveLength(0);
  await page.screenshot({ path: info.outputPath('vector-groups.png') });
});

test('trim between crossings, contour creation, fill and persistence', async ({ page }, info) => {
  await page.goto('/'); const doc = (await saved(page)).doc;
  const p = (id: string, points: number[][], closed: boolean) => ({ id, name: id, points, closed, color: '#2368ce', fill: '#bcd4f5', widthPx: 3, opacity: 1 });
  doc.layers[0].paths = [p('Frame', [[200, 200], [800, 200], [800, 600], [200, 600]], true), p('Cut A', [[400, 100], [400, 700]], false), p('Cut B', [[600, 100], [600, 700]], false)];
  await page.getByLabel('Open drawing file', { exact: true }).setInputFiles({ name: 'Trim.aethersketch', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  await page.getByRole('button', { name: 'Trim', exact: true }).click(); await click(page, 500, 200);
  const trimmed = (await saved(page)).doc.layers[0].paths.find((p: any) => p.id === 'Frame');
  expect(trimmed.closed).toBe(false); expect(trimmed.points[0][0]).toBeCloseTo(600); expect(trimmed.points.at(-1)[0]).toBeCloseTo(400);
  await documentAction(page, 'Undo'); expect((await saved(page)).doc.layers[0].paths).toEqual(doc.layers[0].paths);
  await page.getByRole('button', { name: 'Select', exact: true }).click(); await click(page, 250, 300);
  await page.getByRole('button', { name: 'Create contour', exact: true }).click();
  const contourDoc = (await saved(page)).doc; expect(contourDoc.layers[0].paths).toHaveLength(4);
  const contour = contourDoc.layers[0].paths.at(-1); expect(contour.points[0]).toEqual([190, 190]);
  await page.getByRole('checkbox', { name: 'Fill closed paths', exact: true }).uncheck();
  expect((await saved(page)).doc.layers[0].paths.at(-1).fill).toBeNull();
  await page.screenshot({ path: info.outputPath('vector-contour.png') });
});

test('screen-scaled snapping and Alt bypass keep clicked pen nodes as corners', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Rectangle', exact: true }).click(); await drag(page, 200, 200, 400, 400);
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Bézier pen', exact: true }).click();
  await click(page, 207, 205); await click(page, 700, 300); await page.keyboard.press('Enter');
  let path = (await saved(page)).doc.layers[0].paths.at(-1);
  expect(path.points[0][0]).toBeCloseTo(200); expect(path.points[0][1]).toBeCloseTo(200); expect(path.nodeModes[0]).toBe('corner'); expect(path.curves).toBeUndefined();
  await page.keyboard.down('Alt'); await click(page, 207, 205); await page.keyboard.up('Alt'); await click(page, 800, 500); await page.keyboard.press('Enter');
  path = (await saved(page)).doc.layers[0].paths.at(-1);
  expect(path.points[0][0]).toBeCloseTo(207); expect(path.points[0][1]).toBeCloseTo(205);
});

test('shared layer tree moves a group across layers and deletes the subtree', async ({ page }) => {
  await page.goto('/'); const doc = (await saved(page)).doc;
  doc.layers[0].groups = [{ id: 'g', name: 'Assembly' }, { id: 'nested', name: 'Nested', parentID: 'g' }];
  doc.layers[0].paths = [{ id: 'p', name: 'Shape', groupID: 'nested', points: [[100, 100], [400, 100], [400, 400]], closed: true, fill: '#bcd4f5', color: '#2368ce', widthPx: 3, opacity: 1 }];
  doc.layers.push({ id: 'target', name: 'Destination', visible: true, locked: false, paths: [] });
  await page.getByLabel('Open drawing file', { exact: true }).setInputFiles({ name: 'Layers.aethersketch', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  const assembly = page.getByRole('treeitem').filter({ has: page.locator('.aui-tree-label', { hasText: /^Assembly$/ }) });
  const destination = page.getByRole('treeitem').filter({ has: page.locator('.aui-tree-label', { hasText: /^Destination$/ }) });
  await assembly.dragTo(destination);
  const moved = (await saved(page)).doc; expect(moved.layers[0].paths).toHaveLength(0); expect(moved.layers[1].groups).toHaveLength(2); expect(moved.layers[1].paths).toHaveLength(1);
  await assembly.click(); await page.keyboard.press('Delete');
  const deleted = (await saved(page)).doc; expect(deleted.layers[1].paths).toHaveLength(0); expect(deleted.layers[1].groups).toHaveLength(0);
  await documentAction(page, 'Undo'); expect((await saved(page)).doc).toEqual(moved);
});

test('compound holes, Boolean operations and individual contour nodes stay editable', async ({ page }, info) => {
  await page.goto('/'); await page.getByRole('button',{name:'Rectangle',exact:true}).click();
  await drag(page,150,150,650,600); await drag(page,300,300,500,450);
  await page.getByRole('button',{name:'Select',exact:true}).click(); await canvas(page).focus(); await page.keyboard.press('ControlOrMeta+a');
  await page.getByRole('button',{name:'Subtract front',exact:true}).click();await expect(page.getByRole('group',{name:'Combine shapes',exact:true})).toHaveAttribute('aria-busy','false');
  let shape=(await saved(page)).doc.layers[0].paths[0]; expect(shape.subpaths).toHaveLength(1);expect(shape.fillRule).toBe('evenodd');
  await expect(canvas(page).locator('[data-vector-paint]')).toHaveAttribute('fill-rule','evenodd');
  await page.getByRole('combobox',{name:'Edit contour',exact:true}).selectOption('1');
  const outer=shape.points[0], old=shape.subpaths[0].points[0]; await drag(page,old[0],old[1],old[0]+20,old[1]+10);
  shape=(await saved(page)).doc.layers[0].paths[0];expect(shape.subpaths[0].points[0][0]).toBeCloseTo(old[0]+20);expect(shape.points[0]).toEqual(outer);
  await page.screenshot({path:info.outputPath('compound-hole-node.png')});
  await page.getByRole('button',{name:'Release compound',exact:true}).click();expect((await saved(page)).doc.layers[0].paths).toHaveLength(2);
  await page.getByRole('button',{name:'Make compound',exact:true}).click();expect((await saved(page)).doc.layers[0].paths[0].subpaths).toHaveLength(1);
  await documentAction(page, 'Undo');await canvas(page).focus();await page.keyboard.press('ControlOrMeta+a');await page.getByRole('button',{name:'Union',exact:true}).click();await expect(page.getByRole('group',{name:'Combine shapes',exact:true})).toHaveAttribute('aria-busy','false');
  shape=(await saved(page)).doc.layers[0].paths[0];expect(shape.subpaths).toHaveLength(0);
});

test('editable multiline text transforms, saves, exports and imports as editable text', async ({page},info)=>{
  await page.goto('/');await page.getByRole('button',{name:'Text',exact:true}).click();await click(page,250,250);
  await page.getByRole('textbox',{name:'Text content',exact:true}).fill('Aether vector\nEditable text');
  const size=page.getByRole('textbox',{name:'Font size',exact:true});await size.fill('54');await size.press('Enter');
  await page.getByRole('checkbox',{name:'Italic',exact:true}).check();
  const spacing=page.getByRole('textbox',{name:'Line spacing',exact:true});await spacing.fill('1.8');await spacing.press('Enter');
  await expect(canvas(page).locator('[data-vector-text] tspan')).toHaveCount(2);
  const before=(await saved(page)).doc;expect(before.layers[0].paths[0].text.content).toContain('Editable text');
  await drag(page,300,280,350,320); const moved=(await saved(page)).doc; expect(moved.layers[0].paths[0].points[0][0]).toBeCloseTo(300);
  const promise=page.waitForEvent('download');await documentAction(page, 'Export SVG');const xml=await readFile((await (await promise).path())!,'utf8');expect(xml).toContain('<text');expect(xml).toContain('Editable text');
  await documentAction(page, 'New drawing');
  await page.getByLabel('Import SVG file',{exact:true}).setInputFiles({name:'Text.svg',mimeType:'image/svg+xml',buffer:Buffer.from(xml)});
  const imported=(await saved(page)).doc;expect(imported.layers[0].paths[0].text.content).toBe('Aether vector\nEditable text');expect(imported.layers[0].paths[0].text.lineHeight).toBeCloseTo(1.8);
  await page.getByRole('textbox',{name:'Text content',exact:true}).fill('Still editable');await expect(canvas(page).locator('[data-vector-text]')).toContainText('Still editable');
  await page.screenshot({path:info.outputPath('editable-text.png')});
});

test('SVG imports retained curves, transformed groups and holes safely, with undo and recovery isolation',async({page,context},info)=>{
  await page.goto('/?project=one');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="paint"><stop offset="0" stop-color="#ff3377"/><stop offset="1" stop-color="#239bff"/></linearGradient></defs><g id="Imported group" transform="translate(100 100)"><path id="Ring" fill="url(#paint)" fill-rule="evenodd" d="M0 0h400v400h-400z M100 100h200v200h-200z"/><path id="Curve" fill="none" stroke="#239bff" stroke-width="5" d="M500 0q100 0 100 100t-100 100"/></g><script>window.untrustedSvgExecuted=true</script></svg>`;
  await page.getByLabel('Import SVG file',{exact:true}).setInputFiles({name:'Drawing.svg',mimeType:'image/svg+xml',buffer:Buffer.from(svg)});
  await expect(page.getByRole('status', { name: 'Workspace status' })).toContainText('Skipped unsupported script');
  const imported=(await saved(page)).doc;expect(imported.layers[0].groups).toHaveLength(1);expect(imported.layers[0].paths[0].subpaths).toHaveLength(1);expect(imported.layers[0].paths[1].curves.filter(Boolean)).toHaveLength(2);
  expect(await page.evaluate(()=>('untrustedSvgExecuted' in window))).toBe(false);
  await expect(page.locator('[data-recovery-status]')).toHaveText('Draft saved locally');
  await page.reload();await expect(canvas(page).locator('[data-vector-paint]')).toHaveCount(2);expect((await saved(page)).doc).toEqual(imported);
  const other=await context.newPage();await other.goto('/?project=one');await expect(canvas(other).locator('[data-vector-paint]')).toHaveCount(0);await other.getByRole('button',{name:'Recover drafts',exact:true}).click();await other.getByRole('button',{name:'Restore Untitled',exact:true}).first().click();await expect(canvas(other).locator('[data-vector-paint]')).toHaveCount(2);await other.close();
  await page.goto('/?project=two');await expect(canvas(page).locator('[data-vector-paint]')).toHaveCount(0);
  await page.goto('/?project=one');await expect(canvas(page).locator('[data-vector-paint]')).toHaveCount(2);
  await page.screenshot({path:info.outputPath('imported-svg-recovered.png')});
});


test('local recovery never opens another account draft',async({page})=>{
 let account='alice'; await page.route('**/api/status',route=>route.fulfill({json:{user:{username:account}}}));
 await page.goto('/?project=account-test');await page.getByRole('button',{name:'Rectangle',exact:true}).click();await drag(page,200,200,500,500);
 await expect(page.locator('[data-recovery-status]')).toHaveText('Draft saved locally');
 account='bob';await page.reload();await expect(canvas(page).locator('[data-vector-paint]')).toHaveCount(0);
 await page.getByRole('button',{name:'Recover drafts',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('No saved drafts yet.');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).last().click();
 account='alice';await page.reload();await expect(canvas(page).locator('[data-vector-paint]')).toHaveCount(1);
});

async function documentAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Document controls', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
