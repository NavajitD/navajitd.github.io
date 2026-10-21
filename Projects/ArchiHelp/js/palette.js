// Vaastu Planner — furniture palette (sizes from the planner's defaults) and wall-aware placement.
import { rw, rh } from '../engine/geom.js';

export const PALETTE = [
  ['Bedroom', [
    { kind: 'bed', name: 'Queen bed', w: 5.0, h: 6.5, side: 'S', meta: { head: 'S' }, label: 'BED' },
    { kind: 'bed', name: 'Double bed', w: 4.5, h: 6.25, side: 'S', meta: { head: 'S' }, label: 'BED' },
    { kind: 'bed', name: 'Single bed', w: 3.0, h: 6.25, side: 'S', meta: { head: 'S' }, label: 'BED' },
    { kind: 'side_table', name: 'Side table', w: 1.5, h: 1.5, free: true },
    { kind: 'wardrobe', name: 'Wardrobe', w: 6.0, h: 2.0, tall: true, side: 'S', label: 'WARDROBE' },
    { kind: 'study', name: 'Study table', w: 3.5, h: 2.0, side: 'S' },
  ]],
  ['Kitchen', [
    { kind: 'counter', name: 'Counter', w: 6.0, h: 2.0, side: 'S' },
    { kind: 'counter', name: 'Counter + hob', w: 6.0, h: 2.0, side: 'S', meta: { hob: true, hob_end: 'lo' } },
    { kind: 'counter', name: 'Counter + sink', w: 6.0, h: 2.0, side: 'S', meta: { sink: true, sink_end: 'lo' } },
    { kind: 'fridge', name: 'Fridge', w: 2.25, h: 2.25, tall: true, side: 'S', label: 'F' },
  ]],
  ['Bath & utility', [
    { kind: 'wc', name: 'WC', w: 1.75, h: 2.33, side: 'S', label: 'WC' },
    { kind: 'basin', name: 'Wash basin', w: 1.75, h: 1.5, side: 'S' },
    { kind: 'shower', name: 'Shower', w: 3.0, h: 3.0, label: 'SHOWER', free: true },
    { kind: 'washer', name: 'Washing m/c', w: 2.0, h: 2.0, side: 'S', label: 'WM' },
    { kind: 'utility_sink', name: 'Utility sink', w: 2.0, h: 1.75, side: 'S', label: 'SINK' },
    { kind: 'wash_area', name: 'Wash area', w: 5.0, h: 3.0, free: true },
  ]],
  ['Living, dining, puja', [
    { kind: 'sofa', name: 'Sofa', w: 7.0, h: 3.0, side: 'S', label: 'SOFA' },
    { kind: 'coffee', name: 'Coffee table', w: 3.5, h: 1.75, free: true },
    { kind: 'tv', name: 'TV unit', w: 5.0, h: 1.25, tall: true, side: 'S', label: 'TV' },
    { kind: 'dining_table', name: 'Dining for 4', w: 4.0, h: 3.0, meta: { seats: 4 }, free: true },
    { kind: 'dining_table', name: 'Dining for 6', w: 5.5, h: 3.0, meta: { seats: 6 }, free: true },
    { kind: 'altar', name: 'Altar', w: 3.0, h: 1.5, side: 'S', label: 'ALTAR' },
    { kind: 'planter', name: 'Planter', w: 1.5, h: 1.5, free: true },
  ]],
];

export const KIND_NAMES = { bed: 'Bed', side_table: 'Side table', wardrobe: 'Wardrobe', study: 'Study table', counter: 'Counter', fridge: 'Fridge', wc: 'WC', basin: 'Wash basin',
  shower: 'Shower', washer: 'Washing machine', utility_sink: 'Utility sink', wash_area: 'Wash area', sofa: 'Sofa', coffee: 'Coffee table', tv: 'TV unit',
  dining_table: 'Dining table', altar: 'Altar', planter: 'Planter', chair: 'Chair' };
export const SIDED = new Set(['bed', 'wardrobe', 'study', 'counter', 'fridge', 'wc', 'basin', 'washer', 'utility_sink', 'sofa', 'tv', 'altar']);
/** Room types the planner furnishes by itself (others keep only hand-placed items). */
export const AUTO_TYPES = new Set(['bath', 'puja', 'kitchen', 'master', 'bedroom', 'dining', 'hall', 'court']);

/** Nearest wall face of the net rect to (x, y): 'S'|'N'|'W'|'E' and the distance. */
export function nearestSide(n, x, y) {
  const d = { S: Math.abs(y - n.y0), N: Math.abs(n.y1 - y), W: Math.abs(x - n.x0), E: Math.abs(n.x1 - x) };
  const side = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
  return [side, d[side]];
}

/**
 * Item from a palette entry, placed at (x, y) in a room with clear rect n: wall items back onto the nearest wall
 * (turned to face the room), free items are centred on the pointer. Snapped to `snap` ft, kept inside the room.
 */
export function placeProto(proto, n, x, y, snap) {
  const sn = (v) => (snap ? Math.round(v / snap) * snap : v);
  let side = '', w = proto.w, d = proto.h;
  if (!proto.free) side = nearestSide(n, x, y)[0];
  const alongX = side === 'S' || side === 'N' || side === '';
  let W = alongX ? w : d, H = alongX ? d : w;
  W = Math.min(W, rw(n)); H = Math.min(H, rh(n));
  let x0 = sn(x - W / 2), y0 = sn(y - H / 2);
  x0 = Math.min(Math.max(x0, n.x0), n.x1 - W); y0 = Math.min(Math.max(y0, n.y0), n.y1 - H);
  if (side === 'S') y0 = n.y0; if (side === 'N') y0 = n.y1 - H; if (side === 'W') x0 = n.x0; if (side === 'E') x0 = n.x1 - W;
  const meta = { ...(proto.meta || {}) };
  if (proto.kind === 'bed') meta.head = side || 'S';
  return { kind: proto.kind, rect: { x0, y0, x1: x0 + W, y1: y0 + H }, label: proto.label || '', tall: !!proto.tall, side, meta };
}

/** Snap an item rect flush to the room's wall faces when within `tol` ft. */
export function snapToWalls(r, n, tol) {
  const W = rw(r), H = rh(r);
  let { x0, y0 } = r;
  if (Math.abs(x0 - n.x0) < tol) x0 = n.x0; else if (Math.abs(x0 + W - n.x1) < tol) x0 = n.x1 - W;
  if (Math.abs(y0 - n.y0) < tol) y0 = n.y0; else if (Math.abs(y0 + H - n.y1) < tol) y0 = n.y1 - H;
  x0 = Math.min(Math.max(x0, n.x0), n.x1 - W); y0 = Math.min(Math.max(y0, n.y0), n.y1 - H);
  return { x0, y0, x1: x0 + W, y1: y0 + H };
}
