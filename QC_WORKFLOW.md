# Ready Ops QC Workflow

## Lead lifecycle

1. Agent selects an available company date/time.
2. Ready Ops reserves the slot and the agent completes the internal lead form.
3. Submission creates the lead as `QC Pending`; the slot remains unavailable on agent and admin scheduling views.
4. Company and representative portals cannot see the lead while QC is pending.
5. Main Admin or QC can edit the lead, approve it, deny it with a reason, or move it to another company/service area/time without re-entering the form.
6. QC Approved leads become visible to the company and assigned representatives.
7. QC Denied leads remain in the agent's personal history with the denial reason, and the appointment slot is released.
8. Company/rep users can update outcome information (Good, Bad, No Show, Reschedule, Follow Up, Signed Contract) and inspector notes, but cannot edit the homeowner qualification data.

## Agent personal links

`/agent/:agentSlug/:token`

Includes QC Pending, QC Approved, and QC Denied sections plus payroll filters. Payroll week is Sunday through Saturday based on appointment date; pay date is the following Saturday.

## Company onboarding

Admins create a secure signup link in Operations. A submitted signup creates the company, name-based portal links, default weekly schedule, service area if supplied, and an optional lead package.

## Packages

Track package lead target, delivered QC-approved leads, remaining leads, amount per lead, package total, payment date, payment status, and completion status.

## External client forms

Ready Ops internal form is always completed first. If a company uses an external form, configure **Internal + External Client Form** and its prefill mapping. QC can open the approved lead's external form prefilled from Ready Ops.

## ReadyMode prefill

The company booking URL accepts query parameters for agent/profile data, including `agent`, `agent_token`, `first_name`, `last_name`, `phone`, `address`, `city`, `state`, `zip`, `email`, `language`, `service_needed`, `last_checked_on`, `home_type`, `roof_type`, `roof_age`, `stories`, `insurance`, `insurance_name`, `contract`, `home_value`, `sq_ft`, `web_url`, `notes`, `hail_size`, `claim_filed`, `visible_damage`, `damage_type`, `additional_properties`, and `second_address`.

Use `source=readymode` and `rm_lead_id=<ReadyMode Lead ID>` to associate later ReadyMode webhook updates with the same Ready Ops lead.

## ReadyMode webhook

Endpoint: Supabase Edge Function `readymode-sync`.

Send `source_lead_id`, `disposition`, and the latest profile fields. Authentication uses the private ReadyMode webhook secret stored in Supabase. A ReadyMode QC Denied disposition marks the Ready Ops lead QC Denied and releases its slot.

## Company notifications

Normal QC approvals are batched. At end of shift, QC/Admin uses **Day Complete / Notify** for one company-level email. Same-day appointments queue an immediate notification when approved.

The `send-company-notifications` Edge Function requires `RESEND_API_KEY` to be configured in Supabase Edge Function secrets before real email delivery can occur.

## Verification

The QC branch is required to pass strict TypeScript validation and the production Vite build before merge to `main`.
