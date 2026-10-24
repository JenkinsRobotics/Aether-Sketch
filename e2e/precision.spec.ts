import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const canvas = (page: Page) => page.locator('svg[aria-label="Sketch drawing canvas"]');
const style = { color: '#334455', widthPx: 3, opacity: 1, fill: null };
async function open(page: Page, paths: unknown[]) {
  await page.goto('/');
  await page.getByLabel('Open drawing file', { exact: true }).setInputFiles({ name: 'Precision.aethersketch', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'aethersketch', version: 2, widthPx: 1200, heightPx: 800, layers: [{ id: 'layer', name: 'Layer 1', visible: true, locked: false, paths }] })) });
}
async function saved(page: Page) {
  const download = page.waitForEvent('download'); await documentAction(page, 'Save drawing');
  return JSON.parse(await readFile((await (await download).path())!, 'utf8'));
}
async function click(page: Page, x: number, y: number) {
  const p = await canvas(page).evaluate((el, [x, y]) => { const p = new DOMPoint(x, y).matrixTransform((el as SVGSVGElement).getScreenCTM()!); return { x: p.x, y: p.y }; }, [x, y]);
  await page.mouse.click(p.x, p.y);
}
test('precise compound node and closing-handle edits preserve other contours and undo', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const outer = [[100, 100], [900, 100], [500, 700]];
  await open(page, [{ ...style, id: 'compound', points: outer, closed: true, subpaths: [{ points: [[400, 300], [600, 300], [600, 450], [400, 450]], closed: true, nodeModes: ['symmetric', 'corner', 'corner', 'corner'], curves: [{ c1: [450, 300], c2: [550, 300] }, null, null, { c1: [350, 450], c2: [350, 300] }] }] }]);
  await page.getByRole('button', { name: 'Edit nodes', exact: true }).click(); await click(page, 500, 100);
  await page.getByRole('combobox', { name: 'Edit contour', exact: true }).selectOption('1');
  await canvas(page).getByLabel('Anchor 1', { exact: true }).click();
  const nodeX = page.getByRole('textbox', { name: 'Node X', exact: true }); await nodeX.fill('410.25'); await nodeX.press('Enter');
  let doc = await saved(page); expect(doc.layers[0].paths[0].points).toEqual(outer);
  expect(doc.layers[0].paths[0].subpaths[0].points[0]).toEqual([410.25, 300]);
  expect(doc.layers[0].paths[0].subpaths[0].curves[0].c1).toEqual([460.25, 300]);
  await documentAction(page, 'Undo');
  expect((await saved(page)).layers[0].paths[0].subpaths[0].points[0]).toEqual([400, 300]);
  // Inner contour has four nodes; outer has three. Closing c2 belongs to inner node 0.
  await canvas(page).getByLabel('Curve 4 c2', { exact: true }).click();
  await expect(page.getByRole('combobox', { name: 'Node type', exact: true })).toHaveValue('symmetric');
  const handleX = page.getByRole('textbox', { name: 'Handle X', exact: true }); await handleX.fill('340'); await handleX.press('Enter');
  doc = await saved(page);
  expect(doc.layers[0].paths[0].subpaths[0].curves[3].c2).toEqual([340, 300]);
  expect(doc.layers[0].paths[0].subpaths[0].curves[0].c1).toEqual([460, 300]);
  await documentAction(page, 'Undo');
  expect((await saved(page)).layers[0].paths[0].subpaths[0].curves[3].c2).toEqual([350, 300]);
  await documentAction(page, 'Redo');
  expect((await saved(page)).layers[0].paths[0].subpaths[0].curves[3].c2).toEqual([340, 300]);
  const handleY = page.getByRole('textbox', { name: 'Handle Y', exact: true }); await handleY.fill('320'); await handleY.press('Enter');
  doc = await saved(page);
  expect(doc.layers[0].paths[0].subpaths[0].curves[3].c2).toEqual([340, 320]);
  expect(doc.layers[0].paths[0].subpaths[0].curves[0].c1).toEqual([460, 280]);
  await page.getByRole('combobox', { name: 'Node type', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('precision-controls.png') });
  await page.getByLabel('Open drawing file', { exact: true }).setInputFiles({ name: 'Precision.aethersketch', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) });
  expect(await saved(page)).toEqual(doc);
  expect(errors).toEqual([]);
});
test('trim uses compound hole boundaries and preserves the source cutter', async ({ page }) => {
  const ring = { ...style, id: 'ring', points: [[200, 200], [800, 200], [800, 600], [200, 600]], closed: true, subpaths: [{ points: [[350, 300], [650, 300], [650, 500], [350, 500]], closed: true }] };
  await open(page, [ring, { ...style, id: 'line', points: [[100, 400], [900, 400]], closed: false }]);
  await page.getByRole('button', { name: 'Trim', exact: true }).click(); await click(page, 500, 400);
  const paths = (await saved(page)).layers[0].paths;
  expect(paths).toHaveLength(3); expect(paths[0]).toEqual(ring);
  expect(paths[1].points.at(-1)[0]).toBeCloseTo(350); expect(paths[2].points[0][0]).toBeCloseTo(650);
  await documentAction(page, 'Undo');
  expect((await saved(page)).layers[0].paths).toHaveLength(2);
});

async function documentAction(page: Page, name: string) {
  await page.getByRole('button', { name: 'Document controls', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
