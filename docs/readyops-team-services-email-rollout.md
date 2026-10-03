# ReadyOps team management, payroll, service templates and client email

Repository: [ARios1990/ReadyOps](https://github.com/ARios1990/ReadyOps). Bolt project: [ReadyOps](https://bolt.new/~/sb1-24on47qr).

## Implementation and deployment status

The feature branch contains the implementation and three database migrations. Production rollout was authorized on October 3, 2026. The changes are pushed to PR #67, and local checks plus GitHub verification pass. **Not deployed or published yet:** browser control disconnected during the Bolt publishing preparation. No production migrations or Edge Function deployments were performed; GitHub `main` and the published site remain unchanged. Tests use fictional records in an isolated PGlite database; no customer emails were sent.

## What changes

- Admins edit a specific Agent or Manager from the staff list: name, login/profile email, role, team and active status. The server updates linked agent records, checks an active Admin profile, prevents self-demotion/self-disable and records an immutable audit event. Auth email/status and database updates are coordinated with rollback on failure.
- Admin Overview → Agents & Teams supports direct row editing of Agent Name, Team, Linked User and Status. Click any marked cell or the row pencil; Save commits all four together and Cancel writes nothing. Account Settings retains email/role editing. Only an unlinked Agent login can replace a linked login; replacement disables the displaced login, rotates the agent bearer token and records an audit event. Conflicting/stale changes are rejected. Pre-rollout inspection found two agents with multiple linked profiles; those rows safely refuse edits until an Admin resolves the existing links.
- Managers & Teams is an Admin navigation section. Managers must have an explicit assigned team. Team dashboards, QC, appointments, performance, lead-email history and payroll enforce the assignment on the server/RLS, including direct-ID requests.
- Managers review/edit their own team's weekly payroll, including rates, adjustments, notes, status and payment date. Admins retain all-team access and may save permanent agent pay defaults. Managers cannot change those permanent defaults or approve/lock/pay an entire shared payroll period. Paid entries and locked periods cannot be edited through the new RPC.
- Existing Sunday–Saturday payroll weeks and generated total-pay formulas remain. Recalculation updates counts on pending entries only; it preserves rates, hours, bonuses and payment history. Reassigning an agent does not rewrite historical payroll teams: mismatched historical entries remain Admin-only.
- Companies & Scheduling uses canonical RPC counts. Remaining is a nonnegative lead count, default `0`. Payment means the displayed package's **amount received (`amount_paid`)**, formatted in USD, default `$0.00`; the existing payment-status badge remains. This is not a newly calculated outstanding dollar balance. Corrupted characters on that screen are replaced with valid Unicode.
- Company profiles have a multiple-recipient notification-email editor. An explicit list overrides the fallback primary/owner email plus secondary emails; billing email is not included automatically. Empty/missing recipients produce a visible Failed notification rather than silently dropping the email.
- One initial email is queued when an approved lead becomes visible to its client through Send to Client. Submission into QC does not email the client. Same-day and future appointments use the same outbox. The updated release RPC no longer creates legacy same-day email batches.
- Email rows and attempt history record Pending/Sent/Failed, sent timestamp, provider ID and errors. Sent means accepted by the email provider, not proof of inbox delivery. Admins and assigned-team Managers can deliberately resend; retries/double-clicks of the same request ID deduplicate. Deliberate Resend is a new delivery, rate-limited to one request per minute per lead.
- A transactional outbox claim prevents concurrent workers processing the same job. Resend retries reuse an immutable payload and provider idempotency key. Automatic retries stop after five attempts or 20 hours; uncertain delivery requires checking provider history before a deliberate resend. The worker handles two messages per invocation to stay within request/runtime limits.
- Universal Lead Type of Service immediately swaps both questions and template fields. Roofing, Permanent Exterior Lighting, Tree Service, Solar, PDR and Home Improvement are seeded, plus Water Treatment for existing workflows. All leads stay in `portal_leads` with `service_type` and a saved service-schema snapshot.
- Admins edit global service defaults, company-specific overrides, Required/Optional/Hidden fields, options and qualifying answers, or add future services without a new lead database. Existing company forms/rules are copied into their inferred service override. Existing legacy leads retain their original template; new universal leads and corrections use their service schema. Switching services preserves common contact/notes fields and clears service-specific answers. The server revalidates against the selected company's current configuration and strips unrelated fields.

## Ordered rollout

1. Review and test on a staging Supabase branch/project first. Take/verify a production backup. This is an additive migration but replaces shared role helpers, payroll generation, manager-link access and the client-release RPC; do not blindly replay historical migrations.
2. Apply these three new migrations in order using the Supabase migration tool/workflow:
   - `20260930213257_team_staff_and_manager_payroll.sql`
   - `20260930214837_service_templates_and_lead_email_outbox.sql`
   - `20261003193017_inline_agent_staff_rows.sql`
3. Deploy `create-user` and `update-staff` with JWT verification enabled. Deploy `send-lead-emails` with gateway JWT verification **disabled**: it explicitly verifies either the secret worker header or a real authenticated active Admin inside the function. Disabling the gateway without this function's custom checks is unsafe. Keep service-role and worker secrets server-side only.
4. Configure email through secure Supabase secrets (never frontend environment variables, repository files or chat):
   - `RESEND_API_KEY`: the existing integration may be reused if valid.
   - `READY_OPS_FROM_EMAIL`: a verified Resend sender on the intended Masters Ready Services domain. The worker refuses the Resend test-domain sender.
   - `READYOPS_EMAIL_WORKER_TOKEN`: a securely generated high-entropy random secret.
5. Store the matching worker token in Supabase Vault as `readyops_email_worker_token`, and the project base URL as `readyops_project_url` (`https://vzaraqexdsimmasxsano.supabase.co` for the connected project). Do not log secret values. The migration uses `pg_net`, `pg_cron` and `vault.decrypted_secrets`; verify extension availability/permissions in staging. The scheduled job `readyops-lead-email-worker` dispatches every minute, and a queue-insert trigger also dispatches immediately. With missing sender/secrets, jobs remain Pending rather than pretending to send.
6. Review preexisting queued `company_notification_batches` before running the old `send-company-notifications` sender. New releases no longer enqueue legacy same-day batches, but preexisting batches are intentionally retained. Do not send a legacy batch and a new deliberate resend for the same lead without checking delivery history. Historical released leads are **not** automatically emailed by this migration.
7. Assign every Manager's `profiles.team_id` in Managers & Teams. Read-only inspection found one existing Manager without a team at preparation time; that account will have no team access until assigned. Existing private manager URLs now require sign-in to the matching assigned team; distribute authenticated `/manager` access.
8. Security cutover: revoke/rotate any **previously shared agent bearer links** that Managers possess using the Admin-only link rotation action, and distribute new links only to the intended Agent. Those historical bearer credentials are independent of Manager login and cannot be unshared by a UI change. New manager responses never include them; changing an agent's team/role/active status through the staff editor rotates the linked agent token.
9. In Admin → Service Templates, review each company's inferred legacy override and enable/disable offered services before launch. Defaults expose active services unless disabled by a company override; do not offer services a client does not accept. Review required questions and qualifying answers against the actual client requirements. Core customer name, phone, address and requested service must remain required.
10. Deploy the frontend from the reviewed branch through the existing Bolt/GitHub publishing workflow after backend configuration. The Bolt project was observed linked to GitHub `main`; a feature-branch push alone does not replace its active/published version.

## Acceptance checks before production publishing

- Sign in as Admin, Manager A, Manager B and an inactive account. Verify only Admin sees all teams. Attempt cross-team IDs directly against leads, QC, appointments, payroll RPCs, email history and resends; they must fail or return no rows.
- Check private manager links signed out, signed into the wrong team and signed into the assigned team. Confirm Managers cannot generate or read agent bearer tokens. Rotate historical shared credentials before relying on the new boundary.
- Edit a test staff account's email and sign in with the new email. Change team/status; verify both linked records and old private-link revocation. Verify active Admin self-disable/demotion is refused.
- Generate the same payroll week as two different Managers, then Admin. Verify scope, totals and counters, notes, adjustments, approval/payment states and dates. Try forged team fields, permanent-pay-default updates, and editing paid/locked payroll; they must fail.
- Inspect companies with no package, null values, a partially paid package and a paid package. Verify `0`/`$0.00`, correct nonzero counts/currency and readable punctuation.
- Test all six requested services, then a newly configured service and two company overrides for the same service. Verify immediate switching, Required/Optional/Hidden behavior, service-specific corrections, server validation, saved service type and no leftover answers from the previous service.
- Use an explicitly approved test recipient (not a real client) to submit into QC, approve, and Send to Client. Verify QC submission sends nothing; release queues once, includes customer/appointment/service/agent/notes, excludes QC recordings, and sends to the intended multiple recipient list. Check branded HTML/text, history, sent timestamp and provider ID.
- Simulate provider failure and run concurrent workers. Verify one claim, safe retry key, Failed/Pending status and history. Exercise Admin/own-team Manager Resend and cross-team denial. Verify missing sender/Vault secrets, no-credentials HTTP and Manager worker invocations cannot send global mail.
- Verify real `pg_net`/`pg_cron`/Vault integration and Resend delivery in staging. Isolated tests stub these extensions and Auth/email services; they do not certify actual deployment, Auth synchronization or inbox delivery.

## Local verification

```text
npm ci
npm test
npm run typecheck
npm run lint
npm run build
npx deno check --no-lock --node-modules-dir=auto supabase/functions/create-user/index.ts supabase/functions/update-staff/index.ts supabase/functions/send-lead-emails/index.ts
```

The schema fixture contains table shapes only, not production/customer records. All 26 database/helper tests and four inline React UI tests pass. Generated frontend bundles retain preexisting large-chunk warnings; three unrelated hook-dependency lint warnings are not changed by this feature. Deno's `--node-modules-dir=auto` may replace local npm module links; run `npm ci` before rerunning the Node/React tests after a Deno check.

## Safe rollback

If email delivery must pause, unschedule `readyops-lead-email-worker` **and** remove/disable the immediate dispatch trigger or temporarily remove the worker Vault token. Retain notification/attempt history; inspect uncertain provider deliveries before resending. Rolling back only the frontend does not restore shared SQL functions. Restore reviewed prior function definitions via a forward migration/staging-verified recovery plan; do not delete payroll/lead/audit history or replay destructive historical migrations.
