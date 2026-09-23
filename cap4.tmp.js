const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = __dirname, PORT = 8794, OUT = process.env.OUT;
const TYPES = {".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png"};
const srv = http.createServer((req,res)=>{
  const f = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/,"")||"index.html");
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}
  res.writeHead(200,{"Content-Type":TYPES[path.extname(f)]||"application/octet-stream"});
  fs.createReadStream(f).pipe(res);
});
const LOGO = fs.readFileSync(path.join(OUT,"_logo.png"));
(async()=>{
  await new Promise(r=>srv.listen(PORT,r));
  const b = await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome"});
  const p = await b.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:2});
  p.on("pageerror",e=>console.log("PAGEERROR",e.message));
  await p.goto(`http://localhost:${PORT}/matrix.html`);
  await p.evaluate(()=>localStorage.clear());
  await p.reload();
  await p.waitForSelector("body[data-ready]");

  // Company and formulary details
  await p.fill("#companyName","Northern Event Medical Ltd");
  await p.fill("#companyPhone","01234 567890");
  await p.setInputFiles("#logoFile", path.join(OUT,"_logo.png"));
  await p.waitForFunction(()=>!document.getElementById("logoPreview").hidden);
  await p.fill("#bagNumber","2026-v1");
  await p.fill("#preppedBy","Dr A. Shah");
  await p.fill("#checkedBy","F. Smith");
  await p.fill("#inServiceUntil","2027-04-01");

  // Cut the grade list down to the five asked for, using the tool's own controls.
  const keep = ["FREC 3","FREC 4","EMT","Paramedic","Doctor"];
  for (let guard = 0; guard < 40; guard++) {
    const names = await p.locator("#gradeList .grade-name input").evaluateAll(
      els => els.map(e => e.value));
    const i = names.findIndex(n => !keep.includes(n));
    if (i < 0) break;
    p.once("dialog", d => d.accept());
    await p.locator(".grade").nth(i).locator(".icon-btn.del").click();
  }
  console.log("grades:", await p.locator("#gradeList .grade-name input").evaluateAll(
    els => els.map(e => e.value)));

  // Medications
  const meds = [
   ["paracetamol tablet","Mild to moderate pain, or a high temperature.\nCheck what the patient has already taken today.", 0],
   ["glucose gel","Hypoglycaemia in a patient who can swallow safely.", 0],
   ["aspirin","Suspected heart attack, once bleeding risk is considered.", 0],
   ["salbutamol neb","Wheeze from asthma or COPD.", 1],
   ["adrenaline anaphylaxis","Anaphylaxis.", 1],
   ["ondansetron","Nausea and vomiting.", 3],
   ["naloxone 2mg pre","Respiratory depression from opioids.", 3],
   ["morphine","Severe pain, where no safer option is appropriate.", 4]];
  await p.click('[data-tab="meds"]');
  for (const [q,ind] of meds) {
    await p.fill("#quickAdd",q);
    await p.waitForSelector("#quickResults li");
    const first = p.locator("#quickResults li:not(.note)").first();
    await first.click();
    await p.fill("#mIndication",ind);
    await p.click("#medSubmit");
  }
  // Fill each row with "this grade and above" from the named column.
  await p.check('input[name=fillMode][value=up]');
  for (let r = 0; r < meds.length; r++) {
    await p.locator(`#matrixTable tr:nth-child(${r+2}) .m-cell`).nth(meds[r][2]).click();
  }
  await p.evaluate(()=>document.activeElement&&document.activeElement.blur());
  await p.evaluate(()=>window.scrollTo(0,0));
  await p.screenshot({path:path.join(OUT,"7-five-grades-app.png"), fullPage:true});

  const pdf = await p.evaluate(()=>{
    const m = JSON.parse(localStorage.getItem("drug-bag-tracker/v2")).docs.matrix;
    return window.DrugBagPDF.build(Object.assign({}, m.setup, {
      medications: m.medications, mode: "matrix",
      grades: m.grades.filter(g => (g.name||"").trim())
    })).output("datauristring");
  });
  fs.writeFileSync(path.join(OUT,"matrix-five-grades.pdf"), Buffer.from(pdf.split(",")[1],"base64"));
  await b.close(); srv.close(); console.log("done");
})();
