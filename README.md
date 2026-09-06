# Victoria & Micah — Save the Date

Functional skeleton: `index.html`, `styles.css`, `script.js`, plus
`hero.js` for the opening image. One shared URL for every guest — no
per-guest links or QR codes needed. The backend is a Google Apps Script
Web App bound to a Google Sheet (`apps-script/Code.gs`); wiring it up is
documented in `SETUP.md`.

## What's here

- A full-screen hero with a 3D depth-parallax of the engagement photo,
  rendered on a Three.js quad (`hero.js`). The scene is composited from
  three layers, back to front:
  - `assets/background.png` — the landscape with the couple painted out,
    displaced per-pixel by `assets/backgroundOnlyDepth.png` (a
    background-only depth map, white = near) so the sky and horizon stay
    pinned while the foreground grass drifts.
  - **"You're Invited"** — set in `assets/Aesthetic-Regular.ttf`,
    rendered to a canvas texture at run time and floated in the mid
    ground: it drifts more than the landscape, less than the couple, and
    fades out as you scroll.
  - `assets/Subjects.png` — the couple, cut out on transparency, riding
    on top as one rigid card that translates furthest and fastest so
    they read as the near plane. Because it moves as a card and its
    edges are alpha, the couple never smears — the finished background
    shows through wherever they shift.

  The effect responds to scroll and (on desktop) pointer movement.
  `hero.js` loads web-sized copies (`assets/bg-web.jpg`,
  `assets/bgdepth-web.png`, `assets/subjects-web.png`); if WebGL or the
  Three.js CDN module is unavailable it falls back to a plain cover
  image (see `.hero__stage` in `styles.css`).
- A live arrangement of 150 flowers, generated along three branch lines.
  Flowers fill in as "yes" responses come in and fade out as "no"
  responses come in — see the spec doc for the tally-jar logic.
- A simple form: first name, last name, then a **Yes** or **No** button.
- No identity matching, no login — this is intentionally simple.

**This is a functional skeleton, not the final art.** The flower shapes
and branch layout are placeholders that make the data-driven behavior
work end to end; the polished hand-composed ikebana artwork is its own
design pass, noted as an open item in the spec.

## Connect the backend

See `SETUP.md` for the full ~10-minute walkthrough. In short:

1. Create a Google Sheet, open **Extensions → Apps Script**, and paste
   in `apps-script/Code.gs`.
2. **Deploy → New deployment → Web app**, execute as *Me*, access
   *Anyone*. Authorize it. Copy the Web App URL.
3. Put that URL into `SCRIPT_URL` at the top of `script.js`.
4. Refresh — the arrangement loads the real tally and the form writes
   rows to your sheet. It re-checks the tally every 45s so it stays live.

Until you do that, the page still works: it shows an empty arrangement
and tells you plainly that the backend isn't connected yet.

## Publish it

This repo *is* `victoriamicah.github.io` — once these files are pushed to
the `main` branch, the site is live at:

```
https://victoriamicah.github.io
```

One QR code pointing at that URL is all you need on the printed cards.

## Customize

- **Copy** — edit the tagline in `index.html`'s `<header>`, and the
  yes/no confirmation messages in `script.js`'s `submitResponse`.
- **Colors** — all driven by the CSS variables at the top of
  `styles.css`.
- **Flower counts per branch** — `BRANCH_COUNTS` in `script.js` (must sum
  to `TOTAL_FLOWERS`, 150).
