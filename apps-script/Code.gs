/**
 * Vazhyar Google Sheets sync endpoint.
 * Deploy as a Web App: Execute as ME; access ANYONE (including anonymous)
 * only when your Google account and security policy permit it. The shared
 * SYNC_PIN in Script Properties is a bearer secret: use 32+ random characters.
 */
const VAZHYAR_SHEETS = {
  notes: 'Vazhyar_Notes',
  reviewCards: 'Vazhyar_ReviewCards',
  reviewLogs: 'Vazhyar_ReviewLogs'
};
const VAZHYAR_HEADERS = ['id', 'updatedAt', 'revision', 'payloadJson'];
const VAZHYAR_LOCK_TIMEOUT_MS = 12000;
const VAZHYAR_MAX_BATCH = 20;
const VAZHYAR_MAX_CELL_CHARS = 45000;

function setupVazhyarSheets() {
  // Run once manually from the Apps Script editor while signed in as the owner.
  var spreadsheet = getSpreadsheet_();
  Object.keys(VAZHYAR_SHEETS).forEach(function (entity) {
    var sheet = getSheet_(entity);
    // Keep the internal storage tabs out of the way; do not edit their rows.
    if (!sheet.isSheetHidden()) sheet.hideSheet();
  });
  return 'Ready: ' + spreadsheet.getName();
}

function doGet() {
  return HtmlService.createHtmlOutput(
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Vazhyar Sync</title>' +
    '<body style="font:16px sans-serif;padding:24px">Vazhyar Sync endpoint is online. Use the app to authenticate.</body></html>'
  );
}

function doPost(event) {
  var requestId = '';
  try {
    var raw = event && event.parameter ? event.parameter.payload : '';
    if (!raw || raw.length > 1800000) throw new Error('Invalid or oversized request payload.');
    var request = JSON.parse(raw);
    requestId = String(request.requestId || '');
    if (!requestId || requestId.length > 100) throw new Error('Missing request id.');
    authorize_(request.pin);
    var result = route_(request);
    return bridgeHtml_(requestId, true, result, '');
  } catch (error) {
    return bridgeHtml_(requestId, false, null, safeMessage_(error));
  }
}

function route_(request) {
  switch (request.action) {
    case 'ping':
      return { ok: true, spreadsheet: getSpreadsheet_().getName() };
    case 'merge':
      return mergeRecords_(request.entity, request.records);
    case 'beginPull':
      return beginPull_();
    case 'pullPage':
      return pullPage_(request);
    default:
      throw new Error('Unknown sync action.');
  }
}

function authorize_(candidate) {
  var expected = PropertiesService.getScriptProperties().getProperty('SYNC_PIN') || '';
  if (expected.length < 32 || !constantTimeEquals_(String(candidate || ''), expected)) {
    throw new Error('PIN نامعتبر است یا در تنظیمات Apps Script تعریف نشده است.');
  }
}

function constantTimeEquals_(left, right) {
  var max = Math.max(left.length, right.length);
  var difference = left.length ^ right.length;
  for (var index = 0; index < max; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function getSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID در Script Properties تنظیم نشده است.');
  return SpreadsheetApp.openById(id);
}

function getSheet_(entity) {
  var name = VAZHYAR_SHEETS[entity];
  if (!name) throw new Error('Unknown data collection.');
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, VAZHYAR_HEADERS.length).setValues([VAZHYAR_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function withScriptLock_(callback) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(VAZHYAR_LOCK_TIMEOUT_MS)) {
    throw new Error('سرور مشغول است؛ چند لحظه دیگر دوباره همگام‌سازی کن.');
  }
  try {
    var result = callback();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function getStoredRevision_(forceScan) {
  var properties = PropertiesService.getScriptProperties();
  var stored = Number(properties.getProperty('LAST_REVISION') || 0);
  var maxRevision = isFinite(stored) ? stored : 0;
  // During normal push batches the persisted high-water mark is sufficient;
  // the current entity's max is also checked by mergeRecords_. At the start of
  // each Full Pull we force a complete scan to repair any partially committed
  // Sheet write whose Script Property update was interrupted.
  if (!forceScan && maxRevision > 0) return maxRevision;
  // Script Properties and Spreadsheet writes are not one atomic transaction.
  // On a forced scan (Full Pull watermark), scan all three revision columns
  // while holding ScriptLock so a timeout between setValues() and setProperty()
  // cannot leave the global watermark behind a committed row in another sheet.
  Object.keys(VAZHYAR_SHEETS).forEach(function (entity) {
    var sheet = getSheet_(entity);
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var revisions = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
      revisions.forEach(function (row) {
        var value = Number(row[0]) || 0;
        if (value > maxRevision) maxRevision = value;
      });
    }
  });
  return maxRevision;
}

function parseTime_(value) {
  var time = Date.parse(String(value || ''));
  return isFinite(time) ? time : 0;
}


function dedupeIncomingRecords_(entity, records) {
  var byId = Object.create(null);
  var invalid = [];
  records.forEach(function (incoming) {
    if (!incoming || typeof incoming.id !== 'string' || !incoming.id) {
      invalid.push(incoming); // Keep malformed data so validation rejects it below.
      return;
    }
    var previous = byId[incoming.id];
    if (!previous || (entity !== 'reviewLogs' && parseTime_(incoming.updatedAt) > parseTime_(previous.updatedAt))) {
      byId[incoming.id] = incoming;
    }
  });
  return invalid.concat(Object.keys(byId).map(function (id) { return byId[id]; }));
}

function mergeRecords_(entity, records) {
  if (!VAZHYAR_SHEETS[entity] || !Array.isArray(records)) throw new Error('Invalid merge request.');
  if (records.length > VAZHYAR_MAX_BATCH) throw new Error('Batch is too large.');
  // Defensive dedupe protects the append buffer even if a malformed client
  // accidentally repeats an ID inside one HTTP batch.
  records = dedupeIncomingRecords_(entity, records);

  return withScriptLock_(function () {
    var sheet = getSheet_(entity);
    var lastRow = sheet.getLastRow();
    var values = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 4).getValues() : [];
    var rowById = Object.create(null);
    var stateById = Object.create(null);
    values.forEach(function (row, index) {
      var id = String(row[0]);
      rowById[id] = index + 2;
      stateById[id] = { updatedAt: String(row[1] || ''), payloadJson: String(row[3] || '') };
    });

    var properties = PropertiesService.getScriptProperties();
    var maxRevisionInEntity = values.reduce(function (maximum, row) {
      return Math.max(maximum, Number(row[2]) || 0);
    }, 0);
    // Repair a stale Script Property after a timed-out/partially completed
    // request. The client re-pushes its full local snapshot on the next run.
    var revision = Math.max(getStoredRevision_(), maxRevisionInEntity);
    var inserts = [];
    var updates = [];
    var accepted = 0;

    records.forEach(function (incoming) {
      if (!incoming || typeof incoming.id !== 'string' || !incoming.id || !incoming.payload || typeof incoming.payload !== 'object') {
        throw new Error('هر رکورد همگام‌سازی باید شناسه و payload معتبر داشته باشد.');
      }
      if (String(incoming.payload.id || '') !== incoming.id) throw new Error('شناسه رکورد با payload آن یکسان نیست.');
      var updatedAt = String(incoming.updatedAt || '');
      var incomingTime = parseTime_(updatedAt);
      if (!incomingTime) throw new Error('updatedAt رکورد معتبر نیست.');
      var payloadJson = JSON.stringify(incoming.payload);
      if (payloadJson.length > VAZHYAR_MAX_CELL_CHARS) throw new Error('اندازه یک رکورد از سقف امن Google Sheets بیشتر است؛ از Supabase استفاده کن یا فیلدهای بسیار طولانی را کوتاه کن.');
      var existingRowNumber = rowById[incoming.id];
      var existingState = stateById[incoming.id];
      var shouldWrite = !existingRowNumber;

      if (existingRowNumber) {
        if (entity === 'reviewLogs') {
          // Review logs are immutable events: an idempotent insert is enough.
          shouldWrite = false;
        } else {
          shouldWrite = incomingTime > parseTime_(existingState.updatedAt);
        }
      }

      if (!shouldWrite) return;
      revision += 1;
      var row = [incoming.id, updatedAt, revision, payloadJson];
      if (existingRowNumber) updates.push({ rowNumber: existingRowNumber, values: row });
      else {
        inserts.push(row);
        rowById[incoming.id] = lastRow + inserts.length;
      }
      stateById[incoming.id] = { updatedAt: updatedAt, payloadJson: payloadJson };
      accepted += 1;
    });

    updates.forEach(function (entry) {
      sheet.getRange(entry.rowNumber, 1, 1, 4).setValues([entry.values]);
    });
    if (inserts.length) {
      sheet.getRange(sheet.getLastRow() + 1, 1, inserts.length, 4).setValues(inserts);
    }
    properties.setProperty('LAST_REVISION', String(revision));
    return { accepted: accepted, revision: revision };
  });
}

function safeParse_(raw) {
  try { return JSON.parse(raw); } catch (error) { return null; }
}

function beginPull_() {
  return withScriptLock_(function () {
    var rowCounts = {};
    Object.keys(VAZHYAR_SHEETS).forEach(function (entity) {
      rowCounts[entity] = Math.max(0, getSheet_(entity).getLastRow() - 1);
    });
    var revision = getStoredRevision_(true);
    PropertiesService.getScriptProperties().setProperty('LAST_REVISION', String(revision));
    return { token: String(revision), rowCounts: rowCounts };
  });
}

function pullPage_(request) {
  var entity = String(request.entity || '');
  if (!VAZHYAR_SHEETS[entity]) throw new Error('Unknown data collection.');
  var snapshotRows = Math.max(0, Math.min(1000000, Number(request.snapshotRows) || 0));
  var snapshotRevision = Number(request.snapshotRevision) || 0;
  var offset = Math.max(0, Math.min(snapshotRows, Number(request.offset) || 0));
  var limit = Math.max(1, Math.min(100, Number(request.limit) || 100));

  return withScriptLock_(function () {
    var sheet = getSheet_(entity);
    var remaining = snapshotRows - offset;
    var count = Math.min(limit, remaining);
    var records = [];
    if (count > 0) {
      var rows = sheet.getRange(offset + 2, 1, count, 4).getValues();
      rows.forEach(function (row) {
        var id = String(row[0] || '');
        var updatedAt = String(row[1] || '');
        var revision = Number(row[2]) || 0;
        var payload = safeParse_(String(row[3] || ''));
        if (id && payload && revision <= snapshotRevision) records.push({ id: id, updatedAt: updatedAt, payload: payload });
      });
    }
    var nextOffset = offset + count;
    return {
      records: records,
      nextCursor: nextOffset,
      done: nextOffset >= snapshotRows
    };
  });
}

function bridgeHtml_(requestId, ok, result, error) {
  var message = {
    channel: 'vazhyar-apps-script-sync-v1',
    requestId: requestId,
    ok: Boolean(ok),
    result: result,
    error: error || ''
  };
  var safeMessage = JSON.stringify(message)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
  var html = '<!doctype html><html><head><meta charset="utf-8"></head><body><script>' +
    'parent.postMessage(' + safeMessage + ', "*");' +
    '</script></body></html>';
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
