import ast
import json
import sys
import traceback
from pathlib import Path
from typing import Any, Dict, List

import ibis
from ibis import _
from ibis.common.deferred import Deferred
from ibis.expr.types import Table
from returns.result import Failure, Success
from boring_semantic_layer import from_yaml
from boring_semantic_layer.utils import safe_eval


MODEL_CACHE: Dict[str, Any] = {}

BSL_INVALID_SYNTAX = "DATA_BRIDGE_BSL_INVALID_SYNTAX"
BSL_DEFERRED_RESULT = "DATA_BRIDGE_BSL_DEFERRED_RESULT"
BSL_NON_TABULAR_RESULT = "DATA_BRIDGE_BSL_NON_TABULAR_RESULT"
BSL_INVALID_ARGUMENTS = "DATA_BRIDGE_BSL_INVALID_ARGUMENTS"
BSL_EXECUTION_FAILED = "DATA_BRIDGE_BSL_EXECUTION_FAILED"


class BslQueryError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


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
    except SyntaxError as exc:
        raise BslQueryError(
            BSL_INVALID_SYNTAX,
            "BSL expression is incomplete or has invalid syntax; replace placeholders such as ... with a complete expression",
        ) from exc

    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and node.value is Ellipsis:
            raise BslQueryError(
                BSL_INVALID_SYNTAX,
                "BSL expression is incomplete or has invalid syntax; replace placeholders such as ... with a complete expression",
            )
        if isinstance(node, ast.Attribute) and node.attr.startswith("_"):
            raise ValueError("private/dunder attribute access is not allowed")
        if isinstance(node, ast.Name) and node.id != "_" and node.id.startswith("_"):
            raise ValueError("private/dunder attribute access is not allowed")


def _safe_evaluation_error(error: BaseException) -> BaseException:
    diagnostic = str(error)
    if error.__class__.__name__ != "SignatureValidationError":
        return error

    if "SemanticAggregateOp" in diagnostic and "`aggs`" in diagnostic:
        return BslQueryError(
            BSL_INVALID_ARGUMENTS,
            "Invalid semantic aggregation arguments: pass measure names positionally, for example "
            "aggregate(\"measure\"); named aggregate aliases require callable expressions",
        )

    return BslQueryError(
        BSL_INVALID_ARGUMENTS,
        "BSL operation received invalid argument types; check the operation arguments",
    )


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


def _concrete_table(result: Any) -> Any:
    if isinstance(result, Deferred):
        raise BslQueryError(
            BSL_DEFERRED_RESULT,
            "BSL expression must return a concrete executable table; use _ only inside operations on a selected model such as sm.filter(...)",
        )
    if not isinstance(result, Table):
        raise BslQueryError(
            BSL_NON_TABULAR_RESULT,
            "BSL expression must return a concrete executable table, not a scalar, column, or Python value",
        )
    return result


def _query_to_table(payload: Dict[str, Any]) -> Dict[str, Any]:
    _guard_query(payload["query"])
    models = _resolve_models(payload)
    model = models[payload["model"]]
    evaluated = safe_eval(payload["query"], context={**models, "sm": model, "ibis": ibis, "_": _})

    if isinstance(evaluated, Failure):
        failure = evaluated.failure()
        if isinstance(failure, BaseException):
            raise _safe_evaluation_error(failure)
        raise RuntimeError(str(failure))

    if not isinstance(evaluated, Success):
        failure = evaluated.failure()
        raise failure if isinstance(failure, BaseException) else RuntimeError(str(failure))
    result = evaluated.unwrap()
    df = _concrete_table(result).execute()

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


def _emit_error(id: str, code: str, message: str) -> None:
    _emit({"id": id, "ok": False, "error": {"code": code, "message": message}})


def _query_batch(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    results = []
    for query in payload["queries"]:
        try:
            if not isinstance(query.get("query"), str):
                results.append({"ok": False, "error": {
                    "code": BSL_INVALID_SYNTAX,
                    "message": "BSL query payload must include an expression string",
                }})
                continue
            results.append(_query_to_table(query))
        except BslQueryError as exc:
            results.append({"ok": False, "error": {"code": exc.code, "message": str(exc)}})
        except Exception:
            traceback.print_exc(file=sys.stderr)
            results.append({"ok": False, "error": {
                "code": BSL_EXECUTION_FAILED,
                "message": "BSL expression could not be evaluated; check the selected model and expression",
            }})

    return results


def _handle_query_batch(message_id: str, payload: Dict[str, Any]) -> None:
    _emit({"id": message_id, "ok": True, "payload": _query_batch(payload)})


def _handle_ready(message_id: str) -> None:
    _emit({"id": message_id, "ok": True, "payload": {"ready": True}})


def main() -> None:
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
        except json.JSONDecodeError:
            _emit_error(message_id, BSL_EXECUTION_FAILED, "Invalid BSL worker request")
        except Exception:
            traceback.print_exc(file=sys.stderr)
            _emit_error(message_id, BSL_EXECUTION_FAILED, "BSL worker request failed")


if __name__ == "__main__":
    main()
