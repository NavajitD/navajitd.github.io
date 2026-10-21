// ArchiHelp design engine — dog-leg staircase design and arrival-lobby geometry.
import { rect, rw, rh, rarea, sharedEdge, EPS } from './geom.js';

/** Dog-leg stair from the floor height: risers, flights and the block size (turns clockwise going up). */
/** Rise of the flight drawn on this floor (ft): the ground storey for the ground and first floors, typical above. */
export const stairRiseFt = (cfg) => ((cfg.floor_level ?? 0) <= 1 ? cfg.ground_floor_height_ft : cfg.typical_floor_height_ft);

export function designStair(cfg) {
  const H = stairRiseFt(cfg) * 12.0;
  const n = Math.ceil(H / cfg.max_riser_in - 1e-9), r1 = Math.ceil(n / 2), r2 = n - r1, fw = cfg.stair_width_ft;
  const run = Math.max(r1 - 1, r2 - 1) * cfg.tread_in / 12.0;
  return { height_in: H, risers: n, riser_in: H / n, tread_in: cfg.tread_in, r1, r2, flight_w: fw, block_l: run + fw, block_w: 2 * fw + 0.33, run };
}

/** Dog-leg arrangements inside net rect P (all turn clockwise going up). */
export function stairVariants(P, st) {
  const bw = st.block_w, bl = st.block_l, fw = st.flight_w, out = [];
  const W = rw(P), Hh = rh(P);
  if (W >= bw - EPS && Hh >= bl - EPS) {
    for (const xal of ['W', 'E']) {
      const bx0 = xal === 'W' ? P.x0 : P.x1 - bw;
      let blk = rect(bx0, P.y1 - bl, bx0 + bw, P.y1);
      out.push({ var: 'A', access: 'S', lobby: rect(P.x0, P.y0, P.x1, blk.y0), block: blk,
        flights: [[rect(blk.x0, blk.y0, blk.x0 + fw, blk.y1 - fw), [0, 1]], [rect(blk.x1 - fw, blk.y0, blk.x1, blk.y1 - fw), [0, -1]]] });
      blk = rect(bx0, P.y0, bx0 + bw, P.y0 + bl);
      out.push({ var: 'B', access: 'N', lobby: rect(P.x0, blk.y1, P.x1, P.y1), block: blk,
        flights: [[rect(blk.x1 - fw, blk.y0 + fw, blk.x1, blk.y1), [0, -1]], [rect(blk.x0, blk.y0 + fw, blk.x0 + fw, blk.y1), [0, 1]]] });
    }
  }
  if (W >= bl - EPS && Hh >= bw - EPS) {
    for (const yal of ['S', 'N']) {
      const by0 = yal === 'S' ? P.y0 : P.y1 - bw;
      let blk = rect(P.x1 - bl, by0, P.x1, by0 + bw);
      out.push({ var: 'C', access: 'W', lobby: rect(P.x0, P.y0, blk.x0, P.y1), block: blk,
        flights: [[rect(blk.x0, blk.y1 - fw, blk.x1 - fw, blk.y1), [1, 0]], [rect(blk.x0, blk.y0, blk.x1 - fw, blk.y0 + fw), [-1, 0]]] });
      blk = rect(P.x0, by0, P.x0 + bl, by0 + bw);
      out.push({ var: 'D', access: 'E', lobby: rect(blk.x1, P.y0, P.x1, P.y1), block: blk,
        flights: [[rect(blk.x0 + fw, blk.y0, blk.x1, blk.y0 + fw), [-1, 0]], [rect(blk.x0 + fw, blk.y1 - fw, blk.x1, blk.y1), [1, 0]]] });
    }
  }
  return out;
}

/** Wall shared with a circulation tile along the stair's arrival lobby (where a door/opening can go). */
export function lobbyContact(stile, ctile, v, tol = 0.6) {
  const [L, seg] = sharedEdge(stile, ctile);
  if (L <= 0) return [0, null];
  const [[x0, y0], [x1, y1]] = seg, q = v.lobby, acc = v.access, horiz = Math.abs(y0 - y1) < 1e-9;
  const onAccess = (acc === 'S' && horiz && Math.abs(y0 - stile.y0) < 1e-3) || (acc === 'N' && horiz && Math.abs(y0 - stile.y1) < 1e-3) ||
    (acc === 'W' && !horiz && Math.abs(x0 - stile.x0) < 1e-3) || (acc === 'E' && !horiz && Math.abs(x0 - stile.x1) < 1e-3);
  const depth = (acc === 'S' || acc === 'N') ? rh(q) : rw(q);
  let lo, hi;
  if (horiz) {
    lo = Math.max(x0, q.x0 - tol); hi = Math.min(x1, q.x1 + tol);
    if (!onAccess && !(q.y0 - tol <= y0 && y0 <= q.y1 + tol)) return [0, null];
  } else {
    lo = Math.max(y0, q.y0 - tol); hi = Math.min(y1, q.y1 + tol);
    if (!onAccess && !(q.x0 - tol <= x0 && x0 <= q.x1 + tol)) return [0, null];
  }
  if (hi - lo <= 0 || (!onAccess && depth < 2.5)) return [0, null];
  return [hi - lo, horiz ? [[lo, y0], [hi, y1]] : [[x0, lo], [x1, hi]]];
}

export function stairSizeOk(net, st) {
  return stairVariants(net, st).length > 0 && rarea(net) <= st.block_w * st.block_l + 80;
}
