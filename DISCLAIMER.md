# Disclaimer

**This software is provided "as is", without warranty of any kind.** See
[LICENSE](LICENSE) for the full terms.

Drug Bag Tracker is a document generator. It formats what you type into a
printable label, log or register. It does not check that what you typed is
correct, and it is not a clinical, pharmaceutical or legal reference.

**You are responsible for the documents it produces.** Before any document is
used, check that every entry matches the stock actually held: medication name,
formulation, strength, batch number, expiry date, quantity and legal category.

## Legal categories

The categories offered (`GSL`, `P`, `POM`, `S17`, `S19`, `CD`) and the ones
pre-filled by the quick-add catalogue are **suggestions to save typing, not
legal determinations**. They may be wrong, out of date, or inapplicable to how
your organisation holds and administers a given medicine. In particular:

- Several medicines sit in more than one category depending on indication,
  route and pack size.
- Medicines legislation is amended over time, and this catalogue is a fixed
  snapshot that is not updated automatically.
- The categories were **not verified against primary legislation** when the
  catalogue was compiled. See [Sources](#sources) below.

Check every category against current legislation and your own organisation's
medicines policy, patient group directions and standard operating procedures.

## Controlled drugs

The controlled drugs register this tool produces is a convenience format. It
does not constitute, replace or discharge any statutory record-keeping duty.
Satisfy yourself that it meets the requirements that apply to you before
relying on it, and retain records in line with your own controlled drugs policy
and current legislation.

## Data

Everything is stored in your browser and nothing is uploaded. Browser storage
is not a backup: clearing site data, private browsing, or a different device or
browser will lose it. Export your documents to JSON and keep those files
somewhere durable. No responsibility is accepted for work lost to browser
storage being cleared.

## Sources

The medication list was supplied by the user of the tool as a CSV of common
pre-hospital medicines. Formulations and strengths follow that file, except
where noted in the repository history.

The legal category suggestions were informed by the following public sources.
**None of these is a substitute for the legislation itself**, and the primary
text at legislation.gov.uk could not be reached from the environment in which
the catalogue was compiled, so the categories are unverified against it:

- Journal of Paramedic Practice, *Paramedics and medicines: legal
  considerations* — <https://www.paramedicpractice.com/content/features/paramedics-and-medicines-legal-considerations>
  and <https://jrcalc.org.uk/wp-content/uploads/2016/09/JPAR_2016_8_8_408_415.pdf>
- NHS Specialist Pharmacy Service, *Legal mechanisms to supply and administer
  medicines to individuals* —
  <https://sps.nhs.uk/articles/legal-mechanisms-to-supply-and-administer-medicines-to-individuals/>
- Health and Care Professions Council, *Sale, supply and administration* —
  <https://www.hcpc-uk.org/standards/meeting-our-standards/scope-of-practice/medicines-and-prescribing-rights/sale-supply-and-administration/>
- The Human Medicines Regulations 2012, Schedules 17 and 19 —
  <https://www.legislation.gov.uk/uksi/2012/1916/schedule/17> and
  <https://www.legislation.gov.uk/uksi/2012/1916/schedule/19>

## Third party software

PDF generation uses [jsPDF](https://github.com/parallax/jsPDF), bundled in
`vendor/` under the MIT licence. Its licence text is included at
`vendor/jspdf-LICENSE.txt`.
