# Connecting the Save the Date to a real Google Sheet

The page talks to one small backend: a **Google Apps Script Web App**
that reads from and writes to a **Google Sheet** you own. No server, no
hosting bill, no account for guests. One shared link for everyone.

Total time: about 10 minutes.

---

## 1. Create the spreadsheet

1. Go to <https://sheets.new> (signed in as the Google account that
   should own the guest list — probably your shared wedding account).
2. Rename it something like **Victoria & Micah — RSVPs**.
3. Leave it empty. The script creates a tab called `RSVPs` with the
   right headers the first time it runs.

## 2. Add the script

1. In that spreadsheet: **Extensions → Apps Script**. A new tab opens.
2. Delete whatever is in the `Code.gs` file it shows you.
3. Open `apps-script/Code.gs` from this project, copy **all** of it,
   and paste it in.
4. Click the **Save** icon (💾). Name the project `Save the Date` if it
   asks.

## 3. Deploy it as a Web App

1. Top right: **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Fill in:
   - **Description:** `save the date` (anything)
   - **Execute as:** **Me** (your email)
   - **Who has access:** **Anyone**
     *(this means "anyone with the link can call it" — it does not make
     your spreadsheet public; only the script can touch the sheet)*
4. Click **Deploy**.
5. Google asks you to authorize. Click **Authorize access**, pick your
   account, then on the "Google hasn't verified this app" screen click
   **Advanced → Go to Save the Date (unsafe)** — it's your own script,
   this warning is expected — and **Allow**.
6. Copy the **Web app URL**. It looks like:

   ```
   https://script.google.com/macros/s/AKfycb.................../exec
   ```

## 4. Paste the URL into the site

1. Open `script.js`.
2. Replace this line:

   ```js
   const SCRIPT_URL = "PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE";
   ```

   with your real URL:

   ```js
   const SCRIPT_URL = "https://script.google.com/macros/s/AKfycb...../exec";
   ```

3. Save.

## 5. Test it

Open the URL from step 3 directly in a browser tab. You should see:

```json
{"yes":0,"no":0}
```

Now open the site (locally or published), enter a name, click
**Yes, save the date**, and check the spreadsheet — a row should appear
with a timestamp, the name, and `yes`. Refresh the page and the tally
should reflect it. Delete your test rows when you're done (keep row 1,
the header).

---

## Publishing the site

The static files (`index.html`, `styles.css`, `script.js`) can go on any
static host. If this repo is `victoriamicah.github.io`, push to `main`
and it's live at `https://victoriamicah.github.io`. Put one QR code
pointing at that URL on the printed cards.

## If you change `Code.gs` later

Apps Script → **Deploy → Manage deployments** → pencil icon → **Version:
New version** → **Deploy**. The URL stays the same, so you don't need to
touch `script.js` again.

## Notes & limits

- **Changing your mind:** if a guest submits again, the newest row for
  that first + last name wins, so `yes → no` moves them out of the tally.
  `doPost` returns `updated: true` plus `prev` (their old
  answer), so the page can react to the direction of the change — a warm
  "so glad you can make it after all!" for no→yes, a "we'll miss you" for
  yes→no — instead of "you're the Nth to say yes."
- **Accidental repeats:** the browser remembers the last name + answer it
  sent and short-circuits an identical re-submit before it reaches the
  script. A repeat from a different device still just overwrites the
  previous row, so the count stays right either way.
- **"RSVP deadline shown" column:** the site shows every visitor a reply
  date three weeks out from the day they open it (a soft, always-moving
  target). The date a guest saw on their **first** response is written to
  column E; mind-change rows leave it blank, so each guest has exactly
  one deadline on record. The script adds this column automatically the
  next time it runs, even on a sheet created before the column existed.
- **Name matching is exact-ish:** it trims spaces and ignores case, but
  "Mike" and "Michael" count as two people. Fine for a wedding.
- **Quotas:** Apps Script allows ~20,000 URL calls/day on a free
  account. With ~150 guests and a 45-second refresh you are nowhere
  near it.
- **Privacy:** the tally endpoint returns only two numbers, never
  names. The spreadsheet itself stays private to your Google account.
