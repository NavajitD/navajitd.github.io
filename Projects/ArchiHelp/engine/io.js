// ArchiHelp design engine — import/export helpers.
// The notebook (parametric_vaastu_floorplan_v3.ipynb) names rooms in link specs, window hints and overrides;
// the engine document uses stable uids so rooms can be renamed in the editor.

/** Notebook plan dump (rooms, link_spec, window_hints, tall_keepout, bed_head, wardrobe_side, extra_notes, road_door) -> doc. */
export function docFromNotebook(g) {
  const byName = new Map(g.rooms.map((r) => [r.name, r.uid]));
  const R = (a) => ({ x0: a[0], y0: a[1], x1: a[2], y1: a[3] });
  const doc = {
    id: g.id, source: g.source || '', label: g.source || '',
    rooms: g.rooms.map((r) => ({ uid: r.uid, rtype: r.rtype, name: r.name, tile: R(r.tile), group: r.group ? byName.get(r.group) ?? null : null })),
    links: g.link_spec ? g.link_spec.map((s) => ({ a: byName.get(s[0]), b: byName.get(s[1]), kind: s[2], into: byName.get(s[3]), ...(s[4] ? { hint: { ...s[4] } } : {}) })) : null,
    roadDoor: g.road_door !== undefined ? g.road_door : true,
    windows: [], keepouts: [], furniture: {}, notes: g.extra_notes || [],
  };
  for (const [nm, hs] of Object.entries(g.window_hints || {})) for (const h of hs) {
    const room = byName.get(nm);
    if (!h[1]) doc.windows.push({ room, side: h[0], none: true });
    else doc.windows.push({ room, side: h[0], w: h[1], tag: h[2], c: h.length > 3 ? h[3] : null });
  }
  for (const [nm, rs] of Object.entries(g.tall_keepout || {})) for (const r of rs) doc.keepouts.push({ room: byName.get(nm), rect: R(r) });
  const fs = (nm) => doc.furniture[byName.get(nm)] || (doc.furniture[byName.get(nm)] = {});
  for (const [nm, s] of Object.entries(g.bed_head || {})) fs(nm).bedHead = s;
  for (const [nm, s] of Object.entries(g.wardrobe_side || {})) fs(nm).wardrobeSide = s;
  if (g.win_types) doc.meta = { winTypes: g.win_types };
  return doc;
}

/** Runtime furniture item -> plain JSON item (for manual layouts / saving). */
export const itemToJSON = (i) => ({ kind: i.kind, rect: { ...i.rect }, label: i.label || '', tall: !!i.tall, side: i.side || '', meta: { ...(i.meta || {}) } });

/** Deep clone of a JSON document (structuredClone where available). */
export const cloneDoc = (d) => (typeof structuredClone === 'function' ? structuredClone(d) : JSON.parse(JSON.stringify(d)));
