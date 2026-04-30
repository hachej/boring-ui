# @boring/macro-sdk

Macro-economic timeseries SDK for boring.macro.

## Installation

```bash
npm install @boring/macro-sdk
```

## CLI Usage

The SDK ships a `bm` CLI tool:

```bash
# List available transforms
bm list

# Run a built-in transform (YoY change)
bm run --tool builtin:yoy --input CPIAUCSL --output CPIAUCSL_YOY --title "CPI YoY" --params-json '{}'

# Run a custom transform
bm run --tool custom:my_transform --input series1 --output derived1 --title "My Derived Series"

# Scaffold a new custom transform
bm scaffold --name my_custom_transform
```

## Transform Format

Transforms are Python files that implement:

```python
import pandas as pd

INPUTS = 1  # Number of input series required
DESCRIPTION = "What this transform computes."

def transform(frames: dict[str, pd.DataFrame], input_ids: list[str], params: dict | None = None) -> pd.DataFrame:
    df = frames[input_ids[0]].copy()
    # Your transformation logic here
    return df[['date', 'value']]
```

## LLM Tools

The SDK also exposes LLM-callable tools (when integrated with @boring/agent):

- `execute_sql` - Run read-only SQL queries against ClickHouse
- `macro_search` - Search the FRED series catalog
- `get_series_data` - Fetch observations for a series
- `persist_derived_series` - Persist derived timeseries output

## License

MIT
