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
  - A giant **"&"** — the ampersand from the title, set MASSIVE in
    Bradford LL and floated in the mid ground behind the couple.
    Parallax-drifts and grows with the crane, fades near the end.
  - `assets/Subjects.png` — the couple, cut out on transparency, riding
    on top as one rigid card that translates furthest and fastest so
    they read as the near plane. Because it moves as a card and its
    edges are alpha, the couple never smears — the finished background
    shows through wherever they shift.

  The effect responds to scroll and pointer/finger movement, with a
  progressive depth-of-field blur (separable Gaussian, not a single
  bokeh-style pass — see the comments in `hero.js` if you're tuning it)
  that holds the hero as a frosted backdrop once the crane-in finishes.
  `hero.js` loads web-sized copies (`assets/bg-web.jpg`,
  `assets/bgdepth-web.png`); if WebGL or the Three.js CDN module is
  unavailable it falls back to a plain cover image (see `.hero__stage`
  in `styles.css`).
- A simple form: first name, last name, then a **Yes** or **No** button.
  The current yes/no tally is fetched from the backend and kept in sync
  as other guests respond, but isn't shown as a visual count anywhere on
  the page — it's just used for the optimistic UI update after a reply.
- No identity matching, no login — this is intentionally simple.

## Connect the backend

See `SETUP.md` for the full ~10-minute walkthrough. In short:

1. Create a Google Sheet, open **Extensions → Apps Script**, and paste
   in `apps-script/Code.gs`.
2. **Deploy → New deployment → Web app**, execute as *Me*, access
   *Anyone*. Authorize it. Copy the Web App URL.
3. Put that URL into `SCRIPT_URL` at the top of `script.js`.
4. Refresh — the form writes rows to your sheet, and re-checks the tally
   every 45s.

Until you do that, the page still works: the form tells you plainly that
the backend isn't connected yet.

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
