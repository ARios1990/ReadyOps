# Masters Ready Scheduler Security Policy

## 1. Purpose

This policy governs access to the Masters Ready Scheduler, including the internal scheduler, agent booking portals, company administration portals, representative portals, appointment records, lead data, attendance verification, external form integrations, and audit history.

The system must use one controlled database as the source of truth. Separate portal views may expose different information, but they must not create uncontrolled copies of customer or appointment records.

## 2. Access Roles

### Masters Ready Administrator

Masters Ready administrators may manage all companies, service areas, schedules, representatives, appointments, requirements, forms, integrations, reports, and security settings.

Administrative access requires an authenticated Supabase account with the `admin` role. Hiding a button is not an authorization control; every administrative database action must be authorized server-side.

### Company Administrator

Company administration uses a strong, revocable company access token or an authenticated company account. Company administrators may manage only their own company settings, schedules, service areas, representatives, forms, requirements, and appointments.

A company token must never grant access to another company. Tokens may be disabled or regenerated immediately from the Masters Ready administration portal.

### Company Representative

Each representative receives an individual, revocable access token. Representatives may view only appointments assigned to them and may update only those appointments.

Representatives may view the homeowner name, phone number, address, lead template, appointment notes, and property details for their assigned appointments. They may not change company requirements, schedules, security settings, other representatives, or other companies' records.

### Call-Center Agent

Agent booking links may be shareable. Agents may view company requirements, service areas, weekly availability, and available appointment times. They may reserve a time and submit a lead.

Agents must never see homeowner information belonging to another appointment. Booked time slots display only `BOOKED`, `FULL`, `BLOCKED`, or `CLOSED`.

## 3. Public and Secure Links

- Agent booking link: shareable and limited to availability, requirements, reservation, and lead submission.
- Company administration link: private, token-protected, revocable, and regeneratable.
- Representative link: private, individual, revocable, and regeneratable.
- External webhook secret: private, independently rotatable, and never included in public booking data.

Tokens must be generated with cryptographically secure random values. Sequential IDs must not be used as access credentials.

Tokens must not be included in analytics events, public logs, screenshots, support tickets, or browser-visible error messages.

## 4. Database Access and Row-Level Security

All portal tables must have Row-Level Security enabled.

Anonymous users receive no direct table privileges. Public functionality is exposed only through specifically approved `SECURITY DEFINER` database functions with a fixed `search_path`.

Authenticated non-admin users receive no direct access to portal administration tables. Masters Ready administrators are identified by a server-side role check.

Company and representative portal requests must resolve the company or representative from the supplied token inside the database function. Client-supplied company IDs are not trusted as authorization.

## 5. Appointment Reservation Security

Reservation creation and movement must recheck availability on the server within a transaction.

The scheduler must use a database-level advisory lock or equivalent transaction lock before accepting a reservation. Client-side availability is informational and must never be treated as final authority.

The 45-second Undo action is limited to:

- the exact reservation record,
- the exact agent browser session that created the action,
- the latest reversible action,
- the configured undo deadline.

An agent cannot undo another agent's reservation. When changing time, the system must validate the replacement time before releasing or replacing the prior time.

Temporary reservations expire automatically after the configured hold period. Form activity may refresh the hold, but abandoned reservations must not remain indefinitely.

## 6. Lead and Homeowner Privacy

Public availability pages must not expose:

- homeowner names,
- phone numbers,
- email addresses,
- property addresses,
- insurance details,
- claim details,
- appointment notes,
- agent notes,
- internal pricing,
- representative assignments,
- lead identifiers.

Company administrators may view records for their own company. Representatives may view records assigned to them. Masters Ready administrators may view all records for operational and quality-control purposes.

Sensitive data must not be written to general application logs unless required to diagnose a specific incident. Logs should use record IDs rather than homeowner data whenever practical.

## 7. Audit History

Audit history is mandatory for important changes, including:

- reservations created, moved, undone, expired, and converted,
- appointments submitted, cancelled, assigned, and rescheduled,
- company requirements changed,
- schedules and blocked times changed,
- representatives created, updated, deactivated, or reassigned,
- external form opened, synchronized, failed, or duplicated,
- representative status and attendance changes,
- GPS check-ins,
- access-token and webhook-secret rotation.

Audit and external form event records are append-only evidence. Database triggers reject update and delete operations, including attempted administrative changes.

Normal users cannot delete audit history. Any correction must be represented by a new audit record rather than modifying the original record.

## 8. Representative Attendance and GPS

GPS access must be requested by the representative's browser at check-in time. The system must not continuously track a representative in the background.

The check-in record may contain latitude, longitude, device accuracy, distance from the property, timing status, and verification result.

A check-in is marked verified only when:

- the property has valid coordinates,
- the representative is within the configured geofence,
- the check-in occurs within the configured time window,
- the device location accuracy is acceptable.

If property coordinates are unavailable, the check-in is recorded but must not be described as GPS verified.

The interface must distinguish `VERIFIED SHOW`, `UNVERIFIED SHOW`, `HOMEOWNER NO SHOW`, `REP NO SHOW`, `CANCELLED`, and `UNKNOWN`.

## 9. External Forms

Masters Ready must create and retain its own lead and appointment record before opening an external form.

External forms must receive a Masters Ready lead code or appointment identifier for synchronization. Provider submissions must be idempotent; a duplicate provider submission ID must not create a duplicate lead or appointment.

External submissions are accepted only through a protected server-side endpoint or service-role database function using the company's webhook secret.

The webhook secret is separate from the company administration token and may be rotated independently.

External payloads must be mapped to standardized Masters Ready fields. Unknown or unmapped values may be stored as raw integration evidence but must not overwrite protected scheduling or authorization fields.

## 10. Secrets and Environment Variables

Supabase service-role keys, webhook secrets, and private credentials must never be included in React source code or committed to GitHub.

The browser application may use only the Supabase anonymous key. The anonymous key does not replace Row-Level Security.

Production secrets must be stored in the hosting provider or Supabase secret manager. Local `.env` files must remain excluded from source control.

## 11. Authentication and Account Management

Administrative accounts must use unique credentials. Shared administrator passwords are prohibited.

Inactive users and representatives must be disabled promptly. Access tokens must be rotated when:

- a link is sent to the wrong person,
- a representative leaves the company,
- an account or device is suspected of compromise,
- the link appears in a public location,
- Masters Ready or the company requests rotation.

Account and token changes must create audit events.

## 12. Error Handling and Logging

User-visible errors must be clear without exposing SQL, tokens, secrets, internal table names, stack traces, or homeowner data.

Operational logs should capture:

- request type,
- entity ID,
- company ID,
- error category,
- timestamp,
- authorization result.

Logs must avoid complete form payloads and secret values.

## 13. Security Incident Response

When unauthorized access, token exposure, suspicious booking activity, or data leakage is suspected:

1. Disable or rotate the affected token or credential.
2. Preserve audit and external-form event records.
3. Identify affected companies, appointments, leads, and users.
4. Review recent token use, assignment changes, exports, check-ins, and form events.
5. Correct the access condition without deleting evidence.
6. Notify Masters Ready ownership and affected company administrators as appropriate.
7. Document the incident, corrective action, and prevention measures.

## 14. Change Management

Security-related database changes must be delivered through versioned migrations.

Before deployment, changes must pass:

- TypeScript type checking,
- production build,
- database function compilation,
- Row-Level Security policy review,
- reservation collision tests,
- cross-session Undo denial tests,
- company isolation tests,
- representative assignment isolation tests,
- immutable audit-log tests,
- external webhook duplicate tests.

Security controls must not be removed to fix an interface problem. Authorization errors must be corrected at the policy or function level with the least privilege required.

## 15. Policy Ownership

Masters Ready Services owns this policy and the central scheduler security configuration. Company administrators control their own schedules and operational settings within the permissions granted by the system, but they may not weaken global security, privacy, audit, or isolation controls.
