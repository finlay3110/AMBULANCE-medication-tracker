/* UI state and wiring. Everything is kept in localStorage on this device. */
(function () {
  "use strict";

  var KEY = "drug-bag-tracker/v2";
  var OLD_KEY = "drug-bag-tracker/v1";
  var $ = function (id) { return document.getElementById(id); };

  /* Some controls only exist on one of the two pages. */
  function on(id, fn) {
    var el = $(id);
    if (el) fn(el);
    return !!el;
  }
  function hide(id, yes) { on(id, function (el) { el.hidden = !!yes; }); }
  function setText(id, text) { on(id, function (el) { el.textContent = text; }); }

  /*
   * This script drives both generators, and the page says which documents it
   * owns: index.html the drug bag and the CD register, matrix.html the
   * formulary. They share storage but never write over each other's document,
   * so both can be open at once.
   */
  var MODES = (document.body.dataset.modes || "bag cd").trim().split(/\s+/);
  var IS_MATRIX_PAGE = MODES.length === 1 && MODES[0] === "matrix";

  function blankDoc(mode) {
    var d = { setup: {}, medications: [], meta: {} };
    if (mode === "matrix") d.grades = null;
    return d;
  }

  /*
   * Two entirely separate documents on the bag side. Controlled drugs live in
   * the CD safe, not in a drug bag, so they never share a list with bag stock.
   */
  var state = { mode: MODES[0], docs: {}, editing: null };
  MODES.forEach(function (m) { state.docs[m] = blankDoc(m); });

  function doc() { return state.docs[state.mode]; }
  function isCdMode() { return state.mode === "cd"; }
  /* The formulary: a grid of which clinical grade may give which medication. */
  function isMatrixMode() { return state.mode === "matrix"; }
  /* Both stock documents track batches and expiry; the formulary does not. */
  function isStockMode() { return !isMatrixMode(); }

  /*
   * A starting point only. Every organisation's grades differ, so these are
   * editable, reorderable and removable, and the list can be replaced wholesale.
   */
  var DEFAULT_GRADES = [
    ["First responder", "FR"],
    ["FREC 3", "FREC 3"],
    ["Emergency care assistant", "ECA"],
    ["FREC 4", "FREC 4"],
    ["AAP", "AAP"],
    ["EMT", "EMT"],
    ["FREUC 5", "FREUC 5"],
    ["Paramedic", "Para"],
    ["APP (advanced paramedic)", "APP"],
    ["Nurse", "Nurse"],
    ["Doctor", "Doctor"]
  ];

  var gradeSeq = 0;
  function newGradeId() {
    gradeSeq += 1;
    return "g" + Date.now().toString(36) + gradeSeq.toString(36);
  }

  function defaultGrades() {
    return DEFAULT_GRADES.map(function (g) {
      return { id: newGradeId(), name: g[0], abbr: g[1] };
    });
  }

  function grades() {
    var d = doc();
    if (!Array.isArray(d.grades)) d.grades = defaultGrades();
    return d.grades;
  }

  var ALL_SETUP_FIELDS = [
    "companyName", "companyPhone", "companyAddress",
    "bagNumber", "preppedBy", "checkedBy", "preppedDate", "sealNumber",
    "safeLocation", "inServiceUntil", "cqcNumber"
  ];
  /* A formulary has no seal or safe location, so its page does not carry the
     fields. Whatever this page has is what gets read and written. */
  var SETUP_FIELDS = ALL_SETUP_FIELDS.filter(function (f) { return !!$(f); });

  /* The company profile: everything that is about the organisation rather than
     a particular bag or safe, so it can be saved once and reused. */
  var COMPANY_FIELDS = ["companyName", "companyPhone", "companyAddress", "cqcNumber"];

  // Kept out of SETUP_FIELDS: not a text input, and set through its own control.
  var LOGO_MAX_EDGE = 480;      // px, plenty for print at the size it is drawn
  var LOGO_MAX_BYTES = 400000;  // keep localStorage well inside its quota

  /* Wording that differs between the two document types. */
  var WORDS = {
    bag: {
      detailsTitle: "Bag details",
      contentsTitle: "Bag contents",
      tabMeds: "2. Medications",
      medEmpty: "No medications added yet. Add the first one above.",
      saveTitle: "Save / load bag",
      saveHint: "Everything stays on this device — nothing is uploaded. Exports are named " +
        "after the drug bag number, e.g. Drug-Bag-1-saved.json.",
      generateHint: "A4 PDF: page 1 is the bag label, followed by one usage log per medication.",
      checkedByHint: "The label page carries a prepared-by / checked-by signature block. " +
        "Leave blank to sign it by hand.",
      identity: ["Drug bag number", "e.g. DB-014"],
      preppedBy: ["Prepped by", "Name of person who prepped the bag"],
      preppedDate: ["Prepped date", ""],
      checkedBy: ["Checked by", "Second person for the two-person check (optional)"],
      doses: ["Number of doses", "e.g. 12"],
      inService: ["In service until", ""],
      inServiceHint: "Optional. Expiry is then checked up to this date, so anything running " +
        "out while the bag is away is flagged.",
      quickHint: "Search the list to fill the form, then add the batch, expiry and quantity. " +
        "The suggested legal category is a starting point to save typing \u2014 check it " +
        "against your own policy and current legislation before the document is used.",
      summaryId: "Drug bag",
      addTitle: "Add medication",
      editTitle: "Edit medication"
    },
    cd: {
      detailsTitle: "CD safe details",
      contentsTitle: "Stock held in the safe",
      tabMeds: "2. Controlled drugs",
      medEmpty: "No controlled drugs added yet. Add the first one above.",
      saveTitle: "Save / load register",
      saveHint: "Everything stays on this device — nothing is uploaded. Exports are named " +
        "after the CD safe reference, e.g. CD-Register-2-saved.json.",
      generateHint: "A4 PDF: a register front sheet, a running-balance register per drug, " +
        "and a landscape sign-out sheet for drugs taken from the safe into a personal pouch.",
      checkedByHint: "The front sheet carries a stock check signature block for both people.",
      identity: ["CD safe reference", "e.g. Safe 2"],
      preppedBy: ["Accountable officer", "Name of the person responsible for the safe"],
      preppedDate: ["Register opened", ""],
      checkedBy: ["Witness", "Second person for the stock check (optional)"],
      doses: ["Quantity held", "e.g. 10"],
      inService: ["Check expiry up to", ""],
      inServiceHint: "Optional. Stock expiring before this date is flagged, so a review or " +
        "restock can be planned.",
      quickHint: "Search the list to fill the form, then add the batch, expiry and quantity. " +
        "The suggested legal category is a starting point to save typing \u2014 check it " +
        "against your own policy and current legislation before the document is used.",
      summaryId: "CD safe",
      addTitle: "Add controlled drug",
      editTitle: "Edit controlled drug"
    },
    matrix: {
      detailsTitle: "Formulary details",
      contentsTitle: "Medications in the formulary",
      tabMeds: "2. Medications",
      medEmpty: "No medications added yet. Add the first one above.",
      saveTitle: "Save / load formulary",
      saveHint: "Everything stays on this device — nothing is uploaded. Exports are named " +
        "after the formulary reference, e.g. Formulary-2026-v1-saved.json.",
      generateHint: "A4 landscape PDF: the matrix as a colour-coded table, one column per " +
        "clinical grade, with a key to the column headings and an approval block.",
      checkedByHint: "The matrix carries an approved-by / checked-by signature block.",
      identity: ["Formulary reference", "e.g. 2026-v1"],
      preppedBy: ["Approved by", "Name of the person who approved this formulary"],
      preppedDate: ["Approved date", ""],
      checkedBy: ["Checked by", "Second person who checked it (optional)"],
      doses: ["Number of doses", "e.g. 12"],
      inService: ["Review date", ""],
      inServiceHint: "Optional. Printed on the matrix so it is obvious when it is due a review.",
      quickHint: "Search the list to fill the form, then add what the medication is given " +
        "for. The suggested legal category is a starting point to save typing \u2014 check " +
        "it against your own policy and current legislation before the document is used.",
      summaryId: "Formulary",
      addTitle: "Add medication",
      editTitle: "Edit medication"
    }
  };

  function words() { return WORDS[state.mode]; }

  /* Relabel a field and its placeholder. */
  function relabel(inputId, spec) {
    var input = $(inputId);
    if (!input) return;
    var span = input.parentNode.querySelector("span");
    var required = span.querySelector("b");
    span.textContent = spec[0] + " ";
    if (required) span.appendChild(required);
    if (spec[1] !== undefined && input.type !== "date") input.placeholder = spec[1];
  }

  function applyMode() {
    var w = words();
    document.querySelectorAll("[name=docMode]").forEach(function (r) {
      r.checked = r.value === state.mode;
    });
    document.body.classList.toggle("cd-mode", isCdMode());
    document.body.classList.toggle("matrix-mode", isMatrixMode());

    relabel("bagNumber", w.identity);
    relabel("preppedBy", w.preppedBy);
    relabel("preppedDate", w.preppedDate);
    relabel("checkedBy", w.checkedBy);
    relabel("mDoses", w.doses);
    relabel("inServiceUntil", w.inService);
    setText("inServiceHint", w.inServiceHint);

    setText("detailsTitle", w.detailsTitle);
    setText("contentsTitle", w.contentsTitle);
    setText("tabMedsLabel", w.tabMeds);
    setText("medEmpty", w.medEmpty);
    setText("saveTitle", w.saveTitle);
    setText("saveHint", w.saveHint);
    setText("generateHint", w.generateHint);
    setText("quickHint", w.quickHint);
    setText("checkedByHint", w.checkedByHint);

    // Schedule and seal number are bag-only; safe location is CD-only.
    hide("f-mSchedule", isCdMode());
    hide("f-mUnit", !isCdMode());
    hide("f-sealNumber", !isBagMode());
    hide("f-safeLocation", !isCdMode());

    // A formulary records what may be given, not what is held: no batch,
    // expiry or quantity, but an indication and the grade matrix instead.
    hide("f-mIndication", !isMatrixMode());
    hide("f-mBatch", isMatrixMode());
    hide("f-mExpiry", isMatrixMode());
    hide("f-mDoses", isMatrixMode());
    if (isMatrixMode()) renderGrades();
    else renderFormulary();
  }

  function isBagMode() { return state.mode === "bag"; }

  function setMode(mode) {
    if (mode === state.mode || MODES.indexOf(mode) < 0) return;
    readSetup();
    state.mode = mode;
    hidePdfReminder();
    $("importResult").hidden = true;
    $("quickAdd").value = "";
    closeQuick();
    clearMedForm();
    fillSetup();
    applyMode();
    renderMeds();
    save();
  }

  /* ---------------- persistence ---------------- */
  /*
   * Returns false when the browser refused to store (private browsing, or the
   * quota is full — a large logo makes that a real possibility). The work is
   * still usable in this session, so say so rather than failing silently.
   */
  /*
   * Merges into what is stored rather than replacing it, so the formulary page
   * and the bag page can be open at once without either losing the other's
   * work. Returns false when the browser refused to store (private browsing,
   * or the quota is full — a large logo makes that a real possibility). The
   * work is still usable in this session, so say so rather than failing
   * silently.
   */
  function save() {
    try {
      var stored = {};
      try { stored = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { stored = {}; }
      if (!stored.docs || typeof stored.docs !== "object") stored.docs = {};
      MODES.forEach(function (m) { stored.docs[m] = state.docs[m]; });
      if (!IS_MATRIX_PAGE) stored.mode = state.mode;
      localStorage.setItem(KEY, JSON.stringify(stored));
      state.storageFailed = false;
      return true;
    } catch (e) {
      state.storageFailed = true;
      return false;
    }
  }

  function readDoc(parsed) {
    var d = {
      setup: (parsed && parsed.setup) || {},
      medications: (parsed && Array.isArray(parsed.medications)) ? parsed.medications : [],
      meta: (parsed && parsed.meta) || {}
    };
    if (parsed && parsed.formulary) d.formulary = parsed.formulary;
    return d;
  }

  /* Record that this document has changed since it was last exported. */
  function touch() {
    if (!doc().meta) doc().meta = {};
    doc().meta.changedAt = Date.now();
  }

  /* Browser storage is not a backup, so say so until a copy has been saved. */
  function needsBackup() {
    var meta = doc().meta || {};
    if (!doc().medications.length) return false;
    if (!meta.exportedAt) return true;
    return (meta.changedAt || 0) > meta.exportedAt;
  }

  function load() {
    var raw, old;
    try {
      raw = localStorage.getItem(KEY);
      old = localStorage.getItem(OLD_KEY);
    } catch (e) { return; }

    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        var docs = parsed.docs || {};
        if (MODES.indexOf(parsed.mode) >= 0) state.mode = parsed.mode;
        MODES.forEach(function (m) {
          state.docs[m] = readDoc(docs[m]);
          if (m === "matrix") {
            var g = docs.matrix && docs.matrix.grades;
            state.docs.matrix.grades = Array.isArray(g) ? g : null;
          }
        });
      } catch (e) { /* ignore corrupt data */ }
      return;
    }

    // Migrate a v1 bag, moving any controlled drugs into the CD register.
    if (old && !IS_MATRIX_PAGE) {
      try { state.docs.bag = splitLegacy(readDoc(JSON.parse(old))); }
      catch (e) { /* ignore corrupt data */ }
    }
  }

  /* v1 allowed CDs inside a bag; they belong in the safe, so move them out. */
  function splitLegacy(bag) {
    var cds = bag.medications.filter(function (m) { return m.schedule === "CD"; });
    if (cds.length) {
      state.docs.cd = {
        setup: JSON.parse(JSON.stringify(bag.setup)),
        medications: cds
      };
      state.docs.cd.setup.bagNumber = "";
      bag.medications = bag.medications.filter(function (m) { return m.schedule !== "CD"; });
    }
    return bag;
  }

  /* ---------------- setup tab ---------------- */
  function readSetup() {
    var setup = doc().setup;
    var before = JSON.stringify(setup);
    var wasInService = setup.inServiceUntil;
    SETUP_FIELDS.forEach(function (f) { setup[f] = $(f).value.trim(); });
    setup.cqcRegistered = !!($("cqcRegistered") && $("cqcRegistered").checked);
    if (JSON.stringify(setup) !== before) touch();
    save();
    // The service window decides every expiry flag, so the list needs redrawing.
    if (setup.inServiceUntil !== wasInService) renderMeds();
    else renderSummary();
  }

  function fillSetup() {
    var setup = doc().setup;
    SETUP_FIELDS.forEach(function (f) { $(f).value = setup[f] || ""; });
    on("cqcRegistered", function (el) { el.checked = !!setup.cqcRegistered; });
    syncCqc();
    showLogo();
    resetLogoHint();
    if (!$("preppedDate").value) {
      $("preppedDate").value = new Date().toISOString().slice(0, 10);
      setup.preppedDate = $("preppedDate").value;
    }
  }

  /* ---------------- clinical grades ---------------- */

  function gradeError(text) {
    var box = $("gradeError");
    if (!box) return;
    box.textContent = text || "";
    box.hidden = !text;
  }

  function renderGrades() {
    var list = $("gradeList");
    if (!list) return;
    list.textContent = "";
    grades().forEach(function (g, i) {
      var row = document.createElement("div");
      row.className = "grade";

      var order = document.createElement("span");
      order.className = "grade-order";
      order.textContent = String(i + 1);
      row.appendChild(order);

      [["name", "Full name", "grade-name"], ["abbr", "Short label", "grade-abbr"]]
        .forEach(function (spec) {
          var field = document.createElement("label");
          field.className = "grade-field " + spec[2];
          var cap = document.createElement("span");
          cap.textContent = spec[1];
          var input = document.createElement("input");
          input.type = "text";
          input.value = g[spec[0]] || "";
          input.setAttribute("aria-label", spec[1] + " for grade " + (i + 1));
          input.addEventListener("input", function () {
            g[spec[0]] = input.value;
            gradeError("");
            touch();
            save();
            renderMatrix();
          });
          field.appendChild(cap);
          field.appendChild(input);
          row.appendChild(field);
        });

      var btns = document.createElement("div");
      btns.className = "grade-btns";
      [["\u2191", function () { moveGrade(i, -1); }, ""],
       ["\u2193", function () { moveGrade(i, 1); }, ""],
       ["Remove", function () { removeGrade(i); }, "del"]].forEach(function (spec) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "icon-btn " + spec[2];
        b.textContent = spec[0];
        b.addEventListener("click", spec[1]);
        btns.appendChild(b);
      });
      row.appendChild(btns);
      list.appendChild(row);
    });
  }

  function moveGrade(index, delta) {
    var to = index + delta;
    var list = grades();
    if (to < 0 || to >= list.length) return;
    list.splice(to, 0, list.splice(index, 1)[0]);
    touch();
    save();
    renderGrades();
    renderMatrix();
  }

  function removeGrade(index) {
    var list = grades();
    var g = list[index];
    if (!confirm("Remove the grade \u201c" + (g.name || "untitled") +
                 "\u201d and everything ticked against it?")) return;
    list.splice(index, 1);
    // Leave no orphaned permissions behind.
    doc().medications.forEach(function (m) {
      if (m.allow) delete m.allow[g.id];
    });
    touch();
    save();
    renderGrades();
    renderMatrix();
  }

  function addGrade() {
    grades().push({ id: newGradeId(), name: "", abbr: "" });
    touch();
    save();
    renderGrades();
    renderMatrix();
    var inputs = $("gradeList").querySelectorAll(".grade-name input");
    if (inputs.length) inputs[inputs.length - 1].focus();
  }

  function restoreDefaultGrades() {
    if (!confirm("Replace the grade list with the default one? Anything ticked against your " +
                 "current grades is lost.")) return;
    doc().grades = defaultGrades();
    doc().medications.forEach(function (m) { m.allow = {}; });
    touch();
    save();
    renderGrades();
    renderMatrix();
  }

  /* Grades with nothing in the name box cannot be a column heading. */
  function namedGrades() {
    return grades().filter(function (g) { return (g.name || "").trim(); });
  }

  /* ---------------- the matrix ---------------- */

  function fillMode() {
    var picked = document.querySelector("[name=fillMode]:checked");
    return picked ? picked.value : "toggle";
  }

  function allowed(med, gradeId) {
    return !!(med.allow && med.allow[gradeId]);
  }

  function setAllowed(med, gradeId, value) {
    if (!med.allow) med.allow = {};
    if (value) med.allow[gradeId] = true;
    else delete med.allow[gradeId];
  }

  /*
   * A click means different things depending on the fill mode. "This grade and
   * above" is the one that matters: formularies are usually written as "from
   * paramedic upwards", and setting eleven cells one at a time is the tedium
   * this exists to remove.
   */
  function cellClicked(med, index) {
    var list = grades();
    var mode = fillMode();
    if (mode === "toggle") {
      setAllowed(med, list[index].id, !allowed(med, list[index].id));
    } else {
      var from = mode === "up" ? index : 0;
      var to = mode === "up" ? list.length - 1 : index;
      list.forEach(function (g, i) { setAllowed(med, g.id, i >= from && i <= to); });
    }
    touch();
    save();
    renderMatrix();
  }

  function fillRow(med) {
    var list = grades();
    var all = list.every(function (g) { return allowed(med, g.id); });
    list.forEach(function (g) { setAllowed(med, g.id, !all); });
    touch();
    save();
    renderMatrix();
  }

  function fillColumn(gradeId) {
    var meds = doc().medications;
    var all = meds.every(function (m) { return allowed(m, gradeId); });
    meds.forEach(function (m) { setAllowed(m, gradeId, !all); });
    touch();
    save();
    renderMatrix();
  }

  function renderMatrix() {
    if (!isMatrixMode()) return;
    var table = $("matrixTable");
    if (!table) return;
    var meds = doc().medications;
    var list = namedGrades();
    table.textContent = "";
    $("matrixEmpty").hidden = !(meds.length === 0 || list.length === 0);
    $("matrixEmpty").textContent = meds.length === 0
      ? "Add medications above and they appear here, one row each."
      : "Name at least one clinical grade on the setup tab to build the matrix.";
    if (!meds.length || !list.length) return;

    var head = document.createElement("tr");
    var corner = document.createElement("th");
    corner.className = "m-med";
    corner.textContent = "Medication";
    head.appendChild(corner);
    list.forEach(function (g) {
      var th = document.createElement("th");
      var b = document.createElement("button");
      b.type = "button";
      b.className = "m-head";
      b.textContent = (g.abbr || g.name).trim();
      b.title = "Fill the whole " + g.name + " column";
      b.addEventListener("click", function () { fillColumn(g.id); });
      th.appendChild(b);
      head.appendChild(th);
    });
    table.appendChild(head);

    meds.forEach(function (m) {
      var tr = document.createElement("tr");
      var thead = document.createElement("th");
      thead.className = "m-med";
      var rowBtn = document.createElement("button");
      rowBtn.type = "button";
      rowBtn.className = "m-row";
      rowBtn.textContent = m.name;
      rowBtn.title = "Fill the whole row";
      rowBtn.addEventListener("click", function () { fillRow(m); });
      thead.appendChild(rowBtn);
      tr.appendChild(thead);

      list.forEach(function (g) {
        var td = document.createElement("td");
        var on = allowed(m, g.id);
        var cell = document.createElement("button");
        cell.type = "button";
        cell.className = "m-cell " + (on ? "yes" : "no");
        cell.textContent = on ? "\u2713" : "\u2717";
        cell.setAttribute("aria-label",
          m.name + ", " + g.name + ": " + (on ? "allowed" : "not allowed"));
        cell.setAttribute("aria-pressed", on ? "true" : "false");
        cell.addEventListener("click", function () {
          cellClicked(m, grades().indexOf(g));
        });
        td.appendChild(cell);
        tr.appendChild(td);
      });
      table.appendChild(tr);
    });
  }

  /* ---------------- attached formulary ---------------- */
  /*
   * The matrix is made in its own generator (matrix.html) and exported as a
   * .json. Attaching that file here keeps a copy with the bag or register, so
   * the paperwork can carry the table as well: what is held, and who may give
   * it, in one document.
   */
  function isFormulary(parsed) {
    return !!parsed && typeof parsed === "object" && !Array.isArray(parsed) &&
      parsed.mode === "matrix" && Array.isArray(parsed.medications) &&
      Array.isArray(parsed.grades);
  }

  function formularyMessage(kind, text) {
    on("formularyResult", function (box) {
      box.className = "notice " + kind;
      box.textContent = text;
      box.hidden = false;
    });
  }

  function namedIn(f) {
    return (f.grades || []).filter(function (g) { return (g.name || "").trim(); });
  }

  function formularyRef(f) {
    return ((f.setup && f.setup.bagNumber) || "").trim();
  }

  function renderFormulary() {
    var f = doc().formulary;
    hide("formularyRemove", !f);
    on("formularyBtn", function (b) {
      b.textContent = f ? "Attach a different formulary (.json)" : "Attach a formulary (.json)";
    });
    if (!f) {
      hide("formularyResult", true);
      return;
    }
    var meds = f.medications.length;
    var gs = namedIn(f).length;
    formularyMessage("good", "Formulary " + (formularyRef(f) || "\u2014") + " attached: " +
      meds + " medication" + (meds === 1 ? "" : "s") + " across " +
      gs + " grade" + (gs === 1 ? "" : "s") + ". Its table is printed at the end of this " +
      "document.");
  }

  function attachFormulary(parsed, name) {
    if (!namedIn(parsed).length || !parsed.medications.length) {
      formularyMessage("bad", "\u201c" + name + "\u201d is a formulary, but it has no " +
        "medications or no named grades, so there is nothing to print. Nothing has been " +
        "attached.");
      return false;
    }
    doc().formulary = {
      setup: parsed.setup || {},
      medications: parsed.medications,
      grades: parsed.grades
    };
    touch();
    save();
    renderFormulary();
    renderSummary();
    return true;
  }

  function removeFormulary() {
    delete doc().formulary;
    touch();
    save();
    renderFormulary();
    renderSummary();
  }

  function readFormularyFile(file) {
    var reader = new FileReader();
    reader.onerror = function () {
      formularyMessage("bad", "That file could not be read.");
    };
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        formularyMessage("bad", "\u201c" + file.name + "\u201d is not a valid .json file. " +
          "Nothing has been attached.");
        return;
      }
      if (!isFormulary(parsed)) {
        formularyMessage("bad", "\u201c" + file.name + "\u201d is not a formulary exported " +
          "from the drug matrix generator. Nothing has been attached.");
        return;
      }
      attachFormulary(parsed, file.name);
    };
    reader.readAsText(file);
  }

  /* ---------------- company profile ---------------- */

  /* The registration number is only asked for, and only printed, when the
     organisation says it is registered. */
  function syncCqc() {
    $("f-cqcNumber").hidden = !$("cqcRegistered").checked;
  }

  function companyMessage(kind, text) {
    var box = $("companyResult");
    box.className = "notice " + kind;
    box.textContent = text;
    box.hidden = false;
  }

  function companyFileName() {
    var name = (doc().setup.companyName || "")
      .trim().replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return "Company-" + (name || "details") + ".json";
  }

  function exportCompany() {
    readSetup();
    var setup = doc().setup;
    var profile = { format: "drug-bag-tracker/company", version: 1 };
    COMPANY_FIELDS.forEach(function (f) { profile[f] = setup[f] || ""; });
    profile.cqcRegistered = !!setup.cqcRegistered;
    if (setup.logo) {
      profile.logo = setup.logo;
      profile.logoW = setup.logoW;
      profile.logoH = setup.logoH;
    }

    var blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = companyFileName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    companyMessage("good", "Saved as " + companyFileName() + ".");
  }

  /*
   * Accepts a company file, and also a whole exported bag or register, taking
   * just the company half of it — so details can be lifted from any old export.
   */
  function companyFrom(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed.format === "drug-bag-tracker/company") return parsed;
    if (parsed.setup && typeof parsed.setup === "object") return parsed.setup;
    if (typeof parsed.companyName === "string") return parsed;
    return null;
  }

  function importCompany(file) {
    var reader = new FileReader();
    reader.onerror = function () { companyMessage("bad", "That file could not be read."); };
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        companyMessage("bad", "\u201c" + file.name + "\u201d is not a valid .json file.");
        return;
      }
      var profile = companyFrom(parsed);
      if (!profile) {
        companyMessage("bad", "\u201c" + file.name + "\u201d does not contain company details. " +
          "Nothing has been changed.");
        return;
      }

      var setup = doc().setup;
      COMPANY_FIELDS.forEach(function (f) {
        if (typeof profile[f] === "string") setup[f] = profile[f];
      });
      setup.cqcRegistered = !!profile.cqcRegistered;
      if (typeof profile.logo === "string" && profile.logo) {
        setup.logo = profile.logo;
        setup.logoW = profile.logoW || 0;
        setup.logoH = profile.logoH || 0;
      }
      touch();
      fillSetup();
      save();
      renderSummary();
      companyMessage("good", "Loaded company details for " +
        (setup.companyName || "this organisation") +
        (profile.logo ? ", including the logo." : "."));
    };
    reader.readAsText(file);
  }

  /* ---------------- theme ---------------- */

  /*
   * Kept under its own key rather than in the document state, so it survives
   * "clear all" and is shared by both documents. "auto" stores nothing on the
   * root element and lets prefers-color-scheme decide.
   */
  var THEME_KEY = "drug-bag-tracker/theme";
  var THEMES = ["auto", "light", "dark"];
  var theme = "auto";

  function applyTheme() {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    $("themeBtn").textContent = "Theme: " + theme;
    $("themeBtn").setAttribute("aria-label", "Colour theme: " + theme + ". Click to change.");
  }

  function loadTheme() {
    var stored;
    try { stored = localStorage.getItem(THEME_KEY); } catch (e) { stored = null; }
    if (THEMES.indexOf(stored) >= 0) theme = stored;
    applyTheme();
  }

  function cycleTheme() {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* not fatal */ }
    applyTheme();
  }

  /* ---------------- expiry picker ---------------- */

  /* Safari has never supported <input type="month">; it renders a text box. */
  function supportsInput(type) {
    var probe = document.createElement("input");
    probe.setAttribute("type", type);
    return probe.type === type;
  }

  var HAS_MONTH_INPUT = supportsInput("month");

  /*
   * Remembered separately because by the time the precision select fires its
   * change event it already reads as the new precision, so the value that was
   * on screen a moment ago can no longer be read back through it.
   */
  var lastExpiry = "";

  function expiryPrecision() {
    return $("mExpiryPrecision").value === "day" ? "day" : "month";
  }

  /* Show the control matching the chosen precision. */
  function syncExpiryInputs() {
    var day = expiryPrecision() === "day";
    if (!HAS_MONTH_INPUT && !day) {
      $("mExpiryMonth").hidden = true;
      $("mExpiryDate").hidden = true;
      $("mExpiryText").hidden = false;
      return;
    }
    $("mExpiryText").hidden = true;
    $("mExpiryMonth").hidden = day;
    $("mExpiryDate").hidden = !day;
  }

  /* The canonical value: YYYY-MM for a month, YYYY-MM-DD for an exact date. */
  function expiryValue() {
    if (expiryPrecision() === "day") return $("mExpiryDate").value.trim();
    return HAS_MONTH_INPUT ? $("mExpiryMonth").value.trim() : $("mExpiryText").value.trim();
  }

  function setExpiryValue(raw) {
    var parsed = window.Expiry.parse(raw);
    lastExpiry = parsed ? parsed.iso : "";
    $("mExpiryMonth").value = "";
    $("mExpiryDate").value = "";
    $("mExpiryText").value = "";

    if (!parsed) {
      $("mExpiryPrecision").value = "month";
      if (!HAS_MONTH_INPUT) $("mExpiryText").value = raw || "";
      syncExpiryInputs();
      return;
    }
    $("mExpiryPrecision").value = parsed.precision;
    if (parsed.precision === "day") {
      $("mExpiryDate").value = parsed.iso;
    } else if (HAS_MONTH_INPUT) {
      $("mExpiryMonth").value = parsed.iso;
    } else {
      $("mExpiryText").value = parsed.iso;
    }
    syncExpiryInputs();
  }

  /* ---------------- quick add ---------------- */

  var quick = { items: [], active: -1, closeTimer: null };

  /* Blur closes the list after a beat so a click can land; typing again must
     cancel that, or freshly rendered results get hidden underneath you. */
  function cancelQuickClose() {
    if (quick.closeTimer) {
      clearTimeout(quick.closeTimer);
      quick.closeTimer = null;
    }
  }

  function closeQuick() {
    cancelQuickClose();
    quick.items = [];
    quick.active = -1;
    $("quickResults").hidden = true;
    $("quickAdd").setAttribute("aria-expanded", "false");
  }

  /* Fill the form from a catalogue entry; everything stays editable after. */
  function applyCatalogue(entry, keepStrength) {
    clearMedForm();
    $("mName").value = entry.name;
    if (keepStrength) {
      $("mPresentation").value = entry.form;
      $("mDose").value = entry.strength;
    }
    if (!isCdMode() && entry.schedule && entry.schedule !== "CD") {
      $("mSchedule").value = entry.schedule;
    }
    $("quickAdd").value = "";
    closeQuick();
    logQuickNote(entry, keepStrength);
    ($(keepStrength ? "mBatch" : "mPresentation")).focus();
  }

  function logQuickNote(entry, keepStrength) {
    var box = $("medNote");
    var text = keepStrength
      ? (entry.note || "")
      : "Enter the formulation and strength you hold for " + entry.name + ".";
    box.textContent = text;
    box.hidden = !text;
  }

  function optionRow(label, meta, tag, onPick, extraClass) {
    var li = document.createElement("li");
    if (extraClass) li.className = extraClass;
    li.setAttribute("role", "option");
    var main = document.createElement("div");
    main.className = "q-main";
    var name = document.createElement("div");
    name.className = "q-name";
    name.textContent = label;
    main.appendChild(name);
    if (meta) {
      var m = document.createElement("div");
      m.className = "q-meta";
      m.textContent = meta;
      main.appendChild(m);
    }
    li.appendChild(main);
    if (tag) {
      var t = document.createElement("span");
      t.className = "q-tag " + tag;
      t.textContent = tag;
      li.appendChild(t);
    }
    if (onPick) {
      // mousedown only holds focus in the search box; the row acts on click, so
      // it is still in the document when the click lands.
      li.addEventListener("mousedown", function (ev) { ev.preventDefault(); });
      li.addEventListener("click", onPick);
      quick.items.push(onPick);
    }
    return li;
  }

  function renderQuick() {
    cancelQuickClose();
    var query = $("quickAdd").value.trim();
    var list = $("quickResults");
    list.textContent = "";
    quick.items = [];
    quick.active = -1;

    if (!query) { closeQuick(); return; }

    var matches = window.Medicines.search(query, { cd: isCdMode() }).slice(0, 8);
    matches.forEach(function (entry) {
      list.appendChild(optionRow(entry.name, entry.form + "  ·  " + entry.strength,
        isCdMode() ? "CD" : entry.schedule,
        function () { applyCatalogue(entry, true); }));
    });

    // Another strength or formulation of something already matched.
    window.Medicines.matchingNames(query, { cd: isCdMode() }).slice(0, 3).forEach(function (entry) {
      list.appendChild(optionRow(entry.name + " \u2014 other strength or formulation",
        "Fills the name, then you type the formulation and strength you hold",
        isCdMode() ? "CD" : entry.schedule,
        function () { applyCatalogue(entry, false); }));
    });

    // Controlled drugs belong on the register, so say where they went.
    if (!isCdMode()) {
      var cds = window.Medicines.matchingControlled(query);
      if (cds.length) {
        list.appendChild(optionRow(
          cds.map(function (m) { return m.name; }).filter(function (n, i, a) {
            return a.indexOf(n) === i;
          }).join(", ") + ": controlled drug",
          "Held in the CD safe, not in a drug bag. Switch the document type on the setup " +
          "tab to record it.", "", null, "note"));
      }
    }

    list.appendChild(optionRow("Not on the list \u2014 enter it manually",
      "Type the medication into the form below", "", function () {
        $("quickAdd").value = "";
        closeQuick();
        clearMedForm();
        $("mName").focus();
      }, "manual"));

    list.hidden = false;
    $("quickAdd").setAttribute("aria-expanded", "true");
  }

  function moveQuick(delta) {
    var rows = $("quickResults").querySelectorAll("li[role=option]");
    var pickable = [];
    rows.forEach(function (r) { if (!r.classList.contains("note")) pickable.push(r); });
    if (!pickable.length) return;
    pickable.forEach(function (r) { r.classList.remove("active"); });
    quick.active = (quick.active + delta + pickable.length) % pickable.length;
    pickable[quick.active].classList.add("active");
    pickable[quick.active].scrollIntoView({ block: "nearest" });
  }

  /* ---------------- company logo ---------------- */

  function showLogo() {
    var src = doc().setup.logo || "";
    $("logoPreview").hidden = !src;
    $("logoRemove").hidden = !src;
    if (src) $("logoImg").src = src;
    $("logoBtn").textContent = src ? "Replace image\u2026" : "Choose image\u2026";
  }

  function logoMessage(kind, text) {
    var hint = $("logoHint");
    hint.className = "echo" + (kind ? " " + kind : "");
    hint.textContent = text;
  }

  function resetLogoHint() {
    logoMessage("", "PNG or JPEG, printed at the top of the document. Stored with it " +
      "and included when you export it.");
  }

  /* Scale down before storing: a phone photo would blow the storage quota. */
  function readLogo(file) {
    var reader = new FileReader();
    reader.onerror = function () { logoMessage("bad", "That image could not be read."); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () {
        logoMessage("bad", "\u201c" + file.name + "\u201d could not be read as an image.");
      };
      img.onload = function () {
        var scale = Math.min(1, LOGO_MAX_EDGE / Math.max(img.width, img.height));
        var w = Math.max(1, Math.round(img.width * scale));
        var h = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);

        // PNG keeps transparency; fall back to JPEG if that comes out too big.
        var data = canvas.toDataURL("image/png");
        if (data.length > LOGO_MAX_BYTES) data = canvas.toDataURL("image/jpeg", 0.85);
        if (data.length > LOGO_MAX_BYTES) {
          logoMessage("bad", "That image is too large to store. Try a smaller or simpler one.");
          return;
        }

        doc().setup.logo = data;
        doc().setup.logoW = w;
        doc().setup.logoH = h;
        touch();
        showLogo();
        if (save()) {
          logoMessage("good", "Logo set from \u201c" + file.name + "\u201d.");
        } else {
          logoMessage("bad", "Logo set, but this browser would not store it \u2014 export the " +
            ".json to keep it.");
        }
        renderSummary();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  function removeLogo() {
    delete doc().setup.logo;
    delete doc().setup.logoW;
    delete doc().setup.logoH;
    touch();
    showLogo();
    resetLogoHint();
    save();
    renderSummary();
  }

  /* ---------------- tabs ---------------- */
  function showTab(name) {
    document.querySelectorAll(".tab").forEach(function (t) {
      var on = t.dataset.tab === name;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", String(on));
    });
    document.querySelectorAll(".panel").forEach(function (p) {
      p.classList.toggle("active", p.id === "panel-" + name);
    });
    if (name === "generate") renderSummary();
    window.scrollTo(0, 0);
  }

  /* ---------------- medications ---------------- */
  function medFromForm() {
    var m = {
      name: $("mName").value.trim(),
      presentation: $("mPresentation").value.trim(),
      dose: $("mDose").value.trim(),
      schedule: isCdMode() ? "CD" : $("mSchedule").value
    };
    if (isMatrixMode()) {
      m.indication = $("mIndication").value.trim();
      // Permissions belong to the entry, and survive an edit of its details.
      m.allow = (state.editing !== null && doc().medications[state.editing].allow) || {};
      return m;
    }
    m.batch = $("mBatch").value.trim();
    m.expiry = expiryValue();
    m.doses = parseInt($("mDoses").value, 10);
    m.unit = isCdMode() ? ($("mUnit").value.trim() || "ampoules") : "";
    return m;
  }

  function validateMed(m) {
    if (!m.name) return "Enter the medication name.";
    if (isMatrixMode() && !m.indication) return "Enter what the medication is given for.";
    if (!m.presentation) return "Enter the presentation (tablet, sachet, ampoule…).";
    if (!m.dose) return "Enter the dose or strength.";
    if (isMatrixMode()) return null;
    if (!m.expiry) {
      return expiryPrecision() === "day" ? "Pick the expiry date." : "Pick the expiry month.";
    }
    if (!window.Expiry.parse(m.expiry)) {
      return "Expiry \u201c" + m.expiry + "\u201d was not understood. Use a month " +
        "(07/25, 10/2027, Oct 2025) or a full date (18/10/2025).";
    }
    var label = words().doses[0];
    if (!m.doses || m.doses < 1) return label + " must be at least 1.";
    if (m.doses > 200) return label + " is capped at 200 per medication.";
    return null;
  }

  function clearMedForm() {
    ["mName", "mPresentation", "mDose", "mBatch", "mDoses", "mIndication"].forEach(function (id) {
      $(id).value = "";
    });
    $("mExpiryPrecision").value = "month";
    setExpiryValue("");
    $("mSchedule").value = "GSL";
    $("mUnit").value = isCdMode() ? "ampoules" : "";
    $("medNote").hidden = true;
    updateExpiryEcho();
    state.editing = null;
    $("medFormTitle").textContent = words().addTitle;
    $("medSubmit").textContent = words().addTitle;
    $("medCancel").hidden = true;
    $("medError").hidden = true;
  }

  function startEdit(index) {
    var m = doc().medications[index];
    $("mName").value = m.name;
    $("mPresentation").value = m.presentation;
    $("mDose").value = m.dose;
    $("mIndication").value = m.indication || "";
    $("mBatch").value = m.batch || "";
    setExpiryValue(m.expiry || "");
    $("mDoses").value = m.doses || "";
    $("mSchedule").value = m.schedule || "GSL";
    $("mUnit").value = m.unit || (isCdMode() ? "ampoules" : "");
    updateExpiryEcho();
    state.editing = index;
    $("medFormTitle").textContent = words().editTitle;
    $("medSubmit").textContent = "Save changes";
    $("medCancel").hidden = false;
    $("medError").hidden = true;
    $("mName").focus();
    window.scrollTo(0, 0);
  }

  /*
   * Prefill the form from an existing entry, leaving batch, expiry and quantity
   * blank. Each batch is held as its own entry so it gets its own log page and,
   * for a controlled drug, its own running balance.
   */
  function copyForNewBatch(index) {
    var m = doc().medications[index];
    clearMedForm();
    $("mName").value = m.name;
    $("mPresentation").value = m.presentation;
    $("mDose").value = m.dose;
    $("mSchedule").value = m.schedule || "GSL";
    $("mUnit").value = m.unit || (isCdMode() ? "ampoules" : "");
    $("medFormTitle").textContent = "Add another batch of " + m.name;
    $("mBatch").focus();
    window.scrollTo(0, 0);
  }

  function move(index, delta) {
    var to = index + delta;
    if (to < 0 || to >= doc().medications.length) return;
    var m = doc().medications.splice(index, 1)[0];
    doc().medications.splice(to, 0, m);
    if (state.editing === index) state.editing = to;
    touch();
    save();
    renderMeds();
  }


  /* Live confirmation of how the typed expiry was read. */
  function updateExpiryEcho() {
    var el = $("mExpiryEcho");
    var raw = expiryValue();
    if (raw) lastExpiry = raw;
    if (!raw) {
      el.className = "echo";
      el.textContent = expiryPrecision() === "day"
        ? "Pick the exact date printed on the pack."
        : "Most packs state a month, which runs to the last day of that month. " +
          "Switch to an exact date where the pack gives one.";
      return;
    }
    var p = window.Expiry.parse(raw);
    if (!p) {
      el.className = "echo bad";
      el.textContent = "Not understood. Try 07/25, 10/2027, Oct 2025 or 18/10/2025.";
      return;
    }
    var st = window.Expiry.status(p);
    var days = window.Expiry.daysLeft(p);
    var reads = "Reads as " + window.Expiry.format(p) +
      (p.precision === "month" ? " (in date to the end of that month)" : "");
    if (st === "expired") {
      el.className = "echo bad";
      el.textContent = reads + " \u2014 already expired.";
    } else if (st === "soon") {
      el.className = "echo warn";
      el.textContent = reads + " \u2014 expires in " + days + " days.";
    } else {
      el.className = "echo good";
      el.textContent = reads + ".";
    }
  }

  function renderMeds() {
    var list = $("medList");
    list.textContent = "";
    doc().medications.forEach(function (m, i) {
      var row = document.createElement("div");
      row.className = "med s-" + (m.schedule || "GSL");

      var main = document.createElement("div");
      var name = document.createElement("div");
      name.className = "med-name";
      var tag = document.createElement("span");
      tag.className = "med-tag";
      tag.textContent = m.schedule || "GSL";
      name.appendChild(tag);
      name.appendChild(document.createTextNode(m.name));

      if (isStockMode() &&
          doc().medications.filter(function (o) { return o.name === m.name; }).length > 1) {
        var multi = document.createElement("span");
        multi.className = "chip batch";
        multi.textContent = "batch " + (m.batch || "—");
        name.appendChild(multi);
      }

      var parsed = window.Expiry.parse(m.expiry);
      var st = isStockMode()
        ? window.Expiry.serviceStatus(parsed, doc().setup.inServiceUntil)
        : "unknown";
      if (st !== "ok" && st !== "unknown") {
        var chip = document.createElement("span");
        chip.className = "chip " + (st === "soon" ? "warn" : "bad");
        chip.textContent = st === "expired" ? "EXPIRED"
          : st === "in-service" ? "EXPIRES IN SERVICE"
          : "Expires in " + window.Expiry.daysLeft(parsed) + "d";
        name.appendChild(chip);
      }

      var meta = document.createElement("div");
      meta.className = "med-meta";
      meta.textContent = isMatrixMode()
        ? m.presentation + " · " + m.dose + " · " +
          (m.indication || "").split(/\n+/).filter(Boolean).join("; ")
        : m.presentation + " · " + m.dose + " · x" + m.doses +
          (isCdMode() ? " " + (m.unit || "held") : " dose" + (m.doses === 1 ? "" : "s")) +
          " · batch " + (m.batch || "—") +
          " · exp " + window.Expiry.format(parsed, m.expiry);
      main.appendChild(name);
      main.appendChild(meta);

      var btns = document.createElement("div");
      btns.className = "med-btns";
      [["↑", function () { move(i, -1); }, ""],
       ["↓", function () { move(i, 1); }, ""]]
      .concat(isStockMode() ? [["Copy", function () { copyForNewBatch(i); }, ""]] : [])
      .concat([
       ["Edit", function () { startEdit(i); }, ""],
       ["Delete", function () {
          if (confirm("Remove " + m.name + " from this " +
              (isMatrixMode() ? "formulary" : isCdMode() ? "register" : "bag") + "?")) {
            doc().medications.splice(i, 1);
            if (state.editing === i) clearMedForm();
            touch();
            save();
            renderMeds();
          }
        }, "del"]]).forEach(function (spec) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "icon-btn " + spec[2];
        b.textContent = spec[0];
        b.addEventListener("click", spec[1]);
        btns.appendChild(b);
      });

      row.appendChild(main);
      row.appendChild(btns);
      list.appendChild(row);
    });

    var n = doc().medications.length;
    $("medCount").textContent = n;
    $("medCount2").textContent = n;
    $("medEmpty").hidden = n > 0;
    renderMatrix();
    renderSummary();
  }

  function tickedCells() {
    var list = namedGrades();
    return doc().medications.reduce(function (total, m) {
      return total + list.filter(function (g) { return allowed(m, g.id); }).length;
    }, 0);
  }

  function renderSummary() {
    var totalDoses = doc().medications.reduce(function (a, m) {
      return a + (parseInt(m.doses, 10) || 0);
    }, 0);
    var until = doc().setup.inServiceUntil;
    var first = window.Expiry.earliest(doc().medications);
    var items = isMatrixMode()
      ? [
          [words().summaryId, doc().setup.bagNumber || "—"],
          ["Company", doc().setup.companyName || "—"],
          ["Review date", until
            ? window.Expiry.format(window.Expiry.parse(until), until) : "—"],
          ["Medications", String(doc().medications.length)],
          ["Clinical grades", String(namedGrades().length)],
          ["Cells ticked", String(tickedCells())]
        ]
      : [
          [words().summaryId, doc().setup.bagNumber || "—"],
          ["Company", doc().setup.companyName || "—"],
          [isCdMode() ? "Earliest expiry" : "Bag expires",
            first ? window.Expiry.format(first.parsed) : "—",
            first ? window.Expiry.serviceStatus(first.parsed, until) : "unknown"],
          [isCdMode() ? "Controlled drugs" : "Medications", String(doc().medications.length)],
          [isCdMode() ? "Total quantity held" : "Total logged doses", String(totalDoses)],
          ["Pages", String((isCdMode() ? 2 : 1) + doc().medications.length) + "+"]
        ];
    if (!isMatrixMode() && doc().formulary) {
      items.push(["Drug matrix",
        "Attached" + (formularyRef(doc().formulary)
          ? " (" + formularyRef(doc().formulary) + ")" : "")]);
    }
    var box = $("summary");
    box.textContent = "";
    items.forEach(function (it) {
      var d = document.createElement("dl");
      d.className = "sum-item" +
        (it[2] === "expired" ? " bad" : it[2] === "soon" ? " warn" : "");
      var dt = document.createElement("dt");
      dt.textContent = it[0];
      var dd = document.createElement("dd");
      dd.textContent = it[1];
      d.appendChild(dt); d.appendChild(dd);
      box.appendChild(d);
    });

    if (!$("pdfReminder").hidden) showPdfReminder();

    var backup = $("backupWarning");
    if (state.storageFailed) {
      backup.className = "notice bad";
      backup.textContent = "This browser is not storing your work \u2014 it may be full, or in " +
        "private browsing. Export the .json now, or you will lose this when the tab closes.";
      backup.hidden = false;
    } else if (needsBackup()) {
      var never = !(doc().meta || {}).exportedAt;
      backup.className = "notice warn";
      backup.textContent = never
        ? "This " + (isCdMode() ? "register" : "bag") + " has never been exported. It lives only " +
          "in this browser, and clearing site data or using a private window will lose it \u2014 " +
          "export a copy to keep."
        : "Changed since the last export. Export again so your saved copy matches.";
      backup.hidden = false;
    } else {
      backup.hidden = true;
    }

    var warn = $("expiryWarning");
    var names = function (list) {
      return list.map(function (m) { return m.name; }).join(", ");
    };
    if (isMatrixMode()) {
      // Nothing expires in a formulary; a row nobody can give is the mistake.
      var nobody = doc().medications.filter(function (m) {
        return !namedGrades().some(function (g) { return allowed(m, g.id); });
      });
      if (nobody.length) {
        warn.className = "notice warn";
        warn.textContent = nobody.length +
          (nobody.length === 1 ? " medication has" : " medications have") +
          " no grade ticked, so nobody may give " +
          (nobody.length === 1 ? "it" : "them") + ": " + names(nobody) + ".";
        warn.hidden = false;
      } else {
        warn.hidden = true;
      }
      return;
    }
    var expired = doc().medications.filter(function (m) {
      return window.Expiry.status(window.Expiry.parse(m.expiry)) === "expired";
    });
    var inService = window.Expiry.expiringInService(doc().medications, until);
    var soon = doc().medications.filter(function (m) {
      return window.Expiry.serviceStatus(window.Expiry.parse(m.expiry), until) === "soon";
    });
    if (inService.length && !expired.length) {
      warn.className = "notice bad";
      warn.textContent = inService.length +
        (inService.length === 1 ? " medication expires" : " medications expire") +
        " before " + window.Expiry.format(
          window.Expiry.parse(until), until) + ", while this " +
        (isCdMode() ? "stock is in date" : "bag is in service") + ": " + names(inService) + ".";
      warn.hidden = false;
    } else if (expired.length) {
      warn.className = "notice bad";
      warn.textContent = expired.length + " medication" + (expired.length === 1 ? " is" : "s are") +
        " already expired: " + names(expired) + ". Replace before the bag goes into service." +
        (inService.length
          ? " A further " + inService.length + " expire before " +
            window.Expiry.format(window.Expiry.parse(until), until) + ": " + names(inService) + "."
          : "");
      warn.hidden = false;
    } else if (soon.length) {
      warn.className = "notice warn";
      warn.textContent = soon.length +
        (soon.length === 1 ? " medication expires within " : " medications expire within ") +
        window.Expiry.SOON_DAYS + " days: " + names(soon) + ".";
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  /*
   * Shown after a PDF download. The PDF cannot be read back into the tool, so
   * the JSON is the only thing that saves retyping the whole document later.
   */
  function showPdfReminder() {
    var box = $("pdfReminder");
    var text = $("pdfReminderText");
    var what = isCdMode() ? "register" : "bag";
    if (needsBackup()) {
      box.className = "notice warn reminder";
      text.textContent = "PDF downloaded. Save the .json copy too \u2014 a PDF cannot be loaded " +
        "back in, so without it you would have to retype this " + what + " to make the next version.";
      $("pdfReminderExport").hidden = false;
    } else {
      box.className = "notice good reminder";
      text.textContent = "PDF downloaded, and your .json copy of this " + what + " is up to date.";
      $("pdfReminderExport").hidden = true;
    }
    box.hidden = false;
  }

  function hidePdfReminder() {
    $("pdfReminder").hidden = true;
  }

  /* ---------------- generate ---------------- */
  function collect() {
    readSetup();
    var missing = [];
    if (!doc().setup.companyName) missing.push("company name");
    if (!doc().setup.companyPhone) missing.push("contact number");
    if (doc().setup.cqcRegistered && !doc().setup.cqcNumber) {
      missing.push("CQC registration number");
    }
    if (!doc().setup.bagNumber) missing.push(words().identity[0].toLowerCase());
    if (!doc().setup.preppedBy) missing.push(words().preppedBy[0].toLowerCase());
    if (missing.length) {
      return { error: "Complete the setup tab first — missing: " + missing.join(", ") + "." };
    }
    if (!doc().medications.length) {
      return { error: isCdMode()
        ? "Add at least one controlled drug before generating."
        : "Add at least one medication before generating." };
    }
    if (isMatrixMode() && !namedGrades().length) {
      return { error: "Name at least one clinical grade on the setup tab before generating." };
    }
    var data = {};
    SETUP_FIELDS.forEach(function (f) { data[f] = doc().setup[f] || ""; });
    data.cqcRegistered = !!doc().setup.cqcRegistered;
    data.logo = doc().setup.logo || "";
    data.logoW = doc().setup.logoW || 0;
    data.logoH = doc().setup.logoH || 0;
    data.medications = doc().medications;
    data.mode = state.mode;
    if (isMatrixMode()) data.grades = namedGrades();
    else if (doc().formulary) data.formulary = doc().formulary;
    return { data: data };
  }

  function withData(fn) {
    var err = $("genError");
    var got = collect();
    if (got.error) {
      err.textContent = got.error;
      err.hidden = false;
      showTab("generate");
      return;
    }
    try {
      fn(got.data);
      err.hidden = true;
    } catch (e) {
      err.textContent = e.message || "Could not generate the PDF.";
      err.hidden = false;
    }
  }

  /* ---------------- import / export ---------------- */
  /* "Drug bag 1" exports as Drug-Bag-1-saved.json, a safe as CD-Register-1-saved.json */
  function exportName() {
    var prefix = isMatrixMode() ? "Formulary-" : isCdMode() ? "CD-Register-" : "Drug-Bag-";
    var id = (doc().setup.bagNumber || "")
      .trim()
      .replace(/^(formulary|cd\s*safe|safe|drug\s*bag|bag|db)[\s._-]*/i, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return prefix + (id || "unnumbered") + "-saved.json";
  }

  function exportBag() {
    readSetup();
    var blob = new Blob([JSON.stringify({
      mode: state.mode, setup: doc().setup, medications: doc().medications,
      grades: isMatrixMode() ? grades() : undefined,
      formulary: isMatrixMode() ? undefined : doc().formulary
    }, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = exportName();
    if (!doc().meta) doc().meta = {};
    doc().meta.exportedAt = Date.now();
    save();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    renderSummary();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importMessage(kind, text) {
    var box = $("importResult");
    box.className = "notice " + kind;
    box.textContent = text;
    box.hidden = false;
  }

  /* A saved document has a medications list, a setup block, or both. */
  function looksLikeSavedDocument(parsed) {
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return Array.isArray(parsed.medications) ||
      (parsed.setup && typeof parsed.setup === "object");
  }

  /* Replacing the open document, so check there is nothing unsaved first. */
  function beginImport() {
    if (needsBackup()) {
      var what = isMatrixMode() ? "formulary" : isCdMode() ? "CD register" : "drug bag";
      if (!confirm("Importing replaces the " + what + " you have open, and it has changes that " +
                   "have not been exported.\n\nImport anyway?")) return;
    }
    $("importFile").click();
  }

  function importBag(file) {
    var reader = new FileReader();
    reader.onerror = function () {
      importMessage("bad", "That file could not be read.");
    };
    reader.onload = function () {
      var parsed;
      try {
        parsed = JSON.parse(reader.result);
      } catch (e) {
        importMessage("bad", "\u201c" + file.name + "\u201d is not a valid .json file. " +
          "Nothing has been changed.");
        return;
      }
      if (!looksLikeSavedDocument(parsed)) {
        importMessage("bad", "\u201c" + file.name + "\u201d is not a document exported " +
          "from this tool. Nothing has been changed.");
        return;
      }

      // Each generator only opens its own kind of file. A formulary dropped on
      // the bag side is attached to the bag instead, which is what it is for.
      if (isFormulary(parsed) !== IS_MATRIX_PAGE) {
        if (IS_MATRIX_PAGE) {
          importMessage("bad", "\u201c" + file.name + "\u201d is a saved bag or register, not " +
            "a formulary. Open it in the drug bag generator instead. Nothing has been changed.");
          return;
        }
        if (attachFormulary(parsed, file.name)) {
          importMessage("good", "\u201c" + file.name + "\u201d is a formulary, so it has been " +
            "attached to this " + (isCdMode() ? "register" : "bag") + " rather than replacing " +
            "it. Its table is printed at the end of the document.");
        } else {
          hide("importResult", true);
        }
        showTab("setup");
        return;
      }

      if (MODES.indexOf(parsed.mode) >= 0) state.mode = parsed.mode;
      doc().setup = parsed.setup || {};
      doc().medications = Array.isArray(parsed.medications) ? parsed.medications : [];
      if (isMatrixMode()) {
        doc().grades = Array.isArray(parsed.grades) && parsed.grades.length
          ? parsed.grades : null;
      } else if (parsed.formulary && isFormulary(
          { mode: "matrix", medications: parsed.formulary.medications,
            grades: parsed.formulary.grades })) {
        doc().formulary = parsed.formulary;
      } else {
        delete doc().formulary;
      }
      doc().meta = { exportedAt: Date.now() };
      applyMode();
      fillSetup();
      clearMedForm();
      hidePdfReminder();
      renderMeds();
      save();
      showTab("setup");

      var n = doc().medications.length;
      var kind = isMatrixMode() ? "formulary " : isCdMode() ? "CD safe " : "drug bag ";
      var counted = isCdMode()
        ? " controlled drug" + (n === 1 ? "" : "s")
        : " medication" + (n === 1 ? "" : "s");
      importMessage("good", "Loaded " + kind + (doc().setup.bagNumber || "\u2014") +
        " with " + n + counted + ".");
    };
    reader.readAsText(file);
  }

  /* ---------------- wiring ---------------- */
  function init() {
    loadTheme();
    load();
    applyMode();
    fillSetup();
    clearMedForm();
    renderMeds();

    document.querySelectorAll("[name=docMode]").forEach(function (r) {
      r.addEventListener("change", function () { if (r.checked) setMode(r.value); });
    });

    document.querySelectorAll(".tab").forEach(function (t) {
      t.addEventListener("click", function () { readSetup(); showTab(t.dataset.tab); });
    });
    document.querySelectorAll("[data-goto]").forEach(function (b) {
      b.addEventListener("click", function () { readSetup(); showTab(b.dataset.goto); });
    });
    SETUP_FIELDS.forEach(function (f) {
      // Both events: "change" alone only fires on blur, so a value typed and
      // then left without clicking away was never persisted.
      $(f).addEventListener("change", readSetup);
      $(f).addEventListener("input", readSetup);
    });

    $("medForm").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var m = medFromForm();
      var problem = validateMed(m);
      if (problem) {
        $("medError").textContent = problem;
        $("medError").hidden = false;
        return;
      }
      if (state.editing === null) doc().medications.push(m);
      else doc().medications[state.editing] = m;
      touch();
      save();
      clearMedForm();
      renderMeds();
      $("mName").focus();
    });
    $("medCancel").addEventListener("click", clearMedForm);
    ["mExpiryMonth", "mExpiryDate", "mExpiryText"].forEach(function (id) {
      $(id).addEventListener("input", updateExpiryEcho);
      $(id).addEventListener("change", updateExpiryEcho);
    });
    $("mExpiryPrecision").addEventListener("change", function () {
      // Carry the value across so switching precision does not lose the entry.
      syncExpiryInputs();
      if (!expiryValue() && lastExpiry) {
        var p = window.Expiry.parse(lastExpiry);
        if (p && expiryPrecision() === "day") {
          $("mExpiryDate").value = p.precision === "day" ? p.iso : p.iso + "-01";
        } else if (p) {
          var monthIso = p.iso.slice(0, 7);
          if (HAS_MONTH_INPUT) $("mExpiryMonth").value = monthIso;
          else $("mExpiryText").value = monthIso;
        }
      }
      updateExpiryEcho();
    });
    $("generateBtn").addEventListener("click", function () {
      withData(function (d) { window.DrugBagPDF.save(d); showPdfReminder(); });
    });
    $("generateTop").addEventListener("click", function () {
      withData(function (d) {
        window.DrugBagPDF.save(d);
        showTab("generate");
        showPdfReminder();
      });
    });
    $("pdfReminderExport").addEventListener("click", function () {
      exportBag();
      showPdfReminder();
    });
    $("previewBtn").addEventListener("click", function () {
      withData(function (d) { window.DrugBagPDF.open(d); });
    });

    $("exportBtn").addEventListener("click", exportBag);
    $("quickAdd").addEventListener("input", renderQuick);
    $("quickAdd").addEventListener("focus", renderQuick);
    $("quickAdd").addEventListener("blur", function () {
      cancelQuickClose();
      quick.closeTimer = setTimeout(closeQuick, 120);
    });
    $("quickAdd").addEventListener("keydown", function (ev) {
      if (ev.key === "ArrowDown") { ev.preventDefault(); moveQuick(1); }
      else if (ev.key === "ArrowUp") { ev.preventDefault(); moveQuick(-1); }
      else if (ev.key === "Escape") { closeQuick(); }
      else if (ev.key === "Enter") {
        ev.preventDefault();
        if (quick.active >= 0 && quick.items[quick.active]) quick.items[quick.active]();
        else if (quick.items.length) quick.items[0]();
      }
    });

    $("cqcRegistered").addEventListener("change", function () {
      syncCqc();
      readSetup();
      if (this.checked) $("cqcNumber").focus();
    });

    // Attaching a matrix: bag and CD side only.
    on("formularyBtn", function (b) {
      b.addEventListener("click", function () { $("formularyFile").click(); });
    });
    on("formularyFile", function (f) {
      f.addEventListener("change", function () {
        if (this.files && this.files[0]) readFormularyFile(this.files[0]);
        this.value = "";
      });
    });
    on("formularyRemove", function (b) {
      b.addEventListener("click", function () {
        if (!confirm("Remove the attached formulary? The document will no longer carry the " +
                     "matrix. The formulary itself is not affected.")) return;
        removeFormulary();
      });
    });
    $("companyExportBtn").addEventListener("click", exportCompany);
    $("companyImportBtn").addEventListener("click", function () { $("companyFile").click(); });
    $("companyFile").addEventListener("change", function () {
      if (this.files && this.files[0]) importCompany(this.files[0]);
      this.value = "";
    });

    on("gradeAdd", function (b) { b.addEventListener("click", addGrade); });
    on("gradeDefaults", function (b) {
      b.addEventListener("click", restoreDefaultGrades);
    });
    document.querySelectorAll("[name=fillMode]").forEach(function (r) {
      r.addEventListener("change", function () {
        setText("fillModeHint",
          r.value === "up"
            ? "A click allows that grade and every grade to its right, and clears the rest."
            : r.value === "down"
              ? "A click allows that grade and every grade to its left, and clears the rest."
              : "A click flips a single cell between allowed and not.");
      });
    });

    $("logoBtn").addEventListener("click", function () { $("logoFile").click(); });
    $("logoFile").addEventListener("change", function () {
      if (this.files && this.files[0]) readLogo(this.files[0]);
      this.value = "";
    });
    $("logoRemove").addEventListener("click", removeLogo);

    $("importBtn").addEventListener("click", beginImport);
    $("importSetupBtn").addEventListener("click", beginImport);
    $("importFile").addEventListener("change", function () {
      if (this.files && this.files[0]) importBag(this.files[0]);
      this.value = "";
    });

    $("themeBtn").addEventListener("click", cycleTheme);

    $("resetAll").addEventListener("click", function () {
      var what = isMatrixMode() ? "formulary" : isCdMode() ? "CD register" : "drug bag";
      var message = "Clear the details and list for this " + what + "?" +
        (IS_MATRIX_PAGE ? " The drug bag paperwork is left alone."
                        : " The other document is left alone.");
      if (needsBackup()) {
        message = "This " + what + " has unsaved changes that have not been exported, and " +
          "clearing cannot be undone.\n\n" + message;
      }
      if (!confirm(message)) return;
      doc().setup = {};
      doc().medications = [];
      doc().meta = {};
      if (isMatrixMode()) doc().grades = null;
      else delete doc().formulary;
      $("companyResult").hidden = true;
      showLogo();
      resetLogoHint();
      SETUP_FIELDS.forEach(function (f) { $(f).value = ""; });
      fillSetup();
      renderFormulary();
      clearMedForm();
      renderMeds();
      save();
      showTab("setup");
    });

    // Says the stored document has been restored into the form. Navigating
    // between the two generators is a page load, so a test — or anything
    // watching — can wait for this rather than for a value to appear.
    document.body.dataset.ready = "1";
  }

  document.addEventListener("DOMContentLoaded", init);
})();
