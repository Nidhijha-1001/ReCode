#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
BACKEND_DIR="$PROJECT_ROOT/backend"
FRONTEND_DIR="$PROJECT_ROOT/frontend"
VENV_DIR="$BACKEND_DIR/.venv"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'This launcher is intended for macOS.\n' >&2
  exit 1
fi

for command_name in python3 node npm curl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Missing prerequisite: %s. Install it and rerun this script.\n' "$command_name" >&2
    exit 1
  fi
done

API_PORT="${API_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
export DATABASE_URL="${DATABASE_URL:-sqlite:///$BACKEND_DIR/recode.db}"
export CORS_ORIGINS="${CORS_ORIGINS:-http://localhost:$FRONTEND_PORT,http://127.0.0.1:$FRONTEND_PORT}"
export VITE_API_BASE_URL="${VITE_API_BASE_URL:-/api}"
export VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://127.0.0.1:$API_PORT}"

port_is_available() {
  python3 - "$1" <<'PY'
import socket
import sys

with socket.socket() as sock:
    try:
        sock.bind(("127.0.0.1", int(sys.argv[1])))
    except OSError:
        sys.exit(1)
PY
}

for port in "$API_PORT" "$FRONTEND_PORT"; do
  if ! port_is_available "$port"; then
    printf 'Port %s is already in use. Stop its process or choose another port with API_PORT / FRONTEND_PORT.\n' "$port" >&2
    exit 1
  fi
done

if [[ ! -x "$VENV_DIR/bin/python" ]]; then
  printf 'Creating backend virtual environment...\n'
  python3 -m venv "$VENV_DIR"
fi

PYTHON="$VENV_DIR/bin/python"
if ! "$PYTHON" -c 'import dotenv, fastapi, multipart, pandas, sqlalchemy, uvicorn' >/dev/null 2>&1; then
  printf 'Installing backend dependencies...\n'
  "$PYTHON" -m pip install -r "$BACKEND_DIR/requirements.txt"
fi

if [[ ! -x "$FRONTEND_DIR/node_modules/.bin/vite" ]]; then
  printf 'Installing frontend dependencies...\n'
  npm --prefix "$FRONTEND_DIR" ci
fi

BACKEND_PID=''
FRONTEND_PID=''
cleanup() {
  trap - EXIT INT TERM
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "$FRONTEND_PID" "$BACKEND_PID"; do
    if [[ -n "$pid" ]]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

(
  cd "$BACKEND_DIR"
  exec "$PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port "$API_PORT"
) &
BACKEND_PID=$!

(
  cd "$FRONTEND_DIR"
  exec "$FRONTEND_DIR/node_modules/.bin/vite" --host 127.0.0.1 --port "$FRONTEND_PORT" --strictPort
) &
FRONTEND_PID=$!

wait_for_url() {
  local url="$1"
  local label="$2"
  for _ in {1..40}; do
    if curl --silent --show-error --fail "$url" >/dev/null 2>&1; then
      printf '%s is ready: %s\n' "$label" "$url"
      return 0
    fi
    if ! kill -0 "$BACKEND_PID" 2>/dev/null || ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
      printf '%s exited before becoming ready; see the service output above.\n' "$label" >&2
      return 1
    fi
    sleep 0.5
  done
  printf '%s did not become ready: %s\n' "$label" "$url" >&2
  return 1
}

wait_for_url "http://127.0.0.1:$API_PORT/api/health" "FastAPI"
wait_for_url "http://127.0.0.1:$FRONTEND_PORT/" "Vite"

printf '\nReCode is running. Open http://127.0.0.1:%s and press Ctrl-C to stop both services.\n\n' "$FRONTEND_PORT"
while kill -0 "$BACKEND_PID" 2>/dev/null && kill -0 "$FRONTEND_PID" 2>/dev/null; do
  sleep 1
done

printf 'A development service stopped; shutting down the other service.\n' >&2
