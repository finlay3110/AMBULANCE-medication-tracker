/* UI state and wiring. Everything is kept in localStorage on this device. */
(function () {
  "use strict";

  var KEY = "drug-bag-tracker/v1";
  var $ = function (id) { return document.getElementById(id); };

  var state = { setup: {}, medications: [], editing: null };

  var SETUP_FIELDS = [
    "companyName", "companyPhone", "companyAddress",
    "bagNumber", "preppedBy", "checkedBy", "preppedDate", "sealNumber"
  ];

  /* ---------------- persistence ---------------- */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        setup: state.setup, medications: state.medications
      }));
    } catch (e) { /* private browsing / quota — the app still works in-session */ }
  }

  function load() {
    var raw;
    try { raw = localStorage.getItem(KEY); } catch (e) { return; }
    if (!raw) return;
    try {
      var parsed = JSON.parse(raw);
      state.setup = parsed.setup || {};
      state.medications = Array.isArray(parsed.medications) ? parsed.medications : [];
    } catch (e) { /* ignore corrupt data */ }
  }

  /* ---------------- setup tab ---------------- */
  function readSetup() {
    SETUP_FIELDS.forEach(function (f) { state.setup[f] = $(f).value.trim(); });
    save();
    renderSummary();
  }

  function fillSetup() {
    SETUP_FIELDS.forEach(function (f) { $(f).value = state.setup[f] || ""; });
    if (!$("preppedDate").value) {
      $("preppedDate").value = new Date().toISOString().slice(0, 10);
      state.setup.preppedDate = $("preppedDate").value;
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
      schedule: $("mSchedule").value,
      cdLog: $("mCdLog").checked
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
    if (!m.doses || m.doses < 1) return "Number of doses must be at least 1.";
    if (m.doses > 200) return "Number of doses is capped at 200 per medication.";
    return null;
  }

  function clearMedForm() {
    ["mName", "mPresentation", "mDose", "mBatch", "mExpiry", "mDoses"].forEach(function (id) {
      $(id).value = "";
    });
    $("mSchedule").value = "GSL";
    $("mCdLog").checked = false;
    updateExpiryEcho();
    state.editing = null;
    $("medFormTitle").textContent = "Add medication";
    $("medSubmit").textContent = "Add medication";
    $("medCancel").hidden = true;
    $("medError").hidden = true;
  }

  function startEdit(index) {
    var m = state.medications[index];
    $("mName").value = m.name;
    $("mPresentation").value = m.presentation;
    $("mDose").value = m.dose;
    $("mBatch").value = m.batch;
    $("mExpiry").value = m.expiry;
    $("mDoses").value = m.doses;
    $("mSchedule").value = m.schedule || "GSL";
    $("mCdLog").checked = usesCdLog(m);
    updateExpiryEcho();
    state.editing = index;
    $("medFormTitle").textContent = "Edit medication";
    $("medSubmit").textContent = "Save changes";
    $("medCancel").hidden = false;
    $("medError").hidden = true;
    $("mName").focus();
    window.scrollTo(0, 0);
  }

  function move(index, delta) {
    var to = index + delta;
    if (to < 0 || to >= state.medications.length) return;
    var m = state.medications.splice(index, 1)[0];
    state.medications.splice(to, 0, m);
    if (state.editing === index) state.editing = to;
    save();
    renderMeds();
  }


  function usesCdLog(m) {
    return m.cdLog === true || (m.cdLog === undefined && m.schedule === "CD");
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
    state.medications.forEach(function (m, i) {
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
      var meta = document.createElement("div");
      meta.className = "med-meta";
      meta.textContent = m.presentation + " · " + m.dose + " · x" + m.doses +
        " dose" + (m.doses === 1 ? "" : "s") +
        " · batch " + (m.batch || "—") + " · exp " + m.expiry;
      main.appendChild(name);
      main.appendChild(meta);

      var btns = document.createElement("div");
      btns.className = "med-btns";
      [["↑", function () { move(i, -1); }, ""],
       ["↓", function () { move(i, 1); }, ""],
       ["Edit", function () { startEdit(i); }, ""],
       ["Delete", function () {
          if (confirm("Remove " + m.name + " from this bag?")) {
            state.medications.splice(i, 1);
            if (state.editing === i) clearMedForm();
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

    var n = state.medications.length;
    $("medCount").textContent = n;
    $("medCount2").textContent = n;
    $("medEmpty").hidden = n > 0;
    renderSummary();
  }

  function renderSummary() {
    var totalDoses = state.medications.reduce(function (a, m) {
      return a + (parseInt(m.doses, 10) || 0);
    }, 0);
    var items = [
      ["Drug bag", state.setup.bagNumber || "—"],
      ["Company", state.setup.companyName || "—"],
      ["Prepped by", state.setup.preppedBy || "—"],
      ["Medications", String(state.medications.length)],
      ["Total logged doses", String(totalDoses)],
      ["Pages", String(1 + state.medications.length) + "+"]
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

    var warn = $("expiryWarning");
    var expired = state.medications.filter(function (m) {
      return window.Expiry.status(window.Expiry.parse(m.expiry)) === "expired";
    });
    var soon = state.medications.filter(function (m) {
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
      warn.textContent = soon.length + " medication" + (soon.length === 1 ? "" : "s") +
        " expire within " + window.Expiry.SOON_DAYS + " days: " +
        soon.map(function (m) { return m.name; }).join(", ") + ".";
      warn.hidden = false;
    } else {
      warn.hidden = true;
    }
  }

  /* ---------------- generate ---------------- */
  function collect() {
    readSetup();
    var missing = [];
    if (!state.setup.companyName) missing.push("company name");
    if (!state.setup.companyPhone) missing.push("contact number");
    if (!state.setup.bagNumber) missing.push("drug bag number");
    if (!state.setup.preppedBy) missing.push("prepped by");
    if (missing.length) {
      return { error: "Complete the setup tab first — missing: " + missing.join(", ") + "." };
    }
    if (!state.medications.length) {
      return { error: "Add at least one medication before generating." };
    }
    var data = {};
    SETUP_FIELDS.forEach(function (f) { data[f] = state.setup[f] || ""; });
    data.medications = state.medications;
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
  /* "Drug bag 1" exports as Drug-Bag-1-saved.json */
  function exportName() {
    var id = (state.setup.bagNumber || "")
      .trim()
      .replace(/^(drug\s*bag|bag|db)[\s._-]*/i, "")   // avoid "Drug-Bag-Drug-Bag-1"
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return "Drug-Bag-" + (id || "unnumbered") + "-saved.json";
  }

  function exportBag() {
    readSetup();
    var blob = new Blob([JSON.stringify({
      setup: state.setup, medications: state.medications
    }, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = exportName();
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function importBag(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var parsed = JSON.parse(reader.result);
        state.setup = parsed.setup || {};
        state.medications = Array.isArray(parsed.medications) ? parsed.medications : [];
        fillSetup();
        clearMedForm();
        renderMeds();
        save();
        showTab("setup");
      } catch (e) {
        alert("That file could not be read as a saved bag.");
      }
    };
    reader.readAsText(file);
  }

  /* ---------------- wiring ---------------- */
  function init() {
    load();
    fillSetup();
    clearMedForm();
    renderMeds();

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
      if (state.editing === null) state.medications.push(m);
      else state.medications[state.editing] = m;
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
      withData(function (d) { window.DrugBagPDF.save(d); });
    });
    $("generateTop").addEventListener("click", function () {
      withData(function (d) { window.DrugBagPDF.save(d); });
    });
    $("previewBtn").addEventListener("click", function () {
      withData(function (d) { window.DrugBagPDF.open(d); });
    });

    $("exportBtn").addEventListener("click", exportBag);
    $("importBtn").addEventListener("click", function () { $("importFile").click(); });
    $("importFile").addEventListener("change", function () {
      if (this.files && this.files[0]) importBag(this.files[0]);
      this.value = "";
    });

    $("resetAll").addEventListener("click", function () {
      if (!confirm("Clear the company details and all medications?")) return;
      state.setup = {};
      state.medications = [];
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
