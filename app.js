/* UI state and wiring. Everything is kept in localStorage on this device. */
(function () {
  "use strict";

  var KEY = "drug-bag-tracker/v2";
  var OLD_KEY = "drug-bag-tracker/v1";
  var $ = function (id) { return document.getElementById(id); };

  /*
   * Two entirely separate documents. Controlled drugs live in the CD safe, not
   * in a drug bag, so they never share a list with bag stock.
   */
  var state = {
    mode: "bag",
    docs: {
      bag: { setup: {}, medications: [], meta: {} },
      cd: { setup: {}, medications: [], meta: {} }
    },
    editing: null
  };

  function doc() { return state.docs[state.mode]; }
  function isCdMode() { return state.mode === "cd"; }

  var SETUP_FIELDS = [
    "companyName", "companyPhone", "companyAddress",
    "bagNumber", "preppedBy", "checkedBy", "preppedDate", "sealNumber",
    "safeLocation"
  ];

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
      summaryId: "CD safe",
      addTitle: "Add controlled drug",
      editTitle: "Edit controlled drug"
    }
  };

  function words() { return WORDS[state.mode]; }

  /* Relabel a field and its placeholder. */
  function relabel(inputId, spec) {
    var input = $(inputId);
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

    relabel("bagNumber", w.identity);
    relabel("preppedBy", w.preppedBy);
    relabel("preppedDate", w.preppedDate);
    relabel("checkedBy", w.checkedBy);
    relabel("mDoses", w.doses);

    $("detailsTitle").textContent = w.detailsTitle;
    $("contentsTitle").textContent = w.contentsTitle;
    $("tabMedsLabel").textContent = w.tabMeds;
    $("medEmpty").textContent = w.medEmpty;
    $("saveTitle").textContent = w.saveTitle;
    $("saveHint").textContent = w.saveHint;
    $("generateHint").textContent = w.generateHint;
    $("checkedByHint").textContent = w.checkedByHint;

    // Schedule and seal number are bag-only; safe location is CD-only.
    $("f-mSchedule").hidden = isCdMode();
    $("f-mUnit").hidden = !isCdMode();
    $("f-sealNumber").hidden = isCdMode();
    $("f-safeLocation").hidden = !isCdMode();
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    readSetup();
    state.mode = mode;
    hidePdfReminder();
    $("importResult").hidden = true;
    clearMedForm();
    fillSetup();
    applyMode();
    renderMeds();
    save();
  }

  /* ---------------- persistence ---------------- */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ mode: state.mode, docs: state.docs }));
    } catch (e) { /* private browsing / quota — the app still works in-session */ }
  }

  function readDoc(parsed) {
    return {
      setup: (parsed && parsed.setup) || {},
      medications: (parsed && Array.isArray(parsed.medications)) ? parsed.medications : [],
      meta: (parsed && parsed.meta) || {}
    };
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
        state.mode = parsed.mode === "cd" ? "cd" : "bag";
        state.docs.bag = readDoc(parsed.docs && parsed.docs.bag);
        state.docs.cd = readDoc(parsed.docs && parsed.docs.cd);
      } catch (e) { /* ignore corrupt data */ }
      return;
    }

    // Migrate a v1 bag, moving any controlled drugs into the CD register.
    if (old) {
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
    SETUP_FIELDS.forEach(function (f) { setup[f] = $(f).value.trim(); });
    if (JSON.stringify(setup) !== before) touch();
    save();
    renderSummary();
  }

  function fillSetup() {
    var setup = doc().setup;
    SETUP_FIELDS.forEach(function (f) { $(f).value = setup[f] || ""; });
    if (!$("preppedDate").value) {
      $("preppedDate").value = new Date().toISOString().slice(0, 10);
      setup.preppedDate = $("preppedDate").value;
    }
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
    return {
      name: $("mName").value.trim(),
      presentation: $("mPresentation").value.trim(),
      dose: $("mDose").value.trim(),
      batch: $("mBatch").value.trim(),
      expiry: $("mExpiry").value.trim(),
      doses: parseInt($("mDoses").value, 10),
      schedule: isCdMode() ? "CD" : $("mSchedule").value,
      unit: isCdMode() ? ($("mUnit").value.trim() || "ampoules") : ""
    };
  }

  function validateMed(m) {
    if (!m.name) return "Enter the medication name.";
    if (!m.presentation) return "Enter the presentation (tablet, sachet, ampoule…).";
    if (!m.dose) return "Enter the dose or strength.";
    if (!m.expiry) return "Enter the expiry.";
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
    ["mName", "mPresentation", "mDose", "mBatch", "mExpiry", "mDoses"].forEach(function (id) {
      $(id).value = "";
    });
    $("mSchedule").value = "GSL";
    $("mUnit").value = isCdMode() ? "ampoules" : "";
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
    $("mBatch").value = m.batch;
    $("mExpiry").value = m.expiry;
    $("mDoses").value = m.doses;
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
    var raw = $("mExpiry").value.trim();
    if (!raw) {
      el.className = "echo";
      el.textContent = "Month or full date \u2014 07/25, 10/2027, 18/10/2025, Oct 2025";
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

      if (doc().medications.filter(function (o) { return o.name === m.name; }).length > 1) {
        var multi = document.createElement("span");
        multi.className = "chip batch";
        multi.textContent = "batch " + (m.batch || "—");
        name.appendChild(multi);
      }

      var parsed = window.Expiry.parse(m.expiry);
      var st = window.Expiry.status(parsed);
      if (st === "expired" || st === "soon") {
        var chip = document.createElement("span");
        chip.className = "chip " + (st === "expired" ? "bad" : "warn");
        chip.textContent = st === "expired"
          ? "EXPIRED"
          : "Expires in " + window.Expiry.daysLeft(parsed) + "d";
        name.appendChild(chip);
      }

      var meta = document.createElement("div");
      meta.className = "med-meta";
      meta.textContent = m.presentation + " · " + m.dose + " · x" + m.doses +
        (isCdMode() ? " " + (m.unit || "held") : " dose" + (m.doses === 1 ? "" : "s")) +
        " · batch " + (m.batch || "—") +
        " · exp " + window.Expiry.format(parsed, m.expiry);
      main.appendChild(name);
      main.appendChild(meta);

      var btns = document.createElement("div");
      btns.className = "med-btns";
      [["↑", function () { move(i, -1); }, ""],
       ["↓", function () { move(i, 1); }, ""],
       ["Copy", function () { copyForNewBatch(i); }, ""],
       ["Edit", function () { startEdit(i); }, ""],
       ["Delete", function () {
          if (confirm("Remove " + m.name + " from this bag?")) {
            doc().medications.splice(i, 1);
            if (state.editing === i) clearMedForm();
            touch();
            save();
            renderMeds();
          }
        }, "del"]].forEach(function (spec) {
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
    renderSummary();
  }

  function renderSummary() {
    var totalDoses = doc().medications.reduce(function (a, m) {
      return a + (parseInt(m.doses, 10) || 0);
    }, 0);
    var first = window.Expiry.earliest(doc().medications);
    var items = [
      [words().summaryId, doc().setup.bagNumber || "—"],
      ["Company", doc().setup.companyName || "—"],
      [isCdMode() ? "Earliest expiry" : "Bag expires",
        first ? window.Expiry.format(first.parsed) : "—",
        first ? window.Expiry.status(first.parsed) : "unknown"],
      [isCdMode() ? "Controlled drugs" : "Medications", String(doc().medications.length)],
      [isCdMode() ? "Total quantity held" : "Total logged doses", String(totalDoses)],
      ["Pages", String((isCdMode() ? 2 : 1) + doc().medications.length) + "+"]
    ];
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
    if (needsBackup()) {
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
    var expired = doc().medications.filter(function (m) {
      return window.Expiry.status(window.Expiry.parse(m.expiry)) === "expired";
    });
    var soon = doc().medications.filter(function (m) {
      return window.Expiry.status(window.Expiry.parse(m.expiry)) === "soon";
    });
    if (expired.length) {
      warn.className = "notice bad";
      warn.textContent = expired.length + " medication" + (expired.length === 1 ? " is" : "s are") +
        " already expired: " + expired.map(function (m) { return m.name; }).join(", ") +
        ". Replace before the bag goes into service.";
      warn.hidden = false;
    } else if (soon.length) {
      warn.className = "notice warn";
      warn.textContent = soon.length +
        (soon.length === 1 ? " medication expires within " : " medications expire within ") +
        window.Expiry.SOON_DAYS + " days: " +
        soon.map(function (m) { return m.name; }).join(", ") + ".";
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
    var data = {};
    SETUP_FIELDS.forEach(function (f) { data[f] = doc().setup[f] || ""; });
    data.medications = doc().medications;
    data.mode = state.mode;
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
    var prefix = isCdMode() ? "CD-Register-" : "Drug-Bag-";
    var id = (doc().setup.bagNumber || "")
      .trim()
      .replace(/^(cd\s*safe|safe|drug\s*bag|bag|db)[\s._-]*/i, "")  // no "Drug-Bag-Drug-Bag-1"
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return prefix + (id || "unnumbered") + "-saved.json";
  }

  function exportBag() {
    readSetup();
    var blob = new Blob([JSON.stringify({
      mode: state.mode, setup: doc().setup, medications: doc().medications
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
      var what = isCdMode() ? "CD register" : "drug bag";
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
        importMessage("bad", "\u201c" + file.name + "\u201d is not a bag or register exported " +
          "from this tool. Nothing has been changed.");
        return;
      }

      if (parsed.mode === "cd" || parsed.mode === "bag") state.mode = parsed.mode;
      doc().setup = parsed.setup || {};
      doc().medications = Array.isArray(parsed.medications) ? parsed.medications : [];
      doc().meta = { exportedAt: Date.now() };
      applyMode();
      fillSetup();
      clearMedForm();
      hidePdfReminder();
      renderMeds();
      save();
      showTab("setup");

      var n = doc().medications.length;
      importMessage("good", "Loaded " + (isCdMode() ? "CD safe " : "drug bag ") +
        (doc().setup.bagNumber || "\u2014") + " with " + n +
        (isCdMode()
          ? " controlled drug" + (n === 1 ? "" : "s")
          : " medication" + (n === 1 ? "" : "s")) + ".");
    };
    reader.readAsText(file);
  }

  /* ---------------- wiring ---------------- */
  function init() {
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
    SETUP_FIELDS.forEach(function (f) { $(f).addEventListener("change", readSetup); });

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
    $("mExpiry").addEventListener("input", updateExpiryEcho);
    $("mSchedule").addEventListener("change", function () {
      // Controlled drugs default to the register layout; still overridable.
      if (this.value === "CD") $("mCdLog").checked = true;
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
    $("importBtn").addEventListener("click", beginImport);
    $("importSetupBtn").addEventListener("click", beginImport);
    $("importFile").addEventListener("change", function () {
      if (this.files && this.files[0]) importBag(this.files[0]);
      this.value = "";
    });

    $("resetAll").addEventListener("click", function () {
      var what = isCdMode() ? "CD register" : "drug bag";
      var message = "Clear the details and list for this " + what +
        "? The other document is left alone.";
      if (needsBackup()) {
        message = "This " + what + " has unsaved changes that have not been exported, and " +
          "clearing cannot be undone.\n\n" + message;
      }
      if (!confirm(message)) return;
      doc().setup = {};
      doc().medications = [];
      doc().meta = {};
      SETUP_FIELDS.forEach(function (f) { $(f).value = ""; });
      fillSetup();
      clearMedForm();
      renderMeds();
      save();
      showTab("setup");
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
