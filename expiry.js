/*
 * Expiry parsing shared by the form and the PDF.
 *
 * Packs state expiry either as a month ("07/25", "2027-10", "Jul 2025") or as
 * a full date ("2025-10-18"). Both are accepted; a month-only expiry is
 * treated as valid to the last day of that month, which is the pharmacy
 * convention.
 */
(function (global) {
  "use strict";

  var MONTHS = ["jan", "feb", "mar", "apr", "may", "jun",
                "jul", "aug", "sep", "oct", "nov", "dec"];
  var SOON_DAYS = 90;

  function monthIndex(name) {
    var key = String(name).toLowerCase().slice(0, 3);
    var i = MONTHS.indexOf(key);
    return i < 0 ? 0 : i + 1;
  }

  function fullYear(y) {
    return y < 100 ? 2000 + y : y;
  }

  function daysInMonth(y, m) {
    return new Date(y, m, 0).getDate();
  }

  function pad(n) {
    return (n < 10 ? "0" : "") + n;
  }

  function make(y, m, d) {
    if (m < 1 || m > 12) return null;
    if (d !== null && (d < 1 || d > daysInMonth(y, m))) return null;
    if (y < 1900 || y > 2999) return null;
    return {
      precision: d === null ? "month" : "day",
      iso: d === null ? y + "-" + pad(m) : y + "-" + pad(m) + "-" + pad(d),
      year: y, month: m, day: d
    };
  }

  /* Parse a typed expiry. Returns null when it cannot be understood. */
  function parse(raw) {
    var s = String(raw === null || raw === undefined ? "" : raw).trim();
    if (!s) return null;
    var m;

    // 2025-10-18 / 2025.10.18
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/)))
      return make(+m[1], +m[2], +m[3]);
    // 2025-10
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})$/)))
      return make(+m[1], +m[2], null);
    // 18/10/2025 and 18/10/25 (day first — UK convention)
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2}|\d{4})$/)))
      return make(fullYear(+m[3]), +m[2], +m[1]);
    // 10/2025 and 07/25
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{2}|\d{4})$/)))
      return make(fullYear(+m[2]), +m[1], null);
    // 18 Oct 2025
    if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{2}|\d{4})$/)))
      return make(fullYear(+m[3]), monthIndex(m[2]), +m[1]);
    // Oct 2025 / October 25
    if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{2}|\d{4})$/)))
      return make(fullYear(+m[2]), monthIndex(m[1]), null);
    // 202510
    if ((m = s.match(/^(\d{4})(\d{2})$/)))
      return make(+m[1], +m[2], null);

    return null;
  }

  /* Last moment the stock is in date. */
  function effective(parsed) {
    if (!parsed) return null;
    return parsed.precision === "month"
      ? new Date(parsed.year, parsed.month - 1, daysInMonth(parsed.year, parsed.month))
      : new Date(parsed.year, parsed.month - 1, parsed.day);
  }

  /* Printed form: 10/2027 for a month, 18/10/2025 for a date. */
  function format(parsed, fallback) {
    if (!parsed) return String(fallback === undefined ? "" : fallback);
    return parsed.precision === "month"
      ? pad(parsed.month) + "/" + parsed.year
      : pad(parsed.day) + "/" + pad(parsed.month) + "/" + parsed.year;
  }

  function today() {
    var t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate());
  }

  /* "expired" | "soon" | "ok" | "unknown" */
  function status(parsed, now) {
    var eff = effective(parsed);
    if (!eff) return "unknown";
    var ref = now || today();
    if (eff < ref) return "expired";
    var limit = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + SOON_DAYS);
    return eff <= limit ? "soon" : "ok";
  }

  function daysLeft(parsed, now) {
    var eff = effective(parsed);
    if (!eff) return null;
    return Math.round((eff - (now || today())) / 86400000);
  }

  /* Parse an ISO date from a date input, as a local midnight. */
  function parseDay(iso) {
    var m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    var d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d.getTime()) ? null : d;
  }

  /*
   * Status judged against a service window rather than just today: stock that
   * is in date now but runs out before the bag comes back is the thing worth
   * catching. "expired" is already out of date; "in-service" expires while the
   * bag is out; "soon" is inside the 90 day window; otherwise "ok".
   */
  function serviceStatus(parsed, until, now) {
    var base = status(parsed, now);
    if (base !== "ok" && base !== "soon") return base;   // expired or unknown
    var end = until instanceof Date ? until : parseDay(until);
    if (end && effective(parsed) < end) return "in-service";
    return base;
  }

  /* Items that expire before the bag is due back. */
  function expiringInService(medications, until) {
    var end = until instanceof Date ? until : parseDay(until);
    if (!end) return [];
    return (medications || []).filter(function (m) {
      return serviceStatus(parse(m.expiry), end) === "in-service";
    });
  }

  /* Earliest expiry in the bag — this is what the bag as a whole expires on. */
  function earliest(medications) {
    var best = null;
    (medications || []).forEach(function (m) {
      var p = parse(m.expiry);
      if (!p) return;
      if (!best || effective(p) < effective(best.parsed)) best = { parsed: p, med: m };
    });
    return best;
  }

  global.Expiry = {
    parse: parse,
    format: format,
    effective: effective,
    status: status,
    serviceStatus: serviceStatus,
    expiringInService: expiringInService,
    parseDay: parseDay,
    daysLeft: daysLeft,
    earliest: earliest,
    today: today,
    SOON_DAYS: SOON_DAYS
  };
})(window);
