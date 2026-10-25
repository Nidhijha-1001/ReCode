from __future__ import annotations

import base64
import hashlib
import hmac
import time
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import Response

from .config import (
    APP_ENV,
    CORS_ORIGINS,
    RECODE_AUTH_PASSWORD,
    RECODE_REQUIRE_AUTH,
    RECODE_SESSION_SECRET,
)

SESSION_COOKIE = "recode_session"
SESSION_MAX_AGE = 60 * 60 * 24 * 7
PUBLIC_AUTH_PATHS = {
    "/api/auth/login",
    "/api/auth/session",
    "/api/auth/logout",
    "/api/health",
}

if APP_ENV == "production" and not RECODE_REQUIRE_AUTH:
    raise RuntimeError("RECODE_REQUIRE_AUTH must be enabled in production.")
if RECODE_REQUIRE_AUTH and (
    len(RECODE_AUTH_PASSWORD) < 12
    or len(RECODE_SESSION_SECRET) < 32
    or not CORS_ORIGINS
):
    raise RuntimeError(
        "RECODE_REQUIRE_AUTH needs a RECODE_AUTH_PASSWORD of at least 12 characters, "
        "a RECODE_SESSION_SECRET of at least 32 characters, and at least one CORS_ORIGINS entry."
    )
if APP_ENV == "production" and all(
    origin.startswith(("http://localhost", "http://127.0.0.1"))
    for origin in CORS_ORIGINS
):
    raise RuntimeError("Production CORS_ORIGINS must include the deployed frontend origin.")


def create_session_token(now: Optional[int] = None) -> str:
    expires_at = (int(time.time()) if now is None else now) + SESSION_MAX_AGE
    payload = str(expires_at).encode("ascii")
    encoded_payload = base64.urlsafe_b64encode(payload).rstrip(b"=").decode("ascii")
    signature = hmac.new(
        RECODE_SESSION_SECRET.encode("utf-8"), encoded_payload.encode("ascii"), hashlib.sha256
    ).digest()
    encoded_signature = base64.urlsafe_b64encode(signature).rstrip(b"=").decode("ascii")
    return f"{encoded_payload}.{encoded_signature}"


def is_valid_session(token: Optional[str], now: Optional[int] = None) -> bool:
    if not token or not RECODE_SESSION_SECRET:
        return False
    try:
        encoded_payload, encoded_signature = token.split(".", maxsplit=1)
        provided_signature = base64.urlsafe_b64decode(
            encoded_signature + "=" * (-len(encoded_signature) % 4)
        )
        expected_signature = hmac.new(
            RECODE_SESSION_SECRET.encode("utf-8"),
            encoded_payload.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(provided_signature, expected_signature):
            return False
        payload = base64.urlsafe_b64decode(
            encoded_payload + "=" * (-len(encoded_payload) % 4)
        )
        expires_at = int(payload.decode("ascii"))
        current_time = int(time.time()) if now is None else now
        return current_time < expires_at
    except (ValueError, UnicodeDecodeError):
        return False


class ApiAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        if not RECODE_REQUIRE_AUTH:
            return await call_next(request)

        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            origin = request.headers.get("origin")
            if origin not in CORS_ORIGINS:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Request origin is not allowed."},
                )

        if request.method == "OPTIONS" or request.url.path in PUBLIC_AUTH_PATHS:
            return await call_next(request)

        if not is_valid_session(request.cookies.get(SESSION_COOKIE)):
            return JSONResponse(
                status_code=401,
                content={"detail": "Sign in to access ReCode."},
            )
        return await call_next(request)


def set_session_cookie(response: Response, token: str) -> None:
    production = APP_ENV == "production"
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=SESSION_MAX_AGE,
        httponly=True,
        secure=production,
        samesite="lax",
        path="/api",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(
        key=SESSION_COOKIE,
        httponly=True,
        secure=APP_ENV == "production",
        samesite="lax",
        path="/api",
    )
