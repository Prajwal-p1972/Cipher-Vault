"""Standalone execution launcher for the Cipher Vault offline AI service."""

import signal
import sys
import uvicorn
from app.config import get_settings


def main() -> None:
    """Validate loopback binding and launch uvicorn server in restricted mode."""
    settings = get_settings()
    if settings.host not in ("127.0.0.1", "localhost", "::1"):
        print(
            f"ERROR: Security violation: AI service host must be a loopback address, got '{settings.host}'",
            file=sys.stderr,
        )
        sys.exit(1)

    def _sig_handler(sig: int, frame: object) -> None:
        sys.exit(0)

    signal.signal(signal.SIGINT, _sig_handler)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _sig_handler)

    try:
        uvicorn.run(
            "app.main:create_app",
            factory=True,
            host=settings.host,
            port=settings.port,
            log_level="warning",
            access_log=False,
        )
    except KeyboardInterrupt:
        sys.exit(0)


if __name__ == "__main__":
    main()
