---
name: macro-transform
description: Create derived macro series with Python and pandas. Use this whenever the user asks to create, derive, transform, normalize, smooth, difference, or compute a new series from existing macro time series. Prefer this over ad-hoc in-chat calculations.
---

# macro-transform

Use this skill when the task is: compute a derived macro series in Python, then persist it back into boring.macro.

**Default rule:** if the user asks for a new derived series, use this skill first. Do **not** directly hand-compute observation arrays in chat unless the user explicitly wants a quick one-off approximation instead of a reusable transform artifact.

## Architecture

- Python computes.
- boring.macro API reads inputs and persists outputs.
- Never write derived series directly with SQL.
- ClickHouse stays behind the app API.

## File locations

- Builtins: shipped inside the installed `boring_macro` SDK in the workspace `.venv` — discoverable via `bm list`
- Workspace shims: raw `python`, `pip`, and `bm` commands resolve to the workspace `.venv`
- Custom transforms: `transforms/custom/` in the workspace

Create reusable custom transforms under `transforms/custom/`.

## Transform file contract

```py
import pandas as pd

INPUTS = 1
DESCRIPTION = "Describe the transform"


def transform(frames: dict[str, pd.DataFrame], input_ids: list[str], params: dict | None = None) -> pd.DataFrame:
    params = params or {}
    df = frames[input_ids[0]].copy()
    df = df.sort_values("date").reset_index(drop=True)
    return df[["date", "value"]]
```

Rules:

- inputs are keyed by series id
- each frame must use `date` and `value`
- output must be a DataFrame with `date` and `value`
- normalize dates/numbers before persist
- reject or clean NaN / Inf / duplicate dates

## Workflow

1. Create a transform file in `transforms/custom/` (or use a builtin — run `bm list`).
2. Run it with the `bm` CLI from the workspace root.
3. Raw `python`, `pip`, and `bm` commands already target the workspace `.venv`.
4. Do not manually export `BORING_AGENT_WORKSPACE_ROOT`; the workspace shims set it for you.
5. Verify fetch/chart/lineage/metadata.

For common requests like YoY, diff, moving average, z-score, spread, ratio, or multi-series comparison, still prefer this workflow so the result is reproducible and reusable.

## CLI — primary interface

```bash
# Run a transform and persist the result
bm run --tool custom:ma12 --input UNRATE --output UNRATE_MA12 --title "UNRATE 12M MA" --params-json '{"window": 12}'

# Run a builtin
bm run --tool builtin:yoy --input GDPC1 --output GDPC1_YOY --title "Real GDP YoY"

# List all available transforms (builtins + custom)
bm list

# Scaffold a new custom transform file
bm scaffold --name my_transform

# Install extra Python packages into the workspace venv when truly needed
pip install statsmodels
```

All commands run from the workspace root. `--tool` accepts `builtin:name`, `custom:name`, or just `name` if unambiguous.

## Python SDK — for custom pipelines

```py
from boring_macro import get_series_data_json, persist_series, run_transform

# One-call pipeline (same as CLI)
run_transform(script_path, *, input_ids, output_id, title, transform_name=None, params=None) -> dict

# Fetch observations — returns {series_id, count, observations: [{date, value}, ...]}
get_series_data_json(series_id, **kwargs) -> dict

# Persist derived series
persist_series(*, output_id, title, input_ids, transform_name, observations, transform_spec=None) -> dict
```

Prefer the CLI — only drop to Python when you need custom pre/post-processing logic.

## Naming conventions

- `output_id`: concise, stable, uppercase, e.g. `GDPC1_YOY`, `CPIAUCSL_DIFF`, `UNRATE_MA12`
- `title`: readable chart title

## Verification checklist

After persist, verify:

1. API returned success
2. derived series can be fetched
3. chart opens successfully
4. lineage links source -> derived
5. metadata looks sane
6. if user asked for a reusable transform, confirm the file exists under `transforms/custom/`

## Failure handling

- GET failure: verify route/path/auth first
- bad DataFrame shape: fix transform to return `date` + `value`
- duplicate dates: normalize before persist
- persist collision: choose a different `output_id` or intentionally replace same transform
- metadata oddities: inspect `transform_spec` shape first
