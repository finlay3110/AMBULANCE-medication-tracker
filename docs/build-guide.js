/*
 * Builds the user guide as a PDF, with screenshots taken from the real app.
 *
 *   node docs/build-guide.js            (or: npm run guide)
 *
 * Needs playwright, and python3 with pypdfium2 for the sample-PDF figures.
 * Everything it writes lands in docs/build/ and is git-ignored, so the guide
 * is regenerated from the current app rather than kept as stale images.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("playwright");

const ROOT = path.join(__dirname, "..");
const BUILD = path.join(__dirname, "build");
const SHOTS = path.join(BUILD, "shots");
const PORT = 8741;
const APP = "http://localhost:" + PORT + "/index.html";
const MATRIX = "http://localhost:" + PORT + "/matrix.html";

const TYPES = { ".html": "text/html", ".js": "text/javascript",
                ".css": "text/css", ".json": "application/json", ".png": "image/png" };

function serve(root, port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      const file = path.join(root, rel);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end("not found"); return;
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(port, () => resolve(server));
  });
}

/* A small logo so the guide's figures show the branding feature working. */
function sampleLogo() {
  const file = path.join(BUILD, "sample-logo.png");
  fs.writeFileSync(file, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAPAAAABQCAIAAACoK28rAAAAzUlEQVR42u3UwQnAIBBFQZXcTEWmJC3H" +
    "ltJRCrABBW+BZKaBhc9jY64lwFckEyBoEDQIGgSNoEHQIGgQNAgaQYOgQdAgaBA0ggZBg6BB0LBymGDf" +
    "0++3Tp/tsr8PjaBB0CBoEDQIGkGDoEHQIGgQNIIGQYOgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoE" +
    "DYJG0CBoEDQIGgSNoEHQIGgQNAiaf4m5FivgQ4OgQdAgaAQNggZBg6BB0AgaBA2CBkGDoBE0CBoEDYKG" +
    "qQFVpwUBmo9fcgAAAABJRU5ErkJggg==", "base64"));
  return file;
}

async function shot(target, name, opts) {
  await target.screenshot(Object.assign({ path: path.join(SHOTS, name + ".png") }, opts || {}));
  console.log("  " + name + ".png");
}

async function capture(browser) {
  const page = await browser.newPage({
    viewport: { width: 1180, height: 1000 }, deviceScaleFactor: 2
  });
  const logo = sampleLogo();
  const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur());
  // Filling the last fields scrolls the page, so a viewport shot needs resetting.
  const toTop = () => page.evaluate(() => window.scrollTo(0, 0));

  async function setExpiry(value) {
    if (value.length > 7) {
      await page.selectOption("#mExpiryPrecision", "day");
      await page.fill("#mExpiryDate", value);
    } else {
      await page.selectOption("#mExpiryPrecision", "month");
      await page.fill("#mExpiryMonth", value);
    }
  }
  async function quickAdd(query, batch, expiry, qty, unit, restock) {
    await page.fill("#quickAdd", query);
    await page.waitForSelector("#quickResults li");
    await page.click("#quickResults li:first-child");
    await page.fill("#mBatch", batch);
    await setExpiry(expiry);
    await page.fill("#mDoses", String(qty));
    if (unit) await page.fill("#mUnit", unit);
    if (restock !== undefined) await page.fill("#mRestock", String(restock));
    await page.click("#medSubmit");
  }

  await page.goto(APP);
  await page.evaluate(() => localStorage.clear());
  await page.reload();

  // ---- drug bag ----
  await page.fill("#companyName", "Northern Event Medical Ltd");
  await page.fill("#companyPhone", "01234 567890");
  await page.fill("#companyAddress", "Unit 4, Example Way\nTownsville, AB1 2CD");
  await page.check("#cqcRegistered");
  await page.fill("#cqcNumber", "1-234567890");
  await page.setInputFiles("#logoFile", logo);
  await page.waitForFunction(() => !document.getElementById("logoPreview").hidden);
  await page.fill("#bagNumber", "1");
  await page.fill("#preppedBy", "F. Smith");
  await page.fill("#checkedBy", "J. Doe");
  await page.fill("#sealNumber", "S-99213");
  await page.fill("#inServiceUntil", "2027-03-31");
  await blur();
  await toTop();
  await shot(page, "setup");
  await shot(page.locator("#panel-setup .card").nth(2), "company-card");
  await shot(page.locator("#panel-setup .card").nth(3), "bag-details");

  await page.click('[data-tab="meds"]');
  await page.fill("#quickAdd", "nalox");
  await page.waitForSelector("#quickResults li");
  await shot(page.locator("#panel-meds .card").first(), "quick-add");
  await page.fill("#quickAdd", "morphine");
  await page.waitForSelector("#quickResults li.note");
  await shot(page.locator("#panel-meds .card").first(), "quick-add-cd");
  await page.fill("#quickAdd", "");
  await blur();

  await quickAdd("paracetamol tablet", "22060215", "2027-10", 32, "", 10);
  await quickAdd("aspirin", "ASP771", "2027-07", 28, "", 8);
  await quickAdd("ibuprofen", "IBU7741", "2027-01", 32, "", 10);
  await quickAdd("glucose gel", "GG2210", "2027-02", 3, "", 1);
  await quickAdd("naloxone 2mg pre", "0142723", "2026-10-18", 2);
  await quickAdd("ondansetron", "OND4413", "2027-11", 5, "", 2);
  await blur();
  await shot(page.locator("#panel-meds .card").nth(1), "med-form");
  await shot(page.locator("#panel-meds .card").nth(2), "med-list");

  await page.click('[data-tab="generate"]');
  await shot(page.locator("#panel-generate .card").first(), "generate");
  const bagPdf = path.join(BUILD, "sample-bag.pdf");
  fs.writeFileSync(bagPdf, Buffer.from((await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    return window.DrugBagPDF.build(Object.assign({}, st.docs.bag.setup,
      { medications: st.docs.bag.medications, mode: "bag" })).output("datauristring");
  })).split(",")[1], "base64"));

  await page.click("#generateBtn");
  await page.waitForFunction(() => !document.getElementById("pdfReminder").hidden);
  await shot(page.locator("#panel-generate .card").first(), "generate-reminder");

  // ---- controlled drugs ----
  await page.click('[data-tab="setup"]');
  await page.check('input[name=docMode][value=cd]');
  await page.fill("#companyName", "Northern Event Medical Ltd");
  await page.fill("#companyPhone", "01234 567890");
  await page.setInputFiles("#logoFile", logo);
  await page.waitForFunction(() => !document.getElementById("logoPreview").hidden);
  await page.fill("#bagNumber", "2");
  await page.fill("#safeLocation", "Secure room, Station 4");
  await page.fill("#preppedBy", "A. Jones");
  await page.fill("#checkedBy", "B. Patel");
  await blur();
  await toTop();
  await shot(page, "cd-setup");

  await page.click('[data-tab="meds"]');
  await quickAdd("morphine ampoule", "MOR2291", "2027-12", 10, "ampoules", 3);
  await quickAdd("morphine ampoule", "MOR3310", "2028-04", 6, "ampoules", 2);
  await quickAdd("midazolam 5mg/1ml", "MZ4410", "2027-05", 5, "ampoules", 2);
  await blur();
  await shot(page.locator("#panel-meds .card").nth(2), "cd-list");

  await page.click('[data-tab="generate"]');
  const cdPdf = path.join(BUILD, "sample-cd.pdf");
  fs.writeFileSync(cdPdf, Buffer.from((await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    return window.DrugBagPDF.build(Object.assign({}, st.docs.cd.setup,
      { medications: st.docs.cd.medications, mode: "cd" })).output("datauristring");
  })).split(",")[1], "base64"));

  // ---- drug matrix (its own page) ----
  await page.goto(MATRIX);
  await page.fill("#companyName", "Northern Event Medical Ltd");
  await page.fill("#companyPhone", "01234 567890");
  await page.setInputFiles("#logoFile", logo);
  await page.waitForFunction(() => !document.getElementById("logoPreview").hidden);
  await page.fill("#bagNumber", "2026-v1");
  await page.fill("#preppedBy", "Dr A. Shah");
  await page.fill("#checkedBy", "F. Smith");
  await page.fill("#inServiceUntil", "2027-04-01");
  // Cut the default list down to the five grades this example organisation
  // uses, through the tool's own Remove buttons.
  const keep = ["FREC 3", "FREC 4", "EMT", "Paramedic", "Doctor"];
  for (let guard = 0; guard < 40; guard += 1) {
    const names = await page.locator("#gradeList .grade-name input")
      .evaluateAll(els => els.map(e => e.value));
    const i = names.findIndex(n => !keep.includes(n));
    if (i < 0) break;
    page.once("dialog", d => d.accept());
    await page.locator(".grade").nth(i).locator(".icon-btn.del").click();
  }
  await blur();
  await page.mouse.move(0, 0);
  await shot(page.locator("#gradesCard"), "matrix-grades");

  await page.click('[data-tab="meds"]');
  // "from" is the grade a row starts at, filled with "this grade and above".
  const formulary = [
    { manual: { name: "Oxygen", presentation: "Cylinder - medical gas",
                dose: "Titrated to target saturation", schedule: "POM" },
      indication: "Hypoxia, and any critically unwell patient.\n" +
                  "Titrate to the patient's target saturation range.", from: 0 },
    { query: "paracetamol tablet",
      indication: "Mild to moderate pain, or a high temperature.\n" +
                  "Check what the patient has already taken today.", from: 1 },
    { query: "glucose gel",
      indication: "Hypoglycaemia in a patient who can swallow safely.", from: 1 },
    { query: "aspirin",
      indication: "Suspected heart attack, once bleeding risk is considered.", from: 1 },
    { query: "salbutamol neb", indication: "Wheeze from asthma or COPD.", from: 2 },
    { query: "adrenaline anaphylaxis", indication: "Anaphylaxis.", from: 2 },
    { query: "ondansetron", indication: "Nausea and vomiting.", from: 3 },
    { query: "naloxone 2mg pre",
      indication: "Respiratory depression from opioids.", from: 3 }
  ];
  for (const med of formulary) {
    if (med.manual) {
      // Oxygen is not in the catalogue, so it goes in by hand — which is the
      // escape hatch the guide describes.
      await page.fill("#mName", med.manual.name);
      await page.fill("#mPresentation", med.manual.presentation);
      await page.fill("#mDose", med.manual.dose);
      await page.selectOption("#mSchedule", med.manual.schedule);
    } else {
      await page.fill("#quickAdd", med.query);
      await page.waitForSelector("#quickResults li");
      await page.locator("#quickResults li:not(.note)").first().click();
    }
    await page.fill("#mIndication", med.indication);
    await page.click("#medSubmit");
  }
  await blur();
  await shot(page.locator("#panel-meds .card").nth(1), "matrix-form");

  // Fill each row the way the guide describes it: "this grade and above".
  await page.check('input[name=fillMode][value=up]');
  for (let r = 0; r < formulary.length; r += 1) {
    await page.locator(`#matrixTable tr:nth-child(${r + 2}) .m-cell`)
      .nth(formulary[r].from).click();
  }
  await blur();
  await shot(page.locator("#matrixCard"), "matrix-grid");

  await page.click('[data-tab="generate"]');
  const matrixPdf = path.join(BUILD, "sample-matrix.pdf");
  fs.writeFileSync(matrixPdf, Buffer.from((await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("drug-bag-tracker/v2"));
    return window.DrugBagPDF.build(Object.assign({}, st.docs.matrix.setup,
      { medications: st.docs.matrix.medications, grades: st.docs.matrix.grades,
        mode: "matrix" })).output("datauristring");
  })).split(",")[1], "base64"));

  // ---- attaching that matrix to the drug bag ----
  const formularyJson = path.join(BUILD, "sample-formulary.json");
  fs.writeFileSync(formularyJson, await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem("drug-bag-tracker/v2")).docs.matrix;
    return JSON.stringify({ mode: "matrix", setup: m.setup,
      medications: m.medications, grades: m.grades }, null, 2);
  }));

  await page.goto(APP);
  await page.waitForSelector("body[data-ready]");
  // Back to the drug bag: the CD register was the last thing edited here.
  await page.check('input[name=docMode][value=bag]');
  await shot(page.locator(".topbar"), "topbar");
  await page.setInputFiles("#formularyFile", formularyJson);
  await page.waitForSelector("#formularyResult:not([hidden])");
  await shot(page.locator("#formularyBtn").locator("xpath=ancestor::div[@class='card']"),
    "formulary-attached");

  const bagMatrixPdf = path.join(BUILD, "sample-bag-matrix.pdf");
  fs.writeFileSync(bagMatrixPdf, Buffer.from((await page.evaluate(() => {
    const bag = JSON.parse(localStorage.getItem("drug-bag-tracker/v2")).docs.bag;
    return window.DrugBagPDF.build(Object.assign({}, bag.setup,
      { medications: bag.medications, mode: "bag", formulary: bag.formulary }))
      .output("datauristring");
  })).split(",")[1], "base64"));
  await page.close();

  // ---- dark mode and phone ----
  const dark = await browser.newPage({
    viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, colorScheme: "dark"
  });
  await dark.goto(APP);
  await dark.click('[data-tab="meds"]');
  await dark.fill("#quickAdd", "parac");
  await dark.waitForSelector("#quickResults li");
  await shot(dark, "dark");
  await dark.close();

  const phone = await browser.newPage({
    viewport: { width: 400, height: 780 }, deviceScaleFactor: 3, isMobile: true
  });
  await phone.goto(APP);
  await phone.click('[data-tab="meds"]');
  await shot(phone, "phone");
  await phone.close();

  return { bagPdf, cdPdf, matrixPdf, bagMatrixPdf };
}

function renderPdfPages(pdfs) {
  const args = [path.join(__dirname, "render-pages.py"), SHOTS,
    pdfs.bagPdf, "0", "pdf-bag-label",
    pdfs.bagPdf, "1", "pdf-bag-log",
    pdfs.bagPdf, "2", "pdf-bag-log-restock",
    pdfs.cdPdf, "0", "pdf-cd-front",
    pdfs.cdPdf, "1", "pdf-cd-register",
    pdfs.cdPdf, "-2", "pdf-cd-stockcheck",
    pdfs.cdPdf, "-1", "pdf-cd-signout",
    pdfs.matrixPdf, "0", "pdf-matrix",
    pdfs.bagMatrixPdf, "-1", "pdf-bag-matrix"];
  try {
    execFileSync("python3", args, { stdio: "inherit" });
    return true;
  } catch (e) {
    console.warn("\n! Sample PDF pages were skipped: " +
      "python3 with pypdfium2 is needed for those figures.\n");
    return false;
  }
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const appServer = await serve(ROOT, PORT);
  const browser = await chromium.launch(
    process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  console.log("Capturing the app:");
  const pdfs = await capture(browser);
  console.log("Rendering sample PDF pages:");
  renderPdfPages(pdfs);

  // The guide is served too, so its <img> paths resolve like any other page.
  const guideServer = await serve(__dirname, PORT + 1);
  const page = await browser.newPage();
  await page.goto("http://localhost:" + (PORT + 1) + "/user-guide.html",
    { waitUntil: "networkidle" });

  const out = path.join(ROOT, "Drug-Bag-Tracker-User-Guide.pdf");
  await page.pdf({
    path: out, format: "A4", printBackground: true,
    margin: { top: "14mm", bottom: "16mm", left: "14mm", right: "14mm" },
    displayHeaderFooter: true,
    headerTemplate: "<div></div>",
    footerTemplate:
      '<div style="width:100%;font:9px -apple-system,Segoe UI,Roboto,sans-serif;' +
      'color:#7b8794;padding:0 14mm;display:flex;justify-content:space-between;">' +
      '<span>Drug Bag Tracker &mdash; user guide</span>' +
      '<span class="pageNumber"></span></div>'
  });

  await browser.close();
  appServer.close();
  guideServer.close();
  console.log("\nWrote " + path.relative(ROOT, out));
})();
