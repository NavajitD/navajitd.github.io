// ArchiHelp wind worker: day simulations and 2D lattice-Boltzmann wind pictures off the main thread.
//   -> { id, cmd: 'day', house, fans, wx, opts }                 <- { id, type: 'result', res }
//   -> { id, cmd: 'lbm', geo, state, bin, dx, pad, steps, avg }  <- { id, type: 'progress', f } ... { id, type: 'result', field }
import { runDay, gridFromGeometry, buildMask } from './sim.js';
import { lbmSolve } from './lbm.js';

self.onmessage = (e) => {
  const m = e.data || {};
  try {
    if (m.cmd === 'day') {
      const res = runDay(m.house, m.fans, m.wx, m.opts);
      self.postMessage({ id: m.id, type: 'result', res });
    } else if (m.cmd === 'lbm') {
      const g = gridFromGeometry(m.geo, { dx: m.dx, pad: m.pad }), mask = buildMask(g, m.state);
      const { ux, uy } = lbmSolve(mask, g.nx, g.ny, m.bin, { steps: m.steps, avg: m.avg, onProgress: (f) => self.postMessage({ id: m.id, type: 'progress', f }) });
      const field = { nx: g.nx, ny: g.ny, dx: g.dx, pad: g.pad, xmin: g.xmin, ymin: g.ymin, ux, uy, mask };
      self.postMessage({ id: m.id, type: 'result', field }, [ux.buffer, uy.buffer, mask.buffer]);
    }
  } catch (err) {
    self.postMessage({ id: m.id, type: 'error', message: String((err && err.stack) || err) });
  }
};
