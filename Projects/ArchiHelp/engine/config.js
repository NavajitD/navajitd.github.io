// Vaastu Planner design engine — configuration defaults and rule tables.
// Every default mirrors parametric_vaastu_floorplan_v3.ipynb (incl. the hand-sketch revisions that added
// 'lobby' and 'suite' spaces), so a project created with defaults reproduces the notebook's behaviour.

export const DEFAULT_CONFIG = Object.freeze({
  // ---- project ----
  project_name: 'New house',
  location: '',
  seismic_zone: 'V',
  road_side: 'E',                 // side facing the road
  ew_ft: 63.0,                    // built-up extent East-West (outer face to outer face)
  ns_ft: 24.0,                    // built-up extent North-South
  // ---- levels ----
  floor_level: 1,
  ground_floor_height_ft: 10.0,
  typical_floor_height_ft: 11.0,
  floors_above: 2,
  // ---- programme ----
  program: { bedroom: 3, bath: 2, veranda: 0, kitchen: 1, stair: 1, hall: 1, dining: 1, puja: 1 },
  min_courtyards: 0,
  max_courtyards: 0,
  // ---- construction ----
  t_ext: 0.5833,                  // 7" external wall
  t_int: 0.5833,                  // 7" internal wall
  // ---- structure ----
  max_bay_ft: 12.5,
  ew_bays: null,
  ns_bays: 1,
  avoid_core_columns: true,
  require_columns_in_walls: true,
  col_wall_tol_ft: 0.45,
  col_long_axis: 'y',
  min_column_mm: [230, 380],
  floor_load_kn_m2: 12.0,
  roof_load_kn_m2: 10.0,
  fck: 25.0,
  fy: 500.0,
  // ---- staircase ----
  stair_width_ft: 4.0,
  max_riser_in: 6.0,
  tread_in: 10.0,
  // ---- Vaastu (32 padas) ----
  sector_mapping: 'angular',      // true compass angles from the building centre
  sector_min_frac: 0.70,          // HARD: share of a room's floor in its allowed padas
  sector_pref_floor: 0.5,         // weight of the LAST listed pada (first = 1.0)
  plan_north_bearing_deg: 0.0,    // compass bearing of the plan's +y axis
  sector_centre: null,            // [x, y] ft; null = centre of the envelope
  brahmasthan_rule: true,
  // ---- rule tables (null = defaults below) ----
  room_specs: null,
  sector_rules: null,
  brahmasthan_max_overlap: null,
  furn: null,
  clear: null,
});

// Room size limits — net floor inside walls (sq ft, ft). Minimums: NBC 2016 (residential).
export const ROOM_SPECS = Object.freeze({
  master:  { label: 'Master Bedroom',   amin: 102.3, amax: 220, wmin: 6.9, asp: 2.2 },
  bedroom: { label: 'Bedroom',          amin: 80.7,  amax: 170, wmin: 6.9, asp: 2.2 },
  bath:    { label: 'Bath',             amin: 30.1,  amax: 60,  wmin: 3.9, asp: 2.6 },
  kitchen: { label: 'Kitchen',          amin: 53.8,  amax: 130, wmin: 5.9, asp: 2.5 },
  puja:    { label: 'Puja Room',        amin: 20,    amax: 60,  wmin: 4.0, asp: 2.0 },
  hall:    { label: 'Hall',             amin: 120,   amax: 360, wmin: 8.0, asp: 3.0 },
  dining:  { label: 'Dining',           amin: 70,    amax: 200, wmin: 7.0, asp: 2.5 },
  veranda: { label: 'Veranda',          amin: 30,    amax: 150, wmin: 4.0, asp: 8.0 },
  passage: { label: 'Passage',          amin: 10,    amax: 400, wmin: 3.5, asp: 99, wmax: 4.5 },
  lobby:   { label: 'Lobby',            amin: 10,    amax: 80,  wmin: 3.0, asp: 4.0 },
  suite:   { label: 'Dressing / entry', amin: 0,     amax: 80,  wmin: 3.0, asp: 9.0 },
  court:   { label: 'Courtyard',        amin: 40,    amax: 160, wmin: 6.0, asp: 3.0 },
  stair:   { label: 'Staircase' },
});

export const ROOM_TYPES = ['master', 'bedroom', 'bath', 'kitchen', 'puja', 'hall', 'dining', 'stair', 'passage', 'lobby', 'suite', 'veranda', 'court'];
export const CIRC = new Set(['passage', 'hall', 'dining', 'lobby']);   // circulation: rooms open onto these
export const BEDS = new Set(['master', 'bedroom']);
export const OPEN = new Set(['court']);

// 32 padas of 11.25 deg, numbered as in the circle diagram: N1..N8 (NW->NE), E1..E8, S1..S8, W1..W8
export const PADAS = [].concat(...'NESW'.split('').map((d) => [1, 2, 3, 4, 5, 6, 7, 8].map((i) => d + i)));
export const PADA_SPAN = 360 / 32;

// Allowed padas in order of preference (one entry = one tier; "N1-N8" = one tier).
export const SECTOR_RULES = Object.freeze({
  puja:    { tiers: ['N8', 'E1', 'E2', 'E3', 'N4', 'N3', 'N6', 'N7'], hard: true },
  bath:    { tiers: ['W6', 'W7', 'S6', 'S7', 'E6', 'E7'], hard: true },
  kitchen: { tiers: ['E6', 'E7', 'E8', 'S1', 'S2', 'S3'], hard: true },
  stair:   { tiers: ['S2', 'S3', 'S4', 'S5', 'S6', 'S7'], hard: true },
  bedroom: { tiers: ['S8', 'W1', 'W2', 'W8', 'N1', 'N2', 'N3', 'N4', 'N5'], hard: false },
  master:  { tiers: ['S8', 'W1', 'W2', 'W8', 'N1', 'N2', 'N3', 'N4', 'N5'], hard: false },
  hall: null, dining: null, passage: null, court: null, veranda: null, lobby: null, suite: null,
});

// Brahmasthan (centre third of the envelope, both ways): max sq ft of a room's floor allowed inside it.
export const BRAHMASTHAN_MAX_OVERLAP = Object.freeze({ bath: 18, kitchen: 18, stair: 18, master: 45, bedroom: 45, puja: 10 });

// Furniture sizes (ft) and clearances.
export const FURN = Object.freeze({
  queen: [5.0, 6.5], double: [4.5, 6.25], single: [3.0, 6.25], side_table: [1.5, 1.5], wardrobe_depth: 2.0,
  wardrobe_lengths: [6.0, 5.0, 4.0, 3.5, 3.0], study: [3.5, 2.0], bath_shower: 3.0, bath_wc: [1.75, 2.33], bath_basin: [1.75, 1.5],
  counter_depth: 2.0, fridge: [2.25, 2.25], altar_depth: 1.5, sofa: [[7.0, 3.0], [6.0, 2.75], [4.5, 2.75]], coffee: [3.5, 1.75],
  tv_unit: [5.0, 1.25], dining: [[5.5, 3.0, 6], [4.0, 3.0, 4], [3.0, 3.0, 4], [2.5, 2.5, 2]], chair: 1.5, planter: 1.5,
  washer: [2.0, 2.0], utility_sink: [2.0, 1.75],
});
export const CLEAR = Object.freeze({ bed_side: 2.0, bed_foot: 2.0, wardrobe_front: 2.5, aisle: 3.0, opening: 2.5, door_access: 2.5, wc_front: 1.5 });
export const BED_HEAD_PREF = Object.freeze({ S: 3.0, E: 2.0, W: 2.0, N: 0.0 });   // Vaastu: head towards south; east/west next; north last
export const SIDES = ['S', 'N', 'W', 'E'];

export const DOOR_TYPES = Object.freeze({
  D1: ['Entrance / balcony door', `3'-6" x 7'-0"`, 'flush / panel, teak frame'],
  D2: ['Room door', `3'-0" x 7'-0"`, 'flush door'],
  D3: ['Bath / puja door', `2'-6" x 7'-0"`, 'PVC / FRP (bath), wood (puja)'],
  OP: ['Opening (no shutter)', 'as shown x 7\'-0"', 'plastered reveal'],
});
export const BASE_WIN_TYPES = Object.freeze({
  W4: ['Window (high sill, above cooking platform)', `6'-0" x 3'-0"`, `sill 4'-0"`],
  W5: ['Window', `10'-0" x 4'-0"`, `sill 3'-0"`],
  W1: ['Window', `4'-0" x 4'-0"`, `sill 3'-0"`],
  W2: ['Window', `3'-0" x 4'-0"`, `sill 3'-0"`],
  W3: ['Window', `2'-0" x 3'-0"`, `sill 3'-6"`],
  V1: ['Ventilator', `2'-0" x 1'-6"`, `sill 6'-0"`],
});
// default window per room type: [tag, width]
export const DEFAULT_WIN = Object.freeze({ bath: ['V1', 2.0], puja: ['W3', 2.0], stair: ['W2', 3.0], kitchen: ['W2', 3.0] });

export const REQUIRED_FURNITURE = Object.freeze({
  master: ['bed', 'wardrobe'], bedroom: ['bed', 'wardrobe'], bath: ['wc', 'basin', 'shower'], kitchen: ['counter', 'fridge'],
  puja: ['altar'], dining: ['dining_table'], hall: ['sofa'],
});

export const ROOM_COLORS = Object.freeze({
  master: '#bcd7f0', bedroom: '#d3e4f6', bath: '#c9ece6', kitchen: '#fbe3b5', hall: '#f8f2cf', dining: '#f4d9d0',
  stair: '#e4e4e4', veranda: '#d5ecc2', passage: '#f3f3f3', puja: '#f5c2e7', court: '#dff0d0', lobby: '#ececec', suite: '#cfe0f3',
});

/** Full config (defaults + overrides) with resolved rule tables. */
export function resolveConfig(cfg = {}) {
  const c = { ...DEFAULT_CONFIG, ...cfg };
  c.program = { ...DEFAULT_CONFIG.program, ...(cfg.program || {}) };
  c.room_specs = mergeTable(ROOM_SPECS, cfg.room_specs);
  c.sector_rules = cfg.sector_rules ? { ...SECTOR_RULES, ...cfg.sector_rules } : { ...SECTOR_RULES };
  if (cfg.sector_rules && cfg.sector_rules.bedroom !== undefined && cfg.sector_rules.master === undefined) c.sector_rules.master = cfg.sector_rules.bedroom;
  c.brahmasthan_max_overlap = { ...BRAHMASTHAN_MAX_OVERLAP, ...(cfg.brahmasthan_max_overlap || {}) };
  c.furn = { ...FURN, ...(cfg.furn || {}) };
  c.clear = { ...CLEAR, ...(cfg.clear || {}) };
  return c;
}

function mergeTable(base, over) {
  const out = {};
  for (const k of Object.keys(base)) out[k] = { ...base[k] };
  if (over) for (const k of Object.keys(over)) out[k] = { ...(out[k] || {}), ...over[k] };
  return out;
}

export const roomLabel = (cfg, t) => ((cfg.room_specs || ROOM_SPECS)[t] || {}).label || t;
