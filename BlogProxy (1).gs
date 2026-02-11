// ═══════════════════════════════════════════════════════════════
// Blog Proxy — Google Apps Script
// ═══════════════════════════════════════════════════════════════
// Deploy: Extensions → Apps Script → Deploy → Web App
//   Execute as: Me
//   Who has access: Anyone
//
// This script proxies Google Drive read operations so the client
// never needs an API key. The Drive folder must be readable by
// the script owner (your Google account).
// ═══════════════════════════════════════════════════════════════

const BLOG_FOLDER_ID = '1UZwqp0LAdRl2v6c0-M4z7jvspVXsZXEo';

// ─── CORS-safe JSONP response ───────────────────────────────
function jsonpResponse(data, prefix) {
  const json = JSON.stringify(data);
  const callback = prefix || 'callback';
  return ContentService
    .createTextOutput(callback + '(' + json + ')')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

// ─── Entry point (GET) ──────────────────────────────────────
function doGet(e) {
  const action = (e.parameter.action || '').trim();
  const prefix = e.parameter.prefix || 'callback';

  try {
    if (action === 'list') {
      return jsonpResponse(handleList(), prefix);
    }
    if (action === 'post') {
      const fileId = (e.parameter.id || '').trim();
      if (!fileId) throw new Error('Missing id parameter');
      return jsonpResponse(handlePost(fileId), prefix);
    }
    if (action === 'excerpt') {
      const fileId = (e.parameter.id || '').trim();
      if (!fileId) throw new Error('Missing id parameter');
      return jsonpResponse(handleExcerpt(fileId), prefix);
    }
    throw new Error('Unknown action: ' + action);
  } catch (err) {
    return jsonpResponse({ ok: false, error: String(err) }, prefix);
  }
}

// ─── List all blog posts (newest first) ─────────────────────
function handleList() {
  const folder = DriveApp.getFolderById(BLOG_FOLDER_ID);
  const files = folder.getFilesByType(MimeType.GOOGLE_DOCS);
  const posts = [];

  while (files.hasNext()) {
    const file = files.next();
    posts.push({
      id: file.getId(),
      title: file.getName().replace(/\.(gdoc|docx?|txt|md)$/i, '').trim(),
      createdTime: file.getDateCreated().toISOString(),
      modifiedTime: file.getLastUpdated().toISOString()
    });
  }

  // Sort newest first by last-modified date
  posts.sort(function(a, b) {
    return new Date(b.modifiedTime) - new Date(a.modifiedTime);
  });

  return { ok: true, posts: posts };
}

// ─── Get full post HTML ─────────────────────────────────────
function handlePost(fileId) {
  // Verify file is in our blog folder (security check)
  var file = DriveApp.getFileById(fileId);
  var parents = file.getParents();
  var inFolder = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === BLOG_FOLDER_ID) {
      inFolder = true;
      break;
    }
  }
  if (!inFolder) throw new Error('File not in blog folder');

  var doc = DocumentApp.openById(fileId);
  var html = convertDocToHtml_(fileId);

  return {
    ok: true,
    id: fileId,
    title: file.getName().replace(/\.(gdoc|docx?|txt|md)$/i, '').trim(),
    createdTime: file.getDateCreated().toISOString(),
    modifiedTime: file.getLastUpdated().toISOString(),
    html: html
  };
}

// ─── Get plain-text excerpt ─────────────────────────────────
function handleExcerpt(fileId) {
  var file = DriveApp.getFileById(fileId);
  var doc = DocumentApp.openById(fileId);
  var body = doc.getBody();
  var text = body.getText() || '';
  var excerpt = text.replace(/\s+/g, ' ').trim().substring(0, 250);
  var wordCount = text.split(/\s+/).filter(function(w) { return w.length > 0; }).length;
  var readMins = Math.max(1, Math.round(wordCount / 200));

  return {
    ok: true,
    id: fileId,
    excerpt: excerpt,
    readTime: readMins + ' min read',
    wordCount: wordCount
  };
}

// ─── Convert Google Doc to clean HTML via export ────────────
function convertDocToHtml_(fileId) {
  var url = 'https://docs.google.com/document/d/' + fileId + '/export?format=html';
  var response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });

  if (response.getResponseCode() !== 200) {
    throw new Error('Failed to export doc as HTML: ' + response.getResponseCode());
  }

  return response.getContentText();
}
