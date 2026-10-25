from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy.engine import make_url

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

DB_PATH = BASE_DIR / "recode.db"
_database_url = make_url(os.getenv("DATABASE_URL", f"sqlite:///{DB_PATH}"))
if _database_url.drivername in {"postgres", "postgresql"}:
    _database_url = _database_url.set(drivername="postgresql+psycopg")
if (
    _database_url.drivername.startswith("sqlite")
    and _database_url.database not in (None, "", ":memory:")
    and not Path(_database_url.database).is_absolute()
):
    _database_url = _database_url.set(
        database=str((BASE_DIR / _database_url.database).resolve())
    )
DATABASE_URL = _database_url.render_as_string(hide_password=False)
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:4b")
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
APP_ENV = os.getenv("APP_ENV", "development").strip().lower()
RECODE_SEED_DEMO_DATA = os.getenv(
    "RECODE_SEED_DEMO_DATA", "false" if APP_ENV == "production" else "true"
).strip().lower() in {"1", "true", "yes"}
RECODE_REQUIRE_AUTH = os.getenv("RECODE_REQUIRE_AUTH", "false").strip().lower() in {
    "1",
    "true",
    "yes",
}
RECODE_AUTH_PASSWORD = os.getenv("RECODE_AUTH_PASSWORD", "")
RECODE_SESSION_SECRET = os.getenv("RECODE_SESSION_SECRET", "")

_default_cors_origins = "http://localhost:5173,http://127.0.0.1:5173"
CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv("CORS_ORIGINS", _default_cors_origins).split(",")
    if origin.strip()
]
