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

    // Detail strip
    var details = [
      ["Prepped by", txt(data.preppedBy)],
      ["Prepped date", txt(data.preppedDate)],
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
      setFont(doc, 7.5, "normal");
      doc.setTextColor(95, 105, 118);
      doc.text(d[0].toUpperCase(), cx + 2.5, y + 4.5);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      setFont(doc, 9.5, "bold");
      doc.text(wrap(doc, d[1] || "—", dw - 5)[0], cx + 2.5, y + 9.5);
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
        { text: m.expiry }
      ], { minH: 8 });
    });

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

  function drawLog(doc, data, med, state) {
    var total = Math.max(1, parseInt(med.doses, 10) || 1);
    var widths = [16, 40, 40, 90]; // NO | DATE USED | PRF NO | SIGNED  = 186
    var header = ["NO", "DATE USED", "PRF NO", "SIGNED"];

    function tableHead(atY) {
      return drawRow(doc, PAGE.ml, atY, widths, header.map(function (h, i) {
        return { text: h, bold: true, fill: SOFT_BG, size: 9, align: i === 0 ? "center" : "left" };
      }), { minH: 8 });
    }

    /* Header block for the first page: title bar + presentation/dose bar. */
    function firstPageHead() {
      var y = PAGE.mt;
      doc.setFillColor(HEAD_BG[0], HEAD_BG[1], HEAD_BG[2]);
      doc.rect(PAGE.ml, y, CONTENT_W, 11, "F");
      doc.setTextColor(255, 255, 255);
      setFont(doc, 13, "bold");
      doc.text(txt(med.name), PAGE.w / 2, y + 7.5, { align: "center" });
      y += 11;

      var pairs = [
        ["PRESENTATION", med.presentation],
        ["DOSE", med.dose],
        ["BATCH NO", med.batch || "\u2014"],
        ["EXPIRY", med.expiry]
      ];
      var barH = 8;
      var cx = PAGE.ml;
      var cellW = CONTENT_W / pairs.length;
      pairs.forEach(function (p) {
        setFont(doc, 7.5, "bold");
        var labelW = doc.getTextWidth(p[0]) + 5;
        doc.setFillColor(BAR_BG[0], BAR_BG[1], BAR_BG[2]);
        doc.rect(cx, y, labelW, barH, "F");
        doc.setTextColor(255, 255, 255);
        doc.text(p[0], cx + 2.5, y + 5.4);

        doc.setFillColor(213, 216, 220);
        doc.rect(cx + labelW, y, cellW - labelW, barH, "F");
        doc.setTextColor(INK[0], INK[1], INK[2]);
        setFont(doc, 8.5, "bold");
        doc.text(wrap(doc, p[1], cellW - labelW - 4)[0], cx + labelW + 2.5, y + 5.4);
        cx += cellW;
      });
      doc.setTextColor(INK[0], INK[1], INK[2]);
      return y + barH + 7;
    }

    function contPageHead() {
      var y = PAGE.mt;
      setFont(doc, 10, "bold");
      doc.text(txt(med.name) + " (continued)", PAGE.ml, y + 4);
      return y + 8;
    }

    // Capacities, measured against the real header heights.
    var yFirst = PAGE.mt + 11 + 8 + 7 + 8;   // title bar + detail bar + gap + table head
    var yCont = PAGE.mt + 8 + 8;             // continued caption + table head
    var capFirst = Math.max(1, Math.floor((PAGE.h - PAGE.mb - yFirst) / LOG_ROW_H));
    var capRest = Math.max(1, Math.floor((PAGE.h - PAGE.mb - yCont) / LOG_ROW_H));
    var counts = splitRows(total, capFirst, capRest);

    var n = 1;
    counts.forEach(function (count, pageIdx) {
      doc.addPage();
      state.page += 1;
      var y = pageIdx === 0 ? firstPageHead() : contPageHead();
      y += tableHead(y);
      for (var i = 0; i < count; i++) {
        y += drawRow(doc, PAGE.ml, y, widths, [
          { text: String(n), bold: true, align: "center" },
          { text: "" }, { text: "" }, { text: "" }
        ], { minH: LOG_ROW_H });
        n += 1;
      }
      footer(doc, data, state.page);
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
    data.medications.forEach(function (m) { drawLog(doc, data, m, state); });
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
