// Experience section of the landing page: one source (content/experience.json)
// and one renderer for it. scripts/build-experience.mjs uses this in the
// "Build experience" GitHub Action and locally; admin.html uses it to check
// edits, suggest the change figure and preview the page before publishing.
// No Node or DOM APIs here, so the same file runs in both.

export const LANGS = ['en', 'bn', 'hi'];
export const LANG_NAMES = { en: 'English', bn: 'বাংলা', hi: 'हिंदी' };
export const REGION_RE = /<!-- @experience:start[^>]*-->[\s\S]*?<!-- @experience:end -->/;
export const HASH_RE = /<!-- @experience:start hash=([0-9a-f]+)/;

const MONTHS = {
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  bn: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'],
  hi: ['जनवरी', 'फ़रवरी', 'मार्च', 'अप्रैल', 'मई', 'जून', 'जुलाई', 'अगस्त', 'सितंबर', 'अक्टूबर', 'नवंबर', 'दिसंबर'],
};
const RANGE = {
  en: (a, b) => (b ? `${a} - ${b}` : `${a} - Present`),
  bn: (a, b) => (b ? `${a} থেকে ${b}` : `${a} থেকে এখন`),
  hi: (a, b) => (b ? `${a} से ${b}` : `${a} से अब तक`),
};
// Screen-reader labels for a role's carousel, per language.
const REGION_LABEL = {
  en: (c) => `Results at ${c}`,
  bn: (c) => `${c}-তে ফলাফল`,
  hi: (c) => `${c} में नतीजे`,
};
const TRACK_LABEL = {
  en: (c) => `Results at ${c}, scroll sideways for more`,
  bn: (c) => `${c}-তে ফলাফল, আরও দেখতে পাশে স্ক্রল করুন`,
  hi: (c) => `${c} में नतीजे, और देखने के लिए बगल में स्क्रॉल करें`,
};

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Bengali pages write numbers in Bengali digits; English and Hindi keep 0-9. */
export const localDigits = (s, lang) =>
  lang === 'bn' ? String(s ?? '').replace(/[0-9]/g, (d) => BN_DIGITS[d]) : String(s ?? '');

/** The text of a translated field in `lang`, falling back to English. */
export function pick(field, lang) {
  if (field == null) return '';
  if (typeof field === 'string') return field.trim();
  const own = String(field[lang] ?? '').trim();
  return own || String(field.en ?? '').trim();
}

export const escapeHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Text with optional links written as [text](https://…) or [text](/path).
 * Everything else is escaped, so the JSON can never inject markup.
 */
export function inline(s) {
  const src = String(s ?? '');
  const out = [];
  let last = 0;
  for (const m of src.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
    out.push(escapeHtml(src.slice(last, m.index)));
    const [whole, label, url] = m;
    if (/^https?:\/\/[^\s"<>]+$/i.test(url)) {
      out.push(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="merchant-link">${escapeHtml(label)}</a>`);
    } else if (/^[/#][^\s"<>]*$/.test(url) && !url.startsWith('//')) {
      out.push(`<a href="${escapeHtml(url)}" class="merchant-link">${escapeHtml(label)}</a>`);
    } else {
      out.push(escapeHtml(whole));
    }
    last = m.index + whole.length;
  }
  out.push(escapeHtml(src.slice(last)));
  return out.join('');
}

export function formatMonth(ym, lang) {
  const [y, m] = String(ym).split('-').map(Number);
  return `${MONTHS[lang][m - 1]} ${localDigits(y, lang)}`;
}

/** "Aug 2026 - Present", "আগস্ট ২০২৬ থেকে এখন", "अगस्त 2026 से अब तक". */
export const formatDates = (start, end, lang) =>
  RANGE[lang](formatMonth(start, lang), end ? formatMonth(end, lang) : '');

/** A value as a share of 100 for the grid, or null when it isn't a number. */
export function gridValue(s) {
  const n = parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const number = (s) => parseFloat(String(s ?? '').replace(/[^0-9.]/g, ''));

/**
 * The headline change for before -> after: a ratio for gains of 2x or more
 * (2.04 -> "2×"), otherwise a percentage with a real minus sign ("−85%").
 */
export function suggestDelta(before, after) {
  const b = number(before);
  const a = number(after);
  if (!(b > 0) || !Number.isFinite(a)) return '';
  const r = a / b;
  if (r >= 2) {
    const x = Math.round(r * 10) / 10;
    return `${Number.isInteger(x) ? x : x.toFixed(1)}×`;
  }
  const pct = Math.round((r - 1) * 100);
  return `${pct > 0 ? '+' : pct < 0 ? '−' : ''}${Math.abs(pct)}%`;
}

export const slugify = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'item';

/** `base`, or `base-2`, `base-3`… when taken. */
export function uniqueId(base, taken) {
  const root = slugify(base);
  const used = new Set(taken);
  if (!used.has(root)) return root;
  for (let i = 2; ; i++) if (!used.has(`${root}-${i}`)) return `${root}-${i}`;
}

export const blankText = () => ({ en: '', bn: '', hi: '' });
export const blankRole = (id) => ({
  id,
  archived: false,
  title: blankText(),
  company: blankText(),
  companyUrl: '',
  location: { en: 'Bengaluru', bn: 'বেঙ্গালুরু', hi: 'बेंगलुरु' },
  start: '',
  end: '',
  description: blankText(),
  cards: [],
});
export const blankCard = (id) => ({
  id,
  archived: false,
  metric: blankText(),
  before: '',
  after: '',
  delta: '',
  unit: blankText(),
  grid: true,
  bullets: [blankText(), blankText()],
});

// ─── Checks ─────────────────────────────────────────────────────────────────

const hasEn = (f) => pick(f, 'en') !== '';

/** Problems that would break the page. Archived items are checked too, so they stay restorable. */
export function validateExperience(data) {
  const errors = [];
  if (!data || !Array.isArray(data.roles)) return ['The file needs a "roles" list.'];
  const roleIds = new Set();
  data.roles.forEach((r, i) => {
    const where = `Role ${i + 1}${hasEn(r?.title) ? ` (${pick(r.title, 'en')})` : ''}`;
    if (!r || typeof r !== 'object') return errors.push(`${where}: not an object.`);
    if (!ID_RE.test(r.id || '')) errors.push(`${where}: id must use lowercase letters, digits and hyphens.`);
    else if (roleIds.has(r.id)) errors.push(`${where}: id "${r.id}" is used twice.`);
    else roleIds.add(r.id);
    if (!hasEn(r.title)) errors.push(`${where}: add a title.`);
    if (!hasEn(r.company)) errors.push(`${where}: add the company.`);
    if (r.companyUrl && !/^https?:\/\/[^\s"<>]+$/.test(r.companyUrl)) errors.push(`${where}: the company link must start with https://.`);
    if (!MONTH_RE.test(r.start || '')) errors.push(`${where}: the start month must look like 2026-08.`);
    if (r.end && !MONTH_RE.test(r.end)) errors.push(`${where}: the end month must look like 2026-08, or be empty for Present.`);
    if (MONTH_RE.test(r.start || '') && MONTH_RE.test(r.end || '') && r.end < r.start) errors.push(`${where}: it ends before it starts.`);
    if (r.cards != null && !Array.isArray(r.cards)) errors.push(`${where}: "cards" must be a list.`);
    const cardIds = new Set();
    (Array.isArray(r.cards) ? r.cards : []).forEach((c, j) => {
      const cw = `${where}, card ${j + 1}${hasEn(c?.metric) ? ` (${pick(c.metric, 'en')})` : ''}`;
      if (!c || typeof c !== 'object') return errors.push(`${cw}: not an object.`);
      if (!ID_RE.test(c.id || '')) errors.push(`${cw}: id must use lowercase letters, digits and hyphens.`);
      else if (cardIds.has(c.id)) errors.push(`${cw}: id "${c.id}" is used twice in this role.`);
      else cardIds.add(c.id);
      if (!hasEn(c.metric)) errors.push(`${cw}: add the metric.`);
      if (!String(c.before ?? '').trim() || !String(c.after ?? '').trim()) errors.push(`${cw}: add the before and after values.`);
      if (!String(c.delta ?? '').trim()) errors.push(`${cw}: add the change (for example 2× or −32%).`);
      const bullets = (Array.isArray(c.bullets) ? c.bullets : []).filter(hasEn);
      if (!bullets.length) errors.push(`${cw}: add at least one bullet.`);
      if (c.grid) {
        const b = gridValue(c.before);
        const a = gridValue(c.after);
        if (b == null || a == null || b > 100 || a > 100) errors.push(`${cw}: the 10×10 grid needs before and after between 0 and 100 (or turn the grid off).`);
      }
    });
  });
  return errors;
}

const digitsOf = (s) =>
  (String(s ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d))).match(/\d+(?:\.\d+)?/g) || []).join(' ');

/**
 * Non-blocking notes for the editor: Bengali or Hindi text whose numbers no
 * longer match the English (usually a translation left behind after an edit).
 */
export function translationNotes(field) {
  const notes = {};
  if (!field || typeof field !== 'object') return notes;
  const en = digitsOf(field.en);
  for (const l of ['bn', 'hi']) {
    if (String(field[l] ?? '').trim() && digitsOf(field[l]) !== en) notes[l] = 'Numbers differ from the English.';
  }
  return notes;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

function renderCard(role, card, i, total, put) {
  const k = `x.${role.id}.${card.id}`;
  const values = (l) => {
    const unit = pick(card.unit, l);
    return `<span class="xp-before">${escapeHtml(localDigits(card.before, l))}</span> → ${escapeHtml(localDigits(card.after, l))}${unit ? ` <span class="xp-unit">${escapeHtml(unit)}</span>` : ''}`;
  };
  put(`${k}.metric`, (l) => escapeHtml(pick(card.metric, l)));
  put(`${k}.delta`, (l) => escapeHtml(localDigits(String(card.delta).trim(), l)));
  put(`${k}.values`, values);
  const bullets = (card.bullets || []).filter(hasEn);
  bullets.forEach((b, j) => put(`${k}.p${j + 1}`, (l) => inline(pick(b, l))));
  const b = gridValue(card.before);
  const a = gridValue(card.after);
  const grid = card.grid && b != null && a != null && b <= 100 && a <= 100;
  return [
    `    <li class="xp-card" aria-roledescription="slide" aria-label="${i + 1} of ${total}">`,
    `        <div class="xp-stat">`,
    `            <div>`,
    `                <h4 class="xp-metric" data-i18n="${k}.metric">${escapeHtml(pick(card.metric, 'en'))}</h4>`,
    `                <p class="xp-delta" data-i18n="${k}.delta">${escapeHtml(String(card.delta).trim())}</p>`,
    `                <p class="xp-values" data-i18n="${k}.values">${values('en')}</p>`,
    `            </div>`,
    ...(grid ? [`            <div class="xp-waffle" data-before="${b}" data-after="${a}" aria-hidden="true"></div>`] : []),
    `        </div>`,
    `        <ul class="xp-points">`,
    ...bullets.map((x, j) => `            <li data-i18n="${k}.p${j + 1}">${inline(pick(x, 'en'))}</li>`),
    `        </ul>`,
    `    </li>`,
  ].map((line) => `        ${line}`);
}

function renderRole(role, put) {
  const k = `x.${role.id}`;
  const company = (l) => {
    const name = escapeHtml(pick(role.company, l));
    return role.companyUrl
      ? `<a href="${escapeHtml(role.companyUrl)}" target="_blank" rel="noopener noreferrer" class="merchant-link">${name}</a>`
      : name;
  };
  const meta = (l) =>
    `${[company(l), escapeHtml(pick(role.location, l))].filter(Boolean).join(', ')} · ${escapeHtml(formatDates(role.start, role.end, l))}`;
  put(`${k}.title`, (l) => escapeHtml(pick(role.title, l)));
  put(`${k}.meta`, meta);
  const cards = (role.cards || []).filter((c) => !c.archived);
  const lines = [
    `<div class="experience-item" id="${role.id}">`,
    `    <h3 class="experience-title" data-i18n="${k}.title">${escapeHtml(pick(role.title, 'en'))}</h3>`,
    `    <div class="experience-meta" data-i18n="${k}.meta">${meta('en')}</div>`,
  ];
  if (hasEn(role.description)) {
    put(`${k}.description`, (l) => inline(pick(role.description, l)));
    lines.push(`    <p${cards.length ? ' class="xp-lead"' : ''} data-i18n="${k}.description">${inline(pick(role.description, 'en'))}</p>`);
  }
  if (cards.length) {
    const name = pick(role.company, 'en');
    put(`${k}.region`, (l) => REGION_LABEL[l](pick(role.company, l)));
    put(`${k}.track`, (l) => TRACK_LABEL[l](pick(role.company, l)));
    lines.push(
      `    <div class="xp-carousel" aria-roledescription="carousel" aria-label="${escapeHtml(REGION_LABEL.en(name))}" data-i18n-aria="${k}.region">`,
      `        <ol class="xp-track" tabindex="0" aria-label="${escapeHtml(TRACK_LABEL.en(name))}" data-i18n-aria="${k}.track">`,
      ...cards.flatMap((c, i) => renderCard(role, c, i, cards.length, put)),
      `        </ol>`,
      `        <button type="button" class="xp-btn xp-prev" aria-label="Previous result" data-i18n-aria="xpPrev" hidden></button>`,
      `        <button type="button" class="xp-btn xp-next" aria-label="Next result" data-i18n-aria="xpNext" hidden></button>`,
      `        <p class="sr-only xp-status" aria-live="polite">Result 1 of ${cards.length}</p>`,
      `    </div>`,
    );
  }
  lines.push(`</div>`);
  return lines;
}

/**
 * The whole region that sits between the markers in index.html: every role
 * that isn't archived, in file order, plus the Bengali and Hindi strings the
 * page's language switch reads (`#i18n-xp`). English lives in the HTML.
 */
export function renderExperience(data, { hash = '', indent = 8 } = {}) {
  const strings = { bn: {}, hi: {} };
  // HTML strings are what the page swaps in with innerHTML; aria strings are plain text.
  const put = (key, f) => { for (const l of ['bn', 'hi']) strings[l][key] = f(l); };
  const lines = [];
  data.roles.filter((r) => !r.archived).forEach((r, i) => {
    if (i) lines.push('');
    lines.push(...renderRole(r, put));
  });
  const json = JSON.stringify(strings, null, 2).replace(/</g, '\\u003c');
  const body = [
    `<!-- @experience:start hash=${hash} · Built from content/experience.json by scripts/build-experience.mjs. Edit the JSON or use /admin.html (Experience), not this HTML. -->`,
    ...lines,
    `<script type="application/json" id="i18n-xp">`,
    ...json.split('\n'),
    `</script>`,
    `<!-- @experience:end -->`,
  ];
  const pad = ' '.repeat(indent);
  return body.map((line, i) => (i === 0 || line === '' ? line : pad + line)).join('\n');
}

/** index.html with its Experience region rebuilt from `data`. */
export function applyExperience(html, data, hash) {
  if (!REGION_RE.test(html)) throw new Error('index.html has no <!-- @experience:start --> … <!-- @experience:end --> region.');
  return html.replace(REGION_RE, () => renderExperience(data, { hash }));
}
