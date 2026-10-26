"""Security middleware, CORS configuration, and session authorization dependencies."""

from typing import Callable
from fastapi import HTTPException, Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.middleware.cors import CORSMiddleware
from starlette.types import ASGIApp
from app.config import Settings, get_settings
from app.sessions import AuthError, Session, SessionManager


class SecurityMiddleware(BaseHTTPMiddleware):
    """Enforces DNS rebinding defenses, strict Origin checks, and security headers."""

    def __init__(self, app: ASGIApp, settings: Settings | None = None) -> None:
        """Initialize security middleware with application settings."""
        super().__init__(app)
        self._settings = settings or get_settings()

    async def dispatch(self, request: Request, call_next: Callable[[Request], Response]) -> Response:
        """Inspect host and origin headers before delegating, and apply security headers to responses."""
        # 1. Host check (defense against DNS rebinding)
        host_header = request.headers.get("host", "").strip()
        hostname = host_header.split(":")[0].lower() if host_header else ""
        if hostname not in ("127.0.0.1", "localhost"):
            return JSONResponse(
                status_code=403,
                content={"error": "Forbidden: invalid host header"},
                headers={
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                },
            )

        # 2. Origin check (exempt only for GET /health and CORS preflights handled separately)
        path = request.url.path
        method = request.method.upper()

        if method != "OPTIONS":
            is_health_get = (path == "/health" and method == "GET")
            if not is_health_get:
                origin = request.headers.get("origin")
                is_state_changing = method in ("POST", "PUT", "PATCH", "DELETE")

                if is_state_changing:
                    if not origin:
                        return JSONResponse(
                            status_code=403,
                            content={"error": "Forbidden: missing origin header"},
                            headers={
                                "Cache-Control": "no-store",
                                "X-Content-Type-Options": "nosniff",
                            },
                        )
                    if origin not in self._settings.allowed_origins:
                        return JSONResponse(
                            status_code=403,
                            content={"error": "Forbidden: origin not allowed"},
                            headers={
                                "Cache-Control": "no-store",
                                "X-Content-Type-Options": "nosniff",
                            },
                        )
                elif origin is not None:
                    if origin not in self._settings.allowed_origins:
                        return JSONResponse(
                            status_code=403,
                            content={"error": "Forbidden: origin not allowed"},
                            headers={
                                "Cache-Control": "no-store",
                                "X-Content-Type-Options": "nosniff",
                            },
                        )

        response = await call_next(request)

        # 3. Security headers on every response
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"

        # 4. Explicitly allow private network on OPTIONS only for allowed origins
        if method == "OPTIONS":
            origin = request.headers.get("origin")
            if not origin or origin not in self._settings.allowed_origins:
                if "access-control-allow-private-network" in response.headers:
                    del response.headers["access-control-allow-private-network"]
            elif request.headers.get("access-control-request-private-network") == "true":
                response.headers["Access-Control-Allow-Private-Network"] = "true"

        return response


def setup_cors(app: ASGIApp, settings: Settings | None = None) -> None:
    """Register standard CORSMiddleware with private-network preflight support."""
    cfg = settings or get_settings()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cfg.allowed_origins,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        allow_credentials=False,
        allow_private_network=True,
    )


async def get_authorized_session(
    sid: str,
    request: Request,
) -> Session:
    """Dependency verifying session existence and Bearer token authenticity."""
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")

    token = auth_header[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Unauthorized")

    session_manager: SessionManager = request.app.state.session_manager
    try:
        return await session_manager.authorize(sid, token)
    except AuthError:
        raise HTTPException(status_code=401, detail="Unauthorized")
