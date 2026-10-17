# Internal DNC and QC compliance controls

This module checks authorized imported data. It does not connect to or claim a live FTC registry check, and no subscription is added. Registry imports must be complete for the declared area codes. Permitted lookup-result imports cover only their explicit phone rows. Delta files must first be reconciled to a complete authorized dataset outside the importer. Never label partial coverage as complete.

Dataset-negative results are green only for covered data refreshed within 31 days. They do not establish permission to call. Missing coverage is Not Checked; stale/invalid data is Check Failed; existing positive findings and internal opt-outs remain Match. Previous positive datasets remain conservatively restrictive; documented Admin review is required to clear an exception. A review remains tied to the phone, dataset, suppression and transcript snapshot, expires after 24 hours, and preserves the underlying result.

Admin uploads are staged in batches and activated only after the unique record count matches the declared count. Provider/version identifies an idempotent import; use a new version for new source data. Only QC/Admin can inspect evidence; only Admin can override restrictive/unavailable results with documented grounds. Ordinary QC can document reviewed clearance for dataset-negative results. Neither rule-based cues nor existing AI assessments establish legal compliance or intent.

Backend guards cover new final QC approvals, client releases, email resends and queued email claims. The email worker checks eligibility again immediately before sending. An internal Do Not Contact request is shared by normalized phone across ReadyOps lead copies. Selecting a DNC denial in QC also records suppression. Append-only audit records preserve lookups, decisions and evidence; no lead statuses, consent or dataset matches are fabricated.

## External workflow boundary

ReadyOps currently has no authenticated outbound ReadyMode dialer/texting API integration. It cannot cancel calls/messages made outside ReadyOps or recall previously downloaded campaign files. A dialer integration must call the service-role-only `assert_lead_contact_clear` RPC before contact and must synchronize phone suppression through an authorized dialer import workflow. Do not represent this release as external dialer enforcement. Existing client records are not deleted or retroactively recalled.

## Review checklist

Before clearance, inspect recording/transcript, flagged excerpts, homeowner authority, appointment acceptance, full address, consent evidence and applicable contact grounds. Record evidence source and reviewer decision. If the homeowner requests no further contact, use Record Do Not Contact immediately. No dataset is bundled: supply an authorized current dataset or perform a documented Admin exception review; unavailable data never becomes a green negative result.

## Verification

Run `node tests/dnc-compliance.test.mjs`, `npm run typecheck`, `npm test` and `npm run build`. The database suite uses local PGlite fixtures and never modifies production leads or sends email.
