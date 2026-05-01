"""Year-over-year change transform.

Computes the percentage change from the same period last year.
"""
import pandas as pd

INPUTS = 1
DESCRIPTION = "Compute year-over-year (YoY) percentage change."


def transform(frames: dict[str, pd.DataFrame], input_ids: list[str], params: dict | None = None) -> pd.DataFrame:
    """Compute YoY change.
    
    Args:
        frames: Dict mapping input_id -> DataFrame with 'date' and 'value' columns
        input_ids: List of input series IDs
        params: Optional params (unused for YoY)
    
    Returns:
        DataFrame with 'date' and 'value' columns (YoY percentage)
    """
    params = params or {}
    df = frames[input_ids[0]].copy()
    df = df.sort_values('date').reset_index(drop=True)
    
    # Calculate YoY: (current - same_period_last_year) / same_period_last_year * 100
    df['value_lag12'] = df['value'].shift(12)
    df['yoy'] = ((df['value'] - df['value_lag12']) / df['value_lag12'] * 100).round(2)
    
    result = df[['date', 'yoy']].rename(columns={'yoy': 'value'})
    return result.dropna()
