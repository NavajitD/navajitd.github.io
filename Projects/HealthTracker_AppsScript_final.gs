/**
 * HealthTracker+ Cloud (Google Sheets + Apps Script)
 * - Stores daily snapshots in a Google Sheet (one row per day)
 * - Supports JSONP (GET) for fetch/estimate (avoids CORS from GitHub Pages)
 * - Supports POST (sendBeacon/keepalive) for upsert
 *
 * AUTH:
 * - Client sends a Google ID token as `id_token`
 * - Server validates the token with Google's tokeninfo endpoint and allows ONLY:
 *     navjitdebnath5@gmail.com
 *
 * IMPORTANT:
 * - In Apps Script: Project Settings → Script properties
 *     Set key GOOGLE_CLIENT_ID = your OAuth Client ID used in health.html
 */

const SHEET_NAME = "HealthDB";
const ALLOWED_EMAIL = "navjitdebnath5@gmail.com";
const TOKENINFO_URL = "https://oauth2.googleapis.com/tokeninfo?id_token=";

function doGet(e){
  const p = (e && e.parameter) ? e.parameter : {};
  if(!isAuthorized_(p)) return sendJsonp_(p, {ok:false, error:"Unauthorized"});

  const action = String(p.action || "").toLowerCase();

  try{
    if(action === "fetch"){
      const days = Math.min(Math.max(parseInt(p.days||"120",10)||120, 1), 3650);
      const res = fetchDays_(days);
      return sendJsonp_(p, {ok:true, days:res});
    }

    if(action === "estimate"){
      const dish = String(p.dish || "").trim();
      if(!dish) return sendJsonp_(p, {ok:false, error:"Missing dish"});
      const est = estimateNutrients_(dish);
      return sendJsonp_(p, {ok:true, estimate:est});
    }

    return sendJsonp_(p, {ok:false, error:"Unknown action"});
  }catch(err){
    return sendJsonp_(p, {ok:false, error:String(err)});
  }
}

function doPost(e){
  const p = (e && e.parameter) ? e.parameter : {};
  const body = parseBody_(e);

  // allow id_token in either query or body (sendBeacon uses body)
  const merged = Object.assign({}, p, body);

  if(!isAuthorized_(merged)) return ContentService
    .createTextOutput(JSON.stringify({ok:false, error:"Unauthorized"}))
    .setMimeType(ContentService.MimeType.JSON);

  const action = String(merged.action || "").toLowerCase();

  try{
    if(action === "upsert"){
      const payload = merged.payload;
      if(!payload) return jsonOut_({ok:false, error:"Missing payload"});
      const rows = JSON.parse(payload);
      const count = upsertDays_(rows);
      return jsonOut_({ok:true, upserted:count});
    }
    return jsonOut_({ok:false, error:"Unknown action"});
  }catch(err){
    return jsonOut_({ok:false, error:String(err)});
  }
}

function jsonOut_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody_(e){
  try{
    const raw = e && e.postData ? e.postData.contents : "";
    if(!raw) return {};
    // Support:
    // - application/json
    // - application/x-www-form-urlencoded
    const t = String(e.postData.type||"");
    if(t.indexOf("json") >= 0){
      return JSON.parse(raw);
    }
    // sendBeacon/fetch may arrive as text/plain; try JSON anyway
    const trimmed = String(raw).trim();
    if(trimmed && (trimmed[0]==='{' || trimmed[0]==='[')){
      try{ return JSON.parse(trimmed); }catch(_e){}
    }
    // urlencoded
    const out = {};
    raw.split("&").forEach(kv=>{
      const [k,v] = kv.split("=");
      if(!k) return;
      out[decodeURIComponent(k)] = decodeURIComponent(v||"");
    });
    return out;
  }catch(_){
    return {};
  }
}

function sendJsonp_(p, obj){
  const cb = String(p.prefix || "").trim();
  const payload = JSON.stringify(obj);
  if(!cb) return ContentService.createTextOutput(payload).setMimeType(ContentService.MimeType.JSON);
  return ContentService.createTextOutput(`${cb}(${payload});`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function isAuthorized_(p){
  const token = String(p.id_token || "").trim();
  if(!token) return false;

  try{
    const resp = UrlFetchApp.fetch(TOKENINFO_URL + encodeURIComponent(token), {muteHttpExceptions:true});
    if(resp.getResponseCode() !== 200) return false;

    const info = JSON.parse(resp.getContentText() || "{}");
    const email = String(info.email || "").toLowerCase();
    const verified = String(info.email_verified || "") === "true";
    const aud = String(info.aud || "");

    const expectedAud = String(PropertiesService.getScriptProperties().getProperty("GOOGLE_CLIENT_ID") || "").trim();
    if(expectedAud && aud !== expectedAud) return false;

    return verified && email === ALLOWED_EMAIL;
  }catch(_){
    return false;
  }
}

// ===== Sheet helpers =====
function getSpreadsheet_(){
  const id = String(PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '').trim();
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function getSheet_(){
  const ss = getSpreadsheet_();
  let sh = ss.getSheetByName(SHEET_NAME);
  if(!sh){
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(["date","dayDataJson","updatedAt"]);
  }
  return sh;
}

function fetchDays_(days){
  const sh = getSheet_();
  const last = sh.getLastRow();
  if(last < 2) return [];
  const values = sh.getRange(2,1,last-1,3).getValues(); // date, json, updatedAt
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - days);

  const out = [];
  for(const [date, json, updatedAt] of values){
    if(!date) continue;
    const d = new Date(String(date)+"T00:00:00");
    if(d < cutoff) continue;
    try{
      out.push({date:String(date), dayData: JSON.parse(String(json||"{}")), updatedAt:String(updatedAt||"")});
    }catch(_){
      out.push({date:String(date), dayData: {}, updatedAt:String(updatedAt||"")});
    }
  }
  return out;
}

function upsertDays_(rows){
  if(!Array.isArray(rows)){
    if(rows && typeof rows === 'object') rows = [rows];
    else throw new Error("payload must be an array or object");
  }
  const sh = getSheet_();
  const last = sh.getLastRow();
  const map = {}; // date -> rowNumber
  if(last >= 2){
    const dates = sh.getRange(2,1,last-1,1).getValues().flat();
    dates.forEach((d,i)=>{ if(d) map[String(d)] = i+2; });
  }

  let upserted = 0;
  for(const r of rows){
    if(!r || !r.date) continue;
    const date = String(r.date);
    const json = JSON.stringify(r.dayData || {});
    const updatedAt = String(r.updatedAt || new Date().toISOString());

    const rowNum = map[date];
    if(rowNum){
      sh.getRange(rowNum, 2, 1, 2).setValues([[json, updatedAt]]);
    }else{
      sh.appendRow([date, json, updatedAt]);
      map[date] = sh.getLastRow();
    }
    upserted++;
  }
  return upserted;
}

// ===== LLM estimation =====
// NOTE: Put your Groq API key in Script Properties as GROQ_API_KEY (server-side only).
function estimateNutrients_(dishText){
  const key = PropertiesService.getScriptProperties().getProperty("GROQ_API_KEY");
  if(!key) throw new Error("Missing GROQ_API_KEY in script properties");

  const url = "https://api.groq.com/openai/v1/chat/completions";
  const payload = {
    model: "llama-3.3-70b-versatile",
    temperature: 0.2,
    messages: [
      {role:"system", content:"You are a nutrition assistant. Return ONLY valid JSON with fields: calories (number), protein_g, carbs_g, fat_g, fiber_g (numbers), and micros (object of micronutrients). Use realistic estimates for an average serving if portion unclear."},
      {role:"user", content:`Estimate macros and common micronutrients for: ${dishText}. Include micros keys using snake_case with units in key names where possible (e.g., vitamin_c_mg, iron_mg).`}
    ]
  };

  const res = UrlFetchApp.fetch(url, {
    method:"post",
    contentType:"application/json",
    headers:{Authorization:"Bearer " + key},
    payload: JSON.stringify(payload),
    muteHttpExceptions:true
  });

  if(res.getResponseCode() !== 200){
    throw new Error("Groq API error: " + res.getContentText());
  }

  const data = JSON.parse(res.getContentText() || "{}");
  const txt = (((data.choices||[])[0]||{}).message||{}).content || "";
  return safeJsonParse_(txt);
}

function safeJsonParse_(txt){
  try{
    return JSON.parse(txt);
  }catch(_){
    // try to extract first JSON object
    const m = String(txt).match(/\{[\s\S]*\}/);
    if(!m) throw new Error("Model did not return JSON");
    return JSON.parse(m[0]);
  }
}
