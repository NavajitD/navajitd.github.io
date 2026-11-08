// Landing page: typed greeting, "Read on in …" language switch and the
// experience carousel's floating arrows.
import { test, expect } from '@playwright/test';

async function open(page, url = '/?lang=en') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.emulateMedia({ reducedMotion: 'reduce' }); // instant scrolls, whole greetings
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  return errors;
}

test('arrows show only on a side that has another card', async ({ page }) => {
  const errors = await open(page);
  const carousel = page.locator('#zoca .xp-carousel');
  const prev = carousel.locator('.xp-prev');
  const next = carousel.locator('.xp-next');
  const status = carousel.locator('.xp-status');
  const total = await carousel.locator('.xp-card').count();

  await expect(next).toBeVisible();
  await expect(prev).toBeHidden();
  await expect(status).toHaveText(`Result 1 of ${total}`);

  for (let i = 2; i <= total; i++) {
    await next.click();
    await expect(status).toHaveText(`Result ${i} of ${total}`);
    await expect(prev).toBeVisible();
  }
  await expect(next).toBeHidden();
  await expect(next).toBeDisabled();

  // Keyboard on the cards themselves.
  await carousel.locator('.xp-track').press('Home');
  await expect(status).toHaveText(`Result 1 of ${total}`);
  await expect(prev).toBeHidden();
  await carousel.locator('.xp-track').press('ArrowRight');
  await expect(status).toHaveText(`Result 2 of ${total}`);
  expect(errors).toEqual([]);
});

test('every card fills its 10 x 10 grid from its numbers', async ({ page }) => {
  await open(page);
  const grids = page.locator('#zoca .xp-waffle');
  const n = await grids.count();
  for (let i = 0; i < n; i++) {
    const g = grids.nth(i);
    await expect(g.locator('i')).toHaveCount(100);
    const before = Number(await g.getAttribute('data-before'));
    const after = Number(await g.getAttribute('data-after'));
    const moved = after > before ? 'is-gain' : 'is-cut';
    await expect(g.locator(`i.${moved}`)).toHaveCount(Math.abs(after - before));
    await expect(g.locator('i.is-kept')).toHaveCount(Math.min(before, after));
  }
});

test('Bengali page translates the cards and the arrow labels', async ({ page }) => {
  const errors = await open(page, '/?lang=bn');
  await expect(page.locator('#experience')).toHaveAttribute('lang', 'bn');
  await expect(page.locator('[data-i18n="x.zoca.bookings.metric"]')).toHaveText('ব্যবসার জন্য বুক হওয়া গ্রাহকের অ্যাপয়েন্টমেন্ট');
  await expect(page.locator('#zoca .xp-carousel')).toHaveAttribute('aria-label', 'Zoca-তে ফলাফল');
  await expect(page.locator('[data-i18n="x.pine-labs-ai-pm.meta"]')).toHaveText('পাইন ল্যাবস, বেঙ্গালুরু · মে ২০২৫ থেকে জুলাই ২০২৬');
  await expect(page.locator('#zoca .xp-next')).toHaveAttribute('aria-label', 'পরের ফলাফল');
  await expect(page.locator('#zoca .xp-card').first()).toHaveAttribute('aria-label', /^৫টির মধ্যে ১$/);
  // The big change figure keeps its size in Bengali (a p:lang() rule once shrank it).
  const deltaPx = await page.locator('#zoca .xp-delta').first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  expect(deltaPx).toBeGreaterThan(30);
  await expect(page.locator('.greet-text')).toHaveText('নমস্কার, আমি নভোজিৎ।');
  await expect(page.locator('#readOn')).toHaveText('বাকিটা বাংলায় পড়ুন →');
  expect(errors).toEqual([]);
});

test('Read on switches the page and remembers the language', async ({ page }) => {
  await open(page, '/');
  const readOn = page.locator('#readOn');
  await expect(readOn).toHaveText('বাকিটা বাংলায় পড়ুন →');
  await readOn.click();
  await expect(page).toHaveURL(/\?lang=bn$/);
  await expect(page.locator('[data-i18n="experience"]')).toHaveText('অভিজ্ঞতা');
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-i18n="experience"]')).toHaveText('অভিজ্ঞতা');
});

test('no sideways scrolling on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = await open(page);
  const width = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(390);
  await expect(page.locator('#zoca .xp-next')).toBeVisible();
  expect(errors).toEqual([]);
});
