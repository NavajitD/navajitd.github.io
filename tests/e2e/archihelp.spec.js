// End-to-end: ArchiHelp (Projects/ArchiHelp/planner.html). No sign-in, no network beyond the static server.
// Covers the paths the hand-sketch revisions needed: open the example (the final plan), edit with real mouse input,
// live checks, undo, the A3 drawing set as a PDF, and the wizard -> multi-worker search -> options -> editor flow.
import { test, expect } from '@playwright/test';

const PAGE = '/Projects/ArchiHelp/planner.html';

function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  // external hosts (fonts, analytics) may rate-limit repeated test loads: only same-origin HTTP failures count
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|analytics|favicon/i.test(m.text())) errors.push(`console.error: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400 && new URL(r.url()).host === '127.0.0.1:8765') errors.push(`HTTP ${r.status()} ${r.url()}`); });
  return errors;
}

/** Plan feet -> page pixels via the editor overlay's transform. */
const ftToPx = (page, x, y) => page.evaluate(([fx, fy]) => {
  const m = document.querySelector('.ov').getScreenCTM(), q = new DOMPoint(fx, fy).matrixTransform(m);
  return [q.x, q.y];
}, [x, y]);
const roomNet = (page, name) => page.evaluate((n) => window.__ahEditor.plan.rooms.find((r) => r.name === n).net, name);

async function openExample(page) {
  await page.goto(`${PAGE}#/`);
  await page.getByRole('button', { name: /Open the example/ }).click();
  await expect(page.locator('.ed-status')).toContainText('Vaastu 62.4');
  await expect(page.locator('.ed-status')).toContainText('Hard rules pass');
}

test.describe('ArchiHelp', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => { try { indexedDB.deleteDatabase('archihelp'); } catch { /* ignore */ } });
  });

  test('home loads; the example opens as the final revision-9 plan', async ({ page }) => {
    const errors = trackErrors(page);
    await openExample(page);
    await expect(page.locator('#crumbs select')).toHaveValue('0');
    const rooms = await page.evaluate(() => window.__ahEditor.plan.rooms.map((r) => r.name));
    expect(rooms).toEqual(expect.arrayContaining(['Master Bedroom', 'Kitchen', 'Puja Room', 'Hall', 'Stair Landing', 'Lobby']));
    expect(errors).toEqual([]);
  });

  test('edit with the mouse and the inspector; live checks; undo', async ({ page }) => {
    const errors = trackErrors(page);
    await openExample(page);
    // click the kitchen
    const k = await roomNet(page, 'Kitchen');
    const [kx, ky] = await ftToPx(page, (k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2 + 1.2);
    await page.mouse.click(kx, ky);
    await expect(page.locator('.panel h3')).toHaveText('Kitchen');
    // area target, as in revision 5 ("kitchen 80 sq ft") — here 85
    const area = page.locator('[data-k="room-area"]');
    await area.fill('85');
    await area.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__ahEditor.plan.rooms.find((r) => r.name === 'Kitchen').area)).toBeCloseTo(85, 6);
    // drag the wall between Bedroom 2 and the Lobby one foot east
    const b2 = await roomNet(page, 'Bedroom 2'), t = await page.evaluate(() => window.__ahEditor.plan.rooms.find((r) => r.name === 'Bedroom 2').tile);
    const [wx, wy] = await ftToPx(page, t.x1, (b2.y0 + b2.y1) / 2), [wx2] = await ftToPx(page, t.x1 + 1, (b2.y0 + b2.y1) / 2);
    await page.mouse.move(wx, wy); await page.mouse.down(); await page.mouse.move(wx2, wy, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await roomNet(page, 'Bedroom 2')).x1 - b2.x1).toBeCloseTo(1, 6);
    // undo twice -> back to the original
    await page.keyboard.press('ControlOrMeta+z');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => (await roomNet(page, 'Bedroom 2')).x1).toBeCloseTo(b2.x1, 9);
    await expect.poll(() => page.evaluate(() => window.__ahEditor.plan.rooms.find((r) => r.name === 'Kitchen').area)).toBeCloseTo(80.102, 2);
    // remove the puja door (revision 5) -> the reachability rule fails live
    const pj = await page.evaluate(() => { const e = window.__ahEditor, u = e.plan.rooms.find((r) => r.name === 'Puja Room').uid; return e.plan.links_all.findIndex((l) => l.a === u || l.b === u); });
    await page.evaluate((k2) => { const e = window.__ahEditor, l = e.plan.links_all[k2]; e.select({ t: 'link', a: l.a, b: l.b }); }, pj);
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('.ed-status')).toContainText(/hard rule/);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.ed-status')).toContainText('Hard rules pass');
    expect(errors).toEqual([]);
  });

  test('furniture: place, drag, rotate and delete', async ({ page }) => {
    await openExample(page);
    await page.keyboard.press('f');
    await page.locator('.palette button', { hasText: 'Study table' }).click();
    const n = await roomNet(page, 'Bedroom 3');
    const [x, y] = await ftToPx(page, n.x0 + 2.5, n.y1 - 0.8);
    await page.mouse.click(x, y);
    const sel = await page.evaluate(() => window.__ahEditor.sel);
    expect(sel.t).toBe('item');
    const item = () => page.evaluate((s) => window.__ahEditor.plan.furniture[s.uid][s.i], sel);
    const before = await item();
    expect(before.kind).toBe('study');
    expect(before.rect.y1).toBeCloseTo(n.y1, 6);        // backs onto the north wall
    await page.keyboard.press('Escape');               // select tool
    const [cx, cy] = await ftToPx(page, (before.rect.x0 + before.rect.x1) / 2, (before.rect.y0 + before.rect.y1) / 2);
    const [cx2] = await ftToPx(page, (before.rect.x0 + before.rect.x1) / 2 + 2, 0);
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx2, cy, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => (await item()).rect.x0 - before.rect.x0).toBeCloseTo(2, 6);
    await page.keyboard.press('r');
    await expect.poll(async () => (await item()).side).toBe('E');
    const count = (await page.evaluate((s) => window.__ahEditor.plan.furniture[s.uid].length, sel));
    await page.keyboard.press('Delete');
    await expect.poll(() => page.evaluate((s) => window.__ahEditor.plan.furniture[s.uid].length, sel)).toBe(count - 1);
  });

  test('select several: Shift-click and Ctrl/⌘-click, then move, nudge, delete and undo them together', async ({ page }) => {
    const errors = trackErrors(page);
    await openExample(page);
    const centre = (name, i) => page.evaluate(([n, k]) => { const e = window.__ahEditor, r = e.plan.rooms.find((q) => q.name === n), it = e.plan.furniture[r.uid][k].rect; return [(it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2]; }, [name, i]);
    const rect = (name, i) => page.evaluate(([n, k]) => { const e = window.__ahEditor, r = e.plan.rooms.find((q) => q.name === n); return e.plan.furniture[r.uid][k].rect; }, [name, i]);
    const clickFt = async (fx, fy, key) => { const [x, y] = await ftToPx(page, fx, fy); if (key) await page.keyboard.down(key); await page.mouse.click(x, y); if (key) await page.keyboard.up(key); };
    const bed = await centre('Bedroom 2', 0), coffee = await centre('Hall', 1), sofa = await centre('Hall', 0);
    await clickFt(...bed);
    await expect(page.locator('.panel h3')).toHaveText('Bed');
    await clickFt(...coffee, 'Shift');
    await expect(page.locator('.panel h3')).toHaveText('2 selected');
    await clickFt(...sofa, 'ControlOrMeta');
    await expect(page.locator('.panel h3')).toHaveText('3 selected');
    await expect(page.locator('.ov .sel')).toHaveCount(3);
    await clickFt(...sofa, 'ControlOrMeta');                     // a second click takes it out again
    await expect(page.locator('.panel h3')).toHaveText('2 selected');
    // drag one of them: both move by the same amount
    const b0 = await rect('Bedroom 2', 0), c0 = await rect('Hall', 1);
    const [x0, y0] = await ftToPx(page, ...coffee), [x1, y1] = await ftToPx(page, coffee[0] + 1, coffee[1] + 1);
    await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 8 }); await page.mouse.up();
    await expect.poll(async () => (await rect('Bedroom 2', 0)).x0 - b0.x0).toBeCloseTo(1, 6);
    expect((await rect('Bedroom 2', 0)).y0 - b0.y0).toBeCloseTo(1, 6);
    expect((await rect('Hall', 1)).x0 - c0.x0).toBeCloseTo(1, 6);
    expect((await rect('Hall', 1)).y0 - c0.y0).toBeCloseTo(1, 6);
    await expect(page.locator('.panel h3')).toHaveText('2 selected');
    // arrow keys nudge both (Shift = 1 ft)
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(async () => (await rect('Bedroom 2', 0)).x0 - b0.x0).toBeCloseTo(0, 6);
    expect((await rect('Hall', 1)).x0 - c0.x0).toBeCloseTo(0, 6);
    // Delete removes both; one undo brings both back
    const count = () => page.evaluate(() => Object.values(window.__ahEditor.plan.furniture).reduce((a, l) => a + l.length, 0));
    const n = await count();
    await page.keyboard.press('Delete');
    await expect.poll(count).toBe(n - 2);
    await expect(page.locator('.ed-status')).toContainText('Removed 2 pieces of furniture');
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(count).toBe(n);
    // two rooms: their area together, and swap them
    await page.keyboard.press('Escape');
    const k = await roomNet(page, 'Kitchen'), d = await roomNet(page, 'Dining');
    await clickFt((k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2);            // clear floor, away from furniture and doorways
    await clickFt(d.x0 + 2.3, (d.y0 + d.y1) / 2, 'Shift');
    await expect(page.locator('[data-k="multi-area"]')).toContainText('180 sq ft');
    await page.getByRole('button', { name: 'Swap them' }).click();
    await expect.poll(() => page.evaluate((x) => window.__ahEditor.plan.rooms.find((r) => Math.abs(r.net.x0 - x) < 1e-6).name, k.x0)).toBe('Dining');
    expect(errors).toEqual([]);
  });

  // the add-to-selection key follows the platform: Ctrl on Windows (and Linux), ⌘ on a Mac; Shift on both
  for (const [os, platform, uaPlatform, addKey, otherKey, label] of [['Windows', 'Win32', 'Windows', 'Control', 'Meta', 'Ctrl-click'], ['macOS', 'MacIntel', 'macOS', 'Meta', 'Control', '⌘-click']]) {
    test(`${os}: ${label} adds to the selection, the other modifier does not`, async ({ page }) => {
      await page.addInitScript(([pl, up]) => {
        Object.defineProperty(Navigator.prototype, 'platform', { configurable: true, get: () => pl });
        Object.defineProperty(Navigator.prototype, 'userAgentData', { configurable: true, get: () => ({ platform: up, mobile: false, brands: [] }) });
      }, [platform, uaPlatform]);
      await openExample(page);
      await expect(page.locator('#edHint')).toContainText(label);
      const at = (name, i) => page.evaluate(([n, k]) => { const e = window.__ahEditor, r = e.plan.rooms.find((q) => q.name === n), it = e.plan.furniture[r.uid][k].rect; return [(it.x0 + it.x1) / 2, (it.y0 + it.y1) / 2]; }, [name, i]);
      const clickFt = async ([fx, fy], key) => { const [x, y] = await ftToPx(page, fx, fy); if (key) await page.keyboard.down(key); await page.mouse.click(x, y); if (key) await page.keyboard.up(key); };
      await clickFt(await at('Bedroom 2', 0));
      await clickFt(await at('Hall', 1), addKey);
      await expect(page.locator('.panel h3')).toHaveText('2 selected');
      await clickFt(await at('Hall', 0), 'Shift');
      await expect(page.locator('.panel h3')).toHaveText('3 selected');
      await clickFt(await at('Hall', 2), otherKey);                 // not the add key here: a plain click, just the TV
      await expect(page.locator('.panel h3')).toHaveText('TV unit');
    });
  }

  test('drawing set: four A3 sheets and a PDF download', async ({ page }) => {
    await openExample(page);
    await page.getByRole('button', { name: /PDF/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Drawing set' });
    await expect(dlg).toBeVisible();
    for (const s of ['A-102', 'A-601', 'S-101', 'A-101']) {
      await dlg.getByRole('tab', { name: s }).click();
      await expect(dlg.locator('.sheet-view svg')).toHaveCount(1);
    }
    await expect(dlg.locator('.sheet-view')).toContainText('PRELIMINARY');
    const [download] = await Promise.all([page.waitForEvent('download'), dlg.getByRole('button', { name: /Download PDF/ }).click()]);
    const buf = Buffer.concat(await (async () => { const out = []; for await (const c of await download.createReadStream()) out.push(c); return out; })());
    expect(buf.subarray(0, 8).toString('latin1')).toBe('%PDF-1.4');
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBe(4);
    expect(download.suggestedFilename()).toMatch(/residence-example-house-.*-p1\.pdf$/);
  });

  test('wizard -> options from the multi-worker search -> editor', async ({ page }) => {
    test.setTimeout(180000);
    const errors = trackErrors(page);
    await page.goto(`${PAGE}#/`);
    await page.getByRole('button', { name: /New project/ }).click();
    await expect(page.locator('.wz-main h2')).toHaveText('Site');
    for (const step of ['Building', 'Rooms', 'Vaastu rules', 'Room sizes']) {
      await page.getByRole('button', { name: /^Next/ }).click();
      await expect(page.locator('.wz-main h2')).toHaveText(step);
    }
    await page.getByRole('button', { name: /^Next/ }).click();
    await expect(page.locator('.wz-main .note.ok')).toContainText('skeletons to search');
    await page.getByRole('radio', { name: 'Quick' }).click();
    await page.getByRole('button', { name: /Generate options/ }).click();
    await expect(page.locator('.ccard[data-option]').first()).toBeVisible({ timeout: 150000 });
    const n = await page.locator('.ccard[data-option]').count();
    expect(n).toBeGreaterThanOrEqual(5);
    const passing = await page.locator('.ccard[data-option] .badge.ok').count();
    expect(passing).toBe(n);
    await page.locator('.ccard[data-option]').first().getByRole('button', { name: 'Open' }).click();
    await expect(page.locator('.ed-status')).toContainText('Hard rules pass');
    expect(errors).toEqual([]);
  });

  test('phone width: editor fits without horizontal scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openExample(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('.ed-tools .tool').first()).toBeVisible();
  });
});
