# Masters Ready Time Slot Scheduler

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-24on47qr)

React + TypeScript + Supabase scheduling application for Masters Ready Services.

## Portal routes

- `/` — authenticated internal scheduler
- `/admin/portals` — Masters Ready admin portal-link manager
- `/book/:companySlug` — shareable agent booking portal
- `/company/:companyId/manage/:token` — secure company management portal
- `/rep/:token` — secure representative portal

## Verification

```bash
npm ci
npm run typecheck
npm run build
```

The deployment requires:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

The connected production Supabase project contains the portal schema, reservation RPCs, Row-Level Security policies, audit history, dynamic form configuration, representative check-in workflow, and company scheduling rules.
