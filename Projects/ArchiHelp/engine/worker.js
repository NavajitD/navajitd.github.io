// ArchiHelp engine worker: runs the layout search off the main thread (one worker per CPU core).
// Protocol (postMessage):
//   -> { id, cmd: 'count', cfg }                                  <- { id, type: 'result', count }
//   -> { id, cmd: 'search', cfg, skeletons:[index...], budget, perSkeleton }
//      <- { id, type: 'progress', done, total, candidates:[...] } per skeleton, then { id, type: 'result', stats }
//   -> { id, cmd: 'rank', cfg, candidates, polish, maxCandidates } <- { id, type: 'result', candidates }
//   -> { id, cmd: 'analyse', cfg, doc }                            <- { id, type: 'result', summary }
import { makeContext, skeletons, collectSkeleton, rankCandidates, diagnose } from './generator.js';

let cache = { key: null, ctx: null, sks: null };
function context(cfg) {
  const key = JSON.stringify(cfg);
  if (cache.key !== key) { const ctx = makeContext(cfg, { minFrac: cfg.__minFrac ?? null, fixedStair: cfg.__fixedStair ?? null, stairRiseFt: cfg.__stairRiseFt ?? null }); cache = { key, ctx, sks: skeletons(ctx) }; }
  return cache;
}

self.onmessage = (e) => {
  const m = e.data || {};
  try {
    if (m.cmd === 'count') {
      self.postMessage({ id: m.id, type: 'result', count: context(m.cfg).sks.length, diag: m.diagnose ? diagnose(m.cfg, { minFrac: m.minFrac }) : null });
    } else if (m.cmd === 'search') {
      const { ctx, sks } = context(m.cfg), stats = { skeletons: 0, layouts: 0, valid: 0, nodes: 0 };
      m.skeletons.forEach((k, i) => {
        const r = collectSkeleton(ctx, sks[k], { budget: m.budget, perSkeleton: m.perSkeleton });
        stats.skeletons++; stats.layouts += r.stats.layouts; stats.nodes += r.stats.nodes; stats.valid += r.candidates.length;
        self.postMessage({ id: m.id, type: 'progress', done: i + 1, total: m.skeletons.length, candidates: r.candidates });
      });
      self.postMessage({ id: m.id, type: 'result', stats });
    } else if (m.cmd === 'rank') {
      self.postMessage({ id: m.id, type: 'result', candidates: rankCandidates(m.cfg, m.candidates, { polish: m.polish, maxCandidates: m.maxCandidates, polishMs: m.polishMs }) });
    }
  } catch (err) {
    self.postMessage({ id: m.id, type: 'error', message: String((err && err.stack) || err) });
  }
};
