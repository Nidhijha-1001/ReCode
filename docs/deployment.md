# Deployment guide

## Status

The repository contains deployment configuration for a Vercel frontend/API proxy and a Render FastAPI service with PostgreSQL, but this configuration has **not** been deployed or verified against hosted providers. There is no live ReCode URL or hosted database yet.

## Intended topology

- Vercel builds `frontend` and serves `frontend/dist`.
- The root `api/[...path].ts` function proxies `/api/*` requests to FastAPI.
- Render runs FastAPI.
- A managed PostgreSQL service stores persistent production records.
- The optional AI coach needs an Ollama service reachable from Render; Ollama on a developer's laptop is not reachable by default.

## Configure the services

1. Push the project to a Git provider and create a managed PostgreSQL database. The database URL is a secret; do not put it in frontend configuration.
2. Create the Render web service using [`render.yaml`](../render.yaml). Set:

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | Managed PostgreSQL connection URL |
   | `RECODE_AUTH_PASSWORD` | Private password, at least 12 characters |
   | `RECODE_SESSION_SECRET` | Random secret of at least 32 characters; generate with `openssl rand -hex 32` |
   | `CORS_ORIGINS` | Exact Vercel production origin, such as `https://your-project.vercel.app` |

   Keep `APP_ENV=production`, `RECODE_REQUIRE_AUTH=true`, and `RECODE_SEED_DEMO_DATA=false`. Add exact preview origins only if previews need API access. Do not include `/api` or a trailing slash in `CORS_ORIGINS`.
3. Wait for Render's `/api/health` check to pass, then note the API service origin (for example, `https://your-api.onrender.com`).
4. Import the repository into Vercel. The root [`vercel.json`](../vercel.json) builds the Vite frontend and selects `frontend/dist`. Set the server-side environment variable:

   ```text
   RECODE_API_BASE_URL=https://your-api.onrender.com
   ```

   Use the service origin only—no `/api` suffix. Keep `VITE_API_BASE_URL` at its `/api` default so the browser calls Vercel's proxy. Do not expose the backend origin or database credentials through a `VITE_*` variable. Redeploy after setting environment values.
5. Verify the deployed site: sign in, open `/api/health`, add a test problem, complete a revision, refresh to confirm the next due date and XP persist, and sign out.

## Important limitations

- The production login is one shared password, not multi-user authentication or account isolation.
- Production starts without the local demo records. Importing CSV/XLSX adds problems but does not restore revision history or XP from a JSON export.
- Render's free web service may sleep when idle. The first request can take longer while it wakes.
- Hosted AI remains unavailable unless `OLLAMA_BASE_URL` points to a trusted Ollama service reachable by Render. Do not expose a home machine's Ollama port directly to the public internet.
- Treat deployment as incomplete until the service, persistent database, authentication, CORS, and revision workflow have all been tested in the hosted environment.
