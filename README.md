# Ready Ops

[![Open in Bolt](https://bolt.new/static/open-in-bolt.svg)](https://bolt.new/~/sb1-24on47qr)

React + TypeScript + Supabase scheduling, lead-intake, company portal, and representative operations application for Masters Ready Services.

## Portal routes

- `/` — authenticated Ready Ops internal scheduler
- `/admin/portals` — Ready Ops admin portal-link manager
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

The connected production Supabase project contains the portal schema, reservation RPCs, Row-Level Security policies, audit history, dynamic form configuration, representative check-in workflow, standardized lead-template generation, and company scheduling rules.
