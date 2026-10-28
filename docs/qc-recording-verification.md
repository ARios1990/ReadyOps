# Recording verification in the existing QC workspace

This change extends Appointment Recording, the current transcription/qualification endpoint and the existing editable lead template. When a transcript is ready, analysis compares customer-supported excerpts with the current lead. High-confidence property, insurance, contact-role, contractual-restriction and language corrections populate the QC draft. Only Save Lead Information persists those field changes. Approval and Send remain explicit, separate actions.

Customer identity and destination conflicts are review findings. They do not silently change the primary name or property address. Actual contacts are recorded separately. Public-adjuster agreements and conditional roofer obligations are separate from a signed roofing-company contract. Existing notes and undisclosed fields such as property value, square footage and property links are retained. Approximate roof ages use `~22` internally and display as “Approximately 22 Years.”

The generated Roofing Appointment Summary has independent editable Notes and QC Note sections, copy actions, regeneration and reset. Edits survive switching between leads during the QC session; Save Lead Information also preserves the summary draft and recording correction history in form data. The existing old/new audit already records a normal QC save. Analysis never inserts the generated narrative into the original lead Notes.

Verification badges expose source excerpts beside fields and in Recording Verification / QC Review. The current transcription response has no trustworthy segment timestamps, so this feature does not invent any. Low-confidence, agent-only, translated/unknown-language and conflicting evidence is held for review. Names, accents, geography and the agent's language never determine a customer language. A clear request for Spanish takes priority over English speech. Bilingual classification requires affirmative evidence of comfort using both languages.

Relative appointments require the actual call date and the property's IANA timezone, entered in the recording-date section or supplied by bound recording metadata. The reference is tied to that recording URL. Neither upload time, lead creation time, server time nor today's date is used as a substitute. Ambiguous dates stay unchanged. Appointment corrections retain the existing owner-only scheduling permissions and capacity checks; the combined save is atomic. A rejected schedule correction rolls back the related field save.

The assessment is tied to the exact lead, recording URL and transcript. Audio replacement clears stale indicators. A new recording takes priority over a saved old transcript. Local automatic transcription uses the multilingual model without forcing the saved lead language. Automatic verification saves assessment evidence; it does not set the lead's QC approval or automatically persist lead-field corrections.

Validation: recording-verification tests cover supported corrections, unsupported/agent evidence, identity/address mismatches, adjuster restrictions, manual preservation, approximation, explicit Spanish preference, bilingual evidence, unknown translated speech, call-local dates, independent summary edits and reset/restoration. The save test checks existing authorization delegation, transaction rollback, capacity failures and pending status. Existing recording tests retain cross-lead and replacement-audio race protection.

Deployment order: apply the additive `qc_recording_verified_draft_save` migration; deploy `transcribe-and-qualify` with its current recording-selection helper and shared verification module; publish the frontend through the existing GitHub/Bolt workflow. Verify a current recording in QC without saving, approving or sending a live lead as a test. Revert the frontend and Edge Function together if necessary; the additive save wrapper can remain unused.

Backend rollout: migration `20261028000735_qc_recording_verified_draft_save` is applied to `vzaraqexdsimmasxsano`; `transcribe-and-qualify` version 34 is Active with JWT verification. Live privilege checks confirm the save wrapper is SECURITY INVOKER, callable by authenticated reviewers, and unavailable to anon and service_role. Existing helper RPCs continue to enforce team and owner access. Frontend publishing is tracked with the implementation PR.

Storage follow-up: migration `20261028004408_qc_recording_metadata_retention` preserves contact name/role, roofing agreement qualifiers and the explicit QC draft/context/history keys through the existing service-form trigger. Unrelated service fields and unknown keys are still removed, and configured hidden fields still apply. Only authorized reviewers or maintenance workers can replace internal QC evidence; other callers retain existing evidence unchanged and cannot forge a new recording review. Integration tests exercise the actual trigger, including anonymous replacement attempts and switching away from roofing. A live, user-confirmed contact relationship was saved and read back after deployment.
# Inspector note style

New generated Notes and short summaries follow the user-provided
`ReadyOps_Inspector_Notes_Updated_2026-10-27.xlsx`, specifically Notes Standards
A2:B10 and the Inspector View examples. Use two to four concise sentences covering
the actual contact/purpose, relevant confirmed age or specific damage/scope,
special requests/access and the confirmed appointment. Omit repetitive stories,
roof type, routine no-contract answers, property value and square footage.

Unmentioned damage stays uncertain; non-roof damage does not prove roof damage.
Preserve stated DNC requests and estimate-specific context. Keep unresolved
identity/address conflicts and follow-up in QC warnings. Exact transcript passages
support the generated paragraph. Existing notes and manual edits are preserved;
the workbook is a style reference and does not backfill customer facts.

