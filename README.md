# Francosound Invoicer

Track freelance audio gigs and prepare Housecall Pro invoices. Plain HTML/CSS/JS PWA, no build step.
Built for iPhone. Data lives on the phone (IndexedDB); keep a backup zip in Files or iCloud Drive.

## Run locally

```bash
python3 -m http.server 8765
```

Open http://localhost:8765. Run the pay-engine tests with `node --test tests/pay.test.mjs`.

## Hosting

Hosted on GitHub Pages. To update: bump `VERSION` in `sw.js`, then on github.com use
Add file → Upload files, drag in the changed files and commit. The app updates the next time it's opened.

## Install

iPhone: open the site in Safari → Share → Add to Home Screen. Always open it from the home screen icon.

## Backup

Settings → Back up now saves one zip with everything. Settings → Restore from backup brings it back
(Merge adds to what's on the phone; Replace wipes the phone first).

## Pay rules

- Hourly = day rate ÷ OT-after hours
- Hours worked = clock-out − clock-in − lunch. Lunch is only subtracted when you enter it (new days start at None).
  Clock-out earlier than clock-in means past midnight.
- First OT-after hours: flat day rate (also the minimum)
- OT-after → DT-after: 1.5× hourly. Past DT-after: 2× hourly. No DT-after: all extra hours are OT.
- Each line is rounded to the cent. Days without both times aren't counted or invoiced.

## Files

- `js/pay.js`: pay math and Housecall Pro / Claude text (pure, tested with `node --test tests/pay.test.mjs`)
- `js/db.js`: on-device storage
- `js/exports.js`: PDF summary, backup zip, restore
- `js/app.js`: screens and interactions
- `sw.js`, `manifest.webmanifest`, `icons/`: offline and install support
