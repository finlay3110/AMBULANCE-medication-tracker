# Drug Bag Tracker

A browser-based tool for ambulance and event-medical companies to produce
medication records as A4 PDFs. It makes two separate documents:

- a **drug bag** label and usage log, and
- a **controlled drugs register** for stock held in the CD safe.

Controlled drugs are never carried in the drug bag, so the two are kept
completely apart: each has its own details, its own list and its own export.
Pick the document type at the top of the setup tab.

Everything runs locally in the browser — no server, no upload, no network calls.
The PDF is built with [jsPDF](https://github.com/parallax/jsPDF), bundled in
`vendor/` so the tool works fully offline.

## Using it

Open `index.html` in a browser (double-click it, or serve the folder with any
static host). There are three tabs:

1. **Setup** — the document type, then company details and the details of the
   bag or safe. A drug bag takes a bag number, who prepped and checked it, the
   prepped date and an optional seal number; a CD safe takes a safe reference,
   its location, the accountable officer and a witness.
2. **Medications** — add each item with its presentation, dose/strength, batch
   number, expiry and quantity. Bag items also carry a legal schedule; on a CD
   register every item is a controlled drug, so there is no schedule to choose.
   Entries can be edited, reordered and removed.
3. **Generate** — download the PDF, or preview it in a new tab.

### Expiry dates

Expiry is typed however it is printed on the pack — `07/25`, `10/2027`,
`Oct 2025` or `18/10/2025` — and the form confirms how it was read before the
entry is accepted. A month-only expiry is treated as in date to the last day of
that month, which is the pharmacy convention.

Because the bag is only as good as its earliest item, the **bag expiry** is
derived as the earliest expiry it contains and printed on the label. Anything
already expired is flagged red, and anything within 90 days amber, both in the
app and on the PDF.

### Controlled drugs

Controlled drugs live in the CD safe rather than in a bag, and are signed out
into a paramedic's personal pouch when needed. The CD document reflects that:

- **Register front sheet** — safe reference and location, accountable officer,
  the stock held with quantities and expiries, a two-person stock check
  signature block, and a storage and handling notice.
- **A register page per drug** — balance brought forward, then columns for date,
  time, PRF number, amount given, amount discarded, running balance, and
  separate administering and witness signatures. Spare rows beyond the stock
  count give discards and part doses a line of their own.
- **A landscape sign-out sheet** — date, time out, drug and strength, quantity,
  who issued it, who is carrying it (name and registration number), time back
  in, quantity returned and who signed it back in.

Because the register is a separate document, controlled drugs cannot be added to
a drug bag at all — `CD` is not offered as a bag schedule.

Both documents are kept in `localStorage` on that device, so part-finished work
survives a page reload and switching document type never disturbs the other one.
Either can be exported to JSON and re-imported later, which is the quickest way
to prep a repeat bag — export it once as a template, then re-import and update
the batch numbers and expiries. An import returns to the document type it was
exported from. Exports are named after the bag or safe number, so bag 1 saves as
`Drug-Bag-1-saved.json` and safe 2 as `CD-Register-2-saved.json`.

A bag saved by an earlier version that contained controlled drugs is migrated on
first load: the CDs are moved out into the register, leaving the bag with the
rest.

## What the PDF contains

### Drug bag PDF

**Page 1 — bag label.** Drug bag number, company, prepped by/date/bag
expiry/seal, then a contents table (item, quantity, presentation, schedule,
batch number, expiry) with the schedule colour-coded and out-of-date items in
red. Below it a prepared-by / checked-by signature block for the two-person
check, then an "if found" notice giving the company's contact details and asking
the finder to hand the bag in to a local police station.

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
| `expiry.js` | Expiry parsing and expired / expiring-soon status |
| `pdf.js` | A4 PDF generation (label page + usage logs) |
| `vendor/jspdf.umd.min.js` | Bundled jsPDF build (MIT, see `vendor/jspdf-LICENSE.txt`) |
