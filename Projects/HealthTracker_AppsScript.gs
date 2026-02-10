/**
 * HealthTracker+ Cloud Sync (Google Apps Script)
 *
 * Endpoints (Web App):
 *  GET  ?action=fetch&days=120&secret=...&prefix=CALLBACK
 *  GET  ?action=estimate&dish=...&secret=...&prefix=CALLBACK
 *  POST action=upsert&secret=...&payload=URLENCODED_JSON
 *
 * Script Properties required:
 *  - SHEET_ID         (Google Sheet ID)
 *  - SHEET_NAME       (optional; default: "health")
 *  - SECRET_KEY       (shared secret; must match what you enter in health.html)
 *  - GROQ_API_KEY     (Groq API key)
 */

const DEFAULT_SHEET_NAME = "health";

// Columns in the sheet
const HEADERS = [
  "date",
  "updated_at",
  "calories_in_kcal",
  "calories_burned_kcal",
  "net_calories_kcal",
  "protein_g",
  "carbs_g",
  "fat_g",
  "fiber_g",
  "water_ml",
  "weight_kg",
  "bmi",
  "micros_json",
  "foods_json",
  "day_json"
];

function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const action = (p.action || "status").toLowerCase();

  try {
    if (!isAuthorized_(p)) {
      return jsonp_(p, { ok: false, error: "unauthorized" });
    }

    if (action === "fetch") {
      const days = Math.max(1, Math.min(3650, parseInt(p.days || "120", 10)));
      const out = fetchDays_(days);
      return jsonp_(p, { ok: true, days: out });
    }

    if (action === "estimate") {
      const dish = (p.dish || "").trim();
      if (!dish) return jsonp_(p, { ok: false, error: "missing dish" });

      const nutrients = estimateWithGroq_(dish);
      return jsonp_(p, { ok: true, nutrients: nutrients });
    }

    // status
    return jsonp_(p, { ok: true, status: "ready", time: new Date().toISOString() });

  } catch (err) {
    return jsonp_(p, { ok: false, error: String(err) });
  }
}

function doPost(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  const action = (p.action || "upsert").toLowerCase();

  try {
    if (!isAuthorized_(p)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "upsert") {
      const payloadStr = (p.payload || "").toString();
      if (!payloadStr) throw new Error("missing payload");

      const payload = JSON.parse(payloadStr);
      upsertDay_(payload);

      return ContentService
        .createTextOutput(JSON.stringify({ ok: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: "unknown action" }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ───────────────────────────────────────────────────────────────
// AUTH / CONFIG
function getProp_(k) {
  return PropertiesService.getScriptProperties().getProperty(k);
}
function isAuthorized_(p) {
  const secret = (p.secret || "").toString();
  const expected = (getProp_("SECRET_KEY") || "").toString();
  return expected && secret && secret === expected;
}

// ───────────────────────────────────────────────────────────────
// SHEET HELPERS
function getSheet_() {
  const sheetId = getProp_("SHEET_ID");
  if (!sheetId) throw new Error("Missing script property: SHEET_ID");

  const sheetName = getProp_("SHEET_NAME") || DEFAULT_SHEET_NAME;
  const ss = SpreadsheetApp.openById(sheetId);
  let sh = ss.getSheetByName(sheetName);

  if (!sh) {
    sh = ss.insertSheet(sheetName);
    sh.appendRow(HEADERS);
  } else {
    // Ensure headers exist (simple check)
    const firstRow = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
    if (!firstRow || firstRow[0] !== HEADERS[0]) {
      // Don't overwrite user data; just set headers in row 1
      sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    }
  }
  return sh;
}

function findRowByDate_(sh, dateStr) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const dates = sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0] || ""));
  const idx = dates.indexOf(dateStr);
  return idx === -1 ? -1 : (idx + 2);
}

// ───────────────────────────────────────────────────────────────
// FETCH
function fetchDays_(daysBack) {
  const sh = getSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];

  const values = sh.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (daysBack - 1));
  const cutoffStr = Utilities.formatDate(cutoff, Session.getScriptTimeZone(), "yyyy-MM-dd");

  const out = [];
  values.forEach(row => {
    const date = String(row[0] || "");
    if (!date) return;
    if (date < cutoffStr) return;

    const dayJson = String(row[HEADERS.indexOf("day_json")] || "");
    if (!dayJson) return;

    try {
      out.push({ date: date, dayData: JSON.parse(dayJson) });
    } catch (e) {
      // ignore bad rows
    }
  });
  return out;
}

// ───────────────────────────────────────────────────────────────
// UPSERT
function upsertDay_(payload) {
  const date = String(payload.date || "");
  const dayData = payload.dayData || null;
  if (!date || !dayData) throw new Error("payload must include {date, dayData}");

  // Ensure updatedAt
  if (!dayData.updatedAt) dayData.updatedAt = new Date().toISOString();

  const totals = computeTotals_(dayData);
  const burned = num_(dayData.calBurned, 0);
  const net = totals.calories_in_kcal - burned;

  const weight = (dayData.weight === null || dayData.weight === undefined || dayData.weight === "") ? "" : num_(dayData.weight, "");
  const bmi = (dayData.bmi === null || dayData.bmi === undefined || dayData.bmi === "") ? "" : num_(dayData.bmi, "");

  const microsJson = JSON.stringify(totals.micros || {});
  const foodsJson = JSON.stringify(dayData.foods || []);
  const dayJson = JSON.stringify(dayData);

  const rowValues = [
    date,
    String(dayData.updatedAt || ""),
    totals.calories_in_kcal,
    burned,
    net,
    totals.protein_g,
    totals.carbs_g,
    totals.fat_g,
    totals.fiber_g,
    num_(dayData.water, 0),
    weight,
    bmi,
    microsJson,
    foodsJson,
    dayJson
  ];

  const sh = getSheet_();
  const row = findRowByDate_(sh, date);
  if (row === -1) {
    sh.appendRow(rowValues);
  } else {
    sh.getRange(row, 1, 1, HEADERS.length).setValues([rowValues]);
  }
}

// ───────────────────────────────────────────────────────────────
// NUTRIENT TOTALS
function computeTotals_(dayData) {
  const foods = Array.isArray(dayData.foods) ? dayData.foods : [];
  const t = {
    calories_in_kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    micros: {}
  };

  foods.forEach(f => {
    t.calories_in_kcal += num_(f.cal, 0);
    t.protein_g += num_(f.protein, 0);
    t.carbs_g += num_(f.carbs, 0);
    t.fat_g += num_(f.fat, 0);
    t.fiber_g += num_(f.fiber, 0);

    if (f.micros && typeof f.micros === "object") {
      Object.keys(f.micros).forEach(k => {
        const v = num_(f.micros[k], 0);
        t.micros[k] = (t.micros[k] || 0) + v;
      });
    }
  });

  // round for nicer sheet values
  t.calories_in_kcal = Math.round(t.calories_in_kcal);
  t.protein_g = round_(t.protein_g, 1);
  t.carbs_g = round_(t.carbs_g, 1);
  t.fat_g = round_(t.fat_g, 1);
  t.fiber_g = round_(t.fiber_g, 1);

  return t;
}

function num_(x, fallback) {
  const n = Number(x);
  return isFinite(n) ? n : fallback;
}
function round_(n, decimals) {
  const p = Math.pow(10, decimals);
  return Math.round(n * p) / p;
}

// ───────────────────────────────────────────────────────────────
// GROQ
function estimateWithGroq_(dish) {
  const apiKey = getProp_("GROQ_API_KEY");
  if (!apiKey) throw new Error("Missing script property: GROQ_API_KEY");

  const url = "https://api.groq.com/openai/v1/chat/completions";

  const system = [
    "You are a nutrition estimation engine.",
    "Return ONLY a valid JSON object (no markdown).",
    "Estimate macros & micronutrients for ONE typical serving as eaten by an adult in India, unless the dish specifies a portion.",
    "Be conservative/realistic. If unknown, make a reasonable assumption."
  ].join(" ");

  // Keys + units must match what health.html expects
  const schemaHint = {
    calories_kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    micros: {
      vitamin_a_ug: 0,
      vitamin_c_mg: 0,
      vitamin_d_ug: 0,
      vitamin_e_mg: 0,
      vitamin_k_ug: 0,
      thiamin_mg: 0,
      riboflavin_mg: 0,
      niacin_mg: 0,
      pantothenic_mg: 0,
      vitamin_b6_mg: 0,
      biotin_ug: 0,
      folate_ug: 0,
      vitamin_b12_ug: 0,
      calcium_mg: 0,
      iron_mg: 0,
      magnesium_mg: 0,
      potassium_mg: 0,
      sodium_mg: 0,
      zinc_mg: 0,
      selenium_ug: 0,
      copper_mg: 0,
      manganese_mg: 0,
      phosphorus_mg: 0,
      iodine_ug: 0,
      choline_mg: 0
    }
  };

  const user = [
    "Estimate nutrition for this dish/portion:",
    dish,
    "",
    "Return JSON with EXACT keys/units like this example schema:",
    JSON.stringify(schemaHint)
  ].join("\n");

  const payload = {
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.2,
    max_tokens: 800,
    response_format: { type: "json_object" }
  };

  const resp = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = resp.getResponseCode();
  const raw = resp.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("Groq API error: " + code + " " + raw);
  }

  const parsed = JSON.parse(raw);
  const content = parsed &&
    parsed.choices &&
    parsed.choices[0] &&
    parsed.choices[0].message &&
    parsed.choices[0].message.content;

  if (!content) throw new Error("Groq response missing content");

  let nutrients = JSON.parse(content);
  nutrients = normalizeNutrients_(nutrients);
  return nutrients;
}

function normalizeNutrients_(n) {
  if (!n || typeof n !== "object") n = {};
  const out = {
    calories_kcal: num_(n.calories_kcal, 0),
    protein_g: num_(n.protein_g, 0),
    carbs_g: num_(n.carbs_g, 0),
    fat_g: num_(n.fat_g, 0),
    fiber_g: num_(n.fiber_g, 0),
    micros: {}
  };
  const micros = (n.micros && typeof n.micros === "object") ? n.micros : {};
  Object.keys(micros).forEach(k => out.micros[k] = num_(micros[k], 0));
  return out;
}

// ───────────────────────────────────────────────────────────────
// JSONP helper (used for GET endpoints)
function jsonp_(p, obj) {
  const json = JSON.stringify(obj);

  // If "prefix" is present, wrap as JSONP callback
  if (p && p.prefix) {
    return ContentService
      .createTextOutput(p.prefix + "(" + json + ")")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}