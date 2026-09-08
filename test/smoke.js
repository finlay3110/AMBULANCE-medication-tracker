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
function check(name, ok, detail) {
  if (ok) { console.log("  ok   " + name); return; }
  failures += 1;
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
    await page.fill("#mExpiry", m.expiry);
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
  await page.fill("#mExpiry", "banana");
  await page.fill("#mDoses", "2");
  await page.click("#medSubmit");
  check("an unparseable expiry is refused", await page.isVisible("#medError"));
  eq("and nothing was added", await page.textContent("#medCount"), "1");

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
  await page.fill("#mExpiry", soonExpiry);
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
  const junk = path.join(os.tmpdir(), "smoke-junk.json");
  fs.writeFileSync(junk, JSON.stringify({ hello: "world" }));
  await page.setInputFiles("#importFile", junk);
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

  const server = await serve();
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const page = await browser.newPage();
  await page.goto("http://localhost:" + PORT + "/index.html");

  try {
    await testPdfs(page);
    await testApp(page);
  } finally {
    await browser.close();
    server.close();
  }

  console.log(failures ? "\n" + failures + " check(s) failed" : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
