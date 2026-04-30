"""boring.macro Python SDK — fetch series, run transforms, persist derived series."""
from __future__ import annotations

import importlib.util
import inspect
import math
import os
from pathlib import Path
from typing import Any

import pandas as pd
import requests

_API_PORT = int(os.environ.get("API_PORT", "5210"))
_BASE_URL = os.environ.get("BORING_MACRO_API_URL", f"http://127.0.0.1:{_API_PORT}")
_WORKSPACE_ROOT = Path(os.environ.get("BORING_AGENT_WORKSPACE_ROOT", os.getcwd()))

__all__ = ["get_series_data_json", "persist_series", "run_transform"]


def get_series_data_json(series_id: str, **kwargs: Any) -> dict[str, Any]:
    """Fetch observations for a series.

    kwargs are forwarded as query params (order, limit, from, to).
    Returns {series_id, count, observations: [{date, value}, ...]}.
    """
    resp = requests.get(
        f"{_BASE_URL}/api/macro/series/{series_id}/data",
        params=kwargs,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def persist_series(
    *,
    output_id: str,
    title: str,
    input_ids: list[str],
    transform_name: str,
    observations: list[dict[str, Any]],
    transform_spec: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Persist a derived series.

    observations: [{date: "YYYY-MM-DD", value: float}, ...]
    Returns the API response dict.
    """
    body: dict[str, Any] = {
        "output_id": output_id,
        "title": title,
        "input_ids": input_ids,
        "transform_name": transform_name,
        "data": [[row["date"], float(row["value"])] for row in observations],
    }
    if transform_spec is not None:
        body["transform_spec"] = transform_spec
    resp = requests.post(f"{_BASE_URL}/api/macro/transform/persist", json=body, timeout=30)
    resp.raise_for_status()
    return resp.json()


def run_transform(
    script_path: str,
    *,
    input_ids: list[str],
    output_id: str,
    title: str,
    transform_name: str | None = None,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fetch inputs, run a transform file, and persist the result in one call.

    script_path can be relative to the workspace root (e.g. "transforms/custom/ma12.py").
    """
    path = Path(script_path)
    if not path.is_absolute():
        path = _WORKSPACE_ROOT / path
    path = path.resolve()
    if not path.is_file():
        raise FileNotFoundError(f"Transform script not found: {path}")

    spec = importlib.util.spec_from_file_location("_bm_transform", str(path))
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load transform: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)  # type: ignore[union-attr]
    if not hasattr(module, "transform"):
        raise AttributeError(f"'{path}' must define transform(frames, input_ids, params)")

    frames: dict[str, pd.DataFrame] = {}
    for sid in input_ids:
        raw = get_series_data_json(sid, order="asc", limit=5000)
        df = pd.DataFrame.from_records(raw["observations"], columns=["date", "value"])
        df["date"] = pd.to_datetime(df["date"], errors="coerce")
        df["value"] = pd.to_numeric(df["value"], errors="coerce")
        df = df.dropna(subset=["date", "value"])
        df = df[df["value"].map(math.isfinite)]
        df = df.sort_values("date").drop_duplicates(subset=["date"], keep="last").reset_index(drop=True)
        frames[sid] = df

    sig = inspect.signature(module.transform)
    out: pd.DataFrame = (
        module.transform(frames, input_ids, params or {})
        if len(sig.parameters) >= 3
        else module.transform(frames, input_ids)
    )

    out = out[["date", "value"]].copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce")
    out["value"] = pd.to_numeric(out["value"], errors="coerce")
    out = out.dropna(subset=["date", "value"])
    out = out[out["value"].map(math.isfinite)]
    out = out.sort_values("date").drop_duplicates(subset=["date"], keep="last")

    if out["date"].duplicated().any():
        dupes = out.loc[out["date"].duplicated(), "date"].dt.strftime("%Y-%m-%d").tolist()
        raise ValueError(f"Duplicate dates in transform output: {dupes[:5]}")

    observations = [
        {"date": d.strftime("%Y-%m-%d"), "value": float(v)}
        for d, v in out[["date", "value"]].itertuples(index=False, name=None)
    ]

    return persist_series(
        output_id=output_id,
        title=title,
        input_ids=input_ids,
        transform_name=transform_name or path.stem,
        observations=observations,
        transform_spec={
            "name": transform_name or path.stem,
            "tool_type": "custom",
            "file": str(path.relative_to(_WORKSPACE_ROOT) if path.is_relative_to(_WORKSPACE_ROOT) else path),
            "input_ids": input_ids,
            "params": params or {},
        },
    )
