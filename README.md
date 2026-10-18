# Francosound Invoicer

Track freelance audio gigs and prepare Housecall Pro invoices. Plain HTML/CSS/JS PWA, no build step.
Data lives on each device (IndexedDB). Move it between iPhone and PC with the backup zip.

## Run locally

```bash
python3 -m http.server 8765
```

Open http://localhost:8765. Run the pay-engine tests with `node --test tests/pay.test.mjs`.

## Host it (needed to install on iPhone, which requires HTTPS)

- **Netlify:** go to app.netlify.com/drop and drag this folder onto the page.
- **GitHub Pages:** push this folder to a repo, then Settings → Pages → Deploy from branch → `main` / root.

After each deploy, bump `VERSION` in `sw.js` so installed copies pick up the update.

## Install

- **iPhone:** open the URL in Safari → Share → Add to Home Screen. Open it from the home screen icon from then on.
  Installed apps are protected from Safari's 7-day data clearing.
- **PC:** open the URL in Chrome → install icon in the address bar.

## Moving data between devices

1. On the device with the new work: Settings → **Back up now** (on iPhone: Save to Files, or AirDrop to the PC).
2. On the other device: Settings → **Restore from backup** → **Merge into this device**.

Merge keeps the newest version of each client and event, combines days, photos and files from both sides,
and applies deletions from both sides. **Replace** wipes the device first and restores the backup exactly.
Back up regularly; the home screen reminds you after 7 days.

## Pay rules

- Hourly = day rate ÷ OT-after hours
- Hours worked = clock-out − clock-in − lunch (clock-out earlier than clock-in = past midnight)
- First OT-after hours: flat day rate (also the minimum)
- OT-after → DT-after: 1.5× hourly. Past DT-after: 2× hourly. No DT-after: all extra hours are OT.
- Each line is rounded to the cent. Days without both times aren't counted or invoiced.

## Files

- `js/pay.js`: pay math and Housecall Pro / Claude text (pure, tested)
- `js/db.js`: IndexedDB storage
- `js/exports.js`: PDF summary, backup zip, restore and merge
- `js/app.js`: screens and interactions
- `sw.js`, `manifest.webmanifest`, `icons/`: offline and install support
