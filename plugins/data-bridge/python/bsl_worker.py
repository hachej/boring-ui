import ast
import json
from pathlib import Path
from typing import Any, Dict

import ibis
from ibis import _
from returns.result import Failure, Success
from boring_semantic_layer import from_yaml
from boring_semantic_layer.utils import safe_eval


MODEL_CACHE: Dict[str, Any] = {}


def _model_key(payload: Dict[str, Any]) -> str:
    return json.dumps({
        "modelPath": payload["modelPath"],
        "profile": payload.get("profile"),
        "profileFile": payload.get("profileFile"),
    }, sort_keys=True)


def _resolve_models(payload: Dict[str, Any]) -> Dict[str, Any]:
    key = _model_key(payload)
    if key not in MODEL_CACHE:
        MODEL_CACHE[key] = from_yaml(
            Path(payload["modelPath"]),
            profile=payload.get("profile"),
            profile_path=payload.get("profileFile"),
        )
    return MODEL_CACHE[key]


def _guard_query(query: str) -> None:
    try:
        tree = ast.parse(query, mode="eval")
    except SyntaxError:
        # Preserve BSL/safe_eval's existing syntax diagnostics.
        return

    for node in ast.walk(tree):
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ValueError("private/dunder attribute access is not allowed")
        if isinstance(node, ast.Name) and node.id != "_" and node.id.startswith("_"):
            raise ValueError("private/dunder attribute access is not allowed")


def _dtype_for_value(value):
    dtype = str(value)
    if dtype.startswith("int"):
        return "integer"
    if dtype.startswith("float") or dtype.startswith("decimal"):
        return "float"
    if dtype.startswith("bool"):
        return "boolean"
    if "datetime" in dtype:
        return "datetime"
    return "string"


def _query_to_table(payload: Dict[str, Any]) -> Dict[str, Any]:
    _guard_query(payload["query"])
    models = _resolve_models(payload)
    model = models[payload["model"]]
    evaluated = safe_eval(payload["query"], context={**models, "sm": model, "ibis": ibis, "_": _})

    if isinstance(evaluated, Failure):
        raise evaluated.failure()

    result = evaluated.unwrap() if isinstance(evaluated, Success) else evaluated
    df = result.execute()

    limit = int(payload.get("limit") or 5000)
    rows = json.loads(df.head(limit).to_json(orient="records", date_format="iso"))
    columns = []

    for name in df.columns:
        series = df[name]
        columns.append({"name": str(name), "type": _dtype_for_value(series.dtype)})

    return {
        "ok": True,
        "output": {
            "kind": "data-bridge.table",
            "version": 1,
            "columns": columns,
            "rows": rows,
            "rowCount": len(rows),
            "truncated": len(df) > len(rows),
            "source": "bsl",
        },
    }


def _emit(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload), flush=True)


def _emit_error(id: str, message: str) -> None:
    _emit({"id": id, "ok": False, "error": {"message": message}})


def _handle_query_batch(message_id: str, payload: Dict[str, Any]) -> None:
    results = []
    for query in payload["queries"]:
        try:
            if not isinstance(query.get("query"), str):
                results.append({"ok": False, "error": {"message": "invalid query payload"}})
                continue
            results.append(_query_to_table(query))
        except Exception as exc:
            results.append({"ok": False, "error": {"message": str(exc) or exc.__class__.__name__}})

    _emit({"id": message_id, "ok": True, "payload": results})


def _handle_ready(message_id: str) -> None:
    _emit({"id": message_id, "ok": True, "payload": {"ready": True}})


def main() -> None:
    import sys
    for raw_line in sys.stdin:
        if not raw_line.strip():
            continue

        message: Dict[str, Any] = {}
        message_id = ""
        try:
            decoded = json.loads(raw_line)
            if not isinstance(decoded, dict):
                raise ValueError("worker message must be an object")
            message = decoded
            message_id = str(message.get("id", ""))
            method = message["method"]

            if method == "ready":
                _handle_ready(message_id)
            elif method == "queryBatch":
                _handle_query_batch(message_id, message.get("payload", {}))
            else:
                raise ValueError(f"unknown method: {method}")
        except SystemExit:
            raise
        except json.JSONDecodeError as exc:
            _emit_error(message_id, str(exc) or exc.__class__.__name__)
        except Exception as exc:
            _emit_error(message_id, str(exc) or exc.__class__.__name__)


if __name__ == "__main__":
    main()
