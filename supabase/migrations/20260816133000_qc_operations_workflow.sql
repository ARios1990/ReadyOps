/*
  Ready Ops QC operations migration marker.

  The production project received the QC workflow through audited Supabase migrations on 2026-08-16:
  - qc_operations_foundation
  - qc_submission_and_review_rpcs
  - qc_visibility_packages_agent_portals
  - qc_packages_onboarding_notifications_readymode
  - qc_reference_slug_company_outcomes
  - qc_slot_release_reschedule_agent_status

  This repository marker documents the deployed feature set. The authoritative SQL definitions are present in the production Supabase migration history and database schema.

  Features include:
  - QC Pending / Approved / Denied lead lifecycle
  - company visibility gated by QC approval
  - QC/admin lead editing and reassignment
  - company packages/payment tracking
  - agent personal portal tokens/payroll dates
  - company onboarding invites
  - company outcome/inspector notes
  - notification batching
  - ReadyMode synchronization metadata
*/
select 1;
