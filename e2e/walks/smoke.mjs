import { open } from './common.mjs';
// A short pass over the earlier steps' main flows, to catch regressions from routing the canvas through the frame view.
{ const { page, svg, drag, click, tool, panel, button, grab, check, done } = await open('vector');
  const paths = () => svg.evaluate(el => [...el.querySelectorAll('[data-path-id] > path[data-vector-paint]')].map(p => (b => [b.x, b.y, b.width, b.height].map(Math.round).join(','))(p.getBBox())));
  await tool('Rectangle (M)'); await drag(200, 200, 400, 320); await tool('Ellipse (E)'); await drag(500, 200, 600, 300);
  check('vector shapes draw', (await paths()).join(' | ') === '200,200,200,120 | 500,200,100,100', (await paths()).join(' | '));
  await tool('Select and transform (V)'); await drag(550, 250, 650, 350); check('a shape moves with the select tool', (await paths())[1] === '600,300,100,100', (await paths())[1]);
  await svg.focus(); await page.keyboard.press('Meta+z'); await page.waitForTimeout(200); check('undo works', (await paths())[1] === '500,200,100,100');
  await drag(180, 180, 620, 340); await panel('Inspector'); await button('Make a symbol from the selection').click(); await page.waitForTimeout(300);
  check('symbols still work', await svg.locator('[data-symbol-instance]').count() === 1);
  await page.getByRole('button', { name: 'Create in Tree controls' }).click(); await page.getByRole('menuitem', { name: 'New layer', exact: true }).click(); await page.waitForTimeout(200);
  await tool('Rectangle (M)'); await drag(300, 250, 700, 500); await panel('Properties'); await page.getByLabel('Layer role').selectOption('clip'); await page.waitForTimeout(300);
  check('a clipped layer is masked on the canvas', await svg.evaluate(el => !!el.querySelector('[data-layer-id][mask]') && !!el.querySelector('defs mask')));
  await button('Ruler').first().click(); await tool('Pencil (Shift+B)'); await drag(300, 600, 500, 640); await button('Ruler').first().click();
  check('guides still steer strokes', await svg.locator('[data-path-id]').count() === 3);
  const text = String(await grab('Export SVG (Inkscape layers)')), pdf = (await grab('Export PDF')).toString('latin1');
  check('SVG and PDF exports still write', text.includes('<svg') && text.includes('mask=') && pdf.startsWith('%PDF') && pdf.includes('/SMask'));
  await done(); }
{ const { page, svg, drag, tool, button, settle, grab, check, done } = await open('pixel');
  const tab = name => page.getByRole('tab', { name, exact: true }).click();
  const image = () => svg.evaluate(el => { const i = el.querySelector('image[data-pixel-layer]'); return i ? [i.getAttribute('x'), i.getAttribute('y'), i.getAttribute('width'), i.getAttribute('height')].join(',') : null; });
  await tool('Brush (B)'); await drag(200, 200, 420, 260); await settle(); check('a brush stroke lands on a pixel layer', !!(await image()), String(await image()));
  await tab('Shapes'); await tool('Rectangle (M)'); await drag(300, 300, 500, 450); await settle();
  await tab('Select'); await tool('Rectangle select'); await drag(350, 330, 450, 420);
  check('pixel selection shows', await page.evaluate(() => document.querySelector('svg.sketch-ants path')?.getAttribute('d')) === 'M350 330H450V420H350Z');
  await button('Mask: hide this layer outside the selection').click(); await page.waitForTimeout(800);
  check('mask from selection adds a mask layer', await page.getByRole('treeitem', { name: 'Mask of Layer 1', exact: true }).count() === 1);
  const png = await grab('Export PNG'), psd = await grab('Export PSD (Photoshop layers)');
  check('PNG and PSD exports still write', png[1] === 0x50 && psd.subarray(0, 4).toString('latin1') === '8BPS', `${png.length} / ${psd.length} bytes`);
  await done(); }
