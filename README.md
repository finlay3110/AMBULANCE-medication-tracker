# Drug Bag Tracker

Made by Finlay Russell — <finlay3110@gmail.com>

> **Provided as is, with no warranty.** This tool formats what you type; it does
> not check it. You are responsible for verifying every entry, and every legal
> category, before a document is used. The legal categories it suggests are not
> legal determinations and were not verified against primary legislation.
> See [DISCLAIMER.md](DISCLAIMER.md) in full before using it.

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

1. **Setup** — the document type, an import button to start from a bag or
   register saved earlier, then company details and the details of the
   bag or safe. A drug bag takes a bag number, who prepped and checked it, the
   prepped date and an optional seal number; a CD safe takes a safe reference,
   its location, the accountable officer and a witness.
2. **Medications** — add each item with its presentation, dose/strength, batch
   number, expiry and quantity. Bag items also carry a legal schedule; on a CD
   register every item is a controlled drug, so there is no schedule to choose.
   Entries can be edited, reordered and removed.
3. **Generate** — download the PDF, or preview it in a new tab.

### Company logo

Setup takes an optional PNG or JPEG, drawn at the top of the bag label and the
register front sheet on a white panel sized to the image, so a dark logo still
reads against the coloured masthead. It is scaled down to 480px on its longest
edge before being stored, kept with that document, and included when the
document is exported. An image that will not fit in storage is refused with a
reason, and a logo that cannot be drawn is skipped rather than stopping the PDF.

### Quick add

The medications tab has a search box over a built-in catalogue of common
pre-hospital medicines. Searching matches on name, formulation and strength
together, so "nalox 2mg" or "parac susp" find what you meant. Picking an entry
fills the name, formulation, strength and a suggested legal category, leaving
you the batch, expiry and quantity. Every field stays editable afterwards.

Two escape hatches are always offered: **other strength or formulation** of a
matched medicine, which fills the name and leaves the rest to you, and **not on
the list**, which clears the form for a manual entry. Nothing in the catalogue
is a constraint.

The categories used are `GSL`, `P`, `POM`, `S17` (paramedic exemption, Human
Medicines Regulations 2012 Schedule 17), `S19` (parenteral administration in an
emergency, Schedule 19) and `CD`. **The suggested category is a starting point
to save typing, not a legal determination** — several medicines sit in more than
one category depending on indication, route and pack size, and the list changes
as legislation is amended. Check it against your own policy before a document is
used.

Controlled drugs in the catalogue are offered only on a CD register. Searching
for one on a drug bag says so and points at the other document rather than
letting it be added.

### Company profile

Company details are the same on every bag and every register, so they can be
saved once and reused. **Export company details** on the setup tab writes a small
JSON file — name, contact, address, CQC registration and the logo, and nothing
about any particular bag. **Import company details** loads it into whichever
document you are setting up, leaving the bag or safe details untouched.

Import also accepts a whole exported bag or register and takes just the company
half of it, so details can be lifted out of any old export.

### CQC registration

Not every organisation is registered, so it is a toggle. Tick it and a
registration number is asked for; the number is then printed beside the company
name on the label and the register front sheet. Leave it off and nothing about
CQC appears anywhere. A ticked box with no number blocks generation, rather than
printing a claim with nothing behind it.

### Batches

Each batch is held as its own entry, so a drug held in two batches is added
twice — the **Copy** button on an entry prefills a new one with the name,
presentation, dose and unit, leaving you to type the new batch, expiry and
quantity. Each batch then gets its own log page and, for a controlled drug, its
own running balance, which is what you want: one balance cannot span two
batches. Where a name appears more than once, the page title carries the batch
so the pages can be told apart.

### Expiry dates

Expiry is picked, not typed. Most packs state a month, so the field defaults to
a month picker; switch it to **exact date** for the packs that print a full one.
A month-only expiry is treated as in date to the last day of that month, which
is the pharmacy convention, and the form says so as you pick. Switching between
month and exact date carries the value over rather than clearing it.

Values are stored as `YYYY-MM` or `YYYY-MM-DD`, and the parser still accepts the
older free-text forms (`07/25`, `Oct 2025`, `18/10/2025`) so previously exported
files and hand-edited JSON import correctly. Safari has never supported
`<input type="month">`, so where it is missing the field falls back to a text box
using that same parser.

Because the bag is only as good as its earliest item, the **bag expiry** is
derived as the earliest expiry it contains and printed on the label. Anything
already expired is flagged red, and anything within 90 days amber, both in the
app and on the PDF.

Setting an **in service until** date changes the question from "is this in date
today?" to "will it still be in date when the bag comes back?". Expiry is then
judged against that date, so stock that is perfectly valid now but runs out
mid-deployment is flagged red in the app and printed in a band under the
contents table: *EXPIRES BEFORE 31/03/2027 — 2 ITEMS*. On a CD register the same
field reads "check expiry up to", for planning a review or restock.

### Controlled drugs

Controlled drugs live in the CD safe rather than in a bag, and are signed out
into a paramedic's personal pouch when needed. The CD document reflects that:

- **Register front sheet** — safe reference and location, accountable officer,
  the stock held with quantities and expiries, a two-person stock check
  signature block, and a storage and handling notice.
- **A register page per drug** — balance brought forward, then columns for date,
  time, PRF number, amount given, amount discarded, running balance, and
  separate administering and witness signatures. Spare rows beyond the stock
  count give discards and part doses a line of their own. Every quantity column
  is headed with the drug's own unit (`BALANCE (ampoules)`), so a balance can
  never be read as millilitres when it means ampoules.
- **A stock check record** — a landscape grid with a column per drug, headed
  with its unit and batch, and the quantity issued printed on the first row so a
  counted balance has something to check against. Dated rows take the count, the
  person checking and the witness. Past seven drugs it continues on further
  sheets rather than squeezing the columns.
- **A landscape sign-out sheet** — date, time out, drug and strength, quantity,
  who issued it, who is carrying it (name and registration number), time back
  in, quantity returned and who signed it back in.

Because the register is a separate document, controlled drugs cannot be added to
a drug bag at all — `CD` is not offered as a bag schedule.

Both documents are kept in `localStorage` on that device, so part-finished work
survives a page reload and switching document type never disturbs the other one.
Either can be exported to JSON and re-imported later, which is the quickest way
to prep a repeat bag — export it once as a template, then import it from the
setup tab and update the batch numbers and expiries. An import switches to the
document type the file was exported from, says what it loaded, and refuses a
file that is not one of ours rather than wiping what is open. Importing over a
document with unexported changes asks first. Exports are named after the bag or safe number, so bag 1 saves as
`Drug-Bag-1-saved.json` and safe 2 as `CD-Register-2-saved.json`.

A bag saved by an earlier version that contained controlled drugs is migrated on
first load: the CDs are moved out into the register, leaving the bag with the
rest.

Browser storage is not a backup — clearing site data, or using a private window,
loses it. The generate tab says so until a document has been exported, warns
again once it has changed since that export, and says it plainly before
clearing. Downloading the PDF prompts for the JSON as well, with a button to do
it there and then: the PDF is the printable record but it cannot be read back
in, so the JSON is the only thing that saves retyping the document to produce
the next version.

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

### Page footers

Every page carries the bag or safe, the company, when the PDF was generated, and
"Page 3 of 9". The total is only known once the document is finished, so footers
are stamped in a final pass over every page — which also keeps them correct on
the landscape sheets. On a printed record it makes a missing page obvious, and
tells you which of two printouts is the current one.

## Layout

Designed for desktop, with a single-column responsive layout for phones.

## Dark mode

The interface follows the operating system's light or dark setting by default.
A **Theme** button in the top bar cycles auto → light → dark, and an explicit
choice is remembered and wins over the system setting. It is stored separately
from your documents, so it survives "clear all" and applies to both.

The theme is applied before the first paint, so a chosen dark theme does not
flash light on load. Colours are defined once as tokens, with dark redefining
only the tokens, so a new component picks up both themes by using them.

Screen only — the generated PDF is a printed document and stays light.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Page structure and the three tabs |
| `styles.css` | Styling, including the mobile layout |
| `app.js` | Form state, validation, storage, import/export |
| `expiry.js` | Expiry parsing and expired / expiring-soon status |
| `medicines.js` | Quick-add catalogue and its search |
| `pdf.js` | A4 PDF generation (label page + usage logs) |
| `DISCLAIMER.md` | Disclaimer, legal-category caveats and sources |
| `LICENSE` | MIT licence |
| `docs/build-guide.js` | Builds the user guide PDF from the live app |
| `docs/user-guide.html` | The guide's text and layout |
| `test/smoke.js` | Smoke test: expiry parser, app flow, PDF page counts and margins |
| `vendor/jspdf.umd.min.js` | Bundled jsPDF build (MIT, see `vendor/jspdf-LICENSE.txt`) |

## User guide

A 20-page illustrated guide is generated from the app itself, so its screenshots
are never out of date:

```
npm install
npm run guide          # writes Drug-Bag-Tracker-User-Guide.pdf
```

`docs/build-guide.js` drives the real app in a browser, captures every figure,
generates sample documents, and renders `docs/user-guide.html` to A4. The sample
PDF pages need python3 with `pypdfium2`; without it the guide still builds, minus
those figures. Everything it writes is git-ignored — rebuild it rather than
committing a stale copy.

## Tests

```
npm install     # playwright, for driving a real browser
npm test
```

`test/smoke.js` checks the expiry parser directly against `expiry.js`, then
drives the app in Chromium: adding and rejecting entries, copying a batch,
switching document type without disturbing the other document, export names, the
backup warning, and reload persistence. It also builds both PDFs and reads back
jsPDF's page content streams to assert the page count and that nothing is drawn
below the bottom margin — which is what catches a pagination regression.

## Disclaimer

Read [DISCLAIMER.md](DISCLAIMER.md) in full. In short: this is a document
generator, not a clinical, pharmaceutical or legal reference. It formats what
you type without checking it. The legal categories it offers and pre-fills are
suggestions to save typing, not legal determinations — check them against
current legislation and your own medicines policy. The controlled drugs register
is a convenience format and does not discharge any statutory record-keeping
duty. Browser storage is not a backup.

## Licence

MIT. Copyright © 2026 Finlay Russell. See [LICENSE](LICENSE).

PDF generation uses [jsPDF](https://github.com/parallax/jsPDF), bundled in
`vendor/` under the MIT licence (`vendor/jspdf-LICENSE.txt`).

## Sources

The medication list is a user-supplied list of common pre-hospital medicines;
formulations and strengths follow that file.

The legal category suggestions were informed by the public sources below. None
is a substitute for the legislation itself, and the primary text at
legislation.gov.uk was not reachable from the environment where the catalogue
was compiled, so the categories are **unverified against primary legislation**:

- Journal of Paramedic Practice, *Paramedics and medicines: legal considerations* —
  [article](https://www.paramedicpractice.com/content/features/paramedics-and-medicines-legal-considerations),
  [PDF](https://jrcalc.org.uk/wp-content/uploads/2016/09/JPAR_2016_8_8_408_415.pdf)
- NHS Specialist Pharmacy Service, [*Legal mechanisms to supply and administer medicines to individuals*](https://sps.nhs.uk/articles/legal-mechanisms-to-supply-and-administer-medicines-to-individuals/)
- HCPC, [*Sale, supply and administration*](https://www.hcpc-uk.org/standards/meeting-our-standards/scope-of-practice/medicines-and-prescribing-rights/sale-supply-and-administration/)
- The Human Medicines Regulations 2012,
  [Schedule 17](https://www.legislation.gov.uk/uksi/2012/1916/schedule/17) and
  [Schedule 19](https://www.legislation.gov.uk/uksi/2012/1916/schedule/19)

## Author

Finlay Russell — <finlay3110@gmail.com>
