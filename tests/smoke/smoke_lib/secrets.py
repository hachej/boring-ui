"""Secret loading helpers (Vault + env fallback)."""
from __future__ import annotations
import os
import subprocess


def vault(path: str, field: str) -> str:
    return subprocess.check_output(
        ["vault", "kv", "get", f"-field={field}", path],
        text=True,
    ).strip()


def secret(*, env: str, vault_path: str, vault_field: str) -> str:
    value = (os.environ.get(env) or "").strip()
    if value:
        return value
    return vault(vault_path, vault_field)


def resend_api_key() -> str:
    return secret(
        env="RESEND_API_KEY",
        vault_path="secret/agent/services/resend",
        vault_field="api_key",
    )


def anthropic_api_key() -> str:
    return secret(
        env="ANTHROPIC_API_KEY",
        vault_path="secret/agent/anthropic",
        vault_field="api_key",
    )


def neon_auth_url() -> str:
    return secret(
        env="NEON_AUTH_BASE_URL",
        vault_path="secret/agent/boring-ui-neon-auth",
        vault_field="base_url",
    ).rstrip("/")
