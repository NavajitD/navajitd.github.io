// Admin console → Jobs. The private jobhunt repository is replaced by an
// in-memory stand-in for the GitHub API: files this page reads and writes,
// and workflow dispatches it sends. Nothing leaves the machine, and every
// posting, company and address below is made up.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const STUB = readFileSync(new URL('../fixtures/firebase-admin-stub.js', import.meta.url), 'utf8');
const API = 'https://api.github.com/repos/NavajitD/jobhunt';
const TOKEN = `github_pat_${'j'.repeat(60)}`;
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`).toString('base64');
const unb64 = (s) => JSON.parse(Buffer.from(s, 'base64').toString('utf8'));

const job = (n, o = {}) => ({
  id: `${n}`.repeat(16).slice(0, 16), title: `Product Manager ${n}`, company: `Company ${n}`, location: 'Bengaluru, Karnataka, India', remote: false, geo: 'in',
  url: `https://jobs.example/${n}`, links: [{ source: 'linkedin', url: `https://jobs.example/${n}` }], source: 'linkedin', sources: ['linkedin'],
  postedAt: new Date(Date.now() - 864e5).toISOString(), salary: '', yoe: { req: { min: 2, max: 4 }, stated: true, ok: true, label: '2–4 years' },
  score: 90 - n, llm: true, why: [`Reason one for ${n}`, 'Reason two'], gap: n === 1 ? 'No payments background' : '', themes: [], poster: null,
  thinDescription: false, description: `Posting text for job ${n}.`, ...o,
});
const DAY = {
  date: '2026-11-10', generatedAt: '2026-11-10T01:45:00.000Z', settings: { geos: ['in'], remote: false, years: 3 },
  stats: { perSource: { linkedin: 96, ats: 9530, wellfound: 0 }, errors: ['wellfound: every page failed'], funnel: { fetched: 9626, droppedTitle: 9000, candidates: 243, droppedYoe: 125, scoredBy: 'model', scored: 48, shown: 3 }, llm: {} },
  jobs: [job(1), job(2, { yoe: { req: null, stated: false, ok: null, label: 'not stated' }, links: [{ source: 'linkedin', url: 'https://jobs.example/2' }, { source: 'cutshort', url: 'https://other.example/2' }] }), job(3)],
};
const DRAFT = (id, steer = '') => ({
  jobId: id, steer, status: 'ok', generatedAt: new Date(Date.now() + 1000).toISOString(), errors: [],
  letter: { subject: 'Product Manager 1 application, Navjit Debnath', body: `Hi Company 1 team,\n\nFirst paragraph${steer ? ` (${steer})` : ''}.\n\nBest,\nNavjit`, words: 9, checks: { passed: true, issues: [] }, plan: { needs: [{ need: 'voice agents', evidence: 'resolves 44% of calls' }], hook: 'the booking flow' } },
  contacts: { domain: 'company1.example', domainSource: 'a link in the posting', emails: [
    { email: 'asha@company1.example', kind: 'person', name: 'Asha Rao', title: 'Head of Product', linkedin: '', grade: 'verified', detail: 'A verifier confirmed this mailbox exists.' },
    { email: 'careers@company1.example', kind: 'inbox', name: '', title: '', linkedin: '', grade: 'published', detail: 'Published by the company on company1.example/careers.' },
  ], people: [{ name: 'Ravi Menon', title: 'Recruiter', linkedin: 'https://linkedin.example/ravi', note: 'Posted this job. No confirmed email; message on LinkedIn.' }], notes: [] },
});

/** A tiny GitHub: `files` are served and overwritten; dispatches are recorded and can produce files. */
async function github(page, { files = {}, access = true, onDispatch } = {}) {
  const repo = { files: { 'data/index.json': { days: [{ date: DAY.date, count: 3, fetched: 9626 }] }, [`data/daily/${DAY.date}.json`]: DAY, 'data/settings.json': { version: 1, geos: ['in'], remote: false, yoe: { careerStart: '2023-07', override: null }, avoidCompanies: [] }, 'data/state.json': {}, 'data/profile/resume.json': { parsedAt: new Date().toISOString(), characters: 5344, pages: 1 }, ...files }, puts: [], dispatches: [], sha: 1 };
  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    if (req.headers().authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });
    if (url.pathname === '/user') return json(200, { login: 'NavajitD' });
    if (!access) return json(404, { message: 'Not Found' });
    const path = decodeURIComponent(url.pathname.replace('/repos/NavajitD/jobhunt', ''));
    if (path === '') return json(200, { full_name: 'NavajitD/jobhunt' });
    if (path === '/contents/data/drafts') return json(200, Object.keys(repo.files).filter((f) => f.startsWith('data/drafts/')).map((f) => ({ name: f.split('/').pop() })));
    if (path.startsWith('/contents/')) {
      const file = path.slice('/contents/'.length);
      if (req.method() === 'PUT') {
        const body = req.postDataJSON();
        repo.puts.push({ file, message: body.message, sha: body.sha, content: body.content });
        repo.files[file] = file.endsWith('.json') ? unb64(body.content) : body.content;
        return json(200, { content: { sha: `sha${++repo.sha}` } });
      }
      if (!(file in repo.files)) return json(404, { message: 'Not Found' });
      return json(200, { sha: `sha${repo.sha}`, content: b64(repo.files[file]) });
    }
    const d = path.match(/^\/actions\/workflows\/([\w.]+)\/dispatches$/);
    if (d) {
      const body = req.postDataJSON();
      repo.dispatches.push({ workflow: d[1], ...body });
      onDispatch?.(repo, d[1], body.inputs || {});
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    if (/\/actions\/workflows\/[\w.]+\/runs$/.test(path)) return json(200, { workflow_runs: [{ created_at: new Date().toISOString(), status: 'completed', conclusion: 'success', html_url: 'https://github.example/run' }] });
    return json(404, { message: `unstubbed ${path}` });
  });
  return repo;
}

async function open(page, { token = true, ...gh } = {}) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/gstatic\.com\/firebasejs/, (r) => r.abort());
  await page.addInitScript(STUB);
  await page.addInitScript(({ token }) => {
    if (sessionStorage.getItem('jobs-test-init')) return;
    sessionStorage.setItem('jobs-test-init', '1');
    for (const k of Object.keys(localStorage)) if (k.startsWith('jobs.') || k === 'xp.githubToken') localStorage.removeItem(k);
    localStorage.setItem('jobs.pollMs', '150');
    if (token) localStorage.setItem('xp.githubToken', token);   // the Experience tab's token is reused
  }, { token: token ? TOKEN : '' });
  const repo = await github(page, gh);
  await page.goto('/admin.html', { waitUntil: 'domcontentloaded' });
  await page.locator('.tab[data-tab="jobs"]').click();
  return { repo, errors };
}
const card = (page, n) => page.locator('.jb-job', { hasText: `Product Manager ${n}` });

test('the day’s jobs load with where the pull went, why each fits, and what experience it asks for', async ({ page }) => {
  const { errors } = await open(page);
  await expect(page.locator('.jb-job')).toHaveCount(3);
  await expect(page.locator('.xp-connect')).toContainText('Connected to NavajitD/jobhunt as NavajitD');
  await expect(page.locator('.jb-funnel summary')).toHaveText('9,626 postings pulled → 243 were PM roles in your geographies and new → 125 asked for a different experience range → 48 scored by the model → 3 shown');
  await page.locator('.jb-funnel summary').click();
  await expect(page.locator('.jb-funnel')).toContainText('wellfound: every page failed');
  await expect(page.locator('.jb-funnel')).toContainText('Searched India for roles whose experience range contains 3 years.');

  await expect(card(page, 1).locator('.jb-title a')).toHaveAttribute('href', 'https://jobs.example/1');
  await expect(card(page, 1).locator('.jb-meta').first()).toHaveText('Company 1 · Bengaluru, Karnataka, India · posted yesterday');
  await expect(card(page, 1)).toContainText('Experience asked: 2–4 years');
  await expect(card(page, 1).locator('.jb-why li')).toHaveText(['Reason one for 1', 'Reason two']);
  await expect(card(page, 1).locator('.jb-gap')).toHaveText('Gap: No payments background');
  await expect(card(page, 1).locator('.jb-score')).toHaveText('89');
  await expect(card(page, 2)).toContainText('Experience asked: not stated');
  await expect(card(page, 2).getByRole('link', { name: 'also on cutshort' })).toHaveAttribute('href', 'https://other.example/2');
  expect(errors).toEqual([]);
});

test('a keyword-ranked day says so', async ({ page }) => {
  const day = { ...DAY, stats: { ...DAY.stats, funnel: { ...DAY.stats.funnel, scoredBy: 'keywords', scoreError: 'OPENROUTER_API_KEY is not set' } }, jobs: DAY.jobs.map((j) => ({ ...j, llm: false, why: [] })) };
  await open(page, { files: { [`data/daily/${DAY.date}.json`]: day } });
  await expect(page.locator('#jobsAdmin .alert-info')).toHaveText('This run was ranked by keywords, not by the model (OPENROUTER_API_KEY is not set). Treat the order as rough.');
  await expect(card(page, 1).locator('.jb-score')).toHaveText('89kw');
});

test('drafting: starts the workflow, shows the letter and graded addresses, and Gmail opens with your edits', async ({ page }) => {
  const { repo, errors } = await open(page, { onDispatch: (r, wf, inputs) => { if (wf === 'draft.yml') r.files[`data/drafts/${inputs.job_id}.json`] = DRAFT(inputs.job_id, inputs.steer); } });
  await card(page, 1).getByRole('button', { name: 'Draft cover letter' }).click();
  const letter = card(page, 1).locator('.jb-letter');
  await expect(letter).toHaveValue(/^Hi Company 1 team,\n\nFirst paragraph\./);
  expect(repo.dispatches).toEqual([{ workflow: 'draft.yml', ref: 'main', inputs: { job_id: '1111111111111111', steer: '' } }]);
  await expect(card(page, 1).locator('.jb-count')).toHaveText('8 words');
  await expect(card(page, 1).locator('.jb-draft')).toContainText('every figure appears in your résumé, your site or the posting');
  await expect(card(page, 1).locator('.jb-plan')).toContainText('voice agents: resolves 44% of calls');

  const rows = card(page, 1).locator('.jb-contact');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('asha@company1.example');
  await expect(rows.nth(0).locator('.xp-badge')).toHaveText('Verified');
  await expect(rows.nth(0)).toContainText('Asha Rao, Head of Product');
  await expect(rows.nth(1).locator('.xp-badge')).toHaveText('Published');
  await expect(rows.nth(1)).toContainText('Shared inbox');
  await expect(rows.nth(2)).toContainText('Ravi Menon');

  await letter.fill('Hi Asha,\n\nMy own words.\n\nBest,\nNavjit');
  await expect(card(page, 1).locator('.jb-count')).toHaveText('7 words');
  const href = new URL(await rows.nth(0).getByRole('link', { name: 'Open in Gmail' }).getAttribute('href'));
  expect(href.origin + href.pathname).toBe('https://mail.google.com/mail/');
  expect(href.searchParams.get('to')).toBe('asha@company1.example');
  expect(href.searchParams.get('su')).toBe('Product Manager 1 application, Navjit Debnath');
  expect(href.searchParams.get('body')).toBe('Hi Asha,\n\nMy own words.\n\nBest,\nNavjit');

  // Edits survive a reload; the draft is fetched, not requested again.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tab[data-tab="jobs"]').click();
  await card(page, 1).getByRole('button', { name: 'Show draft' }).click();
  await expect(card(page, 1).locator('.jb-letter')).toHaveValue(/My own words\./);
  expect(repo.dispatches).toHaveLength(1);

  // A redraft carries the note, and replaces the edited text.
  await card(page, 1).locator('.jb-steer').fill('lead with voice');
  await card(page, 1).getByRole('button', { name: 'Redraft' }).click();
  await expect(card(page, 1).locator('.jb-letter')).toHaveValue(/First paragraph \(lead with voice\)\./);
  expect(repo.dispatches[1].inputs).toEqual({ job_id: '1111111111111111', steer: 'lead with voice' });
  expect(errors).toEqual([]);
});

test('a failed draft shows the reason and offers another try', async ({ page }) => {
  await open(page, { onDispatch: (r, wf, inputs) => { r.files[`data/drafts/${inputs.job_id}.json`] = { jobId: inputs.job_id, status: 'partial', generatedAt: new Date(Date.now() + 1000).toISOString(), letter: null, errors: ['Cover letter: the OPENROUTER_API_KEY secret is not set on the jobhunt repository.'], contacts: { domain: '', domainSource: '', emails: [], people: [], notes: ['No published or verified address was found. Apply through the posting; a guessed address would most likely bounce.'] } }; } });
  await card(page, 3).getByRole('button', { name: 'Draft cover letter' }).click();
  await expect(card(page, 3).locator('.alert-error')).toHaveText('Cover letter: the OPENROUTER_API_KEY secret is not set on the jobhunt repository.');
  await expect(card(page, 3).locator('.jb-contacts')).toContainText('a guessed address would most likely bounce');
  await expect(card(page, 3).getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(card(page, 3).locator('.jb-letter')).toHaveCount(0);
});

test('marking a job applied or skipped is saved to the repository, and can be undone', async ({ page }) => {
  const { repo } = await open(page);
  await card(page, 2).getByRole('button', { name: 'Mark applied' }).click();
  await expect(card(page, 2)).toHaveClass(/is-applied/);
  await expect(card(page, 2).getByRole('button', { name: 'Applied today' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].file).toBe('data/state.json');
  expect(repo.files['data/state.json']['2222222222222222']).toMatchObject({ status: 'applied', title: 'Product Manager 2', company: 'Company 2' });

  await card(page, 3).getByRole('button', { name: 'Skip' }).click();
  await expect(card(page, 3)).toHaveClass(/is-skipped/);
  await card(page, 2).getByRole('button', { name: 'Applied today' }).click();
  await expect(card(page, 2)).not.toHaveClass(/is-applied/);
  await expect.poll(() => Object.keys(repo.files['data/state.json'])).toEqual(['3333333333333333']);
});

test('settings: geographies, years and a new résumé are written to the repository', async ({ page }) => {
  const { repo } = await open(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  const dialog = page.locator('dialog.xp-dialog');
  await expect(dialog.getByLabel('India', { exact: true })).toBeChecked();
  await expect(dialog).toContainText('Current résumé parsed today (1 page, 5,344 characters).');
  await dialog.getByLabel('India', { exact: true }).uncheck();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.locator('.xp-errors')).toHaveText('Choose at least one geography.');

  await dialog.getByLabel('Singapore', { exact: true }).check();
  await dialog.getByLabel('UAE').check();
  await dialog.getByLabel('Also show remote roles open to these geographies').check();
  await dialog.getByLabel('Or fix the number').fill('4');
  await dialog.getByLabel('Companies to leave out').fill('Staffing Co, Other Agency');
  await dialog.getByLabel('Upload a new résumé (PDF)').setInputFiles({ name: 'resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#jobsAdmin .alert-info')).toContainText('Settings saved.');
  await expect(page.locator('#jobsAdmin .alert-info')).toContainText('Résumé uploaded.');
  expect(repo.files['data/settings.json']).toMatchObject({ geos: ['ae', 'sg'], remote: true, yoe: { careerStart: '2023-07', override: 4 }, avoidCompanies: ['Staffing Co', 'Other Agency'] });
  const pdf = repo.puts.find((p) => p.file === 'resume/resume.pdf');
  expect(Buffer.from(pdf.content, 'base64').toString()).toBe('%PDF-1.4 test');
});

test('Run now starts the search workflow and reloads when it finishes', async ({ page }) => {
  const { repo } = await open(page);
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect.poll(() => repo.dispatches.map((d) => d.workflow)).toEqual(['daily.yml']);
  await expect(page.getByRole('button', { name: 'Run now' })).toBeEnabled();
  await expect(page.locator('.jb-job')).toHaveCount(3);
});

test('without a token it asks to connect; a pasted token is checked and kept for this tab only', async ({ page }) => {
  await open(page, { token: false });
  await expect(page.locator('#jobsAdmin')).toContainText('Connect a GitHub token that can read NavajitD/jobhunt to see your jobs.');
  await page.getByRole('button', { name: 'Connect GitHub' }).click();
  const dialog = page.locator('dialog.xp-dialog');
  await dialog.getByLabel('Token (only if new)').fill('not-a-token');
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(dialog.locator('.xp-errors')).toContainText('doesn’t look like a GitHub token');
  await dialog.getByLabel('Token (only if new)').fill(TOKEN);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect(page.locator('.jb-job')).toHaveCount(3);
  expect(await page.evaluate(() => [localStorage.getItem('jobs.githubToken') !== null, localStorage.getItem('xp.githubToken')])).toEqual([true, null]);
});

test('a token that can’t see the repository gets a plain explanation and a retry', async ({ page }) => {
  await open(page, { access: false });
  await expect(page.locator('#jobsAdmin .alert-error')).toContainText('The saved token can’t see NavajitD/jobhunt. Give it access to that repository (Contents and Actions, read and write), then press Check again.');
  await expect(page.locator('.jb-job')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
});

test('on a phone nothing overflows, with a draft open', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const long = { title: 'Senior Product Manager, Conversational AI Platform and Agent Experience (Voice)', location: 'Bengaluru East, Karnataka, India · Hyderabad, Telangana, India' };
  await open(page, {
    files: { [`data/daily/${DAY.date}.json`]: { ...DAY, jobs: [job(1, long), job(2), job(3)] } },
    onDispatch: (r, wf, inputs) => { const d = DRAFT(inputs.job_id); d.contacts.emails[0].email = 'a.very.long.name.for.an.address@a-long-company-domain.example'; r.files[`data/drafts/${inputs.job_id}.json`] = d; },
  });
  await page.locator('.jb-job').first().getByRole('button', { name: 'Draft cover letter' }).click();
  await expect(page.locator('.jb-contact')).toHaveCount(3);
  await page.locator('.jb-funnel summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
