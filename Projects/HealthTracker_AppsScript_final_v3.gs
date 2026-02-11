/**
 * Health Tracker Apps Script (Standalone) — HealthDB
 * Actions (JSONP via GET + optional POST):
 * - action=append  (params: row=<json>, source=<str>)
 * - action=latest  (params: dateKey=YYYY-MM-DD)
 * - action=range   (params: start=YYYY-MM-DD, end=YYYY-MM-DD)
 * - action=estimate (params: dish=<text>)
 * - action=analyze  (params: rows=<json>, window=<label>)
 *
 * Auth: id_token required, verified via Google's tokeninfo endpoint and locked to ALLOWED_EMAIL.
 */

const SHEET_ID = "1ozE4VIbBEoW2DlLFtyah88133PT2pZVBmHOmI63HkbI";
const SHEET_NAME = "HealthDB";
const ALLOWED_EMAIL = "navjitdebnath5@gmail.com";
const TZ = "Asia/Kolkata";

const REQUIRED_HEADERS = [
  "Date (timestamp)",
  "Calories Consumed (kcal)",
  "Calories Burnt (kcal)",
  "Net Calories (kcal)",
  "Water Intake (mL)",
  "Sleep (hrs)",
  "Steps",
  "Protein (g)",
  "Fats (g)",
  "Carbs (g)",
  "Fiber (g)",
  "Calcium (mg)",
  "Iron (mg)",
  "Potassium (mg)",
  "Sodium (mg)",
  "Magnesium (mg)",
  "Zinc (mg)",
  "Vitamin A (mg)",
  "Vitamin C (mg)",
  "Vitamin D (mg)",
  "Vitamin B12 (mg)",
  "Weight (kg)",
  "BMI",
  "Skincare Done",
  "Haircare Done"
];

function doGet(e){
  const p = (e && e.parameter) ? e.parameter : {};
  const prefix = p.prefix || null;
  try{
    const email = requireAuth_(p);
    const action = (p.action || "ping").toLowerCase();

    let out = null;
    if(action === "ping"){
      out = {ok:true, email, tz:TZ, sheet:SHEET_NAME};
    }else if(action === "append"){
      const row = parseJson_(p.row || "{}");
      const res = appendRow_(row, {source:p.source || "manual", email});
      out = {ok:true, appended:true, ...res};
    }else if(action === "latest"){
      const dateKey = String(p.dateKey || "").trim();
      if(!dateKey) throw new Error("Missing dateKey");
      const row = getLatestRowForDate_(dateKey);
      out = {ok:true, row};
    }else if(action === "range"){
      const start = String(p.start||"").trim();
      const end = String(p.end||"").trim();
      if(!start || !end) throw new Error("Missing start/end");
      const rows = getLatestRowsInRange_(start, end);
      out = {ok:true, rows};
    }else if(action === "estimate"){
      const dish = String(p.dish || "").trim();
      if(!dish) throw new Error("Missing dish");
      const nutrients = estimateNutrients_(dish);
      out = {ok:true, nutrients};
    }else if(action === "analyze"){
      const rows = parseJson_(p.rows || "[]");
      const windowLabel = String(p.window || "").slice(0,64);
      const analysis = analyzeScores_(rows, windowLabel);
      out = {ok:true, analysis};
    }else{
      throw new Error("Unknown action: " + action);
    }

    return output_(out, prefix);
  }catch(err){
    return output_({ok:false, error:String(err && err.message ? err.message : err)}, prefix);
  }
}

function doPost(e){
  try{
    const p = parseBody_(e);
    const prefix = null; // POST not JSONP
    const email = requireAuth_(p);
    const action = (p.action || "").toLowerCase();
    if(action !== "append") throw new Error("POST supports only action=append");
    const row = parseJson_(p.row || "{}");
    const res = appendRow_(row, {source:p.source || "beacon", email});
    return output_({ok:true, appended:true, ...res}, prefix);
  }catch(err){
    return output_({ok:false, error:String(err && err.message ? err.message : err)}, null);
  }
}

// ───────────────────────────────────────────────────────────────
// Auth
function requireAuth_(p){
  const token = String((p && p.id_token) || "").trim();
  if(!token) throw new Error("Missing id_token");
  const info = verifyIdToken_(token);
  const email = String(info.email || "").toLowerCase();
  if(!email) throw new Error("Token missing email");
  if(email !== ALLOWED_EMAIL) throw new Error("Unauthorized: " + email);
  return email;
}

function verifyIdToken_(idToken){
  // Validate + decode via tokeninfo.
  // https://oauth2.googleapis.com/tokeninfo?id_token=...
  const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken);
  const res = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
  if(res.getResponseCode() !== 200){
    throw new Error("Invalid Google session");
  }
  const obj = JSON.parse(res.getContentText() || "{}");
  // Basic sanity checks
  if(obj.error_description) throw new Error(obj.error_description);
  if(obj.email_verified === "false") throw new Error("Email not verified");
  return obj;
}

// ───────────────────────────────────────────────────────────────
// Sheet helpers
function getSheet_(){
  if(!SHEET_ID) throw new Error("Missing SHEET_ID");
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sh = ss.getSheetByName(SHEET_NAME);
  if(!sh) throw new Error("Sheet not found: " + SHEET_NAME);
  return sh;
}

function ensureHeaders_(sh){
  const lastCol = sh.getLastColumn();
  const existing = (lastCol>0)
    ? sh.getRange(1,1,1,lastCol).getValues()[0].map(String)
    : [];
  const present = new Set(existing.filter(Boolean));

  const missing = REQUIRED_HEADERS.filter(h => !present.has(h));
  if(missing.length === 0) return;

  const newHeaders = existing.concat(missing);
  sh.getRange(1,1,1,newHeaders.length).setValues([newHeaders]);
}

function getHeaders_(sh){
  ensureHeaders_(sh);
  const lastCol = sh.getLastColumn();
  if(lastCol < 1) throw new Error("Sheet has no columns");
  return sh.getRange(1,1,1,lastCol).getValues()[0].map(String);
}

function appendRow_(rowObj, meta){
  const sh = getSheet_();
  const headers = getHeaders_(sh);
  const values = new Array(headers.length).fill(0);

  for(let i=0;i<headers.length;i++){
    const h = headers[i];
    let v = rowObj[h];
    if(v === undefined || v === null || v === "") v = 0;
    values[i] = v;
  }

  sh.appendRow(values);
  return {rowNumber: sh.getLastRow(), source: meta && meta.source ? meta.source : ""};
}

function dateKeyFromTs_(ts){
  const d = new Date(ts);
  if(String(d) === "Invalid Date") return "";
  return Utilities.formatDate(d, TZ, "yyyy-MM-dd");
}

function getLatestRowForDate_(dateKey){
  const sh = getSheet_();
  const headers = getHeaders_(sh);
  const lastRow = sh.getLastRow();
  if(lastRow < 2) return null;

  const dateCol = headers.indexOf("Date (timestamp)");
  if(dateCol === -1) throw new Error('Missing header: "Date (timestamp)"');

  // scan from bottom for the first matching dateKey (fast for newest)
  for(let r=lastRow; r>=2; r--){
    const ts = sh.getRange(r, dateCol+1).getValue();
    const dk = dateKeyFromTs_(ts);
    if(dk !== dateKey) continue;

    const rowVals = sh.getRange(r,1,1,headers.length).getValues()[0];
    const obj = {_rowNumber:r, _dateKey:dk};
    headers.forEach((h,i)=>obj[h] = rowVals[i]);
    return obj;
  }
  return null;
}

function getLatestRowsInRange_(startKey, endKey){
  const sh = getSheet_();
  const headers = getHeaders_(sh);
  const lastRow = sh.getLastRow();
  if(lastRow < 2) return [];

  const dateCol = headers.indexOf("Date (timestamp)");
  if(dateCol === -1) throw new Error('Missing header: "Date (timestamp)"');

  const values = sh.getRange(2,1,lastRow-1,headers.length).getValues();
  const best = {}; // dateKey -> {tsMs,rowObj}

  for(let i=0;i<values.length;i++){
    const row = values[i];
    const ts = row[dateCol];
    const dk = dateKeyFromTs_(ts);
    if(!dk) continue;
    if(dk < startKey || dk > endKey) continue;

    const ms = new Date(ts).getTime();
    if(!best[dk] || ms > best[dk].tsMs){
      const obj = {_rowNumber:i+2, _dateKey:dk};
      headers.forEach((h,ix)=>obj[h] = row[ix]);
      best[dk] = {tsMs:ms, obj};
    }
  }

  return Object.keys(best).sort().map(k=>best[k].obj);
}

// ───────────────────────────────────────────────────────────────
// Groq (OpenAI-compatible) helpers
function getGroqKey_(){
  const key = PropertiesService.getScriptProperties().getProperty("GROQ_API_KEY");
  if(!key) throw new Error("Missing GROQ_API_KEY in script properties");
  return key;
}

function groqChatJson_(messages){
  const key = getGroqKey_();
  const url = "https://api.groq.com/openai/v1/chat/completions";
  const payload = {
    model: "llama-3.3-70b-versatile",
    temperature: 0.2,
    response_format: {type:"json_object"},
    messages: messages
  };

  const res = UrlFetchApp.fetch(url, {
    method:"post",
    contentType:"application/json",
    headers:{Authorization:"Bearer " + key},
    payload: JSON.stringify(payload),
    muteHttpExceptions:true
  });

  if(res.getResponseCode() !== 200){
    throw new Error("Groq API error");
  }

  const data = JSON.parse(res.getContentText() || "{}");
  const txt = (((data.choices||[])[0]||{}).message||{}).content || "";
  return parseJson_(txt);
}

function estimateNutrients_(dishText){
  const sys = `You are a nutrition assistant.
Return ONLY JSON (no prose). Use these exact keys:
calories_kcal, protein_g, carbs_g, fat_g, fiber_g (numbers),
and micros (object) with these keys + units:
calcium_mg, iron_mg, potassium_mg, sodium_mg, magnesium_mg, zinc_mg,
vitamin_a_ug, vitamin_c_mg, vitamin_d_ug, vitamin_b12_ug.
Assume a typical single serving if portion isn't specified.`;

  const user = `Estimate macros + micronutrients for: ${dishText}`;
  const out = groqChatJson_([
    {role:"system", content: sys},
    {role:"user", content: user}
  ]);

  // Normalize (defensive)
  const n = {
    calories_kcal: toNum_(out.calories_kcal),
    protein_g: toNum_(out.protein_g),
    carbs_g: toNum_(out.carbs_g),
    fat_g: toNum_(out.fat_g),
    fiber_g: toNum_(out.fiber_g),
    micros: {}
  };
  const m = out.micros || {};
  const keys = ["calcium_mg","iron_mg","potassium_mg","sodium_mg","magnesium_mg","zinc_mg","vitamin_a_ug","vitamin_c_mg","vitamin_d_ug","vitamin_b12_ug"];
  keys.forEach(k=> n.micros[k] = toNum_(m[k]));
  return n;
}

function analyzeScores_(rows, windowLabel){
  const sys = `You are a fitness + nutrition analyst.
Return ONLY JSON with:
macro_balance_score (1-5 integer), macro_balance_reason (short string),
micronutrient_coverage_score (1-5 integer), micronutrient_coverage_reason (short string).
Use the provided daily log rows (Google Sheet columns) as raw data.`;

  const user = `Window: ${windowLabel || "unspecified"}.
Rows (latest-per-day): ${JSON.stringify(rows || []).slice(0, 35000)}`;

  const out = groqChatJson_([
    {role:"system", content: sys},
    {role:"user", content: user}
  ]);

  return {
    macro_balance_score: clampInt_(out.macro_balance_score, 1, 5),
    macro_balance_reason: String(out.macro_balance_reason || "").slice(0, 400),
    micronutrient_coverage_score: clampInt_(out.micronutrient_coverage_score, 1, 5),
    micronutrient_coverage_reason: String(out.micronutrient_coverage_reason || "").slice(0, 400)
  };
}

// ───────────────────────────────────────────────────────────────
// Utils
function parseBody_(e){
  const p = (e && e.parameter) ? e.parameter : {};
  if(p && Object.keys(p).length) return p;

  const raw = (e && e.postData && e.postData.contents) ? e.postData.contents : "";
  if(!raw) return {};
  // If JSON
  if((e.postData.type || "").indexOf("application/json") === 0){
    return parseJson_(raw);
  }
  // Form encoded
  const out = {};
  raw.split("&").forEach(kv=>{
    const [k,v] = kv.split("=");
    if(!k) return;
    out[decodeURIComponent(k)] = decodeURIComponent(v || "");
  });
  return out;
}

function parseJson_(txt){
  try{
    return JSON.parse(txt);
  }catch(_){
    const m = String(txt||"").match(/\{[\s\S]*\}/);
    if(m) return JSON.parse(m[0]);
    throw new Error("Invalid JSON from model");
  }
}

function toNum_(v){
  const n = +v;
  return (isFinite(n) && n>=0) ? n : 0;
}

function clampInt_(v, lo, hi){
  const n = Math.round(+v);
  if(!isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

function output_(obj, prefix){
  const json = JSON.stringify(obj);
  if(prefix){
    return ContentService
      .createTextOutput(prefix + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
