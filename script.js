// ---------------------------------------------------------------
// Save the date — functional skeleton
//
// Backend: a Google Apps Script Web App bound to a Google Sheet.
// The Apps Script code is in apps-script/Code.gs; deployment steps
// are in SETUP.md. Paste your deployed Web App URL below once it's
// live (it looks like https://script.google.com/macros/s/AKfy.../exec).
// ---------------------------------------------------------------

const SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxuJvTe-Llp3til-OsDMcOiS3sepRMp3BSfdodJufSvq5GJyZoGH7VIE90uuNUuS7dskQ/exec";
const REFRESH_MS = 45000; // re-check the tally periodically

const deadlineEl = document.getElementById("deadline-text");
const form = document.getElementById("rsvp-form");
const firstNameInput = document.getElementById("first-name");
const lastNameInput = document.getElementById("last-name");
const yesBtn = document.getElementById("yes-btn");
const noBtn = document.getElementById("no-btn");
const statusEl = document.getElementById("form-status");

// Fixed RSVP deadline (not computed relative to page-load date).
const RSVP_DEADLINE = { iso: "2026-10-04", label: "October 4th, 2026" };

if (deadlineEl) {
  deadlineEl.textContent = `We'd love to have you celebrate with us. Please kindly reply by ${RSVP_DEADLINE.label}.`;
}

// ---------------------------------------------------------------
// Add to calendar
//
// A save the date: an all-day event, no venue/time confirmed yet. To
// make it a timed event later, give `start`/`end` full ISO datetimes
// and set `allDay: false` (the .ics + Google builders handle both).
// ---------------------------------------------------------------
const EVENT = {
  title: "Victoria & Micah's Wedding",
  allDay: true,
  date: "2027-09-25", // all-day: the day itself
  endDate: "2027-09-26", // all-day: exclusive end (the day after)
  start: null, // timed: e.g. "2027-09-25T16:00:00-07:00"
  end: null, // timed: e.g. "2027-09-25T23:00:00-07:00"
  location: "",
  description:
    "Save the date! Victoria & Micah are getting married. A formal invitation with all the details will follow.",
  url: "https://victoriamicah.github.io",
};

const calGoogleEl = document.getElementById("cal-google");
const calIcsEl = document.getElementById("cal-ics");

function stampUTC(d) {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsEscape(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function buildICS() {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//victoriamicah//save-the-date//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:save-the-date-${EVENT.date.replace(/-/g, "")}@victoriamicah.github.io`,
    `DTSTAMP:${stampUTC(new Date())}`,
  ];

  if (EVENT.allDay) {
    lines.push(`DTSTART;VALUE=DATE:${EVENT.date.replace(/-/g, "")}`);
    lines.push(`DTEND;VALUE=DATE:${EVENT.endDate.replace(/-/g, "")}`);
  } else {
    lines.push(`DTSTART:${stampUTC(new Date(EVENT.start))}`);
    lines.push(`DTEND:${stampUTC(new Date(EVENT.end))}`);
  }

  lines.push(`SUMMARY:${icsEscape(EVENT.title)}`);
  lines.push(`DESCRIPTION:${icsEscape(EVENT.description)}`);
  if (EVENT.location) lines.push(`LOCATION:${icsEscape(EVENT.location)}`);
  if (EVENT.url) lines.push(`URL:${EVENT.url}`);
  lines.push("TRANSP:TRANSPARENT");
  lines.push("END:VEVENT");
  lines.push("END:VCALENDAR");

  // RFC 5545: fold content lines longer than 75 octets (ASCII here).
  const fold = (line) => {
    if (line.length <= 74) return line;
    let out = line.slice(0, 74);
    let rest = line.slice(74);
    while (rest.length > 73) {
      out += "\r\n " + rest.slice(0, 73);
      rest = rest.slice(73);
    }
    return out + "\r\n " + rest;
  };

  return lines.map(fold).join("\r\n");
}

function googleCalHref() {
  const dates = EVENT.allDay
    ? `${EVENT.date.replace(/-/g, "")}/${EVENT.endDate.replace(/-/g, "")}`
    : `${stampUTC(new Date(EVENT.start))}/${stampUTC(new Date(EVENT.end))}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: EVENT.title,
    dates,
    details: EVENT.url
      ? `${EVENT.description}\n\n${EVENT.url}`
      : EVENT.description,
    location: EVENT.location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

if (calGoogleEl) calGoogleEl.href = googleCalHref();
if (calIcsEl) {
  try {
    calIcsEl.href = URL.createObjectURL(
      new Blob([buildICS()], { type: "text/calendar;charset=utf-8" })
    );
  } catch (err) {
    calIcsEl.href =
      "data:text/calendar;charset=utf-8," + encodeURIComponent(buildICS());
  }
}

// ---------------------------------------------------------------
// Post-response panel — replaces the form once someone has replied.
// ---------------------------------------------------------------
const doneEl = document.getElementById("rsvp-done");
const doneCopyEl = document.getElementById("rsvp-done-copy");
const calActionsEl = document.getElementById("calendar-actions");
const redoBtn = document.getElementById("rsvp-redo");

function showDone(response, message) {
  if (!doneEl || !doneCopyEl) {
    setStatus(message, "success");
    return;
  }
  doneCopyEl.textContent = message;
  if (calActionsEl) calActionsEl.hidden = response !== "yes";
  if (form) form.hidden = true;
  if (deadlineEl) deadlineEl.hidden = true;
  doneEl.hidden = false;
  setStatus("", "");
}

function showForm() {
  if (doneEl) doneEl.hidden = true;
  if (deadlineEl) deadlineEl.hidden = false;
  if (form) {
    form.hidden = false;
    form.reset();
  }
  setStatus("", "");
  if (firstNameInput) firstNameInput.focus();
}

if (redoBtn) redoBtn.addEventListener("click", showForm);

let currentYes = 0;
let currentNo = 0;
let loadedOnce = false;

function applyTally(yes, no) {
  currentYes = yes;
  currentNo = no;
}

async function loadTally() {
  if (SCRIPT_URL.includes("PASTE_YOUR")) {
    applyTally(0, 0);
    return;
  }

  try {
    const res = await fetch(SCRIPT_URL);
    const data = await res.json();
    applyTally(data.yes || 0, data.no || 0);
    loadedOnce = true;
  } catch (err) {
    // On the first load, show an honest empty state. On a later refresh,
    // keep whatever is already on screen rather than wiping it.
    if (!loadedOnce) {
      applyTally(0, 0);
    }
  }
}

function setStatus(message, state) {
  statusEl.textContent = message;
  statusEl.dataset.state = state || "";
}

// Remember the last response this browser sent, so an accidental repeat
// submission of the same name + answer is caught before it hits the network.
const LAST_SUBMISSION_KEY = "vm-save-the-date:last";

function readLastSubmission() {
  try {
    return JSON.parse(localStorage.getItem(LAST_SUBMISSION_KEY)) || null;
  } catch (err) {
    return null;
  }
}

function rememberSubmission(firstName, lastName, response) {
  try {
    localStorage.setItem(
      LAST_SUBMISSION_KEY,
      JSON.stringify({
        first: firstName.toLowerCase(),
        last: lastName.toLowerCase(),
        response,
      })
    );
  } catch (err) {
    /* private mode / storage disabled — the server still dedupes */
  }
}

async function submitResponse(response) {
  const firstName = firstNameInput.value.trim();
  const lastName = lastNameInput.value.trim();

  if (!firstName || !lastName) {
    setStatus("Please enter your first and last name.", "error");
    (firstName ? lastNameInput : firstNameInput).focus();
    return;
  }

  if (SCRIPT_URL.includes("PASTE_YOUR")) {
    setStatus(
      "Backend isn't connected yet — paste your Apps Script URL in script.js.",
      "error"
    );
    return;
  }

  const last = readLastSubmission();
  if (
    last &&
    last.first === firstName.toLowerCase() &&
    last.last === lastName.toLowerCase() &&
    last.response === response
  ) {
    showDone(
      response,
      response === "yes"
        ? `Wonderful — you're already on the list, ${firstName}! A formal invitation will follow; add the date to your calendar below. 🌼`
        : `We've already got your reply, ${firstName} — thank you.`
    );
    return;
  }

  yesBtn.disabled = true;
  noBtn.disabled = true;
  setStatus("Sending…", "");

  try {
    const res = await fetch(SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        firstName,
        lastName,
        response,
        deadline: RSVP_DEADLINE.iso,
      }),
    });
    const data = await res.json().catch(() => null);

    if (data && data.ok === false) {
      setStatus("Hmm, that didn't go through. Check your name and try again.", "error");
      return;
    }

    // Prefer the authoritative tally the server just computed; fall back to
    // an optimistic bump only if the response couldn't be read.
    if (data && typeof data.yes === "number") {
      applyTally(data.yes, data.no || 0);
    } else if (response === "yes") {
      applyTally(currentYes + 1, currentNo);
    } else {
      applyTally(currentYes, currentNo + 1);
    }

    rememberSubmission(firstName, lastName, response);

    let message;
    if (data && data.updated && data.prev && data.prev !== response) {
      // Guest changed their mind — acknowledge the direction of the change.
      message =
        response === "yes"
          ? `Omg, so glad you can make it after all, ${firstName}! 🎉 Add the date below.`
          : `We're so sorry to hear you can't make it, ${firstName} — we'll miss you xoxo`;
    } else if (data && data.updated) {
      // Same answer re-submitted from another device — nothing really changed.
      message =
        response === "yes"
          ? `Wonderful — you're already on the list, ${firstName}! A formal invitation will follow; add the date to your calendar below. 🌼`
          : `Got it, ${firstName} — thanks for confirming.`;
    } else if (response === "yes") {
      message = `Wonderful — you're on the list, ${firstName}. A formal invitation will follow; add the date to your calendar below. 🌼`;
    } else {
      message = `Thanks for letting us know, ${firstName}. We'll miss you.`;
    }

    showDone(response, message);
  } catch (err) {
    setStatus("Something went wrong. Please try again.", "error");
  } finally {
    yesBtn.disabled = false;
    noBtn.disabled = false;
  }
}

yesBtn.addEventListener("click", () => submitResponse("yes"));
noBtn.addEventListener("click", () => submitResponse("no"));

loadTally();

// If this browser has already replied, open on the confirmation.
const priorReply = readLastSubmission();
if (priorReply && (priorReply.response === "yes" || priorReply.response === "no")) {
  showDone(
    priorReply.response,
    priorReply.response === "yes"
      ? "You're on the list 🌼 A formal invitation will follow — add the date to your calendar below."
      : "You've let us know you can't make it. Thank you for replying — we'll miss you."
  );
}

// Keep the tally current as other guests respond. Skip a beat if the
// guest is mid-submission, and pause polling while the tab is hidden.
setInterval(() => {
  if (yesBtn.disabled || noBtn.disabled) return;
  if (document.hidden) return;
  if (SCRIPT_URL.includes("PASTE_YOUR")) return;
  loadTally();
}, REFRESH_MS);
