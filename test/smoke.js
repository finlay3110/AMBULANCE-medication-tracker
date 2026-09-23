/*
 * Smoke test: run with `node test/smoke.js` (needs playwright installed).
 *
 * Serves the project over HTTP, drives the app in a real browser, and checks
 * both the app behaviour and the geometry of the PDFs it produces. The page
 * count and margin checks are what catch a pagination regression; the expiry
 * table is checked directly against expiry.js with no browser involved.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");

/* A 240x80 PNG, written to a temp file so the logo picker has something real. */
const TEST_LOGO_PNG = "iVBORw0KGgoAAAANSUhEUgAAAPAAAABQCAIAAACoK28rAAAAzUlEQVR42u3UwQnAIBBFQZXcTEWmJC3H" +
  "ltJRCrABBW+BZKaBhc9jY64lwFckEyBoEDQIGgSNoEHQIGgQNAgaQYOgQdAgaBA0ggZBg6BB0LBymGDf" +
  "0++3Tp/tsr8PjaBB0CBoEDQIGkGDoEHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoE" +
  "DYJG0CBoEDQIGgSNoEHQIGgQNAiaf4m5FivgQ4OgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYKG" +
  "qQFVpwUBmo9fcgAAAABJRU5ErkJggg==";
const PORT = 8731;
const MM = 72 / 25.4;           // millimetres to PDF points
const BOTTOM_LIMIT_MM = 6;      // nothing may be drawn below this from the page foot

let failures = 0;
const failed = [];
function check(name, ok, detail) {
  if (ok) { console.log("  ok   " + name); return; }
  failures += 1;
  failed.push(name);
  console.log("  FAIL " + name + (detail ? "  — " + detail : ""));
}
function eq(name, actual, expected) {
  check(name, actual === expected, "expected " + JSON.stringify(expected) +
    ", got " + JSON.stringify(actual));
}

/* ---------------- expiry parser, straight against the module ------------- */
function testExpiry() {
  console.log("\nexpiry parsing");
  const sandbox = {};
  new Function("window", fs.readFileSync(path.join(ROOT, "expiry.js"), "utf8"))(sandbox);
  const E = sandbox.Expiry;

  [["07/25", "07/2025"], ["2027-10", "10/2027"], ["2025-10-18", "18/10/2025"],
   ["18/10/2025", "18/10/2025"], ["18/10/25", "18/10/2025"], ["10/2025", "10/2025"],
   ["Jul 2025", "07/2025"], ["October 25", "10/2025"], ["18 Oct 2025", "18/10/2025"],
   ["202510", "10/2025"], ["29/02/2024", "29/02/2024"]
  ].forEach(([input, want]) => eq("parses " + input, E.format(E.parse(input)), want));

  ["", "banana", "13/25", "31/02/2025", "2025-13", "//"].forEach(bad =>
    check("rejects " + JSON.stringify(bad), E.parse(bad) === null));

  // A month-only expiry stays in date to the last day of that month.
  const july = E.parse("07/2025");
  eq("month expiry runs to month end", E.effective(july).getDate(), 31);
  eq("in date on the last day of the month", E.status(july, new Date(2025, 6, 31)), "soon");
  eq("expired the next day", E.status(july, new Date(2025, 7, 1)), "expired");
  eq("flags the 90 day window", E.status(july, new Date(2025, 5, 1)), "soon");
  eq("quiet when far off", E.status(E.parse("12/2030"), new Date(2025, 5, 1)), "ok");
  // Judged against a service window rather than today.
  const until = "2027-03-01";
  eq("in date now but not when the bag returns",
    E.serviceStatus(E.parse("01/2027"), until), "in-service");
  eq("lasts beyond the window", E.serviceStatus(E.parse("06/2027"), until), "ok");
  eq("already expired stays expired",
    E.serviceStatus(E.parse("01/2020"), until), "expired");
  eq("no window falls back to today", E.serviceStatus(E.parse("01/2027"), ""), "ok");
  eq("lists what runs out in service",
    E.expiringInService([{ expiry: "01/2027" }, { expiry: "06/2027" }], until).length, 1);
  eq("and nothing without a window",
    E.expiringInService([{ expiry: "01/2027" }], "").length, 0);

  eq("earliest wins", E.format(E.earliest([
    { expiry: "12/2027" }, { expiry: "01/2026" }, { expiry: "06/2026" }
  ]).parsed), "01/2026");
}

/* ---------------- the quick-add catalogue ------------------------------- */
function testCatalogue() {
  console.log("\ncatalogue");
  const sandbox = {};
  new Function("window", fs.readFileSync(path.join(ROOT, "medicines.js"), "utf8"))(sandbox);
  const M = sandbox.Medicines;

  const raw = fs.readFileSync(path.join(ROOT, "medicines.js"), "utf8");
  check("carries no trust or service names", !/\bLAS\b/.test(raw));

  check("every entry is complete", M.CATALOGUE.every(m =>
    m.name && m.form && m.strength && m.schedule));
  check("categories are ones the form offers", M.CATALOGUE.every(m =>
    ["GSL", "P", "POM", "S17", "S19", "CD"].indexOf(m.schedule) >= 0));
  check("controlled drugs are marked as such", M.CATALOGUE.every(m =>
    (m.schedule === "CD") === !!m.cd));

  eq("searches by name", M.search("adenosine", {}).length, 1);
  eq("matches across fields", M.search("naloxone 2mg", {}).length, 2);
  eq("matches an abbreviated word", M.search("parac susp", {}).length, 2);
  eq("finds nothing for nonsense", M.search("zzzz", {}).length, 0);

  eq("a drug bag is offered no controlled drugs",
    M.search("morphine", { cd: false }).length, 0);
  check("but the register is", M.search("morphine", { cd: true }).length > 0);
  check("and they can be pointed at", M.matchingControlled("midazolam").length > 0);

  eq("distinct names for the other-strength option",
    M.matchingNames("paracetamol", { cd: false }).filter(m =>
      m.name === "Paracetamol suspension").length, 1);
}

/* ---------------- PDF geometry, read out of the content stream ----------- */
/*
 * jsPDF writes each page as a content stream we can read back before saving.
 * Rectangles are absolute ("x y w h re", y being the bottom edge), but text is
 * positioned inside a BT/ET block where Tm sets the position and each Td is
 * relative to the previous line — so the offsets have to be accumulated rather
 * than read as coordinates. The smallest resulting y is how close to the paper
 * edge the page got, in points from the bottom.
 */
function lowestInk(pageLines) {
  const content = pageLines.join("\n");
  const op = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re|(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) Tm|(-?[\d.]+) (-?[\d.]+) Td|\bBT\b/g;
  let lowest = Infinity;
  let cursor = null;   // text position inside the current BT/ET block
  let m;
  while ((m = op.exec(content))) {
    if (m[0] === "BT") { cursor = { y: 0 }; continue; }
    if (m[1] !== undefined) {                       // rectangle
      lowest = Math.min(lowest, parseFloat(m[2]));
    } else if (m[5] !== undefined) {                // text matrix, absolute
      cursor = { y: parseFloat(m[10]) };
      lowest = Math.min(lowest, cursor.y);
    } else if (m[11] !== undefined) {               // text displacement, relative
      cursor = cursor || { y: 0 };
      cursor.y += parseFloat(m[12]);
      lowest = Math.min(lowest, cursor.y);
    }
  }
  return lowest;
}

async function build(page, spec) {
  return page.evaluate(([data, want]) => {
    const doc = window.DrugBagPDF.build(data);
    const pages = doc.internal.pages;
    return {
      count: doc.internal.getNumberOfPages(),
      // pages[0] is unused padding in jsPDF's page array
      streams: pages.slice(1).map(p => (Array.isArray(p) ? p : [String(p)]))
    };
  }, [spec, null]);
}

function med(over) {
  return Object.assign({
    name: "Paracetamol", presentation: "Tablet", dose: "500mg",
    batch: "B1", expiry: "10/2027", doses: 6, schedule: "GSL", unit: ""
  }, over);
}
function bagDoc(meds) {
  return {
    mode: "bag", companyName: "Test Medical Ltd", companyPhone: "01234 567890",
    companyAddress: "Unit 4, Example Way", bagNumber: "1", preppedBy: "F. Smith",
    checkedBy: "J. Doe", preppedDate: "2026-09-07", sealNumber: "S1", medications: meds
  };
}
function cdDoc(meds) {
  return Object.assign(bagDoc(meds), { mode: "cd", safeLocation: "Secure room, Station 4" });
}

async function testPdfs(page) {
  console.log("\npdf geometry");

  const cases = [
    ["bag, one medication", bagDoc([med()]), 2],
    ["bag, log spilling to a second page", bagDoc([med({ doses: 40 })]), 3],
    ["bag, the 200 dose cap", bagDoc([med({ doses: 200 })]), 9],
    ["bag, many items spilling the label", bagDoc(
      Array.from({ length: 18 }, (_, i) => med({ name: "Medication number " + i, doses: 2 }))), 19],
    ["cd, one drug", cdDoc([med({ name: "Morphine sulfate", unit: "ampoules", doses: 10 })]), 4],
    ["cd, stock check splits past seven drugs", cdDoc(
      Array.from({ length: 9 }, (_, i) =>
        med({ name: "CD number " + i, unit: "ampoules", doses: 3 }))), 13]
  ];

  for (const [name, spec, expectedPages] of cases) {
    const out = await build(page, spec);
    eq(name + " — page count", out.count, expectedPages);

    const firstPage = out.streams[0].join("\n");
    const lastPage = out.streams[out.streams.length - 1].join("\n");
    check(name + " — footers count the whole document",
      firstPage.includes("Page 1 of " + expectedPages) &&
      lastPage.includes("Page " + expectedPages + " of " + expectedPages));
    check(name + " — footers are dated", firstPage.includes("Generated "));

    let worst = Infinity, worstPage = 0;
    out.streams.forEach((lines, i) => {
      const low = lowestInk(lines);
      if (low < worst) { worst = low; worstPage = i + 1; }
    });
    check(name + " — stays inside the bottom margin",
      worst >= BOTTOM_LIMIT_MM * MM,
      "lowest ink " + worst.toFixed(1) + "pt on page " + worstPage +
      " (limit " + (BOTTOM_LIMIT_MM * MM).toFixed(1) + "pt)");
  }
}

/* Drive the expiry picker: "YYYY-MM" uses the month control, a full date the
   date control. */
async function setExpiry(page, value) {
  const parsed = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
  if (parsed && parsed[3]) {
    await page.selectOption("#mExpiryPrecision", "day");
    await page.fill("#mExpiryDate", value);
    return;
  }
  const month = parsed ? value.slice(0, 7) : monthFrom(value);
  await page.selectOption("#mExpiryPrecision", "month");
  await page.fill("#mExpiryMonth", month);
}

/* "10/2027" and "07/25" as typed on a pack, to the picker's YYYY-MM. */
function monthFrom(value) {
  const m = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(value);
  if (!m) throw new Error("test helper cannot express expiry: " + value);
  const year = m[2].length === 2 ? "20" + m[2] : m[2];
  return year + "-" + m[1].padStart(2, "0");
}

/* A json file that is valid but none of ours. */
function junkPath() {
  const p = path.join(os.tmpdir(), "smoke-junk.json");
  fs.writeFileSync(p, JSON.stringify({ hello: "world" }));
  return p;
}

/* ---------------- the drug matrix --------------------------------------- */
async function testMatrix(page) {
  console.log("\nthe drug matrix");
  const errors = [];
  // testApp ran on this page and left its own handlers; two accepting the same
  // dialog is an error, so take the page over cleanly.
  page.removeAllListeners("dialog");
  page.removeAllListeners("pageerror");
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => errors.push(e.message));

  await page.evaluate(() => localStorage.clear());
  await page.goto("http://localhost:" + PORT + "/matrix.html");

  // Grades start from a default list, and are all editable.
  check("the matrix has its own generator",
    await page.locator("#gradesCard").isVisible());
  eq("with a starting list", await page.locator("#gradeList .grade").count(), 11);
  eq("in the order given", await page.locator(".grade-name input").first().inputValue(),
    "First responder");
  eq("and the last is the most senior",
    await page.locator(".grade-name input").last().inputValue(), "Doctor");

  // The formulary records what may be given, not what is held.
  await page.fill("#companyName", "Test Medical Ltd");
  await page.fill("#companyPhone", "01234 567890");
  await page.fill("#bagNumber", "2026-v1");
  await page.fill("#preppedBy", "Dr A. Shah");
  await page.click('[data-tab="meds"]');
  check("an indication is asked for", await page.isVisible("#f-mIndication"));
  check("expiry is not", await page.locator("#f-mExpiry").isHidden());
  check("nor batch", await page.locator("#f-mBatch").isHidden());
  check("nor quantity", await page.locator("#f-mDoses").isHidden());

  await page.fill("#mName", "Adenosine");
  await page.fill("#mPresentation", "Ampoule");
  await page.fill("#mDose", "3mg/1ml");
  await page.click("#medSubmit");
  check("an entry without an indication is refused", await page.isVisible("#medError"));
  await page.fill("#mIndication", "Conversion of paroxysmal SVT");
  await page.click("#medSubmit");
  eq("and accepted with one", await page.textContent("#medCount"), "1");

  await page.fill("#mName", "Oxygen");
  await page.fill("#mIndication", "Hypoxaemia\nCardiac arrest");
  await page.fill("#mPresentation", "Gas");
  await page.fill("#mDose", "N/A");
  await page.click("#medSubmit");

  const cells = () => page.locator(".m-cell");
  eq("the matrix is two rows of eleven", await cells().count(), 22);
  eq("and starts with nothing allowed",
    await page.locator(".m-cell.yes").count(), 0);

  // A single cell.
  await page.locator("#matrixTable tr:nth-child(2) .m-cell").nth(3).click();
  eq("a click allows one cell", await page.locator(".m-cell.yes").count(), 1);
  await page.locator("#matrixTable tr:nth-child(2) .m-cell").nth(3).click();
  eq("and clicking again clears it", await page.locator(".m-cell.yes").count(), 0);

  // A whole row, from its name.
  await page.locator("#matrixTable tr:nth-child(3) .m-row").click();
  eq("the name fills the row", await page.locator(".m-cell.yes").count(), 11);
  await page.locator("#matrixTable tr:nth-child(3) .m-row").click();
  eq("and clears it again", await page.locator(".m-cell.yes").count(), 0);

  // A whole column, from its heading.
  await page.locator(".m-head").last().click();
  eq("a heading fills the column", await page.locator(".m-cell.yes").count(), 2);
  await page.locator(".m-head").last().click();

  // The one that saves the tedium: this grade and everything above it.
  await page.check('input[name=fillMode][value=up]');
  await page.locator("#matrixTable tr:nth-child(2) .m-cell").nth(7).click();
  eq("grade-and-above fills to the end", await page.locator(".m-cell.yes").count(), 4);
  await page.check('input[name=fillMode][value=down]');
  await page.locator("#matrixTable tr:nth-child(3) .m-cell").nth(2).click();
  eq("grade-and-below fills from the start",
    await page.locator(".m-cell.yes").count(), 4 + 3);
  await page.check('input[name=fillMode][value=toggle]');

  // Reordering and removing grades keeps the matrix honest.
  await page.click('[data-tab="setup"]');
  await page.locator(".grade").nth(1).locator(".icon-btn").first().click();
  eq("grades can be reordered",
    await page.locator(".grade-name input").first().inputValue(), "FREC 3");

  await page.fill("#gradeList .grade:last-child .grade-name input", "Consultant");
  await page.click('[data-tab="meds"]');
  eq("and renamed, which the matrix picks up",
    await page.locator(".m-head").last().textContent(), "Doctor");

  await page.click('[data-tab="setup"]');
  const before = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("drug-bag-tracker/v2")).docs.matrix;
    return d.medications.reduce((n, m) => n + Object.keys(m.allow || {}).length, 0);
  });
  await page.locator(".grade").last().locator(".icon-btn.del").click();
  eq("removing a grade drops its column",
    await page.locator("#gradeList .grade").count(), 10);
  const after = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("drug-bag-tracker/v2")).docs.matrix;
    return d.medications.reduce((n, m) => n + Object.keys(m.allow || {}).length, 0);
  });
  check("and leaves no permission behind for it", after < before, before + " -> " + after);

  await page.click("#gradeAdd");
  eq("a grade can be added", await page.locator("#gradeList .grade").count(), 11);
  await page.fill("#gradeList .grade:last-child .grade-name input", "Critical care paramedic");
  await page.fill("#gradeList .grade:last-child .grade-abbr input", "CCP");
  await page.click('[data-tab="meds"]');
  eq("and appears as a column", await page.locator(".m-head").last().textContent(), "CCP");

  // An unnamed grade cannot be a column, and blocks nothing else.
  await page.click('[data-tab="setup"]');
  await page.click("#gradeAdd");
  await page.click('[data-tab="meds"]');
  eq("an unnamed grade is not a column", await page.locator(".m-head").count(), 11);

  // Export, naming and the round trip.
  await page.click('[data-tab="generate"]');
  const [file] = await Promise.all([
    page.waitForEvent("download"), page.click("#exportBtn")]);
  eq("the export is named for the formulary",
    file.suggestedFilename(), "Formulary-2026-v1-saved.json");
  const saved = path.join(os.tmpdir(), "smoke-formulary.json");
  await file.saveAs(saved);
  const parsed = JSON.parse(fs.readFileSync(saved, "utf8"));
  eq("and carries the grades", parsed.grades.length, 12);
  check("and the permissions",
    parsed.medications.some(m => Object.keys(m.allow || {}).length > 0));

  const [pdf] = await Promise.all([
    page.waitForEvent("download"), page.click("#generateBtn")]);
  eq("the PDF is named for the formulary", pdf.suggestedFilename(), "Formulary-2026-v1.pdf");

  // The matrix is landscape, and says who each column is.
  const built = await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("drug-bag-tracker/v2")).docs.matrix;
    const doc = window.DrugBagPDF.build(Object.assign({}, d.setup, {
      medications: d.medications, mode: "matrix",
      grades: d.grades.filter(g => g.name.trim())
    }));
    const page1 = doc.internal.pages[1].join("\n");
    return {
      pages: doc.internal.getNumberOfPages(),
      landscape: doc.internal.pageSize.getWidth() > doc.internal.pageSize.getHeight(),
      key: page1.indexOf("KEY TO COLUMNS") >= 0,
      approval: page1.indexOf("FORMULARY APPROVAL") >= 0,
      expands: page1.indexOf("CCP = Critical care paramedic") >= 0
    };
  });
  eq("it is one sheet here", built.pages, 1);
  check("landscape", built.landscape);
  check("with a key to the column headings", built.key);
  check("which spells the abbreviations out", built.expands);
  check("and an approval block", built.approval);

  // Leaving for the bag paperwork and coming back leaves the formulary alone.
  await page.click("#bagLink");
  await page.waitForSelector("body[data-ready]");
  check("the bag page is a separate generator",
    await page.locator("#gradesCard").count() === 0);
  check("with its own document type", await page.isVisible('input[name=docMode][value=bag]'));
  check("and no matrix mode hidden in it",
    await page.locator('input[name=docMode][value=matrix]').count() === 0);
  await page.click("#matrixLink");
  await page.waitForSelector("body[data-ready]");
  eq("the formulary is still there", await page.inputValue("#bagNumber"), "2026-v1");
  eq("with its medications", await page.textContent("#medCount"), "2");

  check("no page errors", errors.length === 0, errors.join("; "));
  return saved;
}

/* ---------------- attaching a matrix to a drug bag ---------------------- */
async function testAttach(page, formulary) {
  console.log("\nattaching a matrix to a bag");
  const errors = [];
  page.removeAllListeners("dialog");
  page.removeAllListeners("pageerror");
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => errors.push(e.message));

  await page.goto("http://localhost:" + PORT + "/index.html");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.fill("#companyName", "Test Medical Ltd");
  await page.fill("#companyPhone", "01234 567890");
  await page.fill("#bagNumber", "7");
  await page.fill("#preppedBy", "F. Smith");
  await page.click('[data-tab="meds"]');
  await page.fill("#mName", "Paracetamol");
  await page.fill("#mPresentation", "Tablet");
  await page.fill("#mDose", "500mg");
  await page.fill("#mExpiryMonth", "2027-10");
  await page.fill("#mDoses", "8");
  await page.click("#medSubmit");

  // A bag with no matrix prints what it always did.
  const plain = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    return window.DrugBagPDF.build(Object.assign({}, st.docs.bag.setup,
      { medications: st.docs.bag.medications, mode: "bag" }))
      .internal.getNumberOfPages();
  });
  eq("a bag without a matrix is label plus logs", plain, 2);

  await page.click('[data-tab="setup"]');
  await page.setInputFiles("#formularyFile", formulary);
  await page.waitForSelector("#formularyResult:not([hidden])");
  check("a formulary can be attached to a bag",
    (await page.textContent("#formularyResult")).includes("2026-v1"));
  check("and says what it holds",
    (await page.textContent("#formularyResult")).includes("2 medications"));

  const attached = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    const bag = st.docs.bag;
    const doc = window.DrugBagPDF.build(Object.assign({}, bag.setup,
      { medications: bag.medications, mode: "bag", formulary: bag.formulary }));
    const n = doc.internal.getNumberOfPages();
    return {
      pages: n,
      stored: !!bag.formulary,
      landscape: doc.internal.pages[n].join("\n").indexOf("DRUG MATRIX") >= 0
    };
  });
  check("it is kept with the bag", attached.stored);
  eq("and adds its sheet to the bag's PDF", attached.pages, 3);
  check("which is the matrix", attached.landscape);

  // Exporting the bag carries the matrix with it.
  await page.click('[data-tab="generate"]');
  const [file] = await Promise.all([
    page.waitForEvent("download"), page.click("#exportBtn")]);
  const savedBag = path.join(os.tmpdir(), "smoke-bag-with-matrix.json");
  await file.saveAs(savedBag);
  const parsed = JSON.parse(fs.readFileSync(savedBag, "utf8"));
  check("an exported bag carries its matrix",
    !!parsed.formulary && parsed.formulary.medications.length === 2);

  // Importing a formulary on the bag side attaches rather than replaces.
  await page.click('[data-tab="setup"]');
  await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    delete st.docs.bag.formulary;
    localStorage.setItem("drug-bag-tracker/v2", JSON.stringify(st));
  });
  await page.reload();
  await page.setInputFiles("#importFile", formulary);
  await page.waitForSelector("#importResult:not([hidden])");
  check("importing a formulary here attaches it instead of replacing the bag",
    (await page.textContent("#importResult")).includes("attached"));
  eq("so the bag keeps its own medications", await page.textContent("#medCount"), "1");

  // And the matrix generator refuses a bag.
  await page.goto("http://localhost:" + PORT + "/matrix.html");
  await page.setInputFiles("#importFile", savedBag);
  await page.waitForSelector("#importResult:not([hidden])");
  check("the matrix generator refuses a saved bag",
    (await page.textContent("#importResult")).includes("not a formulary"));

  // Removing it puts the bag back to plain paperwork.
  await page.goto("http://localhost:" + PORT + "/index.html");
  await page.click("#formularyRemove");
  await page.waitForSelector("#formularyRemove", { state: "hidden" });
  const gone = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    return !st.docs.bag.formulary;
  });
  check("and it can be removed again", gone);

  check("no page errors", errors.length === 0, errors.join("; "));
}

/* ---------------- app behaviour ----------------------------------------- */
async function testApp(page) {
  console.log("\napp behaviour");
  const errors = [];
  page.on("dialog", d => d.accept());
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => {
    if (m.type() === "error" && !m.text().includes("favicon")) errors.push(m.text());
  });

  await page.evaluate(() => localStorage.clear());
  await page.reload();

  const addMed = async (m) => {
    await page.fill("#mName", m.name);
    await page.fill("#mPresentation", m.presentation);
    await page.fill("#mDose", m.dose);
    await page.fill("#mBatch", m.batch);
    await setExpiry(page, m.expiry);
    await page.fill("#mDoses", String(m.doses));
    await page.click("#medSubmit");
  };

  await page.fill("#companyName", "Test Medical Ltd");
  await page.fill("#companyPhone", "01234 567890");
  await page.fill("#bagNumber", "1");
  await page.fill("#preppedBy", "F. Smith");

  check("CD is not offered as a bag schedule",
    (await page.locator("#mSchedule option[value=CD]").count()) === 0);

  await page.click('[data-tab="meds"]');
  await addMed({ name: "Paracetamol", presentation: "Tablet", dose: "500mg",
                 batch: "B1", expiry: "10/2027", doses: 12 });
  eq("medication added", await page.textContent("#medCount"), "1");

  await page.fill("#mName", "Junk");
  await page.fill("#mPresentation", "Tablet");
  await page.fill("#mDose", "1mg");
  await page.selectOption("#mExpiryPrecision", "month");
  await page.fill("#mExpiryMonth", "");
  await page.fill("#mDoses", "2");
  await page.click("#medSubmit");
  check("a missing expiry is refused", await page.isVisible("#medError"));
  eq("and nothing was added", await page.textContent("#medCount"), "1");

  // The picker stores a month as YYYY-MM and an exact date as YYYY-MM-DD.
  await page.selectOption("#mExpiryPrecision", "month");
  await page.fill("#mExpiryMonth", "2027-10");
  check("a month reads back as the month end",
    (await page.textContent("#mExpiryEcho")).includes("10/2027"),
    await page.textContent("#mExpiryEcho"));
  await page.selectOption("#mExpiryPrecision", "day");
  eq("switching precision carries the value over",
    await page.inputValue("#mExpiryDate"), "2027-10-01");
  await page.fill("#mExpiryDate", "2027-10-18");
  check("an exact date reads back in full",
    (await page.textContent("#mExpiryEcho")).includes("18/10/2027"),
    await page.textContent("#mExpiryEcho"));
  await page.selectOption("#mExpiryPrecision", "month");
  eq("and back again", await page.inputValue("#mExpiryMonth"), "2027-10");

  // Copy sets up a second batch of the same drug.
  await page.click('.med:first-child .icon-btn:nth-child(3)');
  eq("copy prefills the name", await page.inputValue("#mName"), "Paracetamol");
  eq("copy clears the batch", await page.inputValue("#mBatch"), "");
  const nextMonth = new Date();
  nextMonth.setDate(1);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const soonExpiry = String(nextMonth.getMonth() + 1).padStart(2, "0") +
    "/" + nextMonth.getFullYear();
  await page.fill("#mBatch", "B2");
  await setExpiry(page, soonExpiry);
  await page.fill("#mDoses", "12");
  await page.click("#medSubmit");
  eq("second batch added", await page.textContent("#medCount"), "2");
  check("batches are labelled in the list",
    (await page.locator(".chip.batch").count()) === 2);

  await page.click('[data-tab="generate"]');
  check("an un-exported document is flagged", await page.isVisible("#backupWarning"));
  check("the near expiry is flagged, and agrees in number",
    (await page.textContent("#expiryWarning")).startsWith("1 medication expires within"),
    await page.textContent("#expiryWarning"));

  check("no reminder before a PDF is downloaded", await page.isHidden("#pdfReminder"));
  const [pdfFile] = await Promise.all([page.waitForEvent("download"), page.click("#generateBtn")]);
  eq("PDF is named for the bag", pdfFile.suggestedFilename(), "Drug-Bag-1.pdf");
  check("downloading the PDF asks for the json too", await page.isVisible("#pdfReminder"));
  check("and offers to do it there and then",
    await page.isVisible("#pdfReminderExport"));

  const [bagFile] = await Promise.all([
    page.waitForEvent("download"), page.click("#pdfReminderExport")]);
  eq("bag export is named for the bag", bagFile.suggestedFilename(), "Drug-Bag-1-saved.json");
  const savedBag = path.join(os.tmpdir(), "smoke-bag.json");
  await bagFile.saveAs(savedBag);
  check("the flag clears once exported", await page.isHidden("#backupWarning"));
  check("the reminder settles once both are saved",
    (await page.getAttribute("#pdfReminder", "class")).includes("good"));
  check("with nothing left to press", await page.isHidden("#pdfReminderExport"));

  // Switch to the CD register: separate document, separate list.
  await page.click('[data-tab="setup"]');
  await page.check('input[name=docMode][value=cd]');
  eq("the CD register starts empty", await page.textContent("#medCount"), "0");
  check("the reminder does not follow you to the other document",
    await page.isHidden("#pdfReminder"));
  check("seal number is bag only", await page.locator("#f-sealNumber").isHidden());
  check("safe location is CD only", await page.locator("#f-safeLocation").isVisible());
  await page.fill("#companyName", "Test Medical Ltd");
  await page.fill("#companyPhone", "01234 567890");
  await page.fill("#bagNumber", "2");
  await page.fill("#preppedBy", "A. Jones");

  await page.click('[data-tab="meds"]');
  check("schedule is hidden for controlled drugs", await page.locator("#f-mSchedule").isHidden());
  check("unit is shown for controlled drugs", await page.locator("#f-mUnit").isVisible());
  eq("unit defaults sensibly", await page.inputValue("#mUnit"), "ampoules");
  await addMed({ name: "Morphine sulfate", presentation: "Ampoule", dose: "10mg/1ml",
                 batch: "M1", expiry: "12/2027", doses: 10 });

  await page.click('[data-tab="generate"]');
  const [cdFile] = await Promise.all([page.waitForEvent("download"), page.click("#exportBtn")]);
  eq("CD export is named for the safe", cdFile.suggestedFilename(), "CD-Register-2-saved.json");

  await page.click('[data-tab="setup"]');
  await page.check('input[name=docMode][value=bag]');
  eq("the bag survived the switch", await page.inputValue("#bagNumber"), "1");
  eq("with its medications", await page.textContent("#medCount"), "2");

  await page.reload();
  eq("and survives a reload", await page.textContent("#medCount"), "2");

  // Quick add fills the form from the catalogue.
  await page.click('[data-tab="meds"]');
  await page.fill("#quickAdd", "ondansetron");
  await page.waitForSelector("#quickResults li");
  await page.click("#quickResults li:first-child");
  eq("quick add fills the name", await page.inputValue("#mName"), "Ondansetron");
  eq("and the formulation", await page.inputValue("#mPresentation"),
    "Ampoule - solution for injection");
  eq("and the strength", await page.inputValue("#mDose"), "2mg/1ml");
  eq("and suggests a category", await page.inputValue("#mSchedule"), "S17");

  // The other-strength option leaves formulation and strength to be typed.
  await page.fill("#quickAdd", "paracetamol suspension");
  await page.waitForSelector("#quickResults li");
  const other = page.locator("#quickResults li", { hasText: "other strength" }).first();
  await other.click();
  eq("other strength keeps the name", await page.inputValue("#mName"),
    "Paracetamol suspension");
  eq("but clears the strength", await page.inputValue("#mDose"), "");
  check("and says what to do next", await page.isVisible("#medNote"));

  // A controlled drug is not offered on a drug bag, but is explained.
  await page.fill("#quickAdd", "morphine");
  await page.waitForSelector("#quickResults li");
  check("no controlled drug is offered to a bag",
    (await page.locator("#quickResults li .q-tag.CD").count()) === 0);
  check("and the register is pointed at",
    (await page.locator("#quickResults li.note").count()) === 1);

  // Manual entry is always available.
  await page.fill("#quickAdd", "something not stocked");
  await page.waitForSelector("#quickResults li.manual");
  await page.click("#quickResults li.manual");
  eq("manual entry clears the form", await page.inputValue("#mName"), "");
  eq("and closes the results", await page.locator("#quickResults").isHidden(), true);

  await page.fill("#mName", "Ondansetron");
  await page.fill("#mPresentation", "Ampoule");
  await page.fill("#mDose", "2mg/1ml");
  await page.fill("#mBatch", "OND1");
  await setExpiry(page, "10/2027");
  await page.fill("#mDoses", "4");
  await page.selectOption("#mSchedule", "S19");
  await page.click("#medSubmit");
  eq("S19 is a category the form accepts", await page.textContent("#medCount"), "3");
  await page.click(".med:last-child .icon-btn.del");
  eq("tidied away again", await page.textContent("#medCount"), "2");

  // An in service date moves the expiry question from "is it in date?" to
  // "will it still be in date when the bag comes back?".
  await page.click('[data-tab="setup"]');
  const farOff = new Date();
  farOff.setFullYear(farOff.getFullYear() + 1);
  await page.fill("#inServiceUntil", farOff.toISOString().slice(0, 10));
  await page.click('[data-tab="meds"]');
  check("stock that runs out mid-service is flagged",
    (await page.locator(".chip.bad").filter({ hasText: "EXPIRES IN SERVICE" }).count()) > 0);
  await page.click('[data-tab="generate"]');
  check("and called out on the generate tab",
    (await page.textContent("#expiryWarning")).includes("while this bag is in service"),
    await page.textContent("#expiryWarning"));

  const banded = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    const d = Object.assign({}, st.docs.bag.setup,
      { medications: st.docs.bag.medications, mode: "bag" });
    const doc = window.DrugBagPDF.build(d);
    return doc.internal.pages[1].join("\n").indexOf("EXPIRES BEFORE") >= 0;
  });
  check("and printed on the label", banded);

  await page.click('[data-tab="setup"]');
  await page.fill("#inServiceUntil", "");
  await page.click('[data-tab="meds"]');
  eq("clearing the date clears the flag",
    await page.locator(".chip.bad").filter({ hasText: "EXPIRES IN SERVICE" }).count(), 0);

  // CQC: the number is only asked for, and only printed, when registered.
  await page.click('[data-tab="setup"]');
  check("the registration number is hidden until it applies",
    await page.locator("#f-cqcNumber").isHidden());
  await page.check("#cqcRegistered");
  check("and appears once ticked", await page.locator("#f-cqcNumber").isVisible());

  await page.click('[data-tab="generate"]');
  await page.click("#generateBtn");
  check("generating is refused without the number",
    (await page.textContent("#genError")).includes("CQC registration number"),
    await page.textContent("#genError"));

  await page.click('[data-tab="setup"]');
  await page.fill("#cqcNumber", "1-234567890");
  const cqcOnPage = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    const d = Object.assign({}, st.docs.bag.setup,
      { medications: st.docs.bag.medications, mode: "bag" });
    return window.DrugBagPDF.build(d).internal.pages[1].join("\n").indexOf("CQC 1-234567890") >= 0;
  });
  check("and is printed beside the company name", cqcOnPage);

  await page.uncheck("#cqcRegistered");
  const cqcGone = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    const d = Object.assign({}, st.docs.bag.setup,
      { medications: st.docs.bag.medications, mode: "bag" });
    return window.DrugBagPDF.build(d).internal.pages[1].join("\n").indexOf("CQC") < 0;
  });
  check("un-ticking removes it from the document", cqcGone);
  await page.check("#cqcRegistered");

  // Company logo: stored scaled down, carried into the export, drawn on the PDF.
  await page.click('[data-tab="setup"]');
  const logoPath = path.join(os.tmpdir(), "smoke-logo.png");
  fs.writeFileSync(logoPath, Buffer.from(TEST_LOGO_PNG, "base64"));
  await page.setInputFiles("#logoFile", logoPath);
  await page.waitForFunction(() => !document.getElementById("logoPreview").hidden);
  check("the logo previews once chosen", await page.isVisible("#logoPreview"));

  const logo = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("drug-bag-tracker/v2")).docs.bag.setup;
    return { w: s.logoW, h: s.logoH, prefix: (s.logo || "").slice(0, 14) };
  });
  eq("the logo keeps its shape", logo.w / logo.h, 3);
  check("and is stored as an image", logo.prefix === "data:image/png");
  check("within the size cap", logo.w <= 480 && logo.h <= 480,
    logo.w + "x" + logo.h);

  const withLogo = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    const d = Object.assign({}, st.docs.bag.setup,
      { medications: st.docs.bag.medications, mode: "bag" });
    return window.DrugBagPDF.build(d).internal.getNumberOfPages();
  });
  eq("the PDF still builds with a logo", withLogo, 3);

  await page.reload();
  check("the logo survives a reload", await page.isVisible("#logoPreview"));

  await page.click("#logoRemove");
  check("and can be removed", await page.isHidden("#logoPreview"));
  check("leaving nothing stored", await page.evaluate(() =>
    !JSON.parse(localStorage.getItem("drug-bag-tracker/v2")).docs.bag.setup.logo));

  // Put it back, so the import round trip below carries it.
  await page.setInputFiles("#logoFile", logoPath);
  await page.waitForFunction(() => !document.getElementById("logoPreview").hidden);
  await page.click('[data-tab="generate"]');
  const [reExport] = await Promise.all([
    page.waitForEvent("download"), page.click("#exportBtn")]);
  await reExport.saveAs(savedBag);
  check("the export carries the logo",
    JSON.parse(fs.readFileSync(savedBag, "utf8")).setup.logo.startsWith("data:image/png"));

  // The company profile travels on its own, logo and CQC included.
  await page.click('[data-tab="setup"]');
  const [companyFile] = await Promise.all([
    page.waitForEvent("download"), page.click("#companyExportBtn")]);
  eq("the company export is named after the company",
    companyFile.suggestedFilename(), "Company-Test-Medical-Ltd.json");
  const companyPath = path.join(os.tmpdir(), "smoke-company.json");
  await companyFile.saveAs(companyPath);
  const profile = JSON.parse(fs.readFileSync(companyPath, "utf8"));
  eq("it is stamped with its format", profile.format, "drug-bag-tracker/company");
  eq("carries the company", profile.companyName, "Test Medical Ltd");
  eq("carries the CQC registration", profile.cqcNumber, "1-234567890");
  check("carries the logo", String(profile.logo).startsWith("data:image/png"));
  check("and nothing about the bag itself",
    profile.bagNumber === undefined && profile.medications === undefined);

  // Wipe the company half, then load it back from the file.
  await page.fill("#companyName", "Wrong Ltd");
  await page.fill("#companyPhone", "000");
  await page.uncheck("#cqcRegistered");
  await page.setInputFiles("#companyFile", companyPath);
  await page.waitForFunction(() =>
    document.getElementById("companyResult").textContent.indexOf("Loaded company") >= 0);
  eq("import restores the company", await page.inputValue("#companyName"), "Test Medical Ltd");
  eq("and the contact", await page.inputValue("#companyPhone"), "01234 567890");
  check("and the CQC registration", await page.isChecked("#cqcRegistered"));
  eq("with its number", await page.inputValue("#cqcNumber"), "1-234567890");
  eq("leaving the bag number alone", await page.inputValue("#bagNumber"), "1");

  // A whole bag export also works as a source of company details.
  await page.fill("#companyName", "Wrong Ltd");
  await page.setInputFiles("#companyFile", savedBag);
  await page.waitForFunction(() =>
    document.getElementById("companyResult").textContent.indexOf("Loaded") >= 0);
  eq("company details lift out of a bag export",
    await page.inputValue("#companyName"), "Test Medical Ltd");

  await page.setInputFiles("#companyFile", junkPath());
  await page.waitForFunction(() =>
    document.getElementById("companyResult").className.indexOf("bad") >= 0);
  eq("a file with no company details changes nothing",
    await page.inputValue("#companyName"), "Test Medical Ltd");

  // Import, from the setup tab, restores a document over whatever is open.
  await page.click('[data-tab="setup"]');
  check("setup offers an import", await page.isVisible("#importSetupBtn"));

  await page.fill("#bagNumber", "99");
  await page.click('[data-tab="meds"]');
  await page.click(".med:first-child .icon-btn.del");
  eq("document altered before importing", await page.textContent("#medCount"), "1");

  await page.click('[data-tab="setup"]');
  await page.setInputFiles("#importFile", savedBag);
  await page.waitForFunction(() => !document.getElementById("importResult").hidden);
  eq("import restores the bag number", await page.inputValue("#bagNumber"), "1");
  eq("import restores the medications", await page.textContent("#medCount"), "2");
  check("import restores the logo", await page.isVisible("#logoPreview"));
  check("import says what it loaded",
    (await page.textContent("#importResult")).includes("drug bag 1 with 2 medications"),
    await page.textContent("#importResult"));
  check("an imported document counts as saved", await page.isHidden("#backupWarning"));

  // Importing a CD register from the bag tab switches document type with it.
  const savedCd = path.join(os.tmpdir(), "smoke-cd.json");
  fs.writeFileSync(savedCd, JSON.stringify({
    mode: "cd", setup: { bagNumber: "7", companyName: "Test Medical Ltd",
      companyPhone: "01", preppedBy: "A. Jones" },
    medications: [{ name: "Morphine sulfate", presentation: "Ampoule", dose: "10mg/1ml",
      batch: "M9", expiry: "12/2027", doses: 4, schedule: "CD", unit: "ampoules" }]
  }));
  await page.setInputFiles("#importFile", savedCd);
  await page.waitForFunction(() =>
    document.getElementById("importResult").textContent.indexOf("CD safe") >= 0);
  check("importing a register switches document type",
    await page.locator("#f-safeLocation").isVisible());
  eq("and loads its stock", await page.textContent("#medCount"), "1");

  // A file that is not one of ours must not wipe what is open.
  await page.setInputFiles("#importFile", junkPath());
  await page.waitForFunction(() =>
    document.getElementById("importResult").className.indexOf("bad") >= 0);
  eq("a foreign json is refused", await page.textContent("#medCount"), "1");
  eq("leaving the open document alone", await page.inputValue("#bagNumber"), "7");

  const broken = path.join(os.tmpdir(), "smoke-broken.json");
  fs.writeFileSync(broken, "{ not json at all");
  await page.setInputFiles("#importFile", broken);
  await page.waitForFunction(() =>
    document.getElementById("importResult").textContent.indexOf("not a valid") >= 0);
  eq("malformed json is refused too", await page.textContent("#medCount"), "1");

  // The bag is still there, untouched by all of that.
  await page.check('input[name=docMode][value=bag]');
  eq("the bag came through unharmed", await page.inputValue("#bagNumber"), "1");
  eq("with its medications", await page.textContent("#medCount"), "2");

  // Theme: auto follows the system, and an explicit choice overrides it.
  const rootTheme = () => page.getAttribute("html", "data-theme");
  eq("starts on auto", await page.textContent("#themeBtn"), "Theme: auto");
  eq("auto leaves the system in charge", await rootTheme(), null);

  await page.click("#themeBtn");
  eq("cycles to light", await page.textContent("#themeBtn"), "Theme: light");
  eq("and says so on the root", await rootTheme(), "light");

  await page.click("#themeBtn");
  eq("cycles to dark", await page.textContent("#themeBtn"), "Theme: dark");
  eq("and says so on the root", await rootTheme(), "dark");
  check("dark actually repaints", await page.evaluate(() => {
    const bg = getComputedStyle(document.body).backgroundColor;
    const parts = bg.match(/\d+/g).map(Number);
    return parts[0] + parts[1] + parts[2] < 200;   // a dark page, not a light one
  }));

  await page.reload();
  eq("the choice survives a reload", await rootTheme(), "dark");
  eq("and the button agrees", await page.textContent("#themeBtn"), "Theme: dark");

  await page.click("#themeBtn");
  eq("cycles back to auto", await rootTheme(), null);

  // Disclaimer, licence and credit are on the page, not only in the repo.
  check("the as-is notice is always visible",
    (await page.textContent(".foot-line")).includes("Provided as is, with no warranty"));
  check("the licence and sources are reachable",
    await page.isVisible(".foot-details summary"));
  // Collapse the whitespace the HTML source wraps on, so phrases match.
  const footer = (await page.textContent(".foot-body")).replace(/\s+/g, " ");
  check("the licence is named", footer.includes("MIT licence") &&
    footer.includes("Finlay Russell"));
  check("the category caveat is spelled out",
    footer.includes("not legal determinations"));
  check("sources are credited", footer.includes("Human Medicines Regulations 2012"));
  check("the author is credited",
    (await page.textContent(".foot-credit")).includes("Finlay Russell"));
  eq("with a contact address",
    await page.getAttribute('.foot-credit a[href^="mailto:"]', "href"),
    "mailto:finlay3110@gmail.com");

  check("no page errors", errors.length === 0, errors.join("; "));
}

/* ---------------- runner ------------------------------------------------- */
const TYPES = { ".html": "text/html", ".js": "text/javascript",
                ".css": "text/css", ".json": "application/json" };

function serve() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

(async () => {
  testExpiry();
  testCatalogue();

  const server = await serve();
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.goto("http://localhost:" + PORT + "/index.html");

  try {
    await testPdfs(page);
    await testApp(page);
    const formulary = await testMatrix(page);
    await testAttach(page, formulary);
  } finally {
    await browser.close();
    server.close();
  }

  // Name them in the summary too, so a run captured by its last lines — in CI
  // output, or a tail — still says what went wrong.
  console.log(failures
    ? "\n" + failures + " check(s) failed: " + failed.join("; ")
    : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
