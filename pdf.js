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

  function expiryColour(med) {
    if (!global.Expiry) return null;
    var st = global.Expiry.status(expiryOf(med));
    if (st === "expired") return RED;
    if (st === "soon") return AMBER;
    return null;
  }

  /* Does this medication get the controlled-drug register layout? */
  function isCd(med) {
    return med.cdLog === true || (med.cdLog === undefined && txt(med.schedule) === "CD");
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

  /* Prepared-by / checked-by signature block for the two-person bag check. */
  function drawCheckBlock(doc, data, y) {
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
    doc.text("BAG PREPARATION \u2014 TWO PERSON CHECK", PAGE.ml + 3, y + 4.9);
    doc.setTextColor(INK[0], INK[1], INK[2]);

    [
      ["PREPARED BY", txt(data.preppedBy), txt(data.preppedDate), PAGE.ml],
      ["CHECKED BY", txt(data.checkedBy), "", PAGE.ml + halfW]
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

  function footer(doc, data, pageNo) {
    setFont(doc, 8, "normal");
    doc.setTextColor(110, 118, 128);
    var left = "Bag " + (txt(data.bagNumber) || "—") + "  ·  " + txt(data.companyName);
    doc.text(left, PAGE.ml, PAGE.h - 7);
    doc.text("Page " + pageNo, PAGE.w - PAGE.mr, PAGE.h - 7, { align: "right" });
    doc.setTextColor(INK[0], INK[1], INK[2]);
  }

  /* ------------------------------------------------------------------ */
  /* Page 1+: the bag label / contents list                              */
  /* ------------------------------------------------------------------ */
  function drawLabel(doc, data, state) {
    var y = PAGE.mt;

    // Masthead
    doc.setFillColor(18, 33, 47);
    doc.rect(PAGE.ml, y, CONTENT_W, 20, "F");
    doc.setTextColor(255, 255, 255);
    setFont(doc, 15, "bold");
    doc.text("DRUG BAG CONTENTS", PAGE.ml + 4, y + 8.5);
    setFont(doc, 10, "normal");
    doc.text(txt(data.companyName), PAGE.ml + 4, y + 15);

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
        first ? expiryColour(first.med) : null],
      ["Seal number", txt(data.sealNumber) || "—"],
      ["Contact", txt(data.companyPhone)]
    ];
    var dw = CONTENT_W / details.length;
    doc.setFillColor(SOFT_BG[0], SOFT_BG[1], SOFT_BG[2]);
    doc.rect(PAGE.ml, y, CONTENT_W, 12, "F");
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.2);
    doc.rect(PAGE.ml, y, CONTENT_W, 12, "S");
    details.forEach(function (d, i) {
      var cx = PAGE.ml + dw * i;
      if (i > 0) doc.line(cx, y, cx, y + 12);
      setFont(doc, 7, "normal");
      doc.setTextColor(95, 105, 118);
      doc.text(d[0].toUpperCase(), cx + 2.5, y + 4.5);
      var vc = d[2] || INK;
      doc.setTextColor(vc[0], vc[1], vc[2]);
      setFont(doc, 9, "bold");
      doc.text(wrap(doc, d[1] || "—", dw - 5)[0], cx + 2.5, y + 9.5);
      doc.setTextColor(INK[0], INK[1], INK[2]);
    });
    y += 12 + 6;

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
        footer(doc, data, state.page);
        doc.addPage();
        state.page += 1;
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
        { text: expiryText(m), colour: expiryColour(m), bold: !!expiryColour(m) }
      ], { minH: 8 });
    });

    // Two-person check block
    if (y + 30 > PAGE.h - PAGE.mb) {
      footer(doc, data, state.page);
      doc.addPage();
      state.page += 1;
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
      footer(doc, data, state.page);
      doc.addPage();
      state.page += 1;
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

    footer(doc, data, state.page);
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
  function logTitle(doc, med, y, colour) {
    var c = colour || HEAD_BG;
    doc.setFillColor(c[0], c[1], c[2]);
    doc.rect(PAGE.ml, y, CONTENT_W, 11, "F");
    doc.setTextColor(255, 255, 255);
    setFont(doc, 13, "bold");
    doc.text(txt(med.name), PAGE.w / 2, y + 7.5, { align: "center" });
    doc.setTextColor(INK[0], INK[1], INK[2]);
    return y + 11;
  }

  /* PRESENTATION / DOSE / BATCH NO / EXPIRY strip. */
  function logDetailBar(doc, med, y) {
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
      var vc = (i === 3 && expiryColour(med)) || INK;
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

    doc.addPage();
    state.page += 1;
    var y = spec.firstHead(PAGE.mt);
    y += tableHead(y);
    if (spec.afterHead) y += spec.afterHead(y);

    var capFirst = Math.max(1, Math.floor((bottom - y) / rowH));
    var capRest = Math.max(1, Math.floor((bottom - (PAGE.mt + spec.contHeadH + 8)) / rowH));
    var counts = splitRows(spec.rowCount, capFirst, capRest);

    var n = 1;
    counts.forEach(function (count, pageIdx) {
      if (pageIdx > 0) {
        doc.addPage();
        state.page += 1;
        y = spec.contHead(PAGE.mt);
        y += tableHead(y);
      }
      for (var i = 0; i < count; i++) {
        y += drawRow(doc, PAGE.ml, y, spec.widths, spec.row(n), { minH: rowH });
        n += 1;
      }
      footer(doc, data, state.page);
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
      firstHead: function (y) { return logDetailBar(doc, med, logTitle(doc, med, y)) + 7; },
      contHead: function (y) {
        setFont(doc, 10, "bold");
        doc.text(txt(med.name) + " (continued)", PAGE.ml, y + 4);
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
        { text: "BALANCE BROUGHT FORWARD (bag prepped " + (txt(data.preppedDate) || "\u2014") + ")",
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
      header: ["DATE", "TIME", "PRF NO", "GIVEN", "DISCARD", "BALANCE",
               "ADMINISTERED BY", "WITNESSED BY"],
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
        y = logTitle(doc, med, y, CD_BG);
        y = logDetailBar(doc, med, y);
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
        doc.text("CD register \u2014 " + txt(med.name) + " (continued)", PAGE.ml, y + 4);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        return y + 8;
      }
    });
  }

  /* ------------------------------------------------------------------ */

  function build(data) {
    var jsPDF = (global.jspdf && global.jspdf.jsPDF) || global.jsPDF;
    if (!jsPDF) throw new Error("jsPDF failed to load.");

    var doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    doc.setProperties({
      title: "Drug bag " + txt(data.bagNumber) + " — medication log",
      subject: "Medication tracking document",
      author: txt(data.companyName),
      creator: "Drug Bag Tracker"
    });

    var state = { page: 1 };
    drawLabel(doc, data, state);
    data.medications.forEach(function (m) {
      if (isCd(m)) drawCdLog(doc, data, m, state);
      else drawLog(doc, data, m, state);
    });
    return doc;
  }

  function fileName(data) {
    var bag = txt(data.bagNumber).replace(/[^A-Za-z0-9_-]+/g, "-") || "bag";
    return "drug-bag-" + bag + "-log.pdf";
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
