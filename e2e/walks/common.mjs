// Scripted walks of the real app in headless Chrome. Start the dev server (npm run dev, port 5182), then: node e2e/walks/smoke.mjs
// They draw on a local copy (?storage=local): never against a signed-in Studio host or anyone's Drive files.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
const require = createRequire(new URL('../../package.json', import.meta.url));
const { chromium } = require('@playwright/test');
/** Where screenshots and downloaded exports go: WALK_OUT, or the system temp folder. */
export const OUT = `${(process.env.WALK_OUT ?? os.tmpdir()).replace(/\/$/, '')}/`;
const CHROME = process.env.WALK_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export async function open(workspace) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 960 } })).newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:5182/?editor&storage=local&workspace=${workspace}`);
  const svg = page.locator('svg[aria-label="Sketch drawing canvas"]'); await svg.waitFor(); await page.waitForTimeout(1500);
  const at = (x, y) => svg.evaluate((el, [x, y]) => { const p = new DOMPoint(x, y).matrixTransform(el.getScreenCTM()); return { x: p.x, y: p.y }; }, [x, y]);
  const drag = async (x, y, a, b) => { const s = await at(x, y); await page.mouse.move(s.x, s.y); await page.mouse.down(); const e = await at(a, b); await page.mouse.move(e.x, e.y, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(200); };
  const click = async (x, y) => { const s = await at(x, y); await page.mouse.click(s.x, s.y); await page.waitForTimeout(200); };
  const tool = name => page.getByRole('button', { name, exact: true }).first().click();
  const panel = async name => { const b = page.getByRole('button', { name, exact: true }); if (await b.getAttribute('aria-pressed') !== 'true') await b.click(); await page.waitForTimeout(200); };
  const button = name => page.getByRole('button', { name, exact: true });
  const download = async act => { const [d] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), act()]); return { name: d.suggestedFilename(), data: fs.readFileSync(await d.path()) }; };
  const grab = async label => (await download(async () => { await page.getByRole('button', { name: 'Document controls' }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); })).data;
  const settle = () => page.waitForFunction(() => !document.querySelector('.sketch-pixel-overlay canvas') && !document.querySelector('[data-pixel-pending]'), null, { timeout: 8000 }).then(() => page.waitForTimeout(300));
  const results = []; const check = (name, ok, detail = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, detail); };
  const done = async () => { console.log('errors:', errors); console.log(results.every(Boolean) ? 'ALL PASS' : `${results.filter(v => !v).length} FAILED`); await browser.close(); };
  const p0 = await at(-50, -50); await page.mouse.click(p0.x, p0.y); await page.keyboard.press('Escape');
  return { page, svg, at, drag, click, tool, panel, button, download, grab, settle, check, done };
}
