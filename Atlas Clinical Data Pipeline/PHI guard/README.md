The last gate before publication: quarantines anything that looks like a
patient-level identifier.

**Triggered by** [Validate](../Validate/script.ts).

Atlas publishes trial- and product-level data only. Free-text fields are scanned
for medical record numbers (`PHI_MRN`), dates of birth (`PHI_DOB`), personal
names (`PHI_NAME`), social security numbers (`PHI_SSN`) and personal contact
details (`PHI_EMAIL`). A match withholds the record from publication and records
a finding with its reason code.

The guard is deliberately conservative — a false positive costs a human review, a
false negative is a PHI disclosure — so releasing a finding is a human decision,
taken in the console and recorded by [Actions](../Actions/script.ts).

**The matched value is never logged or stored.** Findings record the field, the
match length and the reason code only.
