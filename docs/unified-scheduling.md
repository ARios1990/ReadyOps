# Shared scheduling availability

`private.portal_slot_inventory` remains the capacity counter and
`portal_assert_slot_capacity` remains the transaction-locking booking guard.
`private.schedule_day` is the common read model used by public booking,
admin/agent availability, company schedule management and the QC picker.

Capacity belongs to a company/location/date, shared by all eligible teams.
Existing `company_teams` restrictions and the legacy company team fallback are
preserved. No teams or agent assignments are created, deleted or reassigned.
Authenticated agent reservations enforce those restrictions; existing public
client booking links remain public when enabled by the company.

Working hours and intervals come from existing weekly rules. A location's legacy
hours apply when it inherits a company rule. Saving a changed location template
requires confirmation before replacing its seven daily rules. Metadata-only saves
leave customized daily rules intact. The save and its audit records are atomic.

Date-specific blocks, temporary slot-capacity reductions and reopen actions extend
`company_schedule_exceptions`. Reopening retains cancelled exceptions for audit.
Blocks never cancel appointments. A location reopen cannot bypass a company-wide
holiday; remove that closure at company scope. Temporary capacity never exceeds
the regular slot/hour/day limits. Existing weekly blocks remain effective except
where explicitly reopened for a particular date.

Availability refreshes on permitted Realtime events, focus, visibility and a
15-second fallback check. Anonymous links poll the public availability RPC, and do
not need access to raw appointment rows. Booking always rechecks capacity under
the existing per-day advisory transaction lock.

Dates use the location's IANA timezone. Invalid spring-forward wall times are
closed. Repeated fall-back wall times have one slot/capacity pool. An interval must
finish by closing time. Cancelled, rescheduled and QC-denied appointments and
expired holds do not consume capacity.

Validation: `unified-scheduling.test.mjs` executes the migration and current SQL
dependencies in isolated Postgres (PGlite), exercising inventory, reservation,
block/reopen, overrides, location saves, audit, timezone/DST, team restrictions and
public/admin read parity. `availability-grid.test.mjs` checks shared rows, direct
actions, occupied-slot confirmation and automatic refresh. Production validation
uses read-only snapshots; no customer booking is created or cancelled as a test.
