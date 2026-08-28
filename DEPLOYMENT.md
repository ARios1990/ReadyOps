# ReadyOps deployment workflow

ReadyOps now supports this workflow:

```text
VS Code -> GitHub -> Docker image -> Linux server -> HTTPS domain
                  \-> automatic build checks
```

Local development and production use different Docker configurations on
purpose:

- `compose.yaml` runs Vite with hot reload and connects to local Supabase.
- `compose.production.yaml` builds the optimized site and serves it with Nginx.
- Hosted Supabase remains the production database, Auth, Storage, and Edge
  Functions service. Postgres is not bundled into the public web container.

## 1. Work locally

Follow [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md). Make and test changes on
a feature branch. The local database is disposable and contains no production
customer data.

## 2. Save the work in GitHub

Commit and push the branch, then merge it through a pull request. GitHub Actions
runs the TypeScript build and independently verifies that the production Docker
image can be created.

The workflow validates images only. It does not publish or deploy anything and
does not contain production credentials.

## 3. Prepare a Linux server

Use a VPS or cloud host that supports Docker Engine and Docker Compose. Point a
domain at the server and place a host-level reverse proxy in front of ReadyOps
to provide HTTPS. The ReadyOps container listens on `127.0.0.1:8080` by default,
so it is not exposed directly to the internet.

Clone the GitHub repository on the server, then create the production settings:

```sh
cp .env.production.example .env.production
```

Edit `.env.production` and set the hosted Supabase project URL and its
publishable/anon browser key. Never add the Supabase service-role or secret key.
The `.env.production` file is ignored by Git.

Build and start the site:

```sh
docker compose --env-file .env.production -f compose.production.yaml up -d --build
```

Check it locally on the server:

```sh
curl http://127.0.0.1:8080/healthz
```

It should return `ready`.

## 4. Update the server

After a tested change is merged into the deployment branch:

```sh
git pull --ff-only
docker compose --env-file .env.production -f compose.production.yaml up -d --build
```

## Supabase changes

The web image does not deploy database migrations or Edge Functions. Review and
deploy those separately with the Supabase CLI so database changes remain an
explicit operation with their own rollback plan.

Before connecting the final domain, add that HTTPS URL to the hosted Supabase
Auth URL configuration and to any OAuth provider redirect allowlists.
