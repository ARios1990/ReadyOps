# Roof Pros manual form preparation

The Admin QC lead dialog has **Prepare Form + Recording** in the Roof Pros Google Form panel. It is available only after the current lead is QC approved and sent. The button prepares the form in the same Chrome profile, attaches the current private recording, fixes Telemarketer Name to Horacio, and leaves Submit to the user. Codex and the scheduled browser sender are not involved.

## One-time setup

Download `/roof-pros-helper.zip` from the panel, extract it to a permanent folder, then load that folder through Chrome Extensions > Developer mode > Load unpacked. Reload ReadyOps after installation. Sign in to `mastersreadyservices2025@gmail.com` in the same profile.

The helper only runs on ReadyOps, the exact Roof Pros form and Google's picker in a tab it created. It can fetch from the existing Supabase project. It has no cookies, debugger, scripting, tabs-history, or unrestricted-storage permissions. It does not read a staff JWT or export Google credentials. A short-lived capability grants access to just one explicitly prepared lead. Customer fields, audio and capability are held in the extension's private IndexedDB for at most two hours and removed after a receipt; the database retains attachment hash and receipt metadata.

## Review and confirmation

Press Prepare Form + Recording, wait for the Google banner to say **Ready for your review**, review the information and the lead-specific recording filename, then click Google's Submit once. The helper never clicks Submit. It observes the user's click, then requires Google's visible **Your response has been recorded.** in the same tab before the delivery is marked submitted. A phrase in lead notes cannot count as a receipt.

The ReadyOps panel refreshes on focus and every 15 seconds while open. **Open Prepared Form** focuses the original tab instead of making a second draft. If a tab, session or receipt is lost, keep the delivery held for review; do not create another submission until its outcome is known. A pre-submit preparation failure can return to needs_info so the user can correct the issue. Manual review and submission states are never eligible for the automatic worker, including after expiry.

The four permanently excluded, manually completed leads remain blocked at the UI, ticket issuer and helper. All submitted, uncertain or currently claimed jobs are blocked from a new preparation. ReadyOps agent attribution, QC status and Send/email behavior remain unchanged. The existing scheduled sender remains paused until the user explicitly requests otherwise.

## Implementation and verification

- `roof_pros_manual_prepare` requires a current authenticated Admin, current approval/Send, a private recording in the lead folder or its exact converted booking reservation, a valid source payload and a claimable delivery. A row lock prevents overlap with the automatic claim.
- The private session stores a SHA-256 hash of the random ticket, source freshness, creator and expiry. The service-role-only `roof_pros_manual_exchange` verifies the capability, source, matching attachment proof, user-submit transition and exact receipt text.
- `roof-pros-manual-review` signs the private recording for five minutes and returns normalized fields. It authenticates the scoped capability itself; it does not accept a staff session from the extension.
- The helper uses Google's normal DOM and file input through its upload picker. There are no private Google endpoints or raw formResponse submissions.
- Package sources live in `public/roof-pros-helper/`. Run `node scripts/package-roof-helper.mjs` after editing them; the build and test suite verify the deterministic ZIP matches those sources.
- `tests/roof-pros-manual.test.mjs` covers permissions, current approval/Send, wrong-company/excluded/completed leads, worker isolation, stale source, audio proof and limits, receipt gates, exact field values, untrusted Submit events and packaged contents. It uses disposable local PGlite data and DOM fixtures; it never creates a production lead or submits a live test form.

## Recording handoff deployment

Apply `20261107050055_booking_recording_referral_ownership.sql`, deploy `roof-pros-form-recording` and `agent-recording-upload-token`, then deploy the frontend. The migration accepts a booking upload only when its reservation was converted into an appointment for the same lead and the storage object exists. The path resolver is service-role-only; approval, Send, manual exclusions and user Submit/receipt checks remain in place. Existing valid reservation uploads need no file copy or public bucket access.

This change does not recover audio previously used only for local transcription; those files must be selected again. It does not automatically submit Google Forms or alter existing held/submitted deliveries. Google picker timeouts are a separate browser-helper problem and require checking the existing draft in the Chrome profile that runs the helper.
