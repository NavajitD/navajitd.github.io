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
  "Haircare Done",
  "Payload JSON",
  "Rev",
  "Device ID",
  "Client Updated At",
  "Server Updated At",
  "Source"
];

function doGet(e){
  const p = (e && e.parameter) ? e.parameter : {};
  const prefix = p.prefix || null;
  try{
    const action = (p.action || "ping").toLowerCase();

    // Create/refresh a short session key (used by the HTML app for JSONP GET calls)
    if(action === "session"){
      const auth = requireAuthWithIdToken_(p);
      const sess = createSession_(auth.email, auth.info);
      return output_({ok:true, session_key:sess.session_key, ttl_s:sess.ttl_s}, prefix);
    }

    const email = requireAuth_(p);

    let out = null;
    if(action === "ping"){
      out = {ok:true, email, tz:TZ, sheet:SHEET_NAME};

}else if(action === "upsertday"){
  const dateKey = String(p.dateKey || "").trim();
  const payloadStr = String(p.payload || "").trim();
  if(!dateKey) throw new Error("Missing dateKey");
  if(!payloadStr) throw new Error("Missing payload");
  const res = upsertDay_(dateKey, payloadStr, {source:p.source || "manual", email});
  out = {ok:true, upserted:true, ...res};
    }else if(action === "append"){
      const row = parseJson_(p.row || "{}");
      const res = appendRow_(row, {source:p.source || "manual", email});
      out = {ok:true, appended:true, ...res};
    }else if(action === "estimateexercise"){
      const text = String(p.text || "").trim();
      if(!text) throw new Error("Missing text");
      const kcal = estimateExerciseKcal_(text);
      out = {ok:true, kcal};
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
      const dishKey = String(p.dishKey || dish || "").toLowerCase().trim();
      const query = String(p.query || dish || dishKey).trim();
      if(!dishKey) throw new Error("Missing dish/dishKey");
      const nutrients = estimateNutrientsCached_(dishKey, query);
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

    if(action === "append"){
      const row = parseJson_(p.row || "{}");
      const res = appendRow_(row, {source:p.source || "beacon", email});
      return output_({ok:true, appended:true, ...res}, prefix);
    }

    if(action === "upsertday"){
      const dateKey = String(p.dateKey || "").trim();
      const payloadStr = String(p.payload || "").trim();
      if(!dateKey) throw new Error("Missing dateKey");
      if(!payloadStr) throw new Error("Missing payload");
      const res = upsertDay_(dateKey, payloadStr, {source:p.source || "beacon", email});
      return output_({ok:true, upserted:true, ...res}, prefix);
    }

    if(action === "estimateexercise"){
      const text = String(p.text || "").trim();
      if(!text) throw new Error("Missing text");
      const kcal = estimateExerciseKcal_(text);
      return output_({ok:true, kcal}, prefix);
    }

    throw new Error("Unsupported POST action: " + action);
  }catch(err){
    return output_({ok:false, error:String(err && err.message ? err.message : err)}, null);
  }
}

// ───────────────────────────────────────────────────────────────
// Auth
function requireAuth_(p){
  // Accept either:
  // - session_key: short-lived server session (preferred for JSONP GET)
  // - id_token: Google ID token (fallback / for session creation)
  const sessionKey = String((p && p.session_key) || "").trim();
  if(sessionKey){
    const email = requireSession_(sessionKey);
    if(email !== ALLOWED_EMAIL) throw new Error("Unauthorized: " + email);
    return email;
  }
  return requireAuthWithIdToken_(p).email;
}

function requireAuthWithIdToken_(p){
  const token = String((p && p.id_token) || "").trim();
  if(!token) throw new Error("Missing id_token");
  const info = verifyIdToken_(token);
  const email = String(info.email || "").toLowerCase();
  if(!email) throw new Error("Token missing email");
  if(email !== ALLOWED_EMAIL) throw new Error("Unauthorized: " + email);
  return { email, info, id_token: token };
}

function createSession_(email, info){
  const cache = CacheService.getScriptCache();
  const now = Math.floor(Date.now()/1000);
  const exp = parseInt((info && info.exp) ? info.exp : "0", 10) || 0;

  // Session should never outlive the ID token. Keep it short for safety.
  const ttlS = exp ? Math.max(60, Math.min(1800, exp - now - 30)) : 900; // 1 min .. 30 min, default 15 min
  const key = Utilities.getUuid().replace(/-/g, "");
  const payload = { email, exp: exp || (now + ttlS) };

  try{ cache.put("sess:" + key, JSON.stringify(payload), ttlS); }catch(e){}
  return { session_key: key, ttl_s: ttlS };
}

function requireSession_(sessionKey){
  const cache = CacheService.getScriptCache();
  const raw = cache.get("sess:" + sessionKey);
  if(!raw) throw new Error("Session expired");
  let obj = null;
  try{ obj = JSON.parse(raw); }catch(e){}
  const email = String(obj && obj.email ? obj.email : "").toLowerCase();
  if(!email) throw new Error("Session invalid");
  return email;
}

function hashToken_(tok){
  // Short stable cache key for large ID tokens
  if(!tok) return "none";
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, tok, Utilities.Charset.UTF_8);
  return bytes.map(b => {
    const n = (b < 0) ? (b + 256) : b;
    return ("0" + n.toString(16)).slice(-2);
  }).join("").slice(0, 32);
}

function verifyIdToken_(idToken){
  // Validate + decode via tokeninfo.
  // https://oauth2.googleapis.com/tokeninfo?id_token=...
  const cache = CacheService.getScriptCache();
  const key = "idtok:" + hashToken_(idToken);

  const cached = cache.get(key);
  if(cached){
    try{ return JSON.parse(cached); }catch(e){}
  }

  const url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken);
  const res = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
  if(res.getResponseCode() !== 200){
    throw new Error("Invalid Google session");
  }

  const obj = JSON.parse(res.getContentText() || "{}");

  // Basic sanity checks
  if(obj.error_description) throw new Error(obj.error_description);
  if(obj.email_verified === "false") throw new Error("Email not verified");

  // Cache verification result to reduce UrlFetch calls (improves sync reliability)
  const now = Math.floor(Date.now()/1000);
  const exp = parseInt(obj.exp || "0", 10) || 0;
  const ttl = exp ? Math.max(60, Math.min(900, exp - now - 30)) : 300; // 1–15 min, or 5 min fallback
  try{ cache.put(key, JSON.stringify(obj), ttl); }catch(e){}

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
// ───────────────────────────────────────────────────────────────
// USDA FoodData Central (FDC) helpers + cache (FoodDB sheet)
// Set script property: FDC_API_KEY
const FOODDB_SHEET_NAME = "FoodDB";
const FDC_API_PROP = "FDC_API_KEY";

function getFdcKey_(){
  const key = PropertiesService.getScriptProperties().getProperty(FDC_API_PROP);
  if(!key) throw new Error("Missing FDC_API_KEY in script properties");
  return key;
}

function getOrCreateFoodDb_(){
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(FOODDB_SHEET_NAME);
  if(!sh){
    sh = ss.insertSheet(FOODDB_SHEET_NAME);
  }
  const headers = ["Dish Key","Query","FDC ID","Description","Data Type","Nutrients JSON","Updated At"];
  const first = sh.getRange(1,1,1,headers.length).getValues()[0];
  if(first.join("|") !== headers.join("|")){
    sh.clear();
    sh.getRange(1,1,1,headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function findFoodDbRowByKey_(sh, dishKey){
  const last = sh.getLastRow();
  if(last < 2) return null;
  const values = sh.getRange(2,1,last-1,1).getValues(); // keys col
  const needle = String(dishKey||"").toLowerCase().trim();
  for(let i=0;i<values.length;i++){
    if(String(values[i][0]||"").toLowerCase().trim() === needle){
      return i+2; // actual row index
    }
  }
  return null;
}

function getCachedFoodNutrients_(dishKey){
  const sh = getOrCreateFoodDb_();
  const row = findFoodDbRowByKey_(sh, dishKey);
  if(!row) return null;
  const jsonStr = sh.getRange(row,6).getValue();
  if(!jsonStr) return null;
  return parseJson_(jsonStr);
}

function setCachedFoodNutrients_(dishKey, query, fdcMeta, nutrients){
  const sh = getOrCreateFoodDb_();
  const row = findFoodDbRowByKey_(sh, dishKey);
  const now = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
  const payload = [
    String(dishKey||"").toLowerCase().trim(),
    String(query||"").trim(),
    fdcMeta?.fdcId || "",
    fdcMeta?.description || "",
    fdcMeta?.dataType || "",
    JSON.stringify(nutrients || {}),
    now
  ];
  if(row){
    sh.getRange(row,1,1,payload.length).setValues([payload]);
  }else{
    sh.appendRow(payload);
  }
}

// Map USDA nutrient IDs (common) to app keys.
// FDC food details returns nutrient.id + amount + unitName.
const FDC_ID_MAP = {
  // Macros
  1008: "calories_kcal", // Energy (kcal)
  1009: "energy_kj",     // Energy (kJ)
  1003: "protein_g",
  1005: "carbs_g",
  1004: "fat_g",
  1079: "fiber_g",

  // Minerals
  1087: "calcium_mg",
  1089: "iron_mg",
  1090: "magnesium_mg",
  1091: "phosphorus_mg",
  1092: "potassium_mg",
  1093: "sodium_mg",
  1095: "zinc_mg",
  1098: "copper_mg",
  1101: "manganese_mg",
  1103: "selenium_ug",

  // Vitamins
  1162: "vitamin_c_mg",
  1165: "thiamin_mg",
  1166: "riboflavin_mg",
  1167: "niacin_mg",
  1170: "pantothenic_mg",
  1175: "vitamin_b6_mg",
  1177: "folate_ug",
  1178: "vitamin_b12_ug",
  1185: "vitamin_k_ug",
  1106: "vitamin_a_ug", // Vitamin A, RAE (µg)
  1114: "vitamin_d_ug", // Vitamin D (D2 + D3) (µg)
  1109: "vitamin_e_mg"  // Vitamin E (alpha-tocopherol) (mg)
};

// Fallback name-based mapping for cases where IDs differ / are missing.
function mapByName_(name){
  const n = String(name||"").toLowerCase();
  if(n.includes("vitamin a") && n.includes("rae")) return "vitamin_a_ug";
  if(n.includes("vitamin d") && (n.includes("d2") || n.includes("d3") || n.includes("d2 + d3") || n.includes("total"))) return "vitamin_d_ug";
  if(n.includes("vitamin c")) return "vitamin_c_mg";
  if(n.includes("vitamin e") && n.includes("alpha")) return "vitamin_e_mg";
  if(n.includes("vitamin k")) return "vitamin_k_ug";
  if(n.includes("thiamin")) return "thiamin_mg";
  if(n.includes("riboflavin")) return "riboflavin_mg";
  if(n.includes("niacin")) return "niacin_mg";
  if(n.includes("pantothenic")) return "pantothenic_mg";
  if(n.includes("vitamin b-6") || n.includes("vitamin b6")) return "vitamin_b6_mg";
  if(n.includes("folate")) return "folate_ug";
  if(n.includes("vitamin b-12") || n.includes("vitamin b12")) return "vitamin_b12_ug";
  if(n.includes("selenium")) return "selenium_ug";
  if(n.includes("manganese")) return "manganese_mg";
  if(n.includes("copper")) return "copper_mg";
  if(n.includes("zinc")) return "zinc_mg";
  if(n.includes("magnesium")) return "magnesium_mg";
  if(n.includes("phosphorus")) return "phosphorus_mg";
  if(n.includes("potassium")) return "potassium_mg";
  if(n.includes("sodium")) return "sodium_mg";
  if(n.includes("iron")) return "iron_mg";
  if(n.includes("calcium")) return "calcium_mg";
  if(n.includes("fiber")) return "fiber_g";
  if(n.includes("energy") && n.includes("kcal")) return "calories_kcal";
  if(n.includes("protein")) return "protein_g";
  if(n.includes("carbohydrate")) return "carbs_g";
  if(n.includes("total lipid") || n.includes("fat")) return "fat_g";
  return null;
}

function fdcSearchBest_(query){
  const key = getFdcKey_();
  const url = "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=" + encodeURIComponent(key);
  const payload = {
    query: String(query||"").trim(),
    pageSize: 5,
    dataType: ["Foundation","Survey (FNDDS)","SR Legacy","Branded"]
  };
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  });
  const code = res.getResponseCode();
  if(code < 200 || code >= 300){
    throw new Error("FDC search failed (" + code + "): " + res.getContentText().slice(0,300));
  }
  const data = JSON.parse(res.getContentText());
  const foods = data.foods || [];
  if(!foods.length) throw new Error("No FDC matches for query: " + query);
  // Prefer non-branded when possible (more consistent); otherwise fall back to first
  const preferredOrder = {"Foundation":1, "Survey (FNDDS)":2, "SR Legacy":3, "Branded":4};
  foods.sort((a,b)=> (preferredOrder[a.dataType]||99) - (preferredOrder[b.dataType]||99));
  return foods[0];
}

function fdcFoodDetails_(fdcId){
  const key = getFdcKey_();
  const url = "https://api.nal.usda.gov/fdc/v1/food/" + encodeURIComponent(fdcId) + "?api_key=" + encodeURIComponent(key);
  const res = UrlFetchApp.fetch(url, {muteHttpExceptions:true});
  const code = res.getResponseCode();
  if(code < 200 || code >= 300){
    throw new Error("FDC details failed (" + code + "): " + res.getContentText().slice(0,300));
  }
  return JSON.parse(res.getContentText());
}

function extractNutrientsFromFdc_(food){
  const out = {
    calories_kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    micros: {}
  };

  const nutrients = food.foodNutrients || [];
  for(const fn of nutrients){
    const amt = (fn.amount===0 || fn.amount) ? +fn.amount : null;
    if(amt===null || !isFinite(amt)) continue;

    const nid = fn.nutrient && fn.nutrient.id ? +fn.nutrient.id : null;
    const nname = fn.nutrient && fn.nutrient.name ? fn.nutrient.name : (fn.nutrientName || "");
    const key = (nid && FDC_ID_MAP[nid]) ? FDC_ID_MAP[nid] : mapByName_(nname);
    if(!key) continue;

    if(key === "calories_kcal") out.calories_kcal = amt;
    else if(key === "protein_g") out.protein_g = amt;
    else if(key === "carbs_g") out.carbs_g = amt;
    else if(key === "fat_g") out.fat_g = amt;
    else if(key === "fiber_g") out.fiber_g = amt;
    else if(key === "energy_kj") out.energy_kj = amt;
    else out.micros[key] = amt;
  }

  // If kcal missing but kJ present, convert (1 kcal = 4.184 kJ)
  if((!out.calories_kcal || out.calories_kcal===0) && isFinite(+out.energy_kj) && (+out.energy_kj)>0){
    out.calories_kcal = (+out.energy_kj) / 4.184;
  }

  // Defensive defaults
  out.calories_kcal = +out.calories_kcal || 0;
  out.protein_g = +out.protein_g || 0;
  out.carbs_g = +out.carbs_g || 0;
  out.fat_g = +out.fat_g || 0;
  out.fiber_g = +out.fiber_g || 0;

  return out;
}



/* ──────────────────────────────────────────────────────────────────────────
   LLM nutrient estimation (fallback when FoodData Central returns missing/partial data)

   Notes:
   - Groq Chat Completions (OpenAI-compatible) endpoint:
     POST https://api.groq.com/openai/v1/chat/completions
   - `llama-3.3-70b-versatile` supports JSON Object Mode via:
     response_format: { type: "json_object" }
   - Groq server-side web search is available via Compound systems (e.g., `groq/compound-mini`)
     with compound_custom.tools.enabled_tools including "web_search".

   Required Script Properties:
   - GROQ_API_KEY (used for both score analysis + nutrient estimation)
   Optional Script Properties:
   - GROQ_NUTRIENT_MODEL (default: llama-3.3-70b-versatile)
   - GROQ_WEB_MODEL (default: groq/compound-mini)
────────────────────────────────────────────────────────────────────────── */

const GROQ_CHAT_ENDPOINT_ = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_DEFAULT_NUTRIENT_MODEL_ = "llama-3.3-70b-versatile";
const GROQ_DEFAULT_WEB_MODEL_ = "groq/compound-mini";

// Must match the MICROS keys in the front-end.
const NUTRIENT_MICRO_KEYS_ = [
  "vitamin_a_ug","vitamin_c_mg","vitamin_d_ug","vitamin_e_mg","vitamin_k_ug",
  "thiamin_mg","riboflavin_mg","niacin_mg","pantothenic_mg","vitamin_b6_mg","biotin_ug","folate_ug","vitamin_b12_ug",
  "calcium_mg","iron_mg","magnesium_mg","potassium_mg","sodium_mg","zinc_mg","selenium_ug","copper_mg","manganese_mg","phosphorus_mg","iodine_ug","choline_mg"
];

function getGroqNutrientModel_(){
  const props = PropertiesService.getScriptProperties();
  return (props.getProperty("GROQ_NUTRIENT_MODEL") || GROQ_DEFAULT_NUTRIENT_MODEL_).trim();
}

function getGroqWebModel_(){
  const props = PropertiesService.getScriptProperties();
  return (props.getProperty("GROQ_WEB_MODEL") || GROQ_DEFAULT_WEB_MODEL_).trim();
}

function groqRequest_(payload, extraHeaders){
  const key = getGroqKey_();
  const headers = { Authorization: "Bearer " + key };
  if(extraHeaders && typeof extraHeaders === "object"){
    for(const [k,v] of Object.entries(extraHeaders)) headers[k] = v;
  }

  const res = UrlFetchApp.fetch(GROQ_CHAT_ENDPOINT_, {
    method: "post",
    contentType: "application/json",
    headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const txt = res.getContentText() || "";
  if(code < 200 || code >= 300){
    throw new Error("Groq API error " + code + ": " + txt.slice(0, 800));
  }
  return JSON.parse(txt);
}

function extractAssistantText_(groqResp){
  return (((groqResp||{}).choices||[])[0]||{}).message?.content || "";
}

function clampStr_(s, n){
  s = String(s || "");
  return s.length > n ? s.slice(0, n) : s;
}

function sanitizeNutrients_(obj){
  const out = {
    calories_kcal: 0,
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    fiber_g: 0,
    micros: {}
  };

  if(!obj || typeof obj !== "object") return out;

  function num(v){
    const n = +v;
    if(!isFinite(n)) return 0;
    return n < 0 ? 0 : n;
  }

  out.calories_kcal = num(obj.calories_kcal);
  out.protein_g = num(obj.protein_g);
  out.carbs_g = num(obj.carbs_g);
  out.fat_g = num(obj.fat_g);
  out.fiber_g = num(obj.fiber_g);

  const m = (obj.micros && typeof obj.micros === "object") ? obj.micros : {};
  for(const k of NUTRIENT_MICRO_KEYS_){
    out.micros[k] = num(m[k]);
  }

  return out;
}

function nutrientsLooksEmpty_(nutrients, food){
  if(!nutrients || typeof nutrients !== "object") return true;

  // If API response explicitly has no nutrient list, treat as empty.
  const listLen = (food && Array.isArray(food.foodNutrients)) ? food.foodNutrients.length : null;
  if(listLen === 0) return true;

  const kcal = +nutrients.calories_kcal || 0;
  const p = +nutrients.protein_g || 0;
  const c = +nutrients.carbs_g || 0;
  const f = +nutrients.fat_g || 0;
  const fib = +nutrients.fiber_g || 0;
  const microsCount = (nutrients.micros && typeof nutrients.micros === "object") ? Object.keys(nutrients.micros).length : 0;

  // "No nutrients" usually manifests as everything zero and no micros keys.
  if((kcal + p + c + f + fib) === 0 && microsCount === 0) return true;

  return false;
}

function nutrientsLooksPartial_(nutrients, query){
  if(!nutrients || typeof nutrients !== "object") return true;
  if(nutrientsLooksEmpty_(nutrients, null)) return true;

  const kcal = +nutrients.calories_kcal || 0;
  const p = +nutrients.protein_g || 0;
  const c = +nutrients.carbs_g || 0;
  const f = +nutrients.fat_g || 0;
  const fib = +nutrients.fiber_g || 0;
  const microsCount = (nutrients.micros && typeof nutrients.micros === "object") ? Object.keys(nutrients.micros).length : 0;

  // Composite foods (apple + peanuts, chicken and rice) often get mapped to a single item by FDC,
  // which is "valid" but not what we want. Prefer the LLM estimate for composites.
  const q = String(query || "").toLowerCase();
  const looksComposite = /(\+| and |&|,|\/)/.test(q);

  // If calories exist but essentially no breakdown/micros, treat as partial.
  if(kcal > 0 && (p + c + f + fib) === 0 && microsCount < 5) return true;

  // If we have basically no micros, it's not usable for your UI.
  if(microsCount === 0) return true;

  // If the user food is composite, prefer LLM to approximate the combined nutrients.
  if(looksComposite && microsCount < 12) return true;

  // Many foods will legitimately have 0 fiber, but if fiber is 0 AND micros are sparse, it’s likely incomplete.
  if(fib === 0 && microsCount < 8) return true;

  return false;
}

function shouldUseWebSearchForEstimate_(query, fdcNutrients){
  const q = String(query || "").toLowerCase();
  if(/(\+| and |&|,|\/)/.test(q)) return true;
  const microsCount = (fdcNutrients && fdcNutrients.micros && typeof fdcNutrients.micros === "object") ? Object.keys(fdcNutrients.micros).length : 0;
  if(!fdcNutrients || nutrientsLooksEmpty_(fdcNutrients, null) || microsCount === 0) return true;
  return false;
}

function groqWebContext_(foodText){
  // Use Groq Compound (server-side tool orchestration) to pull quick, high-signal web context.
  const model = getGroqWebModel_();

  const prompt = [
    "Use web search to find nutrition facts per 100g edible portion for the food below.",
    "Prioritize: USDA FoodData Central (FDC), MyFoodData, and other reputable sources.",
    "Return a short digest that includes:",
    "- macros (kcal, protein g, carbs g, fat g) + fiber g",
    "- a few key vitamins/minerals (Vitamin A/C/D/E/K, iron, calcium, potassium, magnesium, zinc, sodium)",
    "- include source URLs next to the numbers when possible.",
    "",
    "Food:",
    String(foodText || "").trim()
  ].join("\n");

  const payload = {
    model,
    temperature: 0,
    max_tokens: 900,
    messages: [
      { role: "user", content: prompt }
    ],
    compound_custom: {
      tools: {
        enabled_tools: ["web_search", "visit_website"]
      }
    }
  };

  const resp = groqRequest_(payload);
  const msg = (((resp||{}).choices||[])[0]||{}).message || {};
  const digest = String(msg.content || "").trim();

  // executed_tools can be large; keep a compact excerpt.
  let toolsText = "";
  const executed = msg.executed_tools;
  if(Array.isArray(executed) && executed.length){
    toolsText = executed.slice(0,2).map(t=>{
      const type = t.type || "";
      const args = clampStr_(t.arguments || "", 600);
      const out = clampStr_(t.output || "", 1400);
      return `TOOL: ${type}\nARGS: ${args}\nOUTPUT:\n${out}`;
    }).join("\n\n");
  }

  const combined = [digest, toolsText].filter(Boolean).join("\n\n");
  return clampStr_(combined, 5000);
}

function groqEstimateNutrients_(foodText, opts){
  const model = getGroqNutrientModel_();
  const q = String(foodText || "").trim();

  let webCtx = "";
  const fdc = (opts && opts.fdcNutrients) ? opts.fdcNutrients : null;
  if(opts && opts.useWebSearch){
    try{ webCtx = groqWebContext_(q); }catch(_){}
  }

  const schema = {
    calories_kcal: "number (kcal per 100g)",
    protein_g: "number (g per 100g)",
    carbs_g: "number (g per 100g)",
    fat_g: "number (g per 100g)",
    fiber_g: "number (g per 100g)",
    micros: Object.fromEntries(NUTRIENT_MICRO_KEYS_.map(k => [k, "number"]))
  };

  const sys = [
    "You are a careful nutrition facts estimator.",
    "Return ONLY a JSON object (no markdown, no extra text).",
    "All values must be PER 100g edible portion (or per 100ml for beverages).",
    "If the food description is a combination (e.g., 'apple + peanuts'), estimate nutrients for the combined mix per 100g.",
    "Populate ALL fields in this schema. If a nutrient is negligible/unknown, return 0.",
    "",
    "Schema (keys + expected numeric values):",
    JSON.stringify(schema)
  ].join("\n");

  const user = [
    "Food description:",
    q,
    "",
    fdc ? ("FDC-derived nutrients (may be partial):\n" + clampStr_(JSON.stringify(fdc), 6000)) : "",
    webCtx ? ("Web context (digest + tool outputs):\n" + webCtx) : "",
  ].filter(Boolean).join("\n\n");

  const payload = {
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user }
    ]
  };

  const resp = groqRequest_(payload);
  const txt = extractAssistantText_(resp);
  const parsed = parseJson_(txt); // uses existing helper below
  return sanitizeNutrients_(parsed);
}

function fallbackNutrients_(query){
  const q = String(query||"").toLowerCase();

  // Base nutrients are per 100g reference amounts (approx).
  // Used only if USDA FoodData Central lookup is unavailable.
  // Sources for reference values:
  // - Apples (raw, with skin): fiber ~2.4g/100g, potassium ~107mg/100g, vitamin C ~4.6mg/100g
  // - Dry roasted peanuts: fiber ~8.6g/100g, magnesium ~181mg/100g, phosphorus ~368mg/100g, copper ~0.43mg/100g, manganese ~1.82mg/100g, niacin ~14.6mg/100g, vitamin E ~5mg/100g
  const ITEMS = {
    apple: {
      calories_kcal: 52,
      protein_g: 0.26,
      carbs_g: 13.8,
      fat_g: 0.17,
      fiber_g: 2.4,
      micros: {
        potassium_mg: 107,
        vitamin_c_mg: 4.6
      }
    },
    peanuts: {
      calories_kcal: 596,
      protein_g: 24.6,
      carbs_g: 21.4,
      fat_g: 50.4,
      fiber_g: 8.6,
      micros: {
        magnesium_mg: 181,
        phosphorus_mg: 368,
        copper_mg: 0.43,
        manganese_mg: 1.82,
        niacin_mg: 14.6,
        vitamin_e_mg: 5.0,
        choline_mg: 65.4
      }
    }
  };

  const picks = [];
  if(q.includes("peanut")) picks.push(ITEMS.peanuts);
  if(q.includes("apple")) picks.push(ITEMS.apple);

  if(!picks.length) return null;

  // Combine by summing (will be scaled on client if targetCalories is provided)
  const out = {calories_kcal:0, protein_g:0, carbs_g:0, fat_g:0, fiber_g:0, micros:{}};
  for(const it of picks){
    out.calories_kcal += (+it.calories_kcal||0);
    out.protein_g += (+it.protein_g||0);
    out.carbs_g += (+it.carbs_g||0);
    out.fat_g += (+it.fat_g||0);
    out.fiber_g += (+it.fiber_g||0);
    const m = it.micros || {};
    for(const k in m){
      out.micros[k] = (out.micros[k]||0) + (+m[k]||0);
    }
  }
  return out;
}


function estimateNutrientsCached_(dishKey, query){
  const key = String(dishKey||"").toLowerCase().trim();
  const q = String(query||dishKey||"").trim();
  const cached = getCachedFoodNutrients_(key);
  if(cached && typeof cached === "object" && Object.keys(cached).length){
    // If we previously cached partial/empty data, refresh it.
    if(!nutrientsLooksPartial_(cached, q)) return cached;
  }

  // 1) Try USDA FoodData Central first
  try{
    const best = fdcSearchBest_(q);
    const food = fdcFoodDetails_(best.fdcId);
    const nutrients = extractNutrientsFromFdc_(food);

    // Some results can come back with missing/empty nutrients; treat as a failure and fall back.
    if(nutrientsLooksEmpty_(nutrients, food)){
      throw new Error("FDC returned empty nutrients for: " + q);
    }

    // Option B: If FDC returns partial/incomplete data, use Groq to fill everything (macros, fiber, micros),
    // using web search context when it’s likely needed (composites, very sparse micros, etc.).
    if(nutrientsLooksPartial_(nutrients, q)){
      try{
        const llm = groqEstimateNutrients_(q, {
          fdcNutrients: nutrients,
          useWebSearch: shouldUseWebSearchForEstimate_(q, nutrients)
        });
        if(llm && typeof llm === "object"){
          setCachedFoodNutrients_(key, q, {fdcId:best.fdcId, description:best.description, dataType:"llm+fdc"}, llm);
          return llm;
        }
      }catch(_ignoreLlmFillErr){
        // If LLM fill fails, fall back to whatever FDC gave us.
      }
    }

    setCachedFoodNutrients_(key, q, {fdcId:best.fdcId, description:best.description, dataType:best.dataType}, nutrients);
    return nutrients;
  }catch(err){
    // 2) If FDC doesn't return nutrients (or FDC key isn't set), use Groq estimator.
    try{
      const llm = groqEstimateNutrients_(q, {useWebSearch:true});
      if(llm && typeof llm === "object"){
        setCachedFoodNutrients_(key, q, {fdcId:"", description:"LLM estimate", dataType:"llm"}, llm);
        return llm;
      }
    }catch(_ignoreLlmErr){
      // fall through
    }

    // 3) Last-resort static fallback (kept so the app still works if GROQ_API_KEY isn't set)
    const fb = fallbackNutrients_(q);
    if(fb) return fb;
    throw err;
  }
}



function estimateNutrients_(dishText){
  // Backward-compatible wrapper: dishText is used as dishKey + query.
  return estimateNutrientsCached_(String(dishText||"").toLowerCase().trim(), String(dishText||"").trim());
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

// ───────────────────────────────────────────────────────────────
// One-time helper: Prefill USDA nutrients for all preset meals in the plan.
// Run this from the Apps Script editor after setting FDC_API_KEY.
const PRESET_FOODS = [
  {
    "dishKey": "masala oats + boiled egg",
    "query": "Masala Oats + Boiled Egg 40g oats with milk, veggies, spices + 1 boiled egg + black coffee",
    "targetCalories": 340
  },
  {
    "dishKey": "banana + peanut butter",
    "query": "Banana + Peanut Butter 1 banana with 1 tbsp peanut butter",
    "targetCalories": 195
  },
  {
    "dishKey": "chicken biryani + raita",
    "query": "Chicken Biryani + Raita 1 cup chicken biryani with veggies + yogurt raita",
    "targetCalories": 520
  },
  {
    "dishKey": "greek yogurt + honey",
    "query": "Greek Yogurt + Honey 1 cup Greek yogurt with drizzle of honey",
    "targetCalories": 160
  },
  {
    "dishKey": "soup + sautéed veggies + paneer",
    "query": "Soup + Sautéed Veggies + Paneer 1 bowl tomato/chicken soup, sautéed veggies + 50g paneer",
    "targetCalories": 310
  },
  {
    "dishKey": "chamomile tea",
    "query": "Chamomile Tea Chamomile tea – relax and reflect",
    "targetCalories": 5
  },
  {
    "dishKey": "post-workout protein shake",
    "query": "Post-Workout Protein Shake Whey + creatine + chia + PB + oats + milk + dates (~600 kcal)",
    "targetCalories": 600
  },
  {
    "dishKey": "guava + pumpkin seeds",
    "query": "Guava + Pumpkin Seeds 1 guava + handful pumpkin seeds",
    "targetCalories": 130
  },
  {
    "dishKey": "3 rotis + paneer curry + sabzi + curd",
    "query": "3 Rotis + Paneer Curry + Sabzi + Curd Whole-wheat rotis, 100g paneer curry, mixed sabzi, 200g curd",
    "targetCalories": 580
  },
  {
    "dishKey": "whey protein in milk",
    "query": "Whey Protein in Milk 1 scoop whey in 200ml milk",
    "targetCalories": 185
  },
  {
    "dishKey": "khichdi + dal + salad",
    "query": "Khichdi + Dal + Salad 1 cup khichdi with veggies, 1 cup dal, cucumber-carrot salad",
    "targetCalories": 380
  },
  {
    "dishKey": "warm milk + turmeric",
    "query": "Warm Milk + Turmeric 1 cup warm milk with turmeric/ashwagandha",
    "targetCalories": 105
  },
  {
    "dishKey": "apple + walnuts",
    "query": "Apple + Walnuts 1 apple with 10 walnuts",
    "targetCalories": 180
  },
  {
    "dishKey": "3 rotis + grilled chicken + broccoli + curd",
    "query": "3 Rotis + Grilled Chicken + Broccoli + Curd 3 rotis, 100g grilled chicken breast, sautéed broccoli, 1 bowl curd",
    "targetCalories": 560
  },
  {
    "dishKey": "boiled egg",
    "query": "Boiled Egg 1 boiled egg – protein snack",
    "targetCalories": 78
  },
  {
    "dishKey": "veg pulao + rajma + beetroot salad",
    "query": "Veg Pulao + Rajma + Beetroot Salad 1.5 cups veg pulao, 100g rajma curry, small beetroot salad",
    "targetCalories": 480
  },
  {
    "dishKey": "banana + flaxseeds",
    "query": "Banana + Flaxseeds 1 banana + 1 tbsp roasted flaxseeds",
    "targetCalories": 145
  },
  {
    "dishKey": "buddha bowl (quinoa + tofu)",
    "query": "Buddha Bowl (Quinoa + Tofu) 1 cup quinoa, 100g pan-seared tofu, veggies, almonds, olive oil",
    "targetCalories": 520
  },
  {
    "dishKey": "whey protein in water",
    "query": "Whey Protein in Water 1 scoop whey in water – low cal, fast protein",
    "targetCalories": 120
  },
  {
    "dishKey": "2 rotis + grilled fish + dal + salad",
    "query": "2 Rotis + Grilled Fish + Dal + Salad 2 rotis, 150g grilled fish, 1 katori dal, side salad",
    "targetCalories": 520
  },
  {
    "dishKey": "milk + ashwagandha",
    "query": "Milk + Ashwagandha 200ml milk/curd, optional ashwagandha 300mg",
    "targetCalories": 100
  },
  {
    "dishKey": "orange + almonds",
    "query": "Orange + Almonds 1 orange or mango + 10 almonds",
    "targetCalories": 160
  },
  {
    "dishKey": "3 rotis + chicken curry + okra + curd",
    "query": "3 Rotis + Chicken Curry + Okra + Curd 3 rotis, 100g chicken curry, 1 katori okra sabzi, 1 bowl curd",
    "targetCalories": 570
  },
  {
    "dishKey": "buttermilk / protein shake",
    "query": "Buttermilk / Protein Shake 1 glass buttermilk or whey in water",
    "targetCalories": 100
  },
  {
    "dishKey": "whole-grain pasta + chicken",
    "query": "Whole-Grain Pasta + Chicken 1.5 cups pasta, 100g chicken/paneer, tomato sauce, mushrooms, spinach",
    "targetCalories": 520
  },
  {
    "dishKey": "herbal tea / milk",
    "query": "Herbal Tea / Milk Herbal tea or milk + optional collagen",
    "targetCalories": 80
  },
  {
    "dishKey": "apple + peanuts",
    "query": "Apple + Peanuts 1 apple or pear + 10 peanuts/cashews",
    "targetCalories": 165
  },
  {
    "dishKey": "3 rotis + paneer bhurji + dal + curd",
    "query": "3 Rotis + Paneer Bhurji + Dal + Curd 3 rotis, 100g paneer bhurji, 1 katori dal, 1 bowl curd",
    "targetCalories": 580
  },
  {
    "dishKey": "2 boiled eggs",
    "query": "2 Boiled Eggs 2 whole eggs – nutrient-dense protein snack",
    "targetCalories": 156
  },
  {
    "dishKey": "brown rice + stir-fried chicken",
    "query": "Brown Rice + Stir-Fried Chicken 1 cup brown rice, 150g chicken stir-fry with veggies, steamed greens",
    "targetCalories": 510
  },
  {
    "dishKey": "golden milk / yogurt",
    "query": "Golden Milk / Yogurt Turmeric + milk or low-fat yogurt + ashwagandha",
    "targetCalories": 100
  },
  {
    "dishKey": "papaya / watermelon + seeds",
    "query": "Papaya / Watermelon + Seeds 1 bowl hydrating fruit + 1 tbsp mixed seeds",
    "targetCalories": 140
  },
  {
    "dishKey": "egg sandwiches / chicken salad",
    "query": "Egg Sandwiches / Chicken Salad 2 multigrain sandwiches with 2 eggs/paneer, lettuce, tomato, cheese",
    "targetCalories": 480
  },
  {
    "dishKey": "protein bar / roasted chana",
    "query": "Protein Bar / Roasted Chana 1 protein bar or handful of roasted chickpeas",
    "targetCalories": 150
  },
  {
    "dishKey": "2 rotis + 3 egg omelet + dal",
    "query": "2 Rotis + 3 Egg Omelet + Dal 2 rotis, 3 egg whites + 1 yolk omelet with spinach, 1 katori dal, salad",
    "targetCalories": 470
  },
  {
    "dishKey": "milk + shilajit / casein",
    "query": "Milk + Shilajit / Casein 200ml milk with shilajit or casein for overnight recovery",
    "targetCalories": 150
  }
];

function prefillPresetFoods(){
  const start = new Date();
  const results = [];
  for(const item of PRESET_FOODS){
    try{
      const nutrients = estimateNutrientsCached_(item.dishKey, item.query);
      results.push({dishKey:item.dishKey, ok:true, calories_kcal:nutrients.calories_kcal});
      Utilities.sleep(350); // be gentle with API rate limits
    }catch(e){
      results.push({dishKey:item.dishKey, ok:false, error:String(e && e.message ? e.message : e)});
      Utilities.sleep(350);
    }
  }
  Logger.log("Prefill complete in " + ((new Date()-start)/1000).toFixed(1) + "s");
  Logger.log(JSON.stringify(results, null, 2));
  return results;
}


function upsertDay_(dateKey, payloadStr, {source="manual", email=""}={}){
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try{
    const sheet = getSheet_();
    ensureHeaders_(sheet);

    const incoming = parseJson_(payloadStr);
    const latest = getLatestRowForDate_(dateKey);
    let mergedPayload = incoming;

    let latestRev = 0;
    if(latest && latest.row){
      const p0 = String(latest.row["Payload JSON"] || "").trim();
      if(p0){
        try{
          const existing = parseJson_(p0);
          mergedPayload = mergePayload_(existing, incoming);
        }catch(e){}
      }
      latestRev = num_(latest.row["Rev"]);
    }

    // Compute summary from merged payload so sheet totals always match logs
    const summary = computeSummaryFromPayload_(mergedPayload);

    const row = buildRowForSheet_(dateKey, mergedPayload, summary, {
      source,
      email,
      rev: Math.max(latestRev, num_(mergedPayload.rev)) + 1,
      deviceId: String(mergedPayload.deviceId || mergedPayload["Device ID"] || "")
    });

    const res = appendRow_(row, {source, email});
    return {rowNumber: res.rowNumber, serverRev: row["Rev"]};
  }finally{
    lock.releaseLock();
  }
}

function buildRowForSheet_(dateKey, payloadObj, summary, {source="manual", email="", rev=0, deviceId=""}={}){
  const row = {};

  // Date (timestamp) stored as ISO date string (same as client dateKey)
  row["Date (timestamp)"] = dateKey;

  row["Calories Consumed (kcal)"] = summary.cal;
  row["Protein (g)"] = summary.protein;
  row["Carbs (g)"] = summary.carbs;
  row["Fats (g)"] = summary.fat;
  row["Fiber (g)"] = summary.fiber;

  row["Calories Burnt (kcal)"] = num_(payloadObj.calBurned);
  row["Net Calories (kcal)"] = Math.round((summary.cal - num_(payloadObj.calBurned))*10)/10;

  row["Water Intake (mL)"] = summary.waterMl;
  row["Steps"] = summary.steps;
  row["Sleep (hrs)"] = num_(payloadObj.sleep && payloadObj.sleep.hours);

  row["Weight (kg)"] = num_(payloadObj.weight);
  row["BMI"] = num_(payloadObj.bmi);

  row["Skincare Done"] = summary.skincareDone ? "Yes" : 0;
  row["Haircare Done"] = summary.haircareDone ? "Yes" : 0;

  // micros
  const micros = summary.micros || {};
  row["Calcium (mg)"] = num_(micros.calcium_mg);
  row["Iron (mg)"] = num_(micros.iron_mg);
  row["Potassium (mg)"] = num_(micros.potassium_mg);
  row["Sodium (mg)"] = num_(micros.sodium_mg);
  row["Magnesium (mg)"] = num_(micros.magnesium_mg);
  row["Zinc (mg)"] = num_(micros.zinc_mg);
  row["Vitamin A (mg)"] = num_(micros.vitamin_a_mg);
  row["Vitamin C (mg)"] = num_(micros.vitamin_c_mg);
  row["Vitamin D (mg)"] = num_(micros.vitamin_d_mg);
  row["Vitamin B12 (mg)"] = num_(micros.vitamin_b12_mg);

  row["Payload JSON"] = JSON.stringify(payloadObj);
  row["Rev"] = rev;
  row["Device ID"] = deviceId || "";
  row["Client Updated At"] = String(payloadObj.updatedAt || "");
  row["Server Updated At"] = new Date().toISOString();
  row["Source"] = source || "web";

  // fill defaults
  for(const h of REQUIRED_HEADERS){
    if(row[h] === undefined || row[h] === null){
      if(h === "Payload JSON" || h==="Device ID" || h==="Client Updated At" || h==="Server Updated At" || h==="Source"){
        row[h] = "";
      }else{
        row[h] = 0;
      }
    }
  }
  return row;
}

function computeSummaryFromPayload_(p){
  p = (p && typeof p==="object") ? p : {};
  const foods = Array.isArray(p.foods) ? p.foods.filter(f=>f && !f.deletedAt) : [];
  const waterLogs = Array.isArray(p.waterLogs) ? p.waterLogs.filter(l=>l && !l.deletedAt) : [];
  const stepLogs = Array.isArray(p.stepLogs) ? p.stepLogs.filter(l=>l && !l.deletedAt) : [];

  let cal=0, protein=0, carbs=0, fat=0, fiber=0;
  const micros = {};

  foods.forEach(f=>{
    cal += num_(f.cal);
    protein += num_(f.protein);
    carbs += num_(f.carbs);
    fat += num_(f.fat);
    fiber += num_(f.fiber);
    if(f.micros && typeof f.micros==="object"){
      Object.keys(f.micros).forEach(k=>{
        micros[k] = (micros[k]||0) + num_(f.micros[k]);
      });
    }
  });

  // supplements
  const suppMap = (p.supplementNutrients && typeof p.supplementNutrients==="object") ? p.supplementNutrients : {};
  let taken = [];
  if(p.supplementChecks && typeof p.supplementChecks==="object"){
    taken = Object.keys(p.supplementChecks).filter(k=>{
      const o = p.supplementChecks[k];
      return (o && typeof o==="object") ? !!o.v : !!o;
    });
  }else if(Array.isArray(p.supplementsTaken)){
    taken = p.supplementsTaken;
  }
  taken.forEach(id=>{
    const sn = suppMap[id];
    if(!sn) return;
    cal += num_(sn.calories_kcal);
    protein += num_(sn.protein_g);
    carbs += num_(sn.carbs_g);
    fat += num_(sn.fat_g);
    fiber += num_(sn.fiber_g);
    if(sn.micros && typeof sn.micros==="object"){
      Object.keys(sn.micros).forEach(k=>{
        micros[k] = (micros[k]||0) + num_(sn.micros[k]);
      });
    }
  });

  const waterMl = waterLogs.reduce((s,l)=>s + num_(l.ml), 0);
  const steps = stepLogs.reduce((mx,l)=>Math.max(mx, Math.round(num_(l.steps))), 0);

  const skincareDone = inferDone_(p.skincareChecks);
  const haircareDone = inferDone_(p.haircareChecks);

  return {
    cal: Math.round(cal),
    protein: Math.round(protein*10)/10,
    carbs: Math.round(carbs*10)/10,
    fat: Math.round(fat*10)/10,
    fiber: Math.round(fiber*10)/10,
    micros,
    waterMl,
    steps,
    skincareDone,
    haircareDone
  };
}

function inferDone_(checks){
  if(!checks || typeof checks!=="object") return false;
  // done if every entry is true-ish (best-effort)
  const keys = Object.keys(checks);
  if(!keys.length) return false;
  return keys.every(k=>{
    const o = checks[k];
    return (o && typeof o==="object") ? !!o.v : !!o;
  });
}

function mergePayload_(a,b){
  a = (a && typeof a==="object") ? a : {};
  b = (b && typeof b==="object") ? b : {};
  const out = JSON.parse(JSON.stringify(a));

  // shallow override scalars
  const scalarKeys = ["sleep","weight","weightSetAt","bmi","calBurned","updatedAt","rev"];
  scalarKeys.forEach(k=>{
    if(b[k] !== undefined) out[k] = b[k];
  });

  // arrays by id with tombstones
  out.foods = mergeArrayById_(a.foods, b.foods, "id", "addedAt");
  out.waterLogs = mergeArrayById_(a.waterLogs, b.waterLogs, "id", "ts");
  out.stepLogs = mergeArrayById_(a.stepLogs, b.stepLogs, "id", "ts");
  out.customExercises = mergeArrayById_(a.customExercises, b.customExercises, "id", "ts");

  // LWW maps
  out.supplementChecks = mergeLwwMap_(a.supplementChecks, b.supplementChecks);
  out.exerciseChecks = mergeLwwMap_(a.exerciseChecks, b.exerciseChecks);
  out.skincareChecks = mergeLwwMap_(a.skincareChecks, b.skincareChecks);
  out.haircareChecks = mergeLwwMap_(a.haircareChecks, b.haircareChecks);

  // nutrient map: prefer b then a
  out.supplementNutrients = Object.assign({}, a.supplementNutrients||{}, b.supplementNutrients||{});

  return out;
}

function mergeArrayById_(aArr, bArr, idKey, tsKey){
  const a = Array.isArray(aArr) ? aArr : [];
  const b = Array.isArray(bArr) ? bArr : [];
  const map = {};
  a.forEach(x=>{
    if(x && x[idKey]!=null) map[String(x[idKey])] = x;
  });
  b.forEach(x=>{
    if(!x || x[idKey]==null) return;
    const id = String(x[idKey]);
    const cur = map[id];
    if(!cur){ map[id] = x; return; }

    // if either is deleted, keep deleted (tombstone wins)
    if(cur.deletedAt || x.deletedAt){
      map[id] = Object.assign({}, cur, x, {deletedAt: cur.deletedAt || x.deletedAt});
      return;
    }

    // choose newer by timestamp field if present
    const t1 = num_(cur[tsKey]);
    const t2 = num_(x[tsKey]);
    map[id] = (t2 >= t1) ? Object.assign({}, cur, x) : Object.assign({}, x, cur);
  });
  return Object.keys(map).map(k=>map[k]);
}

function mergeLwwMap_(a,b){
  const out = {};
  a = (a && typeof a==="object") ? a : {};
  b = (b && typeof b==="object") ? b : {};
  const keys = new Set([].concat(Object.keys(a), Object.keys(b)));
  keys.forEach(k=>{
    const x = a[k]; const y = b[k];
    if(y===undefined){ out[k]=x; return; }
    if(x===undefined){ out[k]=y; return; }
    const tx = (x && typeof x==="object") ? num_(x.ts) : 0;
    const ty = (y && typeof y==="object") ? num_(y.ts) : 0;
    out[k] = (ty >= tx) ? y : x;
  });
  return out;
}

function estimateExerciseKcal_(text){
  // heuristic: parse duration and activity keywords
  const s = String(text||"").toLowerCase();
  const durMin = parseDurationMinutes_(s) || 30;
  let met = 5.0;
  if(s.includes("walk")) met = 3.3;
  else if(s.includes("run") || s.includes("jog")) met = 8.0;
  else if(s.includes("cycle") || s.includes("bike")) met = 7.0;
  else if(s.includes("swim")) met = 8.0;
  else if(s.includes("yoga")) met = 3.0;
  else if(s.includes("hiit")) met = 8.5;
  else if(s.includes("strength") || s.includes("weights") || s.includes("gym")) met = 6.0;

  const kg = 70;
  const kcal = (met * 3.5 * kg / 200) * durMin;
  return Math.round(kcal);
}

function parseDurationMinutes_(s){
  const m = /(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes)\b/.exec(s);
  if(m) return Math.round(parseFloat(m[1]));
  const h = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours)\b/.exec(s);
  if(h) return Math.round(parseFloat(h[1])*60);
  return 0;
}