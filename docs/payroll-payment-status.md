# Agent payment status

Each lead table in Payroll shows **Agent payroll (this period)**. The badge uses
that lead's agent ID and the saved payroll entry for the selected period. Paid
rows include the payment date and method when recorded. The Agent payroll filter
shows all payments, paid agents or unpaid agents without changing saved totals.

Use the existing **Mark as Paid** action for an individual agent or team, then
confirm the payment date and method. This records payment status; it does not
transfer money. Reopening a payment removes the paid badges after refresh.

The indicator describes the agent's weekly payroll payment, not an immutable
receipt for each individual lead. Lead outcomes and displayed commissions may
change after payroll is finalized. No historical per-lead payment allocation is
inferred. Original inspector visit notes in Payroll remain available.

Changing periods hides payment controls while loading. Late responses from a
previous period are ignored, and a failed fetch cannot keep the prior week's
records. Refreshing the same period preserves the selected agent and view.

Validation includes mixed paid/unpaid agents, payment filters, reopened payments,
late responses, failed fetches and no-period selection. These frontend changes
need no additional database migration beyond the recording handoff migration in
this branch.
