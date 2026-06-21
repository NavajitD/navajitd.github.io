// Renders scripts/og-card.html to og-image.png (1200x630) for social share cards.
// Usage: node scripts/render-og.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cardUrl = 'file://' + resolve(__dirname, 'og-card.html');
const out = resolve(__dirname, '..', 'og-image.png');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.goto(cardUrl, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: out });
await browser.close();
console.log('Wrote', out);
