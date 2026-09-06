/**
 * Victoria & Micah — Save the Date backend
 * -----------------------------------------
 * A Google Apps Script Web App bound to the RSVP Google Sheet.
 *
 *   GET   →  { yes: <number>, no: <number> }        (current tally)
 *   POST  →  body: { firstName, lastName, response: "yes" | "no",
 *                    deadline: "YYYY-MM-DD" }
 *            appends a row, returns { ok, updated, prev, yes, no }
 *            The deadline (the moving "reply by" date the site showed
 *            the guest) is recorded only on that guest's FIRST response.
 *
 * The frontend (script.js) sends the POST as a "simple request"
 * (Content-Type: text/plain) so the browser skips the CORS preflight.
 * It reads the GET response for the tally and refreshes it on a timer.
 *
 * Deployment steps live in SETUP.md.
 */

const SHEET_NAME = 'RSVPs';
const HEADER = ['Timestamp', 'First name', 'Last name', 'Response', 'RSVP deadline shown'];

function getSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  // Make sure the header row is present and current (also upgrades an
  // older sheet that predates the "RSVP deadline shown" column).
  const firstRow = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
  const needsHeader = HEADER.some(function (h, i) { return firstRow[i] !== h; });
  if (needsHeader) {
    sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Turn "YYYY-MM-DD" into a real Date for the sheet, or '' if unparseable. */
function parseDeadline_(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '').trim());
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? '' : d;
}

/**
 * Count yes / no. The last row for a given person wins, so a guest can
 * change their mind (yes → no) and the arrangement follows.
 */
function tally_(sheet) {
  const rows = sheet.getDataRange().getValues().slice(1); // drop header
  const seen = {};
  let yes = 0;
  let no = 0;

  for (let i = rows.length - 1; i >= 0; i--) {
    const first = String(rows[i][1] || '').trim().toLowerCase();
    const last = String(rows[i][2] || '').trim().toLowerCase();
    const resp = String(rows[i][3] || '').trim().toLowerCase();
    if (!first && !last) continue;

    const key = first + '|' + last;
    if (seen[key]) continue;
    seen[key] = true;

    if (resp === 'yes') yes++;
    else if (resp === 'no') no++;
  }

  return { yes: yes, no: no };
}

/** The most recent response already on file for this name, or null. */
function findPrevResponse_(sheet, first, last) {
  const rows = sheet.getDataRange().getValues().slice(1);
  const f = String(first).trim().toLowerCase();
  const l = String(last).trim().toLowerCase();
  for (let i = rows.length - 1; i >= 0; i--) {
    const rf = String(rows[i][1] || '').trim().toLowerCase();
    const rl = String(rows[i][2] || '').trim().toLowerCase();
    if (rf === f && rl === l) {
      return String(rows[i][3] || '').trim().toLowerCase() || null;
    }
  }
  return null;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return json_(tally_(getSheet_()));
  } finally {
    lock.releaseLock();
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const data = JSON.parse(e.postData.contents);
    const first = String(data.firstName || '').trim();
    const last = String(data.lastName || '').trim();
    const resp = String(data.response || '').trim().toLowerCase();

    if (!first || !last || (resp !== 'yes' && resp !== 'no')) {
      return json_({ ok: false, error: 'invalid' });
    }

    const sheet = getSheet_();
    const prev = findPrevResponse_(sheet, first, last);
    const isFirst = prev === null;

    // Only the guest's first-ever response carries the deadline they were
    // shown; later rows (mind-changes) leave that column blank.
    sheet.appendRow([
      new Date(),
      first,
      last,
      resp,
      isFirst ? parseDeadline_(data.deadline) : '',
    ]);

    return json_(Object.assign(
      { ok: true, updated: !isFirst, prev: prev },
      tally_(sheet)
    ));
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}
