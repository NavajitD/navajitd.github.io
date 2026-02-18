function doPost(e) {
  var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  var payload = e.postData.contents;

  var res = UrlFetchApp.fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
    { method: 'post', contentType: 'application/json', payload: payload, muteHttpExceptions: true }
  );

  return ContentService.createTextOutput(res.getContentText()).setMimeType(ContentService.MimeType.JSON);
}
