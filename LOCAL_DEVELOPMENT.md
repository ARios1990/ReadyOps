# ReadyOps local development copy

This branch is an isolated development copy of ReadyOps. It uses Docker Desktop
for the web application and the official Supabase CLI for local Postgres, Auth,
Storage, Realtime, Studio, and Edge Functions.

No production table rows, Auth users, storage objects, API secrets, or service
keys are included. The database starts empty and is constructed from migrations.

## First start

1. Start Docker Desktop and wait until its engine reports that it is running.
2. From this directory, install dependencies with `npm install`.
3. Start the local Supabase stack with `npm run supabase:start`.
   This creates a localhost-bound Docker network and generates an ignored
   `.env.local` file containing only the browser-safe local public key.
4. Start the web application with `npm run dev:docker`.
5. Open ReadyOps at <http://127.0.0.1:5173>.
6. Open local Supabase Studio at <http://127.0.0.1:54323>.

The first Supabase start downloads several container images and can take a few
minutes. Later starts are much faster.

## Useful commands

- `npm run typecheck` validates the TypeScript application.
- `npm run build` creates a production frontend build.
- `npm run supabase:status` shows local Supabase URLs and container state.
- `npm run supabase:reset` rebuilds the local database from the checked-in
  migrations and the empty seed file.
- `npm run docker:down` stops the ReadyOps web container.
- `npm run supabase:stop` stops the local Supabase services.

## Deliberate safety boundaries

- `.env.local` is ignored by Git.
- The web app and Supabase ports are intended for localhost development.
- The start script never writes a service-role or secret key into Vite's public
  environment variables.
- Hosted Edge Function secrets are not copied. Functions that depend on external
  providers need separate local test credentials.
- Production data should not be imported unless it has been anonymized first.

## Known dependency advisory

`npm audit --omit=dev` currently reports a high-severity `sharp`/libvips
advisory inherited through `@huggingface/transformers` 3.8.1. That package has
no non-breaking patched release. ReadyOps' local Whisper feature should be
tested against `@huggingface/transformers` 4.x before making that major upgrade.
