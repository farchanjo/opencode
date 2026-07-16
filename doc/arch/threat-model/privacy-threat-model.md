# Privacy Threat Model (LINDDUN)

How opencode reasons about privacy threats to the people whose data it
touches. This model uses LINDDUN, which is deliberately *data-subject focused*:
where the sibling STRIDE threat model (the other documents under
`doc/arch/threat-model/`) asks "how can an attacker harm the system?", LINDDUN
asks "how can the system harm the privacy of a person?". The seven LINDDUN
categories are Linking, Identifying, Non-repudiation, Detecting,
Data-disclosure, Unawareness, and Non-compliance.

Operators own this document: edit the threats as opencode evolves, keep
every cell concrete, and replace these generic starters with the real privacy
threats and mitigations for this system. `speckit validate` scans the table
below (never the prose around it), so keep it accurate and cover every LINDDUN
category. The `Category` column uses the seven lowercase LINDDUN tokens exactly:
linking, identifying, non-repudiation, detecting, data-disclosure, unawareness,
and non-compliance.

| ID | Category | Threat | Affected Data | Mitigation |
|----|----------|--------|---------------|------------|
| PT-01 | linking | two separate records or actions are correlated back to the same person | request logs and stored identifiers | rotate and salt identifiers, and separate logs by purpose |
| PT-02 | identifying | an operator identity appears in project config and re-identifies a real person | committer name and email | recorded only in committed config the operator authored, never third-party data |
| PT-03 | non-repudiation | a person is unable to plausibly deny that they performed a recorded action | signed or attributed action history | scope retention to what a documented purpose requires |
| PT-04 | detecting | the mere presence or existence of a person is inferred from observable behaviour | request timing and error responses | pad, batch, or normalise observable side effects |
| PT-05 | data-disclosure | personal data is exposed to parties beyond its stated purpose | stored profile and exported reports | encrypt at rest, minimise fields, and enforce least-privilege access |
| PT-06 | unawareness | a person is unaware their data is processed or cannot exercise control over it | consent and preference state | present a clear privacy notice and honour data-subject requests |
| PT-07 | non-compliance | processing drifts out of line with a stated policy or regulation | processing and retention records | audit processing against the retention and privacy policy on a schedule |
