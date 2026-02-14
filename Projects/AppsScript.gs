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
  const prefix = p.prefix || p.callback || p.cb || null;
  try{
    const action = (p.action || p.a || "ping").toLowerCase();

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
      const q = String(p.q || p.dish || "").trim();
      const dishKey = String(p.k || p.dishKey || q || "").toLowerCase().trim();
      const query = String(p.q || p.query || q || dishKey).trim();
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
    const action = (p.action || p.a || "").toLowerCase();

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

    if(action === "session"){
      // POST-based session bootstrap
      const auth = requireAuthWithIdToken_(p);
      const sess = createSession_(auth.email, auth.info);
      return output_({ok:true, session_key:sess.session_key, ttl_s:sess.ttl_s}, prefix);
    }

    if(action === "estimate"){
      const q = String(p.q || p.dish || "").trim();
      const dishKey = String(p.k || p.dishKey || q || "").toLowerCase().trim();
      const query = String(p.q || p.query || q || dishKey).trim();
      if(!dishKey) throw new Error("Missing dish/dishKey");
      const nutrients = estimateNutrientsCached_(dishKey, query);
      return output_({ok:true, nutrients}, prefix);
    }

    if(action === "latest"){
      const dateKey = String(p.dateKey || "").trim();
      if(!dateKey) throw new Error("Missing dateKey");
      const row = getLatestRowForDate_(dateKey);
      return output_({ok:true, row}, prefix);
    }

    if(action === "range"){
      const start = String(p.start||"").trim();
      const end = String(p.end||"").trim();
      if(!start || !end) throw new Error("Missing start/end");
      const rows = getLatestRowsInRange_(start, end);
      return output_({ok:true, rows}, prefix);
    }

    if(action === "analyze"){
      const rows = parseJson_(p.rows || "[]");
      const windowLabel = String(p.window || "").slice(0,64);
      const analysis = analyzeScores_(rows, windowLabel);
      return output_({ok:true, analysis}, prefix);
    }

    if(action === "ping"){
      return output_({ok:true, email, tz:TZ, sheet:SHEET_NAME}, prefix);
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
  const sessionKey = String((p && (p.session_key || p.sk)) || "").trim();
  if(sessionKey){
    const email = requireSession_(sessionKey);
    if(email !== ALLOWED_EMAIL) throw new Error("Unauthorized: " + email);
    return email;
  }
  return requireAuthWithIdToken_(p).email;
}

function requireAuthWithIdToken_(p){
  const token = String((p && (p.id_token || p.t)) || "").trim();
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

// Bump this whenever the estimation pipeline changes significantly.
// Old cached entries with a different (or missing) version will be re-estimated.
const NUTRIENT_CACHE_VERSION_ = 2;

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
  const parsed = parseJson_(jsonStr);
  // Invalidate entries from older pipeline versions
  if(!parsed || parsed._cacheVersion !== NUTRIENT_CACHE_VERSION_) return null;
  return parsed;
}

function setCachedFoodNutrients_(dishKey, query, fdcMeta, nutrients){
  const sh = getOrCreateFoodDb_();
  const row = findFoodDbRowByKey_(sh, dishKey);
  const now = Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm:ss");
  // Embed cache version so stale entries auto-refresh on pipeline changes
  const toStore = Object.assign({}, nutrients || {}, {_cacheVersion: NUTRIENT_CACHE_VERSION_});
  const payload = [
    String(dishKey||"").toLowerCase().trim(),
    String(query||"").trim(),
    fdcMeta?.fdcId || "",
    fdcMeta?.description || "",
    fdcMeta?.dataType || "",
    JSON.stringify(toStore),
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

function looksLikeBranded_(query){
  const q = String(query||"").toLowerCase();
  // Brand signals: proper nouns, product names, "bar", "pack", specific brand patterns
  return /\b(protein bar|granola bar|energy bar|cereal|biscuit|cookie|chips|crackers|yogurt cup|instant noodle|maggi|cup noodle|oreo|kitkat|amul|mother dairy|epigamia|yoga bar|ritebite|max protein|muesli|cornflakes|oats|quaker|kellogg|britannia|parle|haldiram|lays|kurkure|pepsi|coca[- ]?cola|sprite|fanta|redbull|red bull|monster|gatorade|tropicana|real juice|paper boat|sting|bournvita|horlicks|complan|boost|ensure|protinex|hershey|cadbury|nestle|magnum|kwality|havmor|baskin|mcdonald|mcd|burger king|domino|subway|kfc|pizza hut|starbucks|dunkin)\b/.test(q)
    || /\b(brand|pack|packet|sachet|bottle|can|bar|scoop)\b/.test(q);
}

function fdcSearchBest_(query, opts){
  const key = getFdcKey_();
  const url = "https://api.nal.usda.gov/fdc/v1/foods/search?api_key=" + encodeURIComponent(key);

  // Clean query: strip portion descriptors for better FDC matching
  const cleanQ = stripPortionInfo_(query);
  const searchQ = cleanQ || String(query||"").trim();

  const branded = (opts && opts.preferBranded) || looksLikeBranded_(query);

  const payload = {
    query: searchQ,
    pageSize: 5,
    dataType: branded
      ? ["Branded"]  // For packaged foods, only search Branded (has label data)
      : ["Foundation","Survey (FNDDS)","SR Legacy","Branded"]
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
  let foods = data.foods || [];

  // If branded search returned nothing, retry with all dataTypes
  if(!foods.length && branded){
    payload.dataType = ["Foundation","Survey (FNDDS)","SR Legacy","Branded"];
    const res2 = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      muteHttpExceptions: true,
      payload: JSON.stringify(payload)
    });
    if(res2.getResponseCode() >= 200 && res2.getResponseCode() < 300){
      const data2 = JSON.parse(res2.getContentText());
      foods = data2.foods || [];
    }
  }

  if(!foods.length) throw new Error("No FDC matches for query: " + searchQ);

  // For branded queries, prefer Branded (has label data); otherwise prefer Foundation/Survey
  const preferredOrder = branded
    ? {"Branded":1, "Survey (FNDDS)":2, "SR Legacy":3, "Foundation":4}
    : {"Foundation":1, "Survey (FNDDS)":2, "SR Legacy":3, "Branded":4};

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
    micros: {},
    _meta: {} // internal metadata, not returned to client
  };

  // Extract serving size from Branded foods (label data)
  if(food.servingSize && isFinite(+food.servingSize) && +food.servingSize > 0){
    out._meta.servingSize = +food.servingSize;
    out._meta.servingSizeUnit = food.servingSizeUnit || "g";
    out._meta.householdServingFullText = food.householdServingFullText || "";
  }
  if(food.brandName) out._meta.brandName = food.brandName;
  if(food.brandOwner) out._meta.brandOwner = food.brandOwner;
  if(food.dataType) out._meta.dataType = food.dataType;

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

// Scale FDC per-100g nutrients to a serving size (for Branded foods with label data)
function scaleFdcToServing_(nutrients, servingG){
  if(!servingG || servingG <= 0) return nutrients;
  const factor = servingG / 100;
  const out = {
    calories_kcal: Math.round(nutrients.calories_kcal * factor),
    protein_g: Math.round(nutrients.protein_g * factor * 10) / 10,
    carbs_g: Math.round(nutrients.carbs_g * factor * 10) / 10,
    fat_g: Math.round(nutrients.fat_g * factor * 10) / 10,
    fiber_g: Math.round(nutrients.fiber_g * factor * 10) / 10,
    micros: {}
  };
  if(nutrients.micros){
    for(const [k,v] of Object.entries(nutrients.micros)){
      out.micros[k] = Math.round((+v||0) * factor * 100) / 100;
    }
  }
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

  const q = String(query || "").toLowerCase();

  // If query describes a specific portion, FDC per-100g data needs LLM scaling
  if(hasPortionDescriptor_(q)) return true;

  // Composite foods often get mapped to a single item by FDC
  const looksComposite = /(\+| and |&|,|\/)/.test(q);

  if(kcal > 0 && (p + c + f + fib) === 0 && microsCount < 5) return true;
  if(microsCount === 0) return true;
  if(looksComposite && microsCount < 12) return true;
  if(fib === 0 && microsCount < 8) return true;

  return false;
}

function hasPortionDescriptor_(query){
  const q = String(query || "").toLowerCase();
  // Standard unit-based portions: "5 pieces", "1 katori", "200g", etc.
  if(/\d+\s*(katori|bowl|plate|cup|piece|slice|roti|rotis|paratha|parathas|chapati|chapatis|glass|scoop|tbsp|tablespoon|tsp|teaspoon|serving|pcs?|nos?|g\b|gm\b|gram|ml\b|oz\b|small|medium|large|half)/.test(q)) return true;
  // Countable food items: "5 momos", "2 samosas", "3 idlis", "4 puris"
  if(/\d+\s*(momos?|samosas?|pakoras?|vadas?|idlis?|dosas?|puris?|cutlets?|tikkas?|kebabs?|wings?|drumsticks?|nuggets?|cookies?|biscuits?)/.test(q)) return true;
  // Word-based portions: "one bowl", "half a plate"
  if(/\b(a |one |two |three |four |five |six |half a?)\s*(katori|bowl|plate|cup|piece|slice|roti|paratha|chapati|glass|scoop|serving|momo|samosa|idli|dosa|puri)/i.test(q)) return true;
  // Parenthetical count: "(5 momos)", "(2 pieces)"
  if(/\(\s*\d+\s*(momos?|pieces?|pcs?|nos?|servings?)/.test(q)) return true;
  return false;
}

function shouldUseWebSearchForEstimate_(query, fdcNutrients){
  const q = String(query || "").toLowerCase();
  if(/(\+| and |&|,|\/)/.test(q)) return true;
  if(hasPortionDescriptor_(q)) return true;
  if(looksLikeBranded_(q)) return true; // Branded foods need label data from web
  const microsCount = (fdcNutrients && fdcNutrients.micros && typeof fdcNutrients.micros === "object") ? Object.keys(fdcNutrients.micros).length : 0;
  if(!fdcNutrients || nutrientsLooksEmpty_(fdcNutrients, null) || microsCount === 0) return true;
  return false;
}

function groqWebContext_(foodText){
  // Use Groq Compound (server-side tool orchestration) to pull quick, high-signal web context.
  const model = getGroqWebModel_();

  const prompt = [
    "Use web search to find nutrition facts for the food described below.",
    "If a specific portion/serving is mentioned (e.g., '1 katori', '1 bowl', '2 rotis', '1 bar', '1 packet'), find nutrition for THAT serving size.",
    "If no portion is mentioned, find nutrition per standard serving.",
    "",
    "For BRANDED/PACKAGED foods (protein bars, cereal, biscuits, instant noodles, drinks, etc.):",
    "- Search for the EXACT product name + 'nutrition label' or 'nutrition facts'",
    "- Use the manufacturer's website, Nutritionix, or CalorieKing for label-accurate data",
    "- Include the pack serving size (e.g., 'per bar 60g', 'per packet 70g')",
    "",
    "For home-cooked/restaurant foods:",
    "- Prioritize: USDA FoodData Central, MyFoodData, Nutritionix, CalorieKing",
    "- For Indian foods, also check HealthifyMe, IFCT (Indian Food Composition Tables)",
    "",
    "Return a short digest that includes:",
    "- estimated serving weight in grams (or exact weight from label)",
    "- macros (kcal, protein g, carbs g, fat g) + fiber g for that serving",
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
    estimated_serving_g: "number (estimated weight of the described portion in grams)",
    calories_kcal: "number (total kcal for the described portion)",
    protein_g: "number (total grams for the described portion)",
    carbs_g: "number (total grams for the described portion)",
    fat_g: "number (total grams for the described portion)",
    fiber_g: "number (total grams for the described portion)",
    micros: Object.fromEntries(NUTRIENT_MICRO_KEYS_.map(k => [k, "number"]))
  };

  const sys = [
    "You are a careful nutrition facts estimator for a health tracking app.",
    "Return ONLY a JSON object (no markdown, no extra text).",
    "",
    "CRITICAL RULES:",
    "1. If the user specifies a portion (e.g., '1 katori', '1 bowl', '2 eggs', '1 plate', '1 cup', '1 bar', '1 packet'), estimate nutrients for THAT EXACT PORTION.",
    "2. If no portion is specified, estimate for ONE STANDARD SERVING of the food.",
    "3. First estimate the serving weight in grams (estimated_serving_g), then calculate all nutrients for that weight.",
    "4. For Indian foods: 1 katori ≈ 150-180g, 1 roti ≈ 40g, 1 plate rice ≈ 180-200g, 1 bowl dal ≈ 150-180g.",
    "5. For BRANDED/PACKAGED foods (protein bars, cereal, biscuits, drinks, etc.):",
    "   - Use the exact nutrition label data if available from web context or FDC reference.",
    "   - Serving size is printed on the pack — use that, not a generic estimate.",
    "   - Common examples: Yoga Bar protein bar ~60g, packet Maggi ~70g, Oreo pack ~11g per cookie.",
    "6. SANITY CHECK: calories must roughly equal (protein_g × 4) + (carbs_g × 4) + (fat_g × 9). If they don't add up, fix the values.",
    "7. Chicken/meat dishes always have significant fat (minimum 5-15g per serving). Cooked curries/keema have oil/ghee.",
    "8. If the food is a combination (e.g., 'rice + dal'), estimate for the combined plate.",
    "9. ALL micro values are for the described portion, not per 100g.",
    "10. Populate ALL fields. If a nutrient is negligible/unknown, return 0.",
    "",
    "Schema (keys + expected values):",
    JSON.stringify(schema)
  ].join("\n");

  // Include FDC serving size info if available
  let fdcContext = "";
  if(fdc){
    const meta = fdc._meta || {};
    if(meta.servingSize > 0){
      fdcContext = "FDC Branded data (per 100g, label serving = " + meta.servingSize + (meta.servingSizeUnit||"g") +
        (meta.householdServingFullText ? ", household: " + meta.householdServingFullText : "") +
        (meta.brandName ? ", brand: " + meta.brandName : "") + "):\n";
    } else {
      fdcContext = "Reference: FDC per-100g nutrients (scale to described serving):\n";
    }
    // Clean _meta before sending to LLM
    const fdcClean = Object.assign({}, fdc);
    delete fdcClean._meta;
    fdcContext += clampStr_(JSON.stringify(fdcClean), 6000);
  }

  const user = [
    "Food description:",
    q,
    "",
    fdcContext || "",
    webCtx ? ("Web context (may include per-serving or per-100g data — scale appropriately):\n" + webCtx) : "",
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
  const parsed = parseJson_(txt);
  const result = sanitizeNutrients_(parsed);

  // Sanity check: macros should roughly account for calories (4/4/9 rule)
  const macroKcal = (result.protein_g * 4) + (result.carbs_g * 4) + (result.fat_g * 9);
  if(result.calories_kcal > 0 && macroKcal > 0){
    const ratio = macroKcal / result.calories_kcal;
    // If macros account for less than 60% or more than 140% of stated calories, adjust calories
    if(ratio < 0.6 || ratio > 1.4){
      result.calories_kcal = Math.round(macroKcal);
    }
  }

  return result;
}

// ── Indian Food Reference Table (per 100g cooked/prepared) ──────────────
// Source: IFCT 2017 (Indian Food Composition Tables), NIN Hyderabad,
// HealthifyMe verified data, and cross-referenced with USDA SR Legacy.
// All values are for COOKED/PREPARED form, not raw ingredients.
const INDIAN_FOOD_REF_ = {
  // ── Curries & Gravies ──
  "chicken keema":       {calories_kcal:175, protein_g:15, carbs_g:4,  fat_g:11, fiber_g:0.5, micros:{iron_mg:1.5, zinc_mg:2.8, vitamin_b12_ug:0.5, sodium_mg:320, potassium_mg:220, phosphorus_mg:160, selenium_ug:15, niacin_mg:4}},
  "chicken curry":       {calories_kcal:165, protein_g:14, carbs_g:6,  fat_g:10, fiber_g:0.8, micros:{iron_mg:1.3, zinc_mg:2.2, vitamin_b12_ug:0.3, sodium_mg:350, potassium_mg:230, phosphorus_mg:150, niacin_mg:4, vitamin_a_ug:30}},
  "mutton curry":        {calories_kcal:195, protein_g:16, carbs_g:5,  fat_g:13, fiber_g:0.6, micros:{iron_mg:2.5, zinc_mg:4, vitamin_b12_ug:2.5, sodium_mg:340, potassium_mg:250, phosphorus_mg:170}},
  "egg curry":           {calories_kcal:150, protein_g:10, carbs_g:6,  fat_g:10, fiber_g:0.5, micros:{iron_mg:1.5, zinc_mg:1, vitamin_b12_ug:0.8, vitamin_a_ug:140, selenium_ug:15, sodium_mg:350}},
  "fish curry":          {calories_kcal:120, protein_g:14, carbs_g:5,  fat_g:5,  fiber_g:0.5, micros:{iron_mg:1, zinc_mg:0.8, vitamin_b12_ug:2, sodium_mg:400, potassium_mg:280, selenium_ug:25, calcium_mg:40}},
  "paneer curry":        {calories_kcal:200, protein_g:12, carbs_g:7,  fat_g:14, fiber_g:0.6, micros:{calcium_mg:300, phosphorus_mg:180, sodium_mg:300, zinc_mg:1.5, vitamin_a_ug:100, riboflavin_mg:0.2}},
  "paneer bhurji":       {calories_kcal:210, protein_g:13, carbs_g:5,  fat_g:16, fiber_g:0.5, micros:{calcium_mg:280, phosphorus_mg:170, sodium_mg:280, vitamin_a_ug:90}},
  "palak paneer":        {calories_kcal:180, protein_g:11, carbs_g:6,  fat_g:13, fiber_g:1.5, micros:{calcium_mg:320, iron_mg:3, vitamin_a_ug:400, vitamin_c_mg:15, potassium_mg:350, magnesium_mg:50, folate_ug:80}},
  "dal":                 {calories_kcal:100, protein_g:7,  carbs_g:13, fat_g:2.5,fiber_g:3,   micros:{iron_mg:2, potassium_mg:280, magnesium_mg:30, folate_ug:60, phosphorus_mg:120, zinc_mg:1, calcium_mg:25}},
  "dal tadka":           {calories_kcal:115, protein_g:7,  carbs_g:13, fat_g:4,  fiber_g:3,   micros:{iron_mg:2, potassium_mg:280, magnesium_mg:30, folate_ug:60, phosphorus_mg:120, zinc_mg:1, calcium_mg:25}},
  "dal fry":             {calories_kcal:120, protein_g:7,  carbs_g:13, fat_g:4.5,fiber_g:3,   micros:{iron_mg:2, potassium_mg:280, magnesium_mg:30, folate_ug:60, phosphorus_mg:120}},
  "rajma":               {calories_kcal:120, protein_g:8,  carbs_g:16, fat_g:3,  fiber_g:5,   micros:{iron_mg:2.5, potassium_mg:350, magnesium_mg:40, folate_ug:70, phosphorus_mg:130, calcium_mg:35, zinc_mg:1}},
  "chole":               {calories_kcal:130, protein_g:7,  carbs_g:18, fat_g:4,  fiber_g:5,   micros:{iron_mg:2.5, potassium_mg:300, magnesium_mg:35, folate_ug:100, phosphorus_mg:120, zinc_mg:1.2}},
  "chana masala":        {calories_kcal:130, protein_g:7,  carbs_g:18, fat_g:4,  fiber_g:5,   micros:{iron_mg:2.5, potassium_mg:300, magnesium_mg:35, folate_ug:100}},
  "sambhar":             {calories_kcal:65,  protein_g:3.5,carbs_g:8,  fat_g:2,  fiber_g:2,   micros:{iron_mg:1.2, potassium_mg:200, vitamin_c_mg:8, calcium_mg:30, folate_ug:30}},
  "rasam":               {calories_kcal:30,  protein_g:1.5,carbs_g:4,  fat_g:1,  fiber_g:0.5, micros:{iron_mg:0.5, vitamin_c_mg:10, potassium_mg:100}},
  "aloo gobi":           {calories_kcal:90,  protein_g:2.5,carbs_g:10, fat_g:5,  fiber_g:2.5, micros:{vitamin_c_mg:25, potassium_mg:250, iron_mg:0.8, vitamin_b6_mg:0.2, folate_ug:30}},
  "bhindi":              {calories_kcal:80,  protein_g:2,  carbs_g:7,  fat_g:5,  fiber_g:3,   micros:{vitamin_c_mg:12, potassium_mg:200, magnesium_mg:35, folate_ug:45, calcium_mg:60}},
  "baingan bharta":      {calories_kcal:85,  protein_g:2,  carbs_g:8,  fat_g:5,  fiber_g:3,   micros:{potassium_mg:180, iron_mg:0.5, vitamin_c_mg:5, folate_ug:15}},

  // ── Rice dishes ──
  "rice":                {calories_kcal:130, protein_g:2.7,carbs_g:28, fat_g:0.3,fiber_g:0.4, micros:{iron_mg:0.2, magnesium_mg:12, phosphorus_mg:43, potassium_mg:35, selenium_ug:7.5}},
  "biryani":             {calories_kcal:180, protein_g:8,  carbs_g:22, fat_g:7,  fiber_g:1,   micros:{iron_mg:1, zinc_mg:1.2, sodium_mg:400, potassium_mg:150, vitamin_b12_ug:0.3}},
  "chicken biryani":     {calories_kcal:190, protein_g:10, carbs_g:22, fat_g:7,  fiber_g:1,   micros:{iron_mg:1, zinc_mg:1.5, sodium_mg:420, potassium_mg:160, vitamin_b12_ug:0.3, niacin_mg:2.5}},
  "veg biryani":         {calories_kcal:160, protein_g:4,  carbs_g:24, fat_g:5,  fiber_g:2,   micros:{iron_mg:0.8, potassium_mg:140, vitamin_a_ug:30, vitamin_c_mg:5}},
  "khichdi":             {calories_kcal:110, protein_g:5,  carbs_g:17, fat_g:2.5,fiber_g:2,   micros:{iron_mg:1, potassium_mg:150, magnesium_mg:20, phosphorus_mg:80, folate_ug:30}},
  "veg pulao":           {calories_kcal:145, protein_g:3,  carbs_g:22, fat_g:5,  fiber_g:1.5, micros:{iron_mg:0.5, potassium_mg:120, vitamin_a_ug:25}},
  "jeera rice":          {calories_kcal:150, protein_g:3,  carbs_g:26, fat_g:4,  fiber_g:0.5, micros:{iron_mg:1, magnesium_mg:14}},
  "curd rice":           {calories_kcal:120, protein_g:4,  carbs_g:18, fat_g:3.5,fiber_g:0.3, micros:{calcium_mg:80, phosphorus_mg:70, vitamin_b12_ug:0.2}},
  "lemon rice":          {calories_kcal:160, protein_g:3,  carbs_g:25, fat_g:5,  fiber_g:0.5, micros:{iron_mg:0.5, vitamin_c_mg:5}},
  "fried rice":          {calories_kcal:170, protein_g:5,  carbs_g:24, fat_g:6,  fiber_g:1.5, micros:{iron_mg:0.8, sodium_mg:500, potassium_mg:120}},

  // ── Breads ──
  "roti":                {calories_kcal:240, protein_g:8,  carbs_g:45, fat_g:3.5,fiber_g:4,   micros:{iron_mg:2.5, magnesium_mg:35, phosphorus_mg:120, potassium_mg:130, zinc_mg:1, folate_ug:15}},
  "chapati":             {calories_kcal:240, protein_g:8,  carbs_g:45, fat_g:3.5,fiber_g:4,   micros:{iron_mg:2.5, magnesium_mg:35, phosphorus_mg:120}},
  "paratha":             {calories_kcal:300, protein_g:7,  carbs_g:40, fat_g:13, fiber_g:3,   micros:{iron_mg:2, magnesium_mg:30, phosphorus_mg:100, sodium_mg:250}},
  "aloo paratha":        {calories_kcal:280, protein_g:6,  carbs_g:38, fat_g:12, fiber_g:3,   micros:{iron_mg:1.8, potassium_mg:200, vitamin_c_mg:5}},
  "naan":                {calories_kcal:290, protein_g:8.5,carbs_g:48, fat_g:7,  fiber_g:2,   micros:{iron_mg:2, calcium_mg:50, sodium_mg:400, folate_ug:60}},
  "puri":                {calories_kcal:350, protein_g:7,  carbs_g:42, fat_g:17, fiber_g:2,   micros:{iron_mg:2, sodium_mg:300}},
  "dosa":                {calories_kcal:160, protein_g:4,  carbs_g:26, fat_g:4,  fiber_g:1,   micros:{iron_mg:1, calcium_mg:15, potassium_mg:80}},
  "idli":                {calories_kcal:130, protein_g:4,  carbs_g:25, fat_g:1,  fiber_g:1,   micros:{iron_mg:0.8, calcium_mg:10, potassium_mg:60}},
  "poha":                {calories_kcal:130, protein_g:3,  carbs_g:22, fat_g:3.5,fiber_g:1,   micros:{iron_mg:5, potassium_mg:100, vitamin_c_mg:3}},
  "upma":                {calories_kcal:125, protein_g:3.5,carbs_g:18, fat_g:4,  fiber_g:1.5, micros:{iron_mg:1, calcium_mg:15, sodium_mg:250}},

  // ── Snacks & sides ──
  "chicken momo":        {calories_kcal:164, protein_g:7.4,carbs_g:17, fat_g:7.3,fiber_g:1,   micros:{sodium_mg:350, potassium_mg:150, iron_mg:1, calcium_mg:15}},
  "veg momo":            {calories_kcal:140, protein_g:4,  carbs_g:20, fat_g:5,  fiber_g:1.5, micros:{sodium_mg:320, potassium_mg:120, iron_mg:0.8}},
  "samosa":              {calories_kcal:260, protein_g:4,  carbs_g:28, fat_g:15, fiber_g:2,   micros:{sodium_mg:300, potassium_mg:150, iron_mg:1.2}},
  "raita":               {calories_kcal:50,  protein_g:3,  carbs_g:5,  fat_g:2,  fiber_g:0.3, micros:{calcium_mg:100, phosphorus_mg:70, vitamin_b12_ug:0.2}},
  "curd":                {calories_kcal:60,  protein_g:3.5,carbs_g:5,  fat_g:3,  fiber_g:0,   micros:{calcium_mg:120, phosphorus_mg:90, vitamin_b12_ug:0.3, riboflavin_mg:0.15}},
  "yogurt":              {calories_kcal:60,  protein_g:3.5,carbs_g:5,  fat_g:3,  fiber_g:0,   micros:{calcium_mg:120, phosphorus_mg:90, vitamin_b12_ug:0.3}},
  "boiled egg":          {calories_kcal:155, protein_g:13, carbs_g:1.1,fat_g:11, fiber_g:0,   micros:{vitamin_b12_ug:1.1, selenium_ug:30, vitamin_a_ug:160, iron_mg:1.2, zinc_mg:1.1, phosphorus_mg:172, riboflavin_mg:0.5, folate_ug:44, choline_mg:294, vitamin_d_ug:2.2}},
  "egg":                 {calories_kcal:155, protein_g:13, carbs_g:1.1,fat_g:11, fiber_g:0,   micros:{vitamin_b12_ug:1.1, selenium_ug:30, vitamin_a_ug:160, iron_mg:1.2, zinc_mg:1.1, phosphorus_mg:172, choline_mg:294}},
  "paneer":              {calories_kcal:265, protein_g:18, carbs_g:3,  fat_g:21, fiber_g:0,   micros:{calcium_mg:480, phosphorus_mg:280, zinc_mg:2.5, vitamin_a_ug:120, riboflavin_mg:0.3}},
  "tofu":                {calories_kcal:76,  protein_g:8,  carbs_g:1.9,fat_g:4.8,fiber_g:0.3, micros:{calcium_mg:350, iron_mg:5.4, magnesium_mg:30, phosphorus_mg:97, potassium_mg:121, zinc_mg:0.8, manganese_mg:0.6}},

  // ── Common beverages ──
  "milk":                {calories_kcal:60,  protein_g:3.2,carbs_g:5,  fat_g:3,  fiber_g:0,   micros:{calcium_mg:120, phosphorus_mg:93, vitamin_b12_ug:0.4, vitamin_d_ug:1.2, riboflavin_mg:0.18, potassium_mg:150}},
  "buttermilk":          {calories_kcal:35,  protein_g:2.5,carbs_g:4,  fat_g:1,  fiber_g:0,   micros:{calcium_mg:80, phosphorus_mg:60, sodium_mg:200}},
  "lassi":               {calories_kcal:75,  protein_g:3,  carbs_g:12, fat_g:2,  fiber_g:0,   micros:{calcium_mg:100, phosphorus_mg:75}},
  "chai":                {calories_kcal:50,  protein_g:2,  carbs_g:7,  fat_g:1.5,fiber_g:0,   micros:{calcium_mg:60}},
};

// Portion weight estimation is now handled by llmEstimatePortionGrams_() instead of a static lookup.

function lookupIndianFoodRef_(query){
  const q = String(query||"").toLowerCase().trim();
  // Strip portion descriptors for matching
  const cleaned = stripPortionInfo_(q);

  // Try exact match first
  if(INDIAN_FOOD_REF_[cleaned]) return {key: cleaned, ref: INDIAN_FOOD_REF_[cleaned]};

  // Try fuzzy match: find the best matching key
  let bestKey = null, bestScore = 0;
  for(const key of Object.keys(INDIAN_FOOD_REF_)){
    const keyWords = key.split(/\s+/);
    const qWords = cleaned.split(/\s+/);
    // Count how many key words appear in query
    const matches = keyWords.filter(w => qWords.some(qw => qw.includes(w) || w.includes(qw))).length;
    const score = matches / keyWords.length;
    if(score > bestScore && score >= 0.6){
      bestScore = score;
      bestKey = key;
    }
  }

  if(bestKey) return {key: bestKey, ref: INDIAN_FOOD_REF_[bestKey]};
  return null;
}

function stripPortionInfo_(query){
  let q = String(query||"").toLowerCase().trim();
  // Remove parenthetical portion info: "(1 katori)", "(200g)", "(1 bowl)"
  q = q.replace(/\([^)]*\)/g, "").trim();
  // Remove leading count + portion: "1 katori of", "2 cups", "1 bowl"
  q = q.replace(/^\d+\.?\d*\s*(katori|bowl|plate|cup|piece|slice|glass|scoop|serving|pcs?|nos?|g\b|gm\b|gram|ml\b|oz\b|small|medium|large|half)\s*(of\s+)?/i, "").trim();
  // Remove trailing portion: "chicken keema 1 katori"
  q = q.replace(/\s+\d+\.?\d*\s*(katori|bowl|plate|cup|piece|slice|glass|g\b|gm\b|ml\b)$/i, "").trim();
  return q;
}

function extractExplicitGrams_(query){
  // Only extract when user specifies an exact weight (e.g., "200g", "150 gm", "100 ml")
  const q = String(query||"").toLowerCase();
  const gm = q.match(/(\d+\.?\d*)\s*(g\b|gm\b|gram|ml\b)/);
  if(gm) return parseFloat(gm[1]) || null;
  return null;
}

// Ask LLM to estimate portion weight for a described serving.
// This is a fast, focused call — just returns a number.
function llmEstimatePortionGrams_(foodDescription){
  const model = getGroqNutrientModel_();
  const q = String(foodDescription || "").trim();
  if(!q) return 150;

  const sys = [
    "You estimate the weight in grams of a described food portion.",
    "Return ONLY a JSON object: {\"grams\": <number>}",
    "Consider the SPECIFIC food when estimating — a katori of thick keema weighs ~150-180g,",
    "while a katori of thin rasam weighs ~180-200g, a roti weighs ~35-45g, etc.",
    "Common Indian portions:",
    "- katori/bowl: 150-200g depending on food density",
    "- plate of rice: 180-220g, plate of biryani: 200-250g",
    "- roti/chapati: 35-45g each, paratha: 60-80g, naan: 80-100g",
    "- dosa: 80-120g, idli: 35-45g each, momo: 20-25g each, samosa: 50-60g each",
    "- glass of milk/lassi: 200ml",
    "If no portion is mentioned, estimate for 1 standard home-cooked serving."
  ].join("\n");

  const payload = {
    model,
    temperature: 0,
    max_tokens: 50,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: "How many grams is: " + q }
    ]
  };

  const resp = groqRequest_(payload);
  const txt = extractAssistantText_(resp);
  const parsed = parseJson_(txt);
  const g = +(parsed.grams || parsed.weight || parsed.g || 0);
  // Sanity: clamp to reasonable range
  if(isFinite(g) && g >= 5 && g <= 2000) return Math.round(g);
  return 150; // safe default
}

function estimatePortionGrams_(query){
  // If user specifies exact grams, use that directly (no LLM call needed)
  const explicit = extractExplicitGrams_(query);
  if(explicit) return explicit;
  // Otherwise, ask LLM to estimate based on the food + portion description
  try{
    return llmEstimatePortionGrams_(query);
  }catch(_){
    return 150; // safe fallback
  }
}

function scaleRefToServing_(ref, portionG){
  const factor = portionG / 100;
  const out = {
    calories_kcal: Math.round(ref.calories_kcal * factor),
    protein_g: Math.round(ref.protein_g * factor * 10) / 10,
    carbs_g: Math.round(ref.carbs_g * factor * 10) / 10,
    fat_g: Math.round(ref.fat_g * factor * 10) / 10,
    fiber_g: Math.round(ref.fiber_g * factor * 10) / 10,
    micros: {}
  };
  if(ref.micros){
    for(const [k,v] of Object.entries(ref.micros)){
      out.micros[k] = Math.round((+v||0) * factor * 100) / 100;
    }
  }
  return out;
}

function fallbackNutrients_(query){
  // Try Indian food reference table first
  const lookup = lookupIndianFoodRef_(query);
  if(lookup){
    const portionG = estimatePortionGrams_(query);
    if(portionG){
      return scaleRefToServing_(lookup.ref, portionG);
    }
    // Return per-100g if no portion detected
    return JSON.parse(JSON.stringify(lookup.ref));
  }
  return null;
}


function estimateNutrientsCached_(dishKey, query){
  const key = String(dishKey||"").toLowerCase().trim();
  const q = String(query||dishKey||"").trim();

  // Check cache first (but skip stale/partial data)
  const cached = getCachedFoodNutrients_(key);
  if(cached && typeof cached === "object" && Object.keys(cached).length){
    if(!nutrientsLooksPartial_(cached, q)) return cached;
  }

  // --- STEP 1: Indian Food Reference Table (highest accuracy for Indian foods) ---
  const refLookup = lookupIndianFoodRef_(q);
  if(refLookup){
    // If user specifies exact grams (e.g., "200g chicken keema"), use that directly
    const explicitG = extractExplicitGrams_(q);

    if(explicitG){
      // User gave exact weight — just scale ref, then enrich micros only
      const refScaled = scaleRefToServing_(refLookup.ref, explicitG);
      try{
        const enriched = enrichWithLlm_(q, refLookup.ref);
        if(enriched && enriched.nutrients){
          // Override with exact-gram scaling (ignore LLM's portion estimate)
          const result = scaleRefToServing_(refLookup.ref, explicitG);
          // But use LLM's micro estimates (already per-portion from enrichWithLlm_)
          // Re-scale LLM micros from LLM's portionG to our explicitG
          const llmFactor = explicitG / (enriched.portionG || explicitG);
          for(const k of NUTRIENT_MICRO_KEYS_){
            if((result.micros[k] || 0) === 0 && enriched.nutrients.micros[k] > 0){
              result.micros[k] = Math.round(enriched.nutrients.micros[k] * llmFactor * 100) / 100;
            }
          }
          setCachedFoodNutrients_(key, q, {fdcId:"", description:"ref+llm: "+refLookup.key, dataType:"ref+llm"}, result);
          return result;
        }
      }catch(_){}
      setCachedFoodNutrients_(key, q, {fdcId:"", description:"ref: "+refLookup.key, dataType:"ref"}, refScaled);
      return refScaled;
    }

    // No explicit grams — use LLM to estimate portion weight AND fill micros in one call
    try{
      const enriched = enrichWithLlm_(q, refLookup.ref);
      if(enriched && enriched.nutrients){
        setCachedFoodNutrients_(key, q, {fdcId:"", description:"ref+llm: "+refLookup.key+" @"+enriched.portionG+"g", dataType:"ref+llm"}, enriched.nutrients);
        return enriched.nutrients;
      }
    }catch(_){
      // LLM failed; use fallback portion estimation
    }

    // Fallback: use llmEstimatePortionGrams_ separately (or default 150g)
    const portionG = estimatePortionGrams_(q) || 150;
    const refScaled = scaleRefToServing_(refLookup.ref, portionG);
    setCachedFoodNutrients_(key, q, {fdcId:"", description:"ref: "+refLookup.key, dataType:"ref"}, refScaled);
    return refScaled;
  }

  // --- STEP 2: For non-Indian foods, try USDA FDC ---
  // Fast-fail: FDC can't handle multi-item combinations or complex prepared foods. Skip to LLM.
  const looksComposite = /(\+| and | with |&|,|\bmomo\b|\btikka\b|\bsushi\b|\bpizza\b|\bpasta\b|\bburger\b|\broll\b|\bsandwich\b|\bwrap\b|\bthali\b)/i.test(q);

  // ONLY run FDC if it's a simple, single-ingredient/branded food
  if(!looksComposite){
  const isBranded = looksLikeBranded_(q);
  try{
    const best = fdcSearchBest_(q, {preferBranded: isBranded});
    const food = fdcFoodDetails_(best.fdcId);
    const nutrientsPer100g = extractNutrientsFromFdc_(food);

    if(nutrientsLooksEmpty_(nutrientsPer100g, food)){
      throw new Error("FDC returned empty nutrients for: " + q);
    }

    // For Branded foods with serving size data, scale to one serving
    const meta = nutrientsPer100g._meta || {};
    let nutrients = nutrientsPer100g;
    let servingDesc = "";

    if(meta.dataType === "Branded" && meta.servingSize > 0){
      // User specified explicit grams? Use that. Otherwise use label serving size.
      const explicitG = extractExplicitGrams_(q);
      const servingG = explicitG || meta.servingSize;
      nutrients = scaleFdcToServing_(nutrientsPer100g, servingG);
      servingDesc = (meta.brandName ? meta.brandName + " " : "") +
        (meta.householdServingFullText || servingG + (meta.servingSizeUnit || "g"));
    } else if(hasPortionDescriptor_(q)){
      // Non-branded but has portion — use LLM to estimate portion weight
      const explicitG = extractExplicitGrams_(q);
      if(explicitG){
        nutrients = scaleFdcToServing_(nutrientsPer100g, explicitG);
      }
      // else: let LLM handle it in the partial check below
    }

    // Clean up internal metadata before caching
    delete nutrients._meta;

    if(nutrientsLooksPartial_(nutrients, q)){
      try{
        const llm = groqEstimateNutrients_(q, {
          fdcNutrients: nutrientsPer100g,
          useWebSearch: shouldUseWebSearchForEstimate_(q, nutrientsPer100g)
        });
        if(llm && typeof llm === "object"){
          setCachedFoodNutrients_(key, q, {fdcId:best.fdcId, description:best.description + (servingDesc ? " | " + servingDesc : ""), dataType:"llm+fdc"}, llm);
          return llm;
        }
      }catch(_ignoreLlmFillErr){}
    }

    setCachedFoodNutrients_(key, q, {fdcId:best.fdcId, description:best.description + (servingDesc ? " | " + servingDesc : ""), dataType:best.dataType}, nutrients);
    return nutrients;
  }catch(fdcErr){
    // FDC failed - continue to LLM
  }
  } // end if(!looksComposite)

  // --- STEP 3: Full LLM estimation with web search ---
  try{
    const llm = groqEstimateNutrients_(q, {useWebSearch:true});
    if(llm && typeof llm === "object"){
      setCachedFoodNutrients_(key, q, {fdcId:"", description:"LLM estimate", dataType:"llm"}, llm);
      return llm;
    }
  }catch(_ignoreLlmErr){}

  // --- STEP 4: Static fallback ---
  const fb = fallbackNutrients_(q);
  if(fb) return fb;

  throw new Error("Could not estimate nutrients for: " + q);
}

// Enrich reference-table macros with LLM-estimated micros AND portion weight.
// Keeps macros from ref (trusted), only fills in micro gaps.
// Returns {nutrients, portionG} so caller can scale.
function enrichWithLlm_(foodText, refPer100g){
  const model = getGroqNutrientModel_();
  const q = String(foodText || "").trim();

  const existingMicros = refPer100g.micros || {};

  const sys = [
    "You are a nutrition assistant. You will receive per-100g nutrient data for a food.",
    "Your TWO jobs:",
    "1. Estimate the weight in grams of the described portion (estimated_serving_g).",
    "   Consider the specific food density — thick keema ~150-180g per katori, thin rasam ~180-200g.",
    "   Common Indian portions: katori 150-200g, roti 35-45g, paratha 60-80g, naan 80-100g,",
    "   dosa 80-120g, idli 35-45g each, momo 20-25g each, samosa 50-60g each, plate rice 180-220g, bowl dal 150-200g, glass 200ml.",
    "   If no portion is mentioned, use one standard home-cooked serving.",
    "2. Estimate MICRONUTRIENTS that are currently 0/missing for that serving size.",
    "",
    "Return ONLY a JSON object with:",
    "  estimated_serving_g: number,",
    "  micros: { ... all 25 micro keys with values FOR THE DESCRIBED PORTION }",
    "",
    "DO NOT return macros — they will be calculated from the verified per-100g data.",
    "",
    "Micronutrient keys:",
    JSON.stringify(NUTRIENT_MICRO_KEYS_)
  ].join("\n");

  const user = [
    "Food: " + q,
    "",
    "Verified per-100g nutrients:",
    "  calories_kcal: " + refPer100g.calories_kcal,
    "  protein_g: " + refPer100g.protein_g,
    "  carbs_g: " + refPer100g.carbs_g,
    "  fat_g: " + refPer100g.fat_g,
    "  fiber_g: " + refPer100g.fiber_g,
    "",
    "Known micros per 100g (scale these to portion, fill the rest):",
    JSON.stringify(existingMicros)
  ].join("\n");

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
  const parsed = parseJson_(txt);

  // Extract portion weight
  let portionG = +(parsed.estimated_serving_g || parsed.grams || parsed.serving_g || 0);
  if(!isFinite(portionG) || portionG < 5 || portionG > 2000) portionG = 150;
  portionG = Math.round(portionG);

  // Scale macros from ref
  const factor = portionG / 100;
  const result = {
    calories_kcal: Math.round(refPer100g.calories_kcal * factor),
    protein_g: Math.round(refPer100g.protein_g * factor * 10) / 10,
    carbs_g: Math.round(refPer100g.carbs_g * factor * 10) / 10,
    fat_g: Math.round(refPer100g.fat_g * factor * 10) / 10,
    fiber_g: Math.round(refPer100g.fiber_g * factor * 10) / 10,
    micros: {}
  };

  // Scale known ref micros to portion
  for(const k of NUTRIENT_MICRO_KEYS_){
    const refVal = +(existingMicros[k] || 0);
    result.micros[k] = Math.round(refVal * factor * 100) / 100;
  }

  // Fill gaps from LLM (these are already per-portion from the prompt)
  const llmMicros = (parsed && parsed.micros && typeof parsed.micros === "object") ? parsed.micros : {};
  for(const k of NUTRIENT_MICRO_KEYS_){
    if(result.micros[k] === 0 || result.micros[k] === undefined){
      const llmVal = +(llmMicros[k] || 0);
      if(isFinite(llmVal) && llmVal >= 0) result.micros[k] = Math.round(llmVal * 100) / 100;
    }
  }

  return { nutrients: result, portionG };
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
