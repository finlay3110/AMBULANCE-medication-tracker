# Drug Bag Tracker

A browser-based tool for ambulance and event-medical companies to produce a
**drug bag label and medication usage log** as a single A4 PDF.

Everything runs locally in the browser — no server, no upload, no network calls.
The PDF is built with [jsPDF](https://github.com/parallax/jsPDF), bundled in
`vendor/` so the tool works fully offline.

## Using it

Open `index.html` in a browser (double-click it, or serve the folder with any
static host). There are three tabs:

1. **Setup** — company name, contact number and address, drug bag number,
   who prepped the bag, prepped date and an optional seal number.
2. **Medications** — add each medication with its presentation, dose/strength,
   batch number, expiry, number of doses in the bag and its legal schedule.
   Entries can be edited, reordered and removed.
3. **Generate** — download the PDF, or preview it in a new tab.

Entries are kept in `localStorage` on that device, so a part-finished bag
survives a page reload. A bag can also be exported to JSON and re-imported
later, which is the quickest way to prep a repeat bag.

## What the PDF contains

**Page 1 — bag label.** Drug bag number, company, prepped by/date/seal, then a
contents table (item, quantity, presentation, schedule, batch number, expiry)
with the schedule colour-coded. Below it an "if found" notice giving the
company's contact details and asking the finder to hand the bag in to a local
police station.

**One usage log per medication.** A header bar with the medication name, then a
strip showing presentation, dose, batch number and expiry, then one numbered
row per dose with `DATE USED`, `PRF NO` and `SIGNED` columns to sign off in
ink. Medications with more doses than fit on a page are split evenly across
pages rather than leaving a stub.

## Layout

Designed for desktop, with a single-column responsive layout for phones.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and the three tabs |
| `styles.css` | Styling, including the mobile layout |
| `app.js` | Form state, validation, storage, import/export |
| `pdf.js` | A4 PDF generation (label page + usage logs) |
| `vendor/jspdf.umd.min.js` | Bundled jsPDF build (MIT, see `vendor/jspdf-LICENSE.txt`) |
