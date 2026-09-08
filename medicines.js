/*
 * Quick-add catalogue.
 *
 * `schedule` is a SUGGESTION to save typing, not a legal determination. The
 * categories used are:
 *   GSL  general sales list
 *   P    pharmacy only
 *   POM  prescription only medicine
 *   S17  paramedic exemption, Human Medicines Regulations 2012 Schedule 17
 *   S19  parenteral administration in an emergency, HMR 2012 Schedule 19
 *   CD   controlled drug (recorded on the CD register, never in a drug bag)
 *
 * Several medicines sit in more than one category depending on indication,
 * pack size and route; `note` says so where it matters. Every field is
 * editable after picking an entry, and entries carrying `cd` are offered only
 * on a controlled drugs register.
 */
(function (global) {
  "use strict";

  var CATALOGUE = [
    { name: "Adenosine", form: "Ampoule - solution for injection", strength: "3mg/1ml",
      schedule: "POM" },
    { name: "Adrenaline 1 in 1,000 (anaphylaxis)", form: "Ampoule - solution for injection",
      strength: "1mg/1ml", schedule: "S19",
      note: "Schedule 19 covers IM adrenaline up to 1mg for anaphylaxis; paramedics also hold a Schedule 17 exemption." },
    { name: "Adrenaline 1 in 1,000 (life-threatening asthma)",
      form: "Ampoule - solution for injection", strength: "1mg/1ml", schedule: "POM",
      note: "The Schedule 19 exemption is for anaphylaxis; other indications are not covered by it." },
    { name: "Adrenaline 1 in 10,000 (cardiac arrest)", form: "Pre-filled syringe",
      strength: "1mg/10ml", schedule: "S17" },
    { name: "Amiodarone (cardiac arrest)", form: "Pre-filled syringe", strength: "300mg/10ml",
      schedule: "S17" },
    { name: "Aspirin", form: "Tablet", strength: "300mg", schedule: "P",
      note: "Classification depends on pack size and presentation; small packs may be GSL." },
    { name: "Atropine sulfate", form: "Ampoule - solution for injection",
      strength: "600micrograms/1ml", schedule: "S19" },
    { name: "Benzylpenicillin sodium", form: "Vial - powder for reconstitution",
      strength: "600mg", schedule: "S17" },
    { name: "Chlorphenamine", form: "Ampoule - solution for injection", strength: "10mg/1ml",
      schedule: "S19" },
    { name: "Dexamethasone", form: "Ampoule - solution for injection", strength: "3.3mg/1ml",
      schedule: "POM" },
    { name: "Diazepam", form: "Ampoule - solution for injection", strength: "5mg/1ml",
      schedule: "CD", cd: true,
      note: "Controlled drug (Schedule 4). Paramedics also hold a Schedule 17 exemption." },
    { name: "Diazepam (Stesolid)", form: "Enema", strength: "2.5mg/1.25ml",
      schedule: "CD", cd: true },
    { name: "Diazepam (Stesolid)", form: "Enema", strength: "5mg/2.5ml",
      schedule: "CD", cd: true },
    { name: "Duodote (atropine and pralidoxime)", form: "Auto-injector",
      strength: "2.1mg atropine and 600mg pralidoxime/3ml", schedule: "S19" },
    { name: "Glucagon", form: "Vial - powder for reconstitution", strength: "1mg",
      schedule: "S19" },
    { name: "Glucose 10% infusion", form: "Solution for infusion", strength: "50g/500ml",
      schedule: "S17" },
    { name: "Glucose 5% infusion", form: "Solution for infusion", strength: "5g/100ml",
      schedule: "S17" },
    { name: "Glucose gel", form: "Oral gel", strength: "40% w/v", schedule: "GSL" },
    { name: "Glyceryl trinitrate spray", form: "Metered dose spray",
      strength: "400micrograms/spray", schedule: "POM" },
    { name: "Hydrocortisone sodium phosphate (IM)", form: "Vial - powder / ampoule",
      strength: "100mg", schedule: "S19" },
    { name: "Hydrocortisone sodium phosphate (IV)", form: "Vial - powder / ampoule",
      strength: "100mg", schedule: "S19" },
    { name: "Ibuprofen", form: "Tablet", strength: "400mg", schedule: "P",
      note: "400mg is pharmacy only; 200mg packs are generally GSL." },
    { name: "Ipratropium bromide", form: "Nebuliser liquid", strength: "250micrograms/1ml",
      schedule: "POM" },
    { name: "Methoxyflurane (Penthrox)", form: "Inhaled vapour", strength: "99.9% 3ml",
      schedule: "POM" },
    { name: "Metoclopramide", form: "Ampoule - solution for injection", strength: "10mg/2ml",
      schedule: "S17" },
    { name: "Midazolam", form: "Ampoule - solution for injection", strength: "5mg/5ml",
      schedule: "CD", cd: true, note: "Controlled drug (Schedule 3)." },
    { name: "Midazolam", form: "Ampoule - solution for injection", strength: "5mg/1ml",
      schedule: "CD", cd: true, note: "Controlled drug (Schedule 3)." },
    { name: "Misoprostol", form: "Tablet", strength: "200micrograms", schedule: "POM" },
    { name: "Morphine sulfate", form: "Ampoule - solution for injection", strength: "10mg/1ml",
      schedule: "CD", cd: true,
      note: "Controlled drug (Schedule 2). Paramedics also hold a Schedule 17 exemption." },
    { name: "Morphine sulfate", form: "Oral solution", strength: "10mg/5ml",
      schedule: "CD", cd: true, note: "Controlled drug (Schedule 2)." },
    { name: "Naloxone hydrochloride (IM)", form: "Solution for injection",
      strength: "400micrograms/1ml", schedule: "S19",
      note: "Also covered by the Schedule 17 paramedic exemption." },
    { name: "Naloxone hydrochloride (IV)", form: "Ampoule - solution for injection",
      strength: "400micrograms/1ml", schedule: "S19" },
    { name: "Naloxone hydrochloride (IV)", form: "Pre-filled syringe", strength: "2mg/2ml",
      schedule: "S19" },
    { name: "Naloxone hydrochloride (IM)", form: "Pre-filled syringe", strength: "2mg/2ml",
      schedule: "S19" },
    { name: "Ondansetron", form: "Ampoule - solution for injection", strength: "2mg/1ml",
      schedule: "S17" },
    { name: "Paracetamol", form: "Tablet", strength: "500mg", schedule: "GSL",
      note: "GSL in small packs; larger packs are pharmacy only." },
    { name: "Paracetamol suspension", form: "Suspension", strength: "250mg/5ml",
      schedule: "GSL" },
    { name: "Paracetamol suspension", form: "Suspension", strength: "120mg/5ml",
      schedule: "GSL" },
    { name: "Paracetamol infusion", form: "Infusion", strength: "1000mg/100ml",
      schedule: "S17" },
    { name: "Paracetamol infusion", form: "Infusion", strength: "500mg/50ml",
      schedule: "S17" },
    { name: "Salbutamol", form: "Ampoule - solution for injection",
      strength: "500micrograms/1ml", schedule: "POM" },
    { name: "Salbutamol nebuliser", form: "Nebuliser liquid", strength: "2.5mg/2.5ml",
      schedule: "POM" },
    { name: "Sodium chloride 0.9%", form: "Solution for infusion", strength: "0.9% 500ml",
      schedule: "S17" },
    { name: "Sodium chloride 0.9% (diluent)", form: "Solution for infusion",
      strength: "0.9% 100ml", schedule: "S17" },
    { name: "Sodium chloride 0.9% (flush)", form: "Ampoule - solution for injection",
      strength: "0.9% 10ml", schedule: "S17" },
    { name: "Syntometrine (ergometrine and oxytocin)", form: "Ampoule - solution for injection",
      strength: "500micrograms ergometrine and 5 units oxytocin/1ml", schedule: "S17" },
    { name: "Tranexamic acid", form: "Ampoule - solution for injection", strength: "100mg/1ml",
      schedule: "POM" },
    { name: "Water for injection", form: "Solution for injection", strength: "10ml",
      schedule: "POM" }
  ];

  function norm(s) {
    return String(s === null || s === undefined ? "" : s).toLowerCase();
  }

  /*
   * Match on every whitespace-separated term, against name, form and strength,
   * so "morph amp" and "naloxone 2mg" both find what you meant.
   */
  function search(query, opts) {
    var terms = norm(query).split(/\s+/).filter(Boolean);
    var wantCd = !!(opts && opts.cd);
    var pool = CATALOGUE.filter(function (m) { return !!m.cd === wantCd; });
    if (!terms.length) return pool.slice();

    return pool.filter(function (m) {
      var hay = norm(m.name) + " " + norm(m.form) + " " + norm(m.strength);
      return terms.every(function (t) { return hay.indexOf(t) >= 0; });
    }).sort(function (a, b) {
      // Whatever starts with the query is what was probably meant.
      var lead = norm(terms[0]);
      var an = norm(a.name).indexOf(lead) === 0 ? 0 : 1;
      var bn = norm(b.name).indexOf(lead) === 0 ? 0 : 1;
      return an - bn || norm(a.name).localeCompare(norm(b.name));
    });
  }

  /* Controlled drugs matching the query, for pointing at the other document. */
  function matchingControlled(query) {
    return search(query, { cd: true });
  }

  /* Distinct medication names matching, for the "other strength" option. */
  function matchingNames(query, opts) {
    var seen = {};
    return search(query, opts).filter(function (m) {
      if (seen[m.name]) return false;
      seen[m.name] = true;
      return true;
    });
  }

  global.Medicines = {
    CATALOGUE: CATALOGUE,
    search: search,
    matchingControlled: matchingControlled,
    matchingNames: matchingNames
  };
})(window);
