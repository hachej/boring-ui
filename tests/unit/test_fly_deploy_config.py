from __future__ import annotations

import tomllib
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
FLY_TOML = REPO_ROOT / "deploy" / "fly" / "fly.toml"
FLY_SECRETS = REPO_ROOT / "deploy" / "fly" / "fly.secrets.sh"


def test_fly_toml_targets_backend_image_and_single_machine_http_service() -> None:
    with FLY_TOML.open("rb") as handle:
        data = tomllib.load(handle)

    assert data["app"] == "boring-ui"
    assert data["primary_region"] == "cdg"
    assert data["build"]["dockerfile"] == "deploy/shared/Dockerfile.backend"
    assert data["http_service"]["internal_port"] == 8000
    assert data["http_service"]["force_https"] is True
    assert data["http_service"]["auto_stop_machines"] == "off"
    assert data["http_service"]["min_machines_running"] == 1
    assert data["http_service"]["checks"][0]["path"] == "/healthz"
    assert data["vm"]["cpu_kind"] == "shared"
    assert data["vm"]["cpus"] == 1
    assert data["vm"]["memory"] == "512mb"


def test_fly_secrets_script_covers_core_and_hosted_secret_contract() -> None:
    contents = FLY_SECRETS.read_text(encoding="utf-8")

    for key in (
        "DATABASE_URL",
        "BORING_UI_SESSION_SECRET",
        "BORING_SETTINGS_KEY",
        "ANTHROPIC_API_KEY",
        "RESEND_API_KEY",
        "NEON_AUTH_BASE_URL",
        "NEON_AUTH_JWKS_URL",
        "GITHUB_APP_ID",
        "GITHUB_APP_CLIENT_ID",
        "GITHUB_APP_CLIENT_SECRET",
        "GITHUB_APP_PRIVATE_KEY",
        "GITHUB_APP_SLUG",
    ):
        assert f"{key}=" in contents

    assert "vault kv get -field=" in contents
    assert 'app_toml_value "deploy.neon.auth_url"' in contents
    assert 'app_toml_value "deploy.neon.jwks_url"' in contents
    assert 'secrets set --app "$APP_NAME"' in contents
