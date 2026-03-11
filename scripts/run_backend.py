#!/usr/bin/env python3
"""Run boring-ui backend with explicit args (avoids shell interpolation)."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

import uvicorn

from boring_ui.api.app import create_app


def load_local_env() -> None:
    env_path = Path(".env.local")
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if value[:1] == value[-1:] and value[:1] in {"'", '"'}:
            value = value[1:-1]
        if "\\n" in value and (
            key.endswith("PRIVATE_KEY")
            or key.endswith("_PEM")
            or "BEGIN " in value
        ):
            value = value.replace("\\n", "\n")
        os.environ.setdefault(key, value)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--include-pty", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--include-stream", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--include-approval", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument(
        "--deploy-mode",
        choices=["core", "edge"],
        default=os.environ.get("DEPLOY_MODE", "core").strip().lower(),
    )
    return parser.parse_args()


def main() -> int:
    load_local_env()
    args = parse_args()
    os.environ["DEPLOY_MODE"] = args.deploy_mode
    # Local/dev convenience: auto-login by default unless explicitly overridden.
    # Set both flags for compatibility with routes that still check AUTH_DEV_LOGIN_ENABLED.
    os.environ.setdefault("AUTH_DEV_AUTO_LOGIN", "true")
    os.environ.setdefault("AUTH_DEV_LOGIN_ENABLED", "true")
    # Local/dev convenience: keep GitHub install flow available by default.
    # Full GitHub sync still requires GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY.
    os.environ.setdefault("GITHUB_APP_SLUG", "boring-ui-app")
    app = create_app(
        include_pty=args.include_pty,
        include_stream=args.include_stream,
        include_approval=args.include_approval,
    )
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
