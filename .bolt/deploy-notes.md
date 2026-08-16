# Deployment Notes

This branch adds the Masters Ready multi-portal scheduling workflow.

Before publishing in Bolt, verify the Bolt project is synced to this repository's `main` branch and that these environment variables remain configured:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

After merge, test these routes on the deployed domain:

1. `/` — internal scheduler login
2. `/admin/portals` — Masters Ready portal link manager
3. One enabled `/book/:companySlug` route
4. One secure `/company/:companyId/manage/:token` route
5. One `/rep/:token` route after creating a representative

Do not expose company or representative tokens in public documentation.
