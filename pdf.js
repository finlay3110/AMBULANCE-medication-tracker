/* PDF generation for the drug bag tracker. Uses the bundled jsPDF UMD build. */
(function (global) {
  "use strict";

  var PAGE = { w: 210, h: 297, ml: 12, mr: 12, mt: 12, mb: 14 }; // A4 mm
  var CONTENT_W = PAGE.w - PAGE.ml - PAGE.mr;

  var SCHEDULE_COLOUR = {
    GSL: [106, 168, 79],
    P:   [154, 106, 0],
    POM: [21, 70, 160],
    S17: [21, 70, 160],
    S19: [15, 110, 120],
    CD:  [139, 26, 26]
  };

  var INK = [22, 32, 44];
  var LINE = [130, 140, 150];
  var HEAD_BG = [166, 166, 166];
  var BAR_BG = [90, 90, 90];
  var SOFT_BG = [242, 244, 246];
  var RED = [176, 32, 32];
  var AMBER = [166, 108, 0];
  var CD_BG = [139, 26, 26];

  function expiryOf(med) {
    return global.Expiry ? global.Expiry.parse(med.expiry) : null;
  }

  function expiryText(med) {
    var p = expiryOf(med);
    return p ? global.Expiry.format(p) : txt(med.expiry);
  }

  /* `until` is the in-service date, when one is set. */
  function expiryColour(med, until) {
    if (!global.Expiry) return null;
    var st = global.Expiry.serviceStatus(expiryOf(med), until);
    if (st === "expired" || st === "in-service") return RED;
    if (st === "soon") return AMBER;
    return null;
  }

  /*
   * Company logo, fitted inside a white panel so a dark logo still reads on the
   * coloured masthead. Returns the width used, or 0 when there is no logo.
   */
  function drawLogo(doc, data, x, y, boxW, boxH) {
    var src = txt(data.logo);
    if (!src) return 0;
    var iw = data.logoW || 0;
    var ih = data.logoH || 0;
    if (iw <= 0 || ih <= 0) return 0;

    var pad = 1.5;
    var scale = Math.min((boxW - pad * 2) / iw, (boxH - pad * 2) / ih);
    var w = iw * scale;
    var h = ih * scale;
    // Panel fits the logo rather than the whole box, so a wide or tall logo
    // does not sit in a slab of white.
    var panelW = w + pad * 2;
    var panelH = h + pad * 2;
    var panelY = y + (boxH - panelH) / 2;
    try {
      doc.setFillColor(255, 255, 255);
      doc.rect(x, panelY, panelW, panelH, "F");
      doc.addImage(src, src.indexOf("image/png") >= 0 ? "PNG" : "JPEG",
        x + pad, panelY + pad, w, h);
    } catch (e) {
      return 0;   // an unreadable logo must never stop the document generating
    }
    return panelW;
  }

  function serviceDate(data) {
    var iso = txt(data.inServiceUntil);
    if (!iso || !global.Expiry) return iso;
    return global.Expiry.format(global.Expiry.parse(iso), iso);
  }

  /*
   * Stock that is in date today but runs out before the bag is due back is the
   * thing a label should shout about, so it gets its own band under the table.
   */
  function drawInServiceWarning(doc, data, y) {
    if (!global.Expiry || !txt(data.inServiceUntil)) return 0;
    var due = global.Expiry.expiringInService(data.medications, data.inServiceUntil);
    if (!due.length) return 0;

    setFont(doc, 9, "normal");
    var lines = wrap(doc, due.map(function (m) {
      return txt(m.name) + " (" + expiryText(m) + ")";
    }).join(",  "), CONTENT_W - 8);
    var h = linesHeight(lines, 9) + 12;

    doc.setFillColor(253, 236, 235);
    doc.setDrawColor(RED[0], RED[1], RED[2]);
    doc.setLineWidth(0.5);
    doc.rect(PAGE.ml, y, CONTENT_W, h, "FD");
    setFont(doc, 9, "bold");
    doc.setTextColor(RED[0], RED[1], RED[2]);
    doc.text("EXPIRES BEFORE " + serviceDate(data).toUpperCase() +
      " \u2014 " + due.length + " ITEM" + (due.length === 1 ? "" : "S"), PAGE.ml + 4, y + 6);
    setFont(doc, 9, "normal");
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(lines, PAGE.ml + 4, y + 11);
    return h;
  }

  function isCdDoc(data) {
    return data.mode === "cd";
  }

  function isMatrixDoc(data) {
    return data.mode === "matrix";
  }

  /* Company name, with the CQC registration beside it when there is one. */
  function companyLine(data) {
    var name = txt(data.companyName);
    var cqc = txt(data.cqcNumber);
    return (data.cqcRegistered && cqc) ? name + "  \u00b7  CQC " + cqc : name;
  }

  function unitOf(med) {
    return txt(med.unit);
  }

  /* Column heading carrying the unit, so a balance is never ambiguous. */
  function unitHead(label, med) {
    var u = unitOf(med);
    return u ? label + " (" + u + ")" : label;
  }

  function quantityText(med) {
    var u = unitOf(med);
    return String(med.doses) + (u ? " " + u : "");
  }

  /*
   * Each batch is a separate entry with its own log, so two entries for one
   * drug need their batch in the page title to tell the pages apart.
   */
  function pageTitle(data, med) {
    var sameName = data.medications.filter(function (m) { return m.name === med.name; });
    if (sameName.length < 2) return txt(med.name);
    return txt(med.name) + "  \u2014  batch " + (txt(med.batch) || "not recorded");
  }

  function txt(v) {
    return (v === null || v === undefined) ? "" : String(v).trim();
  }

  /* Wrap `value` to `width` mm at the current font settings. */
  function wrap(doc, value, width) {
    var s = txt(value);
    if (!s) return [""];
    return doc.splitTextToSize(s, width);
  }

  function setFont(doc, size, style) {
    doc.setFont("helvetica", style || "normal");
    doc.setFontSize(size);
  }

  /* Height of a block of `lines` at `size` pt, in mm. */
  function linesHeight(lines, size) {
    return lines.length * (size * 0.3528 * 1.15);
  }

  /*
   * Draw one table row of cells.
   * cells: [{ text, align, bold, fill, colour, size }]
   * Returns the row height used.
   */
  function drawRow(doc, x, y, widths, cells, opts) {
    opts = opts || {};
    var padX = 1.8, padY = 1.6;
    var size = opts.size || 9;
    var minH = opts.minH || 7;

    // Measure first so every cell in the row shares one height.
    var wrapped = cells.map(function (cell, i) {
      setFont(doc, cell.size || size, cell.bold ? "bold" : "normal");
      return wrap(doc, cell.text, widths[i] - padX * 2);
    });
    var h = minH;
    wrapped.forEach(function (lines, i) {
      h = Math.max(h, linesHeight(lines, cells[i].size || size) + padY * 2);
    });

    var cx = x;
    wrapped.forEach(function (lines, i) {
      var cell = cells[i];
      var w = widths[i];
      if (cell.fill) {
        doc.setFillColor(cell.fill[0], cell.fill[1], cell.fill[2]);
        doc.rect(cx, y, w, h, "F");
      }
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setLineWidth(0.2);
      doc.rect(cx, y, w, h, "S");

      var col = cell.colour || INK;
      doc.setTextColor(col[0], col[1], col[2]);
      setFont(doc, cell.size || size, cell.bold ? "bold" : "normal");

      var tx = cx + padX;
      if (cell.align === "center") tx = cx + w / 2;
      else if (cell.align === "right") tx = cx + w - padX;
      doc.text(lines, tx, y + padY + (cell.size || size) * 0.3528 * 0.95, {
        align: cell.align || "left",
        baseline: "alphabetic"
      });
      cx += w;
    });
    doc.setTextColor(INK[0], INK[1], INK[2]);
    return h;
  }

  /* Labelled strip of key details, one cell per entry: [label, value, colour?]. */
  function detailStrip(doc, details, y) {
    var h = 12;
    var dw = CONTENT_W / details.length;
    doc.setFillColor(SOFT_BG[0], SOFT_BG[1], SOFT_BG[2]);
    doc.rect(PAGE.ml, y, CONTENT_W, h, "F");
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.rect(PAGE.ml, y, CONTENT_W, h, "S");
    details.forEach(function (d, i) {
      var cx = PAGE.ml + dw * i;
      if (i > 0) doc.line(cx, y, cx, y + h);
      setFont(doc, 7, "normal");
      doc.setTextColor(95, 105, 118);
      doc.text(d[0].toUpperCase(), cx + 2.5, y + 4.5);
      var vc = d[2] || INK;
      doc.setTextColor(vc[0], vc[1], vc[2]);
      setFont(doc, 9, "bold");
      var lines = wrap(doc, d[1] || "\u2014", dw - 5);
      if (lines.length === 1) {
        doc.text(lines[0], cx + 2.5, y + 9.5);
      } else {
        // Two lines at a smaller size beats silently clipping the value.
        setFont(doc, 7.5, "bold");
        doc.text(wrap(doc, d[1], dw - 5).slice(0, 2), cx + 2.5, y + 8);
      }
      doc.setTextColor(INK[0], INK[1], INK[2]);
    });
    return y + h;
  }

  /* Prepared-by / checked-by signature block for the two-person bag check. */
  function drawCheckBlock(doc, data, y, title, leftLabel, rightLabel) {
    var h = 30;
    var halfW = CONTENT_W / 2;

    doc.setFillColor(SOFT_BG[0], SOFT_BG[1], SOFT_BG[2]);
    doc.rect(PAGE.ml, y, CONTENT_W, 7, "F");
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.rect(PAGE.ml, y, CONTENT_W, h, "S");
    doc.line(PAGE.ml, y + 7, PAGE.w - PAGE.mr, y + 7);
    doc.line(PAGE.ml + halfW, y + 7, PAGE.ml + halfW, y + h);

    setFont(doc, 8.5, "bold");
    doc.setTextColor(60, 72, 86);
    doc.text(title || "BAG PREPARATION \u2014 TWO PERSON CHECK", PAGE.ml + 3, y + 4.9);
    doc.setTextColor(INK[0], INK[1], INK[2]);

    [
      [leftLabel || "PREPARED BY", txt(data.preppedBy), txt(data.preppedDate), PAGE.ml],
      [rightLabel || "CHECKED BY", txt(data.checkedBy), "", PAGE.ml + halfW]
    ].forEach(function (col) {
      var cx = col[3];
      setFont(doc, 7.5, "bold");
      doc.setTextColor(95, 105, 118);
      doc.text(col[0], cx + 3, y + 12);
      doc.setTextColor(INK[0], INK[1], INK[2]);

      [["Name", col[1], 17.5], ["Signature", "", 23], ["Date", col[2], 28.5]].forEach(function (row) {
        setFont(doc, 8, "normal");
        doc.setTextColor(95, 105, 118);
        doc.text(row[0], cx + 3, y + row[2]);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        doc.setDrawColor(160, 168, 178);
        doc.setLineWidth(0.15);
        doc.line(cx + 20, y + row[2] + 1, cx + halfW - 3, y + row[2] + 1);
        if (row[1]) {
          setFont(doc, 9, "bold");
          doc.text(wrap(doc, row[1], halfW - 26)[0], cx + 21, y + row[2]);
        }
      });
    });
    return h;
  }

  /*
   * Add a page and remember its size, so footers can be stamped afterwards on
   * pages of either orientation.
   */
  function addPage(doc, state, landscape) {
    if (landscape) doc.addPage("a4", "landscape");
    else doc.addPage();
    state.page += 1;
    state.sizes[state.page] = landscape
      ? { w: PAGE.h, h: PAGE.w }
      : { w: PAGE.w, h: PAGE.h };
  }

  function stamp() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "Generated " + p(d.getDate()) + "/" + p(d.getMonth() + 1) + "/" + d.getFullYear() +
      " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  /*
   * Footers are stamped once the document is complete, because "of N" is not
   * known until then. A missing page is then obvious on a printed record.
   */
  function stampFooters(doc, data, state) {
    var total = doc.internal.getNumberOfPages();
    var left = (isMatrixDoc(data) ? "Drug matrix " : isCdDoc(data) ? "CD safe " : "Bag ") +
      (txt(data.bagNumber) || "\u2014") + "  \u00b7  " + txt(data.companyName);
    var generated = stamp();

    for (var i = 1; i <= total; i++) {
      doc.setPage(i);
      var size = state.sizes[i] || { w: PAGE.w, h: PAGE.h };
      var baseline = size.h - 7;
      setFont(doc, 8, "normal");
      doc.setTextColor(110, 118, 128);
      doc.text(left, PAGE.ml, baseline);
      doc.text(generated, size.w / 2, baseline, { align: "center" });
      doc.text("Page " + i + " of " + total, size.w - PAGE.mr, baseline, { align: "right" });
      doc.setTextColor(INK[0], INK[1], INK[2]);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Page 1+: the bag label / contents list                              */
  /* ------------------------------------------------------------------ */
  function drawLabel(doc, data, state) {
    var y = PAGE.mt;

    // Masthead
    doc.setFillColor(18, 33, 47);
    doc.rect(PAGE.ml, y, CONTENT_W, 20, "F");
    var logoW = drawLogo(doc, data, PAGE.ml + 3, y + 3, 26, 14);
    var textX = PAGE.ml + 4 + (logoW ? logoW + 3 : 0);
    doc.setTextColor(255, 255, 255);
    setFont(doc, 15, "bold");
    doc.text("DRUG BAG CONTENTS", textX, y + 8.5);
    setFont(doc, 10, "normal");
    doc.text(wrap(doc, companyLine(data), CONTENT_W - (textX - PAGE.ml) - 40)[0],
      textX, y + 15);

    setFont(doc, 9, "normal");
    doc.text("DRUG BAG No.", PAGE.w - PAGE.mr - 4, y + 7, { align: "right" });
    setFont(doc, 16, "bold");
    doc.text(txt(data.bagNumber) || "—", PAGE.w - PAGE.mr - 4, y + 15.5, { align: "right" });
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += 20;

    // Detail strip. The bag as a whole expires with its earliest item.
    var first = global.Expiry ? global.Expiry.earliest(data.medications) : null;
    var details = [
      ["Prepped by", txt(data.preppedBy)],
      ["Prepped date", txt(data.preppedDate)],
      ["Bag expires",
        first ? global.Expiry.format(first.parsed) : "—",
        first ? expiryColour(first.med, data.inServiceUntil) : null],
      ["Seal number", txt(data.sealNumber) || "—"],
      ["Contact", txt(data.companyPhone)]
    ];
    if (txt(data.inServiceUntil)) {
      details.splice(3, 0, ["In service until", serviceDate(data)]);
    }
    y = detailStrip(doc, details, y) + 6;

    // Contents table
    var widths = [50, 26, 30, 18, 30, 32]; // = 186 = CONTENT_W
    var header = ["Item", "Quantity", "Presentation", "Schedule", "Batch number", "Expiry date"];

    function tableHead(atY) {
      return drawRow(doc, PAGE.ml, atY, widths, header.map(function (h) {
        return { text: h, bold: true, fill: HEAD_BG, size: 9 };
      }), { minH: 8 });
    }

    y += tableHead(y);

    data.medications.forEach(function (m) {
      // Page break before a row that will not fit.
      if (y > PAGE.h - PAGE.mb - 14) {
        addPage(doc, state);
        y = PAGE.mt;
        y += tableHead(y);
      }
      var sched = txt(m.schedule) || "GSL";
      var colour = SCHEDULE_COLOUR[sched] || SCHEDULE_COLOUR.GSL;
      y += drawRow(doc, PAGE.ml, y, widths, [
        { text: m.name },
        { text: "x" + m.doses + (txt(m.dose) ? " " + m.dose : "") },
        { text: m.presentation },
        { text: sched, bold: true, fill: colour, colour: [255, 255, 255], align: "center" },
        { text: m.batch || "—" },
        { text: expiryText(m), colour: expiryColour(m, data.inServiceUntil),
          bold: !!expiryColour(m, data.inServiceUntil) }
      ], { minH: 8 });
    });

    var warnH = drawInServiceWarning(doc, data, y + 6);
    if (warnH) y += 6 + warnH;

    // Two-person check block
    if (y + 30 > PAGE.h - PAGE.mb) {
      addPage(doc, state);
      y = PAGE.mt;
    } else {
      y += 6;
    }
    y += drawCheckBlock(doc, data, y);

    // "If found" notice
    var noticeLines = [];
    setFont(doc, 10, "normal");
    var address = txt(data.companyAddress).replace(/\s*\n\s*/g, ", ");
    var body = "If found, please call " + txt(data.companyName) +
      " on " + txt(data.companyPhone) +
      (address ? " (" + address + ")" : "") +
      ", or hand in to your local police station.";
    noticeLines = wrap(doc, body, CONTENT_W - 8);
    var noticeH = linesHeight(noticeLines, 10) + 13;

    if (y + noticeH > PAGE.h - PAGE.mb) {
      addPage(doc, state);
      y = PAGE.mt;
    } else {
      y += 6;
    }

    doc.setFillColor(255, 244, 214);
    doc.setDrawColor(196, 150, 20);
    doc.setLineWidth(0.5);
    doc.rect(PAGE.ml, y, CONTENT_W, noticeH, "FD");
    setFont(doc, 9, "bold");
    doc.setTextColor(140, 96, 0);
    doc.text("IF FOUND", PAGE.ml + 4, y + 6);
    setFont(doc, 10, "normal");
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(noticeLines, PAGE.ml + 4, y + 11.5);

  }

  /* ------------------------------------------------------------------ */
  /* One usage log per medication                                        */
  /* ------------------------------------------------------------------ */
  var LOG_ROW_H = 9;

  /* Split `total` rows over as few pages as possible, balanced rather than
     packing the first page full and leaving a stub at the end. */
  function splitRows(total, capFirst, capRest) {
    var pages = 1;
    while (capFirst + (pages - 1) * capRest < total) pages += 1;

    var counts = [];
    var base = Math.floor(total / pages);
    var extra = total % pages;
    for (var i = 0; i < pages; i++) counts.push(base + (i < extra ? 1 : 0));

    // Respect per-page capacity, pushing any overflow to later pages.
    var carry = 0;
    for (var j = 0; j < pages; j++) {
      var cap = j === 0 ? capFirst : capRest;
      counts[j] += carry;
      carry = 0;
      if (counts[j] > cap) { carry = counts[j] - cap; counts[j] = cap; }
    }
    return counts;
  }

  /* Grey title bar naming the medication. */
  function logTitle(doc, data, med, y, colour) {
    var c = colour || HEAD_BG;
    doc.setFillColor(c[0], c[1], c[2]);
    doc.rect(PAGE.ml, y, CONTENT_W, 11, "F");
    doc.setTextColor(255, 255, 255);
    setFont(doc, 13, "bold");
    doc.text(pageTitle(data, med), PAGE.w / 2, y + 7.5, { align: "center" });
    doc.setTextColor(INK[0], INK[1], INK[2]);
    return y + 11;
  }

  /* PRESENTATION / DOSE / BATCH NO / EXPIRY strip. */
  function logDetailBar(doc, data, med, y) {
    var pairs = [
      ["PRESENTATION", med.presentation],
      ["DOSE", med.dose],
      ["BATCH NO", med.batch || "\u2014"],
      ["EXPIRY", expiryText(med)]
    ];
    var barH = 8;
    var cx = PAGE.ml;
    var cellW = CONTENT_W / pairs.length;
    pairs.forEach(function (p, i) {
      setFont(doc, 7.5, "bold");
      var labelW = doc.getTextWidth(p[0]) + 5;
      doc.setFillColor(BAR_BG[0], BAR_BG[1], BAR_BG[2]);
      doc.rect(cx, y, labelW, barH, "F");
      doc.setTextColor(255, 255, 255);
      doc.text(p[0], cx + 2.5, y + 5.4);

      doc.setFillColor(213, 216, 220);
      doc.rect(cx + labelW, y, cellW - labelW, barH, "F");
      var vc = (i === 3 && expiryColour(med, data.inServiceUntil)) || INK;
      doc.setTextColor(vc[0], vc[1], vc[2]);
      setFont(doc, 8.5, "bold");
      doc.text(wrap(doc, p[1], cellW - labelW - 4)[0], cx + labelW + 2.5, y + 5.4);
      cx += cellW;
    });
    doc.setTextColor(INK[0], INK[1], INK[2]);
    return y + barH;
  }

  /*
   * Draw a paginated log for one medication.
   * spec: { widths, header, rowCount, row(n), firstHead(y)->y, contHead(y)->y,
   *         contHeadH, rowH }
   * The first page's header is drawn before capacity is measured, so a header
   * whose height depends on wrapped text cannot push rows off the page.
   */
  function drawPaginatedLog(doc, data, med, state, spec) {
    function tableHead(atY) {
      return drawRow(doc, PAGE.ml, atY, spec.widths, spec.header.map(function (h, i) {
        return {
          text: h, bold: true, fill: SOFT_BG, size: spec.headSize || 9,
          align: spec.headAlign && spec.headAlign[i] ? spec.headAlign[i] : "left"
        };
      }), { minH: 8 });
    }

    var rowH = spec.rowH || LOG_ROW_H;
    var bottom = PAGE.h - PAGE.mb;

    addPage(doc, state);
    var y = spec.firstHead(PAGE.mt);
    y += tableHead(y);
    if (spec.afterHead) y += spec.afterHead(y);

    var capFirst = Math.max(1, Math.floor((bottom - y) / rowH));
    var capRest = Math.max(1, Math.floor((bottom - (PAGE.mt + spec.contHeadH + 8)) / rowH));
    var counts = splitRows(spec.rowCount, capFirst, capRest);

    var n = 1;
    counts.forEach(function (count, pageIdx) {
      if (pageIdx > 0) {
        addPage(doc, state);
        y = spec.contHead(PAGE.mt);
        y += tableHead(y);
      }
      for (var i = 0; i < count; i++) {
        y += drawRow(doc, PAGE.ml, y, spec.widths, spec.row(n), { minH: rowH });
        n += 1;
      }
    });
  }

  /* ---- standard usage log ---- */
  function drawLog(doc, data, med, state) {
    drawPaginatedLog(doc, data, med, state, {
      widths: [16, 40, 40, 90], // NO | DATE USED | PRF NO | SIGNED = 186
      header: ["NO", "DATE USED", "PRF NO", "SIGNED"],
      headAlign: ["center", "left", "left", "left"],
      rowCount: Math.max(1, parseInt(med.doses, 10) || 1),
      row: function (n) {
        return [
          { text: String(n), bold: true, align: "center" },
          { text: "" }, { text: "" }, { text: "" }
        ];
      },
      contHeadH: 8,
      firstHead: function (y) { return logDetailBar(doc, data, med, logTitle(doc, data, med, y)) + 7; },
      contHead: function (y) {
        setFont(doc, 10, "bold");
        doc.text(pageTitle(data, med) + " (continued)", PAGE.ml, y + 4);
        return y + 8;
      }
    });
  }

  /* ---- controlled drug register ---- */
  function drawCdLog(doc, data, med, state) {
    var doses = Math.max(1, parseInt(med.doses, 10) || 1);
    // Spare rows: a discard or part-dose entry consumes a line of its own.
    var rows = doses + Math.max(2, Math.ceil(doses / 4));
    var widths = [20, 13, 22, 18, 18, 18, 40, 37]; // = 186
    var note = "Every entry must be signed by the administering clinician and a witness. " +
      "Record any discarded volume on its own line and carry the balance forward.";

    function openingBalance(y) {
      // Balance brought forward, drawn across merged leading columns.
      return drawRow(doc, PAGE.ml, y, [55, 18, 18, 18, 40, 37], [
        { text: "BALANCE BROUGHT FORWARD \u2014 " + quantityText(med) +
            " (stock entered " + (txt(data.preppedDate) || "\u2014") + ")",
          bold: true, fill: [235, 238, 241], size: 8 },
        { text: "\u2014", align: "center", fill: [235, 238, 241] },
        { text: "\u2014", align: "center", fill: [235, 238, 241] },
        { text: String(doses), bold: true, align: "center", fill: [235, 238, 241] },
        { text: txt(data.preppedBy), size: 8, fill: [235, 238, 241] },
        { text: txt(data.checkedBy), size: 8, fill: [235, 238, 241] }
      ], { minH: 8 });
    }

    drawPaginatedLog(doc, data, med, state, {
      widths: widths,
      header: ["DATE", "TIME", "PRF NO", unitHead("GIVEN", med), unitHead("DISCARD", med),
               unitHead("BALANCE", med), "ADMINISTERED BY", "WITNESSED BY"],
      headSize: 7.5,
      headAlign: ["left", "left", "left", "center", "center", "center", "left", "left"],
      rowCount: rows,
      row: function () {
        return [
          { text: "" }, { text: "" }, { text: "" }, { text: "" },
          { text: "" }, { text: "" }, { text: "" }, { text: "" }
        ];
      },
      contHeadH: 8,
      firstHead: function (y) {
        y = logTitle(doc, data, med, y, CD_BG);
        y = logDetailBar(doc, data, med, y);
        y += 5;
        setFont(doc, 7.5, "normal");
        doc.setTextColor(120, 40, 40);
        var noteLines = wrap(doc, note, CONTENT_W);
        doc.text(noteLines, PAGE.ml, y);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        return y + linesHeight(noteLines, 7.5) + 3;
      },
      afterHead: openingBalance,
      contHead: function (y) {
        setFont(doc, 10, "bold");
        doc.setTextColor(CD_BG[0], CD_BG[1], CD_BG[2]);
        doc.text("CD register \u2014 " + pageTitle(data, med) + " (continued)", PAGE.ml, y + 4);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        return y + 8;
      }
    });
  }


  /* ------------------------------------------------------------------ */
  /* Controlled drugs: register front sheet                              */
  /* ------------------------------------------------------------------ */
  function drawCdCover(doc, data, state) {
    var y = PAGE.mt;

    doc.setFillColor(CD_BG[0], CD_BG[1], CD_BG[2]);
    doc.rect(PAGE.ml, y, CONTENT_W, 20, "F");
    var logoW = drawLogo(doc, data, PAGE.ml + 3, y + 3, 26, 14);
    var textX = PAGE.ml + 4 + (logoW ? logoW + 3 : 0);
    doc.setTextColor(255, 255, 255);
    setFont(doc, 15, "bold");
    doc.text("CONTROLLED DRUGS REGISTER", textX, y + 8.5);
    setFont(doc, 10, "normal");
    doc.text(wrap(doc, companyLine(data), CONTENT_W - (textX - PAGE.ml) - 40)[0],
      textX, y + 15);
    setFont(doc, 9, "normal");
    doc.text("CD SAFE", PAGE.w - PAGE.mr - 4, y + 7, { align: "right" });
    setFont(doc, 16, "bold");
    doc.text(txt(data.bagNumber) || "\u2014", PAGE.w - PAGE.mr - 4, y + 15.5, { align: "right" });
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += 20;

    var first = global.Expiry ? global.Expiry.earliest(data.medications) : null;
    var details = [
      ["Accountable officer", txt(data.preppedBy)],
      ["Register opened", txt(data.preppedDate)],
      ["Earliest expiry",
        first ? global.Expiry.format(first.parsed) : "\u2014",
        first ? expiryColour(first.med, data.inServiceUntil) : null],
      ["Location", txt(data.safeLocation) || "\u2014"],
      ["Contact", txt(data.companyPhone)]
    ];
    if (txt(data.inServiceUntil)) {
      details.splice(3, 0, ["Expiry checked to", serviceDate(data)]);
    }
    y = detailStrip(doc, details, y) + 6;

    // Stock held
    var widths = [52, 28, 28, 28, 24, 26]; // = 186
    y += drawRow(doc, PAGE.ml, y, widths, [
      "Controlled drug", "Presentation", "Strength", "Quantity", "Batch", "Expiry"
    ].map(function (h) {
      return { text: h, bold: true, fill: HEAD_BG, colour: [255, 255, 255], size: 9 };
    }), { minH: 8 });

    data.medications.forEach(function (m) {
      if (y > PAGE.h - PAGE.mb - 14) {
        addPage(doc, state);
        y = PAGE.mt;
      }
      y += drawRow(doc, PAGE.ml, y, widths, [
        { text: m.name },
        { text: m.presentation },
        { text: m.dose },
        { text: quantityText(m), bold: true, align: "center" },
        { text: m.batch || "\u2014" },
        { text: expiryText(m), colour: expiryColour(m, data.inServiceUntil),
          bold: !!expiryColour(m, data.inServiceUntil) }
      ], { minH: 8 });
    });

    var cdWarnH = drawInServiceWarning(doc, data, y + 6);
    if (cdWarnH) y += 6 + cdWarnH;

    y += 6;
    if (y + 30 > PAGE.h - PAGE.mb) {
      addPage(doc, state);
      y = PAGE.mt;
    }
    y += drawCheckBlock(doc, data, y, "STOCK CHECK \u2014 TWO PERSON",
                        "CHECKED BY", "WITNESSED BY");

    // Storage / handling notice
    setFont(doc, 9, "normal");
    var lines = wrap(doc, "Controlled drugs are held in the CD safe and are not carried in the " +
      "drug bag. Stock is signed out of the safe into a personal drug pouch on the sign-out " +
      "sheet at the back of this register, and any unused stock is signed back in. Retain this " +
      "register in line with your organisation's controlled drugs policy and current legislation.",
      CONTENT_W - 8);
    var h = linesHeight(lines, 9) + 12;
    y += 6;
    if (y + h > PAGE.h - PAGE.mb) {
      addPage(doc, state);
      y = PAGE.mt;
    }
    doc.setFillColor(250, 238, 238);
    doc.setDrawColor(CD_BG[0], CD_BG[1], CD_BG[2]);
    doc.setLineWidth(0.5);
    doc.rect(PAGE.ml, y, CONTENT_W, h, "FD");
    setFont(doc, 9, "bold");
    doc.setTextColor(CD_BG[0], CD_BG[1], CD_BG[2]);
    doc.text("STORAGE AND HANDLING", PAGE.ml + 4, y + 6);
    setFont(doc, 9, "normal");
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(lines, PAGE.ml + 4, y + 11);

  }


  /* ------------------------------------------------------------------ */
  /* Controlled drugs: recurring stock check record (landscape)          */
  /* ------------------------------------------------------------------ */

  /* One sheet per group of drugs, so the columns never squeeze too far. */
  var STOCK_CHECK_MAX_DRUGS = 7;

  function drawStockCheckSheets(doc, data, state) {
    for (var i = 0; i < data.medications.length; i += STOCK_CHECK_MAX_DRUGS) {
      drawStockCheckSheet(doc, data, state,
        data.medications.slice(i, i + STOCK_CHECK_MAX_DRUGS),
        i, data.medications.length);
    }
  }

  function drawStockCheckSheet(doc, data, state, meds, offset, total) {
    addPage(doc, state, true);

    var W = PAGE.h, H = PAGE.w;
    var contentW = W - PAGE.ml - PAGE.mr;
    var y = PAGE.mt;

    var part = total > meds.length
      ? "  \u00b7  drugs " + (offset + 1) + "\u2013" + (offset + meds.length) + " of " + total
      : "";

    doc.setFillColor(CD_BG[0], CD_BG[1], CD_BG[2]);
    doc.rect(PAGE.ml, y, contentW, 13, "F");
    doc.setTextColor(255, 255, 255);
    setFont(doc, 13, "bold");
    doc.text("CD SAFE \u2014 STOCK CHECK RECORD", PAGE.ml + 4, y + 6);
    setFont(doc, 9, "normal");
    doc.text("Safe " + (txt(data.bagNumber) || "\u2014") + "  \u00b7  " + txt(data.companyName) +
      (txt(data.safeLocation) ? "  \u00b7  " + txt(data.safeLocation) : "") + part,
      PAGE.ml + 4, y + 11);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += 13 + 4;

    setFont(doc, 7.5, "normal");
    doc.setTextColor(120, 40, 40);
    doc.text("Enter the balance counted for each drug. Any discrepancy must be reported " +
      "immediately in line with your controlled drugs policy and recorded on the drug's " +
      "register page.", PAGE.ml, y);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += 6;

    var fixed = 22 + 14 + 38 + 38;                  // date, time, checked by, witnessed by
    var drugW = (contentW - fixed) / meds.length;
    var widths = [22, 14].concat(meds.map(function () { return drugW; })).concat([38, 38]);
    var header = ["DATE", "TIME"].concat(meds.map(function (m) {
      var u = unitOf(m);
      return txt(m.name) + (u ? " (" + u + ")" : "") +
        (txt(m.batch) ? " \u2014 " + txt(m.batch) : "");
    })).concat(["CHECKED BY", "WITNESSED BY"]);

    var headH = drawRow(doc, PAGE.ml, y, widths, header.map(function (h, i) {
      return {
        text: h, bold: true, fill: SOFT_BG, size: 7,
        align: (i >= 2 && i < 2 + meds.length) ? "center" : "left"
      };
    }), { minH: 12 });

    // Expected balance, so a counted figure has something to be checked against.
    var expected = [
      { text: "Expected at issue", bold: true, size: 7, fill: [235, 238, 241] },
      { text: "", fill: [235, 238, 241] }
    ].concat(meds.map(function (m) {
      return { text: String(m.doses), bold: true, align: "center", fill: [235, 238, 241] };
    })).concat([
      { text: txt(data.preppedBy), size: 7, fill: [235, 238, 241] },
      { text: txt(data.checkedBy), size: 7, fill: [235, 238, 241] }
    ]);

    y += headH;
    y += drawRow(doc, PAGE.ml, y, widths, expected, { minH: 8 });

    var rowH = 11;
    var blank = widths.map(function () { return { text: "" }; });
    while (y + rowH <= H - PAGE.mb) {
      y += drawRow(doc, PAGE.ml, y, widths, blank, { minH: rowH });
    }

  }


  /* ------------------------------------------------------------------ */
  /* Controlled drugs: safe -> pouch sign-out sheet (landscape)          */
  /* ------------------------------------------------------------------ */
  function drawPouchSheet(doc, data, state) {
    addPage(doc, state, true);

    var W = PAGE.h;              // 297 landscape width
    var H = PAGE.w;              // 210 landscape height
    var contentW = W - PAGE.ml - PAGE.mr;
    var y = PAGE.mt;

    doc.setFillColor(CD_BG[0], CD_BG[1], CD_BG[2]);
    doc.rect(PAGE.ml, y, contentW, 13, "F");
    doc.setTextColor(255, 255, 255);
    setFont(doc, 13, "bold");
    doc.text("CD SAFE \u2014 SIGN OUT / SIGN IN", PAGE.ml + 4, y + 6);
    setFont(doc, 9, "normal");
    doc.text("Safe " + (txt(data.bagNumber) || "\u2014") + "  \u00b7  " + txt(data.companyName) +
      (txt(data.safeLocation) ? "  \u00b7  " + txt(data.safeLocation) : ""), PAGE.ml + 4, y + 11);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += 13 + 4;

    setFont(doc, 7.5, "normal");
    doc.setTextColor(120, 40, 40);
    doc.text("Stock removed from the safe into a personal drug pouch must be signed out by two " +
      "people and signed back in on return. Anything administered is also entered on that drug's " +
      "register page.", PAGE.ml, y);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += 6;

    // DATE | TIME OUT | DRUG & STRENGTH | QTY | ISSUED BY | CARRIED BY | TIME IN | QTY IN | BACK IN
    var widths = [22, 18, 50, 16, 44, 50, 18, 18, 37]; // = 273
    var header = ["DATE", "TIME OUT", "DRUG AND STRENGTH", "QTY OUT", "ISSUED BY (sign)",
                  "CARRIED BY \u2014 name and reg. no.", "TIME IN", "QTY IN",
                  "SIGNED BACK IN"];

    function head(atY) {
      return drawRow(doc, PAGE.ml, atY, widths, header.map(function (h, i) {
        return {
          text: h, bold: true, fill: SOFT_BG, size: 7,
          align: (i === 3 || i === 6 || i === 7) ? "center" : "left"
        };
      }), { minH: 9 });
    }

    y += head(y);
    var rowH = 11;
    var blank = widths.map(function () { return { text: "" }; });
    while (y + rowH <= H - PAGE.mb) {
      y += drawRow(doc, PAGE.ml, y, widths, blank, { minH: rowH });
    }

  }


  /* ------------------------------------------------------------------ */
  /* Drug matrix: who may give what, as a colour-coded landscape table   */
  /* ------------------------------------------------------------------ */

  var MATRIX_BG = [31, 78, 145];        // heading band
  var YES_BG = [122, 201, 94];
  var NO_BG = [227, 66, 52];

  /*
   * Drawn rather than typed: the standard PDF fonts have no tick or cross, so
   * a glyph would come out as a substituted character on some viewers.
   */
  function drawTick(doc, cx, cy, size) {
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(size * 0.16);
    doc.lines([[size * 0.32, size * 0.36], [size * 0.62, -size * 0.78]],
      cx - size * 0.44, cy + size * 0.04);
  }

  function drawCross(doc, cx, cy, size) {
    doc.setDrawColor(255, 255, 255);
    doc.setLineWidth(size * 0.17);
    var r = size * 0.33;
    doc.line(cx - r, cy - r, cx + r, cy + r);
    doc.line(cx + r, cy - r, cx - r, cy + r);
  }

  function gradeAllows(med, grade) {
    return !!(med.allow && med.allow[grade.id]);
  }

  /* Indications are entered one per line and printed as a bulleted list. */
  function indicationLines(doc, med, width) {
    var raw = txt(med.indication);
    if (!raw) return [""];
    var parts = raw.split(/\r?\n/).map(function (p) { return p.trim(); })
      .filter(function (p) { return p; });
    if (parts.length <= 1) return wrap(doc, parts[0] || "", width);
    var out = [];
    parts.forEach(function (p) {
      wrap(doc, "\u2022 " + p, width).forEach(function (line) { out.push(line); });
    });
    return out;
  }

  var MATRIX_MIN_GRADE_W = 9;      // mm, the narrowest a tick still reads at
  var MATRIX_MIN_INDICATION_W = 42;

  /* How many grade columns fit beside the information columns on one sheet. */
  function gradesPerSheet(contentW, fixed) {
    return Math.max(1, Math.floor(
      (contentW - fixed - MATRIX_MIN_INDICATION_W) / MATRIX_MIN_GRADE_W));
  }

  function drawMatrix(doc, data, state) {
    var contentW = PAGE.h - PAGE.ml - PAGE.mr;   // landscape
    var all = (data.grades || []).filter(function (g) { return txt(g.name); });
    var fixed = 46 + 27 + 20;
    var per = gradesPerSheet(contentW, fixed);

    if (!all.length) {
      drawMatrixSheet(doc, data, state, [], 0, 0);
      return;
    }
    // Too many grades for one sheet: repeat the medication columns and carry on.
    for (var i = 0; i < all.length; i += per) {
      drawMatrixSheet(doc, data, state, all.slice(i, i + per), i, all.length);
    }
  }

  function drawMatrixSheet(doc, data, state, list, offset, total) {
    var W = PAGE.h, H = PAGE.w;                 // landscape
    var contentW = W - PAGE.ml - PAGE.mr;
    var rowMin = 9;

    // Information columns are fixed; the grade columns share what is left, and
    // any slack goes back to the indication, which is always the hungriest.
    var nameW = 46, formW = 27, strengthW = 20;
    var fixed = nameW + formW + strengthW;
    var gradeW = list.length
      ? Math.max(MATRIX_MIN_GRADE_W,
          Math.min(20, (contentW - fixed - MATRIX_MIN_INDICATION_W) / list.length))
      : 0;
    var indicationW = contentW - fixed - gradeW * list.length;

    var widths = [nameW, indicationW, formW, strengthW]
      .concat(list.map(function () { return gradeW; }));
    var header = ["Medication name", "Indication", "Formulation(s)", "Strength"]
      .concat(list.map(function (g) { return txt(g.abbr) || txt(g.name); }));

    /* Text is unreadable once it wraps mid-word ("FREU" / "C 5", or a strength
       broken as "2.5mg/2.5m" / "l"), so shrink it until each word fits the
       column instead. drawRow wraps at width - padX * 2. */
    function fitSize(text, width, base, min, bold) {
      var words = String(text).split(/\s+/);
      for (var size = base; size > min; size -= 0.5) {
        setFont(doc, size, bold ? "bold" : "normal");
        var fits = words.every(function (w) {
          return doc.getTextWidth(w) <= width - 3.8;
        });
        if (fits) return size;
      }
      return min;
    }

    function headerRow(y) {
      return drawRow(doc, PAGE.ml, y, widths, header.map(function (h, i) {
        return {
          text: h, bold: true, fill: MATRIX_BG, colour: [255, 255, 255],
          size: i < 4 ? 8.5 : fitSize(h, gradeW, 7.5, 5, true),
          align: i < 4 ? "left" : "center"
        };
      }), { minH: 9 });
    }

    function banner(y) {
      doc.setFillColor(MATRIX_BG[0], MATRIX_BG[1], MATRIX_BG[2]);
      doc.rect(PAGE.ml, y, contentW, 15, "F");
      var logoW = drawLogo(doc, data, PAGE.ml + 2.5, y + 2.5, 22, 10);
      var textX = PAGE.ml + 4 + (logoW ? logoW + 3 : 0);
      doc.setTextColor(255, 255, 255);
      setFont(doc, 12, "bold");
      doc.text("DRUG MATRIX", textX, y + 7);
      setFont(doc, 8.5, "normal");
      doc.text(companyLine(data), textX, y + 12);

      setFont(doc, 8, "normal");
      var right = [];
      if (txt(data.bagNumber)) right.push("Ref " + txt(data.bagNumber));
      if (txt(data.preppedDate)) right.push("Approved " + txt(data.preppedDate));
      if (txt(data.inServiceUntil)) right.push("Review " + serviceDate(data));
      if (total > list.length) {
        right.push("Grades " + (offset + 1) + "\u2013" + (offset + list.length) +
          " of " + total);
      }
      doc.text(right.join("   \u00b7   "), W - PAGE.mr - 4, y + 9, { align: "right" });
      doc.setTextColor(INK[0], INK[1], INK[2]);
      return y + 15 + 4;
    }

    var y = 0;
    function newSheet() {
      addPage(doc, state, true);
      y = banner(PAGE.mt);
      y += headerRow(y);
    }

    newSheet();
    var usable = H - PAGE.mb - (PAGE.mt + 15 + 4 + 9);
    data.medications.forEach(function (m) {
      // Measure first, so a tall row moves to the next sheet whole.
      setFont(doc, 8.5, "normal");
      var lines = indicationLines(doc, m, indicationW - 3.6);
      // An indication longer than a whole sheet is trimmed rather than left to
      // run off the bottom; the app warns nothing is silently lost.
      var maxLines = Math.max(1, Math.floor((usable - 3.2) / (8.5 * 0.3528 * 1.15)));
      if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines - 1).concat(["\u2026"]);
      }
      var needed = Math.max(rowMin, linesHeight(lines, 8.5) + 3.2,
        linesHeight(wrap(doc, txt(m.name), nameW - 3.6), 8.5) + 3.2);
      if (y + needed > H - PAGE.mb) newSheet();

      var cells = [
        { text: m.name, size: 8.5 },
        { text: lines.join("\n"), size: 8.5 },
        { text: m.presentation, size: 8.5 },
        { text: m.dose, size: fitSize(txt(m.dose), strengthW, 8.5, 6), align: "center" }
      ].concat(list.map(function (g) {
        return { text: "", fill: gradeAllows(m, g) ? YES_BG : NO_BG };
      }));

      var h = drawRow(doc, PAGE.ml, y, widths, cells, { minH: rowMin });

      // Marks go on afterwards: drawRow paints the fills they sit on.
      var cx = PAGE.ml + nameW + indicationW + formW + strengthW;
      list.forEach(function (g) {
        var mid = cx + gradeW / 2;
        if (gradeAllows(m, g)) drawTick(doc, mid, y + h / 2, 3.4);
        else drawCross(doc, mid, y + h / 2, 3.4);
        cx += gradeW;
      });
      y += h;
    });

    drawMatrixKey(doc, data, state, list, H, contentW, y, banner);
  }

  /*
   * Column headings are abbreviated to fit, so the full grade names are spelled
   * out underneath. Without this the table is unreadable to anyone who did not
   * write it.
   */
  function drawMatrixKey(doc, data, state, list, H, contentW, y, banner) {
    var entries = list.map(function (g) {
      var abbr = txt(g.abbr) || txt(g.name);
      return abbr === txt(g.name) ? abbr : abbr + " = " + txt(g.name);
    });
    setFont(doc, 8, "normal");
    // Packed entry by entry rather than wrapped as one string, so a grade name
    // is never split across two lines mid-phrase.
    var lines = [];
    var line = "";
    entries.forEach(function (entry) {
      var candidate = line ? line + "      " + entry : entry;
      if (line && doc.getTextWidth(candidate) > contentW - 8) {
        lines.push(line);
        line = entry;
      } else {
        line = candidate;
      }
    });
    if (line) lines.push(line);
    var keyH = linesHeight(lines, 8) + 11;

    // Key and approval block travel together; move both rather than split them.
    if (y + 6 + keyH + 6 + 24 > H - PAGE.mb) {
      addPage(doc, state, true);
      y = banner(PAGE.mt);
    } else {
      y += 6;
    }

    doc.setFillColor(SOFT_BG[0], SOFT_BG[1], SOFT_BG[2]);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.rect(PAGE.ml, y, contentW, keyH, "FD");
    setFont(doc, 8, "bold");
    doc.setTextColor(60, 72, 86);
    doc.text("KEY TO COLUMNS", PAGE.ml + 4, y + 5);
    setFont(doc, 8, "normal");
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(lines, PAGE.ml + 4, y + 9.5);

    drawApprovalBlock(doc, data, y + keyH + 6, contentW);
  }

  /* Approval signatures, in the landscape width. */
  function drawApprovalBlock(doc, data, y, contentW) {
    var h = 24;
    var halfW = contentW / 2;
    doc.setFillColor(SOFT_BG[0], SOFT_BG[1], SOFT_BG[2]);
    doc.rect(PAGE.ml, y, contentW, 6.5, "F");
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.rect(PAGE.ml, y, contentW, h, "S");
    doc.line(PAGE.ml, y + 6.5, PAGE.ml + contentW, y + 6.5);
    doc.line(PAGE.ml + halfW, y + 6.5, PAGE.ml + halfW, y + h);

    setFont(doc, 8, "bold");
    doc.setTextColor(60, 72, 86);
    doc.text("FORMULARY APPROVAL", PAGE.ml + 3, y + 4.6);
    doc.setTextColor(INK[0], INK[1], INK[2]);

    [["APPROVED BY", txt(data.preppedBy), txt(data.preppedDate), PAGE.ml],
     ["CHECKED BY", txt(data.checkedBy), "", PAGE.ml + halfW]].forEach(function (col) {
      var cx = col[3];
      setFont(doc, 7, "bold");
      doc.setTextColor(95, 105, 118);
      doc.text(col[0], cx + 3, y + 11);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      [["Name", col[1], 15.5], ["Signature", "", 20], ["Date", col[2], 15.5]]
        .forEach(function (row, i) {
          var rx = cx + (i === 2 ? halfW / 2 : 0);
          var rw = i === 2 ? halfW / 2 : halfW / 2;
          setFont(doc, 7.5, "normal");
          doc.setTextColor(95, 105, 118);
          doc.text(row[0], rx + 3, y + row[2]);
          doc.setTextColor(INK[0], INK[1], INK[2]);
          doc.setDrawColor(160, 168, 178);
          doc.setLineWidth(0.15);
          doc.line(rx + 18, y + row[2] + 1, rx + rw - 3, y + row[2] + 1);
          if (row[1]) {
            setFont(doc, 8.5, "bold");
            doc.text(wrap(doc, row[1], rw - 24)[0], rx + 19, y + row[2]);
          }
        });
    });
  }

  /* ------------------------------------------------------------------ */

  /*
   * A formulary attached to a bag or register, printed after its own pages:
   * what is held, then who may give it, in one document. The matrix keeps its
   * own reference, approval names and dates, but wears the document's company
   * details and logo, because it is that document's paperwork.
   */
  function drawAttachedMatrix(doc, data, state) {
    var f = data.formulary;
    if (!f || !Array.isArray(f.medications) || !f.medications.length) return;
    var named = (f.grades || []).filter(function (g) { return txt(g.name); });
    if (!named.length) return;

    var setup = f.setup || {};
    drawMatrix(doc, {
      mode: "matrix",
      companyName: data.companyName,
      cqcRegistered: data.cqcRegistered,
      cqcNumber: data.cqcNumber,
      logo: data.logo, logoW: data.logoW, logoH: data.logoH,
      bagNumber: setup.bagNumber,
      preppedBy: setup.preppedBy,
      checkedBy: setup.checkedBy,
      preppedDate: setup.preppedDate,
      inServiceUntil: setup.inServiceUntil,
      medications: f.medications,
      grades: named
    }, state);
  }

  function build(data) {
    var jsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDF) throw new Error("jsPDF failed to load.");

    var doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    doc.setProperties({
      title: isMatrixDoc(data)
        ? "Drug matrix " + txt(data.bagNumber)
        : isCdDoc(data)
          ? "Controlled drugs register — safe " + txt(data.bagNumber)
          : "Drug bag " + txt(data.bagNumber) + " — medication log",
      subject: isMatrixDoc(data)
        ? "Drug matrix / formulary"
        : isCdDoc(data) ? "Controlled drugs register" : "Medication tracking document",
      author: txt(data.companyName),
      creator: "Drug Bag Tracker"
    });

    var state = { page: 1, sizes: { 1: { w: PAGE.w, h: PAGE.h } } };
    if (isMatrixDoc(data)) {
      // The matrix is landscape throughout, so the portrait first page that
      // jsPDF opens with is discarded once the first sheet exists.
      drawMatrix(doc, data, state);
      doc.deletePage(1);
      var shifted = {};
      Object.keys(state.sizes).forEach(function (k) {
        if (Number(k) > 1) shifted[Number(k) - 1] = state.sizes[k];
      });
      state.sizes = shifted;
    } else if (isCdDoc(data)) {
      drawCdCover(doc, data, state);
      data.medications.forEach(function (m) { drawCdLog(doc, data, m, state); });
      drawStockCheckSheets(doc, data, state);
      drawPouchSheet(doc, data, state);
    } else {
      drawLabel(doc, data, state);
      data.medications.forEach(function (m) { drawLog(doc, data, m, state); });
    }
    if (!isMatrixDoc(data)) drawAttachedMatrix(doc, data, state);
    stampFooters(doc, data, state);
    return doc;
  }

  function fileName(data) {
    var id = txt(data.bagNumber)
      .replace(/^(formulary|cd\s*safe|safe|drug\s*bag|bag|db)[\s._-]*/i, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unnumbered";
    return (isMatrixDoc(data) ? "Formulary-"
      : isCdDoc(data) ? "CD-Register-" : "Drug-Bag-") + id + ".pdf";
  }

  global.DrugBagPDF = {
    build: build,
    save: function (data) { build(data).save(fileName(data)); },
    open: function (data) {
      var url = build(data).output("bloburl");
      var win = global.open(url, "_blank");
      if (!win) throw new Error("Preview was blocked — allow pop-ups, or use Download instead.");
    }
  };
})(window);
