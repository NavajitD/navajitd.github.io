// HealThee Gamification — DOM rendering layer
// Reuses host app's toast if available (window.toast). Otherwise renders its own.

import { BADGES, levelForXp, xpToNextLevel, progressToNextLevel, DAILY_CHALLENGE_POOL } from './core.js';

const STYLE_ID = 'htgam-styles';

const CSS = `
.htgam-overlay {
  position: fixed; inset: 0; z-index: 9999; display: flex; align-items: center; justify-content: center;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(6px);
  opacity: 0; pointer-events: none; transition: opacity .25s ease;
}
.htgam-overlay.show { opacity: 1; pointer-events: auto; }
.htgam-card {
  background: linear-gradient(180deg, #1a1f2b, #0f1320);
  color: #f5f7fb; padding: 28px 32px; border-radius: 20px;
  min-width: 280px; max-width: 90vw; text-align: center;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08) inset;
  transform: scale(.94); transition: transform .25s ease;
}
.htgam-overlay.show .htgam-card { transform: scale(1); }
.htgam-card h2 { margin: 0 0 6px; font-size: 22px; }
.htgam-card .htgam-sub { opacity: .75; font-size: 13px; margin-bottom: 14px; }
.htgam-card .htgam-emoji { font-size: 44px; margin-bottom: 8px; line-height: 1; }
.htgam-card button {
  margin-top: 16px; padding: 10px 22px; border: none; border-radius: 999px;
  background: #ffd166; color: #1a1f2b; font-weight: 600; cursor: pointer;
}
.htgam-hud {
  display: flex; gap: 10px; align-items: center; font-size: 13px;
  padding: 4px 10px; border-radius: 999px;
  background: rgba(255,255,255,0.06);
}
.htgam-hud .htgam-pill { display: inline-flex; gap: 4px; align-items: center; }
.htgam-trophy-wall {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 12px; padding: 12px 0;
}
.htgam-trophy {
  text-align: center; padding: 12px 8px; border-radius: 14px;
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06);
}
.htgam-trophy.locked { opacity: .35; filter: grayscale(1); }
.htgam-trophy .htgam-trophy-icon { font-size: 28px; margin-bottom: 4px; }
.htgam-trophy .htgam-trophy-name { font-size: 12px; line-height: 1.2; }
`;

function ensureStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

export function toast(msg, type = '') {
  if (typeof document === 'undefined') return;
  if (typeof window !== 'undefined' && typeof window.toast === 'function') {
    try { window.toast(msg, type); return; } catch { /* fall through */ }
  }
  ensureStyles();
  let el = document.getElementById('htgam-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'htgam-toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:10px 16px;border-radius:999px;background:#1a1f2b;color:#fff;font-size:13px;z-index:10000;opacity:0;transition:opacity .2s ease';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._hideT);
  el._hideT = setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

const BADGE_ICONS = {
  first_step: '🌱', three_peat: '🔥', week_warrior: '⚔️', fortnight_focus: '🎯',
  monthly_maven: '🏆', quarter_century: '💎', half_year_hero: '🦸', annual_legend: '👑',
  macro_mind: '🧠', the_100: '💯',
  on_your_feet: '🦶', step_starter: '🚶',
  sleep_scholar: '😴',
  first_thoughts: '📝',
  goal_setter: '🎯',
};

export function badgeIcon(id) { return BADGE_ICONS[id] || '🏅'; }

export function showLevelUp(toLevel) {
  if (typeof document === 'undefined' || !toLevel) return;
  ensureStyles();
  const el = document.createElement('div');
  el.className = 'htgam-overlay';
  el.innerHTML = `
    <div class="htgam-card">
      <div class="htgam-emoji">✨</div>
      <div class="htgam-sub">Level ${toLevel.lvl}</div>
      <h2>${escapeHtml(toLevel.title)}</h2>
      <div class="htgam-sub">You've leveled up. Keep going.</div>
      <button type="button">Onward</button>
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const close = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('button').addEventListener('click', close);
  el.addEventListener('click', e => { if (e.target === el) close(); });
  setTimeout(close, 4500);
}

export function showBadgeUnlock(badgeId) {
  const b = BADGES.find(x => x.id === badgeId);
  if (!b) return;
  toast(`${badgeIcon(b.id)} Badge unlocked: ${b.name}`, 'success');
}

export function showXpToast(delta, reason) {
  if (delta <= 0) return;
  toast(`+${delta} XP${reason ? ' · ' + reason : ''}`);
}

export function showStreakMilestone(days) {
  toast(`🔥 ${days}-day streak! Keep it lit.`, 'success');
}

export function showComebackBonus(xp) {
  toast(`👋 Welcome back — +${xp} XP Comeback bonus`, 'success');
}

export function showBonusBurst(xp, gems) {
  toast(`🎉 Bonus Burst! +${xp} XP, +${gems} 💎`, 'success');
}

export function renderHud(state, mountEl) {
  if (!mountEl) return;
  ensureStyles();
  const lvl = levelForXp(state.xp || 0);
  const toNext = xpToNextLevel(state.xp || 0);
  const pct = Math.round(progressToNextLevel(state.xp || 0) * 100);
  mountEl.innerHTML = `
    <div class="htgam-hud" title="Level ${lvl.lvl} ${lvl.title} · ${toNext} XP to next">
      <span class="htgam-pill">✨ <strong>L${lvl.lvl}</strong> ${escapeHtml(lvl.title)}</span>
      <span class="htgam-pill" title="${pct}% to next level">${state.xp || 0} XP</span>
      <span class="htgam-pill" title="Daily streak">🔥 ${state.streak?.current || 0}</span>
      <span class="htgam-pill" title="Gems">💎 ${state.gems || 0}</span>
    </div>`;
}

export function renderTrophyWall(state, mountEl) {
  if (!mountEl) return;
  ensureStyles();
  const earned = new Set(state.badges || []);
  const html = BADGES.map(b => {
    const got = earned.has(b.id);
    return `<div class="htgam-trophy ${got ? '' : 'locked'}" title="${escapeHtml(b.name)}">
      <div class="htgam-trophy-icon">${badgeIcon(b.id)}</div>
      <div class="htgam-trophy-name">${escapeHtml(b.name)}</div>
    </div>`;
  }).join('');
  mountEl.innerHTML = `<div class="htgam-trophy-wall">${html}</div>`;
}

export function renderDailyChallenges(state, dateKey, picks, mountEl) {
  if (!mountEl) return;
  ensureStyles();
  const completed = new Set(
    state.dailyChallenges && state.dailyChallenges.dateKey === dateKey
      ? (state.dailyChallenges.completed || [])
      : []
  );
  const items = picks.map(c => `
    <li style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;font-size:13px">
      <span>${completed.has(c.id) ? '✅' : '⬜'}</span>
      <span style="${completed.has(c.id) ? 'opacity:.6;text-decoration:line-through' : ''}">${escapeHtml(c.label)}</span>
    </li>`).join('');
  mountEl.innerHTML = `<ul style="list-style:none;padding:0;margin:0">${items}</ul>`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
