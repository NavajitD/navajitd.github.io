// Admin console → Experience: archive, edit, add and reorder, preview the
// real page with the draft, and publish (a commit of content/experience.json
// through the GitHub API, stubbed here). Firebase is stubbed so the admin is
// signed in; nothing leaves the machine.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const STUB = readFileSync(new URL('../fixtures/firebase-admin-stub.js', import.meta.url), 'utf8');
const FILE = readFileSync(new URL('../../content/experience.json', import.meta.url), 'utf8');
const API = 'https://api.github.com/repos/NavajitD/navajitd.github.io';
const TOKEN = `github_pat_${'x'.repeat(60)}`;

async function openEditor(page, { token = false } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await page.addInitScript(STUB);
  await page.addInitScript(({ token }) => {
    if (sessionStorage.getItem('xp-test-init')) return;   // only the first load starts clean
    sessionStorage.setItem('xp-test-init', '1');
    localStorage.removeItem('xp.draft');
    localStorage.removeItem('xp.githubToken');
    localStorage.setItem('xp.allowLocalPublish', '1');
    if (token) localStorage.setItem('xp.githubToken', token);
  }, { token: token ? TOKEN : '' });
  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  await page.locator('.tab[data-tab="experience"]').click();
  await expect(page.locator('.xp-role')).toHaveCount(JSON.parse(FILE).roles.length);
  return errors;
}

const card = (page, name) => page.locator('.xp-cards > .xp-item', { hasText: name });
const role = (page, id) => page.locator(`.xp-role[data-role="${id}"]`);

test('archive and restore a card, and the status counts unpublished changes', async ({ page }) => {
  const errors = await openEditor(page);
  await expect(page.locator('.xp-status')).toHaveText('Matches the live site');
  await expect(page.getByRole('button', { name: 'Publish' })).toBeDisabled();

  await card(page, 'Calls that needed a person').getByRole('button', { name: 'Archive “Calls that needed a person”' }).click();
  await expect(card(page, 'Calls that needed a person')).toHaveClass(/is-archived/);
  await expect(page.locator('.xp-status')).toHaveText('1 unpublished change');
  await expect(role(page, 'zoca').locator('.xp-item-meta').first()).toContainText('4 of 5 cards shown');

  // Drafts survive a reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tab[data-tab="experience"]').click();
  await expect(card(page, 'Calls that needed a person')).toHaveClass(/is-archived/);
  await expect(page.locator('.xp-alert')).toContainText('Restored your unpublished changes');

  await card(page, 'Calls that needed a person').getByRole('button', { name: 'Restore “Calls that needed a person”' }).click();
  await expect(page.locator('.xp-status')).toHaveText('Matches the live site');
  expect(errors).toEqual([]);
});

test('preview shows the real page with the draft: an archived role is gone, an edit shows', async ({ page }) => {
  await openEditor(page);
  await role(page, 'pine-labs-apm').getByRole('button', { name: /^Archive Associate Product Manager/ }).click();
  await card(page, 'Calls where the agent broke trust').getByRole('button', { name: 'Edit “Calls where the agent broke trust”' }).click();
  const dialog = page.locator('dialog.xp-dialog');
  await dialog.getByLabel('Metric (English)').fill('Calls where the agent broke a promise');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).not.toBeVisible();

  await page.getByRole('button', { name: 'Preview' }).click();
  const frame = page.frameLocator('.xp-frame');
  await expect(frame.locator('#zoca .xp-card')).toHaveCount(5);
  await expect(frame.locator('[data-i18n="x.zoca.trust.metric"]')).toHaveText('Calls where the agent broke a promise');
  await expect(frame.locator('#pine-labs-apm')).toHaveCount(0);
  await expect(frame.locator('#pine-labs-ai-pm')).toHaveCount(1);
  await expect(frame.locator('script[src*="analytics"]')).toHaveCount(0); // previews aren't counted as visits
  await expect(frame.locator('#zoca .xp-waffle i')).toHaveCount(500);
  await page.getByRole('button', { name: 'Phone' }).click();
  await expect(page.locator('.xp-frame')).toHaveCSS('width', '390px');
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(page.locator('.xp-preview')).toHaveCount(0);
});

test('add a role and a card, with validation and a suggested change', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: '+ Add role' }).click();
  const dialog = page.locator('dialog.xp-dialog');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('.xp-errors')).toContainText('Add a title.');
  await dialog.getByLabel('Title (English)').fill('Senior AI Product Manager');
  await dialog.getByLabel('Company (English)').fill('Acme AI');
  await dialog.locator('input[type="month"]').first().fill('2027-01');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.xp-role').first()).toHaveAttribute('data-role', 'acme-ai');

  await role(page, 'acme-ai').getByRole('button', { name: '+ Add card' }).click();
  await dialog.getByLabel('Metric (English)').fill('Leads qualified by the agent');
  await dialog.getByLabel('Before', { exact: true }).fill('20%');
  await dialog.getByLabel('After', { exact: true }).fill('45%');
  await expect(dialog.getByLabel('Change', { exact: true })).toHaveValue('2.3×');
  await dialog.getByLabel('Unit (English)').fill('of leads');
  await dialog.getByLabel('Bullet 1 (English)').fill('Built a scoring rubric with sales');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(card(page, 'Leads qualified by the agent')).toContainText('20% → 45% · 2.3× · 1 bullets');

  // Things added in this draft can be removed outright; published ones are archived.
  await expect(card(page, 'Leads qualified by the agent').getByRole('button', { name: /^Remove/ })).toBeVisible();
  await expect(card(page, 'Calls that needed a person').getByRole('button', { name: /^Remove/ })).toHaveCount(0);
  await expect(page.locator('.xp-status')).toHaveText('2 unpublished changes');
});

test('reorder roles and cards', async ({ page }) => {
  await openEditor(page);
  await card(page, 'Calls where the agent broke trust').getByRole('button', { name: 'Move “Calls where the agent broke trust” up' }).click();
  await expect(role(page, 'zoca').locator('.xp-cards > .xp-item').first()).toHaveAttribute('data-card', 'trust');
  await role(page, 'pine-labs-ai-pm').getByRole('button', { name: /^Move AI Product Manager, Pine Labs up/ }).click();
  await expect(page.locator('.xp-role').first()).toHaveAttribute('data-role', 'pine-labs-ai-pm');
});

test('publish commits content/experience.json through the GitHub API', async ({ page }) => {
  let put = null;
  await page.route(`${API}/contents/content/experience.json?ref=main`, (r) => r.fulfill({
    json: { sha: 'blob-sha-1', content: Buffer.from(FILE).toString('base64') },
  }));
  await page.route('https://api.github.com/user', (r) => r.fulfill({ json: { login: 'NavajitD' } }));
  await page.route(`${API}/contents/content/experience.json`, async (r) => {
    put = { method: r.request().method(), auth: r.request().headers().authorization, body: r.request().postDataJSON() };
    await r.fulfill({ json: { content: { sha: 'blob-sha-2' }, commit: { sha: 'abc1234def', html_url: 'https://github.com/NavajitD/navajitd.github.io/commit/abc1234def' } } });
  });
  await openEditor(page, { token: true });
  await expect(page.locator('.xp-connect')).toContainText('GitHub connected as NavajitD');
  await expect(page.locator('.xp-status')).toHaveText('Matches GitHub');

  await card(page, 'Calls that needed a person').getByRole('button', { name: 'Archive “Calls that needed a person”' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('.xp-log')).toContainText('Committed abc1234');
  await expect(page.locator('.xp-status')).toHaveText('Matches GitHub');

  expect(put.method).toBe('PUT');
  expect(put.auth).toBe(`Bearer ${TOKEN}`);
  expect(put.body.sha).toBe('blob-sha-1');
  expect(put.body.branch).toBe('main');
  expect(put.body.message).toMatch(/^experience: archive card “Calls that needed a person” \(Zoca\)/);
  const committed = JSON.parse(Buffer.from(put.body.content, 'base64').toString('utf8'));
  expect(committed.roles.find((r) => r.id === 'zoca').cards.find((c) => c.id === 'handoffs').archived).toBe(true);
  expect(Buffer.from(put.body.content, 'base64').toString('utf8')).toMatch(/\n$/);
  expect(await page.evaluate(() => localStorage.getItem('xp.draft'))).toBeNull();
});

test('a stale file on GitHub stops the publish with a clear message', async ({ page }) => {
  await page.route(`${API}/contents/content/experience.json?ref=main`, (r) => r.fulfill({
    json: { sha: 'blob-sha-1', content: Buffer.from(FILE).toString('base64') },
  }));
  await page.route('https://api.github.com/user', (r) => r.fulfill({ json: { login: 'NavajitD' } }));
  await page.route(`${API}/contents/content/experience.json`, (r) => r.fulfill({ status: 409, json: { message: 'conflict' } }));
  await openEditor(page, { token: true });
  await card(page, 'Calls that needed a person').getByRole('button', { name: 'Archive “Calls that needed a person”' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(page.locator('.xp-log')).toContainText('changed on GitHub since you loaded it');
  await expect(page.locator('.xp-status')).toHaveText('1 unpublished change');
});

test('connecting checks the token against the repository before keeping it', async ({ page }) => {
  await page.route(API, (r) => r.fulfill({ status: 404, json: { message: 'Not Found' } }));
  await openEditor(page);
  await page.getByRole('button', { name: 'Connect GitHub' }).click();
  const dialog = page.locator('dialog.xp-dialog');
  await dialog.getByLabel('GitHub token').fill('not-a-token');
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.locator('.xp-errors')).toContainText('doesn’t look like a GitHub token');
  await dialog.getByLabel('GitHub token').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await expect(dialog.locator('.xp-errors')).toContainText('can’t see NavajitD/navajitd.github.io');
  expect(await page.evaluate(() => localStorage.getItem('xp.githubToken'))).toBeNull();
});
