"""Rolling mean transform."""

import pandas as pd

INPUTS = 1
DESCRIPTION = "Compute rolling mean with configurable window (default 12 periods)."
DEFAULT_WINDOW = 12


def transform(
    frames: dict[str, pd.DataFrame],
    input_ids: list[str],
    params: dict | None = None,
) -> pd.DataFrame:
    params = params or {}
    window = int(params.get("window", DEFAULT_WINDOW))
    if window < 1:
        raise ValueError("window must be >= 1")

    df = frames[input_ids[0]].copy()
    df = df.sort_values("date").reset_index(drop=True)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df["value"] = df["value"].rolling(window=window).mean()
    return df[["date", "value"]]
