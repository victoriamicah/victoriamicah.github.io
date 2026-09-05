# Victoria & Micah — Save the Date

A single-page starter site: `index.html`, `styles.css`, `script.js`. No build step, no framework — just static files.

## Customize the content

Open `index.html` and edit:
- **Date & location** — search for `June 20, 2027` and `Sonoma County, California`, replace both instances (hero + details section).
- **Hero copy** — `hero-kicker`, `hero-line` text.
- **Details section** — the three blocks under `<section class="details">`.

Open `styles.css` if you want to change colors — everything is driven by the CSS variables at the top of the file under `:root`.

## Wire up the form

GitHub Pages only hosts static files, so the "Notify me" form has nowhere to send data until you connect a free form backend:

1. Sign up at [Formspree](https://formspree.io) (or Getform, or use a Google Form instead).
2. Create a form, copy the endpoint URL it gives you.
3. Paste it into `script.js`:
   ```js
   const FORM_ENDPOINT = "https://formspree.io/f/xxxxxxx";
   ```
4. Commit and push — submissions will now land in your Formspree dashboard (or wherever you connect).

Until you set this, the form still validates input and shows a success message, it just doesn't save anywhere.

## Publish it

You already have `victoriamicah.github.io` — this repo *is* that GitHub Pages site, so once these files are pushed to the `main` branch, it's live at:

```
https://victoriamicah.github.io
```

## Point a custom domain at it (optional)

If you buy something like `victoriaandmicah.com`:

1. At your registrar (Namecheap, Porkbun, etc.), add these DNS records:
   - `A` records for `@` pointing to GitHub Pages' IPs:
     ```
     185.199.108.153
     185.199.109.153
     185.199.110.153
     185.199.111.153
     ```
   - `CNAME` record for `www` pointing to `victoriamicah.github.io`
2. In your repo's GitHub Settings → Pages, enter the custom domain and save. This creates a `CNAME` file in your repo automatically.
3. Check "Enforce HTTPS" once it's available (can take a few minutes to an hour).

DNS changes can take anywhere from a few minutes to 24 hours to propagate.
