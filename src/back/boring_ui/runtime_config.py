"""Runtime config payload helpers for the frontend bootstrap contract."""

from __future__ import annotations

import copy
import os
from typing import Any, Mapping

from boring_ui.api.config import APIConfig


_KNOWN_PROFILES = {
    "frontend",
    "backend",
    "custom",
}


def _normalize_agent_mode(value: str | None) -> str:
    return "backend" if str(value or "").strip().lower() == "backend" else "frontend"


def _normalize_profile(value: str | None) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in _KNOWN_PROFILES else ""


def _build_auth_payload(config: APIConfig | None) -> dict[str, Any] | None:
    if config and config.use_neon_control_plane and config.neon_auth_base_url:
        return {
            "provider": "neon",
            "neonAuthUrl": config.neon_auth_base_url.rstrip("/"),
            "callbackUrl": "/auth/callback",
            "appName": config.auth_app_name or "",
            "appDescription": config.auth_app_description or "",
        }
    return None


def _build_available_agents(
    agents_cfg: Mapping[str, Any],
    enabled_features: Mapping[str, bool],
) -> list[str]:
    available: list[str] = []

    for key, value in agents_cfg.items():
        if key == "mode":
            continue
        if isinstance(value, Mapping) and value.get("enabled", True):
            available.append(str(key))

    if available:
        return sorted(set(available))

    inferred: list[str] = []
    if enabled_features.get("chat_claude_code") or enabled_features.get("stream"):
        inferred.append("claude_code")
    if enabled_features.get("pi"):
        inferred.append("pi")
    return sorted(set(inferred))


def _serialize_config_agents(config: APIConfig | None) -> dict[str, Any]:
    if config is None:
        return {}

    serialized: dict[str, Any] = {
        "mode": config.agents_mode,
    }
    if config.default_agent_name:
        serialized["default"] = config.default_agent_name
    for name, agent in config.agents.items():
        serialized[name] = {
            "enabled": agent.enabled,
            "port": agent.port,
            "transport": agent.transport,
            "command": list(agent.command),
            "env": dict(agent.env),
            **dict(agent.metadata),
        }
    return serialized


def _effective_agents_cfg(
    raw_agents_cfg: Mapping[str, Any],
    config: APIConfig | None,
) -> dict[str, Any]:
    effective = dict(raw_agents_cfg)
    effective.update(_serialize_config_agents(config))
    return effective


def _build_agent_definitions(agents_cfg: Mapping[str, Any]) -> list[dict[str, Any]]:
    definitions: list[dict[str, Any]] = []
    for key, value in agents_cfg.items():
        if key in {"mode", "default"} or not isinstance(value, Mapping):
            continue
        if not value.get("enabled", True):
            continue
        definitions.append(
            {
                "name": str(key),
                "transport": value.get("transport"),
                "port": value.get("port"),
                "command": list(value.get("command", [])),
                "metadata": {
                    inner_key: inner_value
                    for inner_key, inner_value in value.items()
                    if inner_key not in {"enabled", "port", "transport", "command", "env"}
                },
            }
        )
    return definitions


def build_runtime_config_payload(
    raw_config: Mapping[str, Any] | None = None,
    *,
    config: APIConfig | None = None,
    enabled_features: Mapping[str, bool] | None = None,
) -> dict[str, Any]:
    """Build the canonical runtime config payload served from /__bui/config."""
    raw_config = raw_config or {}
    enabled_features = dict(enabled_features or {})

    app_section = raw_config.get("app", {})
    frontend = copy.deepcopy(raw_config.get("frontend", {}))
    agents_cfg = raw_config.get("agents", {})

    if not isinstance(app_section, Mapping):
        app_section = {}
    if not isinstance(frontend, Mapping):
        frontend = {}
    if not isinstance(agents_cfg, Mapping):
        agents_cfg = {}
    effective_agents_cfg = _effective_agents_cfg(agents_cfg, config)

    frontend = dict(frontend)
    branding = dict(frontend.get("branding", {}))
    features = dict(frontend.get("features", {}))
    data = dict(frontend.get("data", {}))
    panels = frontend.get("panels", {})
    if not isinstance(panels, Mapping):
        panels = {}

    app_name = str(app_section.get("name") or (config.auth_app_name if config else "") or "Boring UI")
    app_id = str(app_section.get("id") or (config.control_plane_app_id if config else "") or "boring-ui")
    app_logo = str(app_section.get("logo") or branding.get("logo") or "B")

    branding.setdefault("name", app_name)
    branding.setdefault("logo", app_logo)

    agent_mode = _normalize_agent_mode(
        effective_agents_cfg.get("mode") if effective_agents_cfg else None
    )
    data_backend = str(data.get("backend") or "http").strip().lower() or "http"
    explicit_profile = _normalize_profile(
        os.environ.get("VITE_UI_PROFILE")
        or os.environ.get("UI_PROFILE")
        or (frontend.get("mode", {}) or {}).get("profile")
    )
    profile = explicit_profile or agent_mode
    data["backend"] = data_backend

    frontend["branding"] = branding
    frontend["features"] = features
    frontend["data"] = data
    frontend["agents"] = {
        "mode": agent_mode,
    }
    frontend["panels"] = copy.deepcopy(dict(panels))
    frontend["mode"] = {
        "profile": profile,
    }

    return {
        "app": {
            "id": app_id,
            "name": app_name,
            "logo": app_logo,
        },
        "frontend": frontend,
        "agents": {
            "mode": agent_mode,
            "default": effective_agents_cfg.get("default"),
            "available": _build_available_agents(effective_agents_cfg, enabled_features),
            "definitions": _build_agent_definitions(effective_agents_cfg),
        },
        "auth": _build_auth_payload(config),
    }
