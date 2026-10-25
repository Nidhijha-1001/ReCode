# Development setup

## Prerequisites

- macOS for the convenience launcher; the separate commands below work on other platforms with equivalent tools.
- Python 3.11.11 (the version recorded in `backend/.python-version`).
- Node.js 20.19+ or 22.12+, npm, and `curl`.
- Ollama is optional and only needed for local AI inference.

## One-command startup on macOS

From the project root:

```bash
./scripts/dev-macos.sh
```

The script resolves paths from its own location, so it can also be called by absolute path from another working directory. It checks prerequisites and ports, creates the backend virtual environment and installs dependencies when needed, installs frontend dependencies when missing, starts FastAPI and Vite, checks both services, and cleans up both processes on Ctrl-C.

Defaults:

- Frontend: <http://127.0.0.1:5173>
- API health: <http://127.0.0.1:8000/api/health>
- Local database: `backend/recode.db`

To use alternate ports:

```bash
API_PORT=8001 FRONTEND_PORT=5174 ./scripts/dev-macos.sh
```

## Run services separately

Open two Terminal tabs.

**Backend**

```bash
cd /path/to/ReCode/backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
cp .env.example .env  # optional local configuration
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

**Frontend**

```bash
cd /path/to/ReCode/frontend
npm ci
VITE_API_BASE_URL=/api \
VITE_API_PROXY_TARGET=http://127.0.0.1:8000 \
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open <http://127.0.0.1:5173>. Vite forwards same-origin `/api` requests to FastAPI.

## Configuration

The backend reads `backend/.env`; the frontend reads Vite environment variables from its own project directory. Copy the checked-in `.env.example` files for reference. Important settings:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite by default; may be set to another SQLite or PostgreSQL URL. Relative SQLite paths resolve from the backend directory, not the shell's current directory. |
| `VITE_API_BASE_URL` | Frontend API prefix; defaults to `/api`. |
| `VITE_API_PROXY_TARGET` | Local Vite proxy target; defaults to `http://127.0.0.1:8000`. |
| `CORS_ORIGINS` | Exact comma-separated origins allowed by FastAPI; local Vite origins are the defaults. |
| `RECODE_SEED_DEMO_DATA` | Seeds five sample problems in an empty local database by default; disable for a clean local database. |
| `RECODE_REQUIRE_AUTH` | Enables the production-style single-password login when set to `true`. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | Address and model used for optional Ollama inference. |

Never put passwords, session secrets, or database credentials in a `VITE_*` variable; frontend variables are included in browser code.

## Try the local AI coach

Install and start Ollama, then pull the configured default model:

```bash
ollama pull gemma3:4b
```

Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in `backend/.env` when using a different local service or model. The coach status is separate from problem and revision data; its generated advice may be wrong and should be checked.

## Verify a change

```bash
npm --prefix frontend run lint
npm --prefix frontend run build
```

There is currently no dedicated automated backend test suite. Manually verify the affected UI flow and API behavior. For revision changes, complete a review in an isolated database, confirm the saved review event and next due date, refresh, and confirm the XP/profile update persists.
