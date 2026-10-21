// Helvetica / Helvetica-Bold advance widths (Adobe AFM, 1/1000 em) for WinAnsi codes 32-126, plus a few extras.
// Used to lay out text identically in the SVG preview and the PDF (base-14 fonts need no embedding).
const H = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HB = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611,
  389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
// WinAnsi extras: code -> [regular, bold]
const EXTRA = { 0x96: [556, 556], 0x97: [1000, 1000], 0xB0: [400, 400], 0xB2: [333, 333], 0xBD: [834, 834], 0xD7: [584, 584], 0x92: [222, 278],
  0x91: [222, 278], 0x93: [333, 500], 0x94: [333, 500], 0x95: [350, 350], 0x85: [1000, 1000], 0xB7: [278, 278], 0xB1: [584, 584] };
export const UNI_TO_WINANSI = { '\u2013': 0x96, '\u2014': 0x97, '\u00b0': 0xB0, '\u00b2': 0xB2, '\u00bd': 0xBD, '\u00d7': 0xD7, '\u2019': 0x92,
  '\u2018': 0x91, '\u201c': 0x93, '\u201d': 0x94, '\u2022': 0x95, '\u2026': 0x85, '\u00b7': 0xB7, '\u00b1': 0xB1 };
export const ASCENT = 0.718, DESCENT = 0.207;      // Helvetica cap-height-ish ascender / descender (em)

export function winAnsiCode(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return c;
  return UNI_TO_WINANSI[ch] || 63;   // '?'
}

/** Width of `s` in em units (multiply by font size). */
export function textWidthEm(s, bold = false) {
  const T = bold ? HB : H; let w = 0;
  for (const ch of s) {
    const c = winAnsiCode(ch);
    w += (c >= 32 && c <= 126) ? T[c - 32] : (EXTRA[c] ? EXTRA[c][bold ? 1 : 0] : 556);
  }
  return w / 1000;
}
