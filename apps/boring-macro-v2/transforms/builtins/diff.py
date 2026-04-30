"""First-difference transform."""

import pandas as pd

INPUTS = 1
DESCRIPTION = "Compute first difference (value[t] - value[t-1]) for a single time series."


def transform(
    frames: dict[str, pd.DataFrame],
    input_ids: list[str],
    params: dict | None = None,
) -> pd.DataFrame:
    df = frames[input_ids[0]].copy()
    df = df.sort_values("date").reset_index(drop=True)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df["value"] = df["value"].diff()
    return df[["date", "value"]]
