"""Dependency-free protocol validation for the real Data Bridge Python worker."""

import contextlib
import importlib.util
import io
import sys
import types
from pathlib import Path


class Deferred:
    pass


class Table:
    def execute(self):
        return Frame()


class Column:
    pass


class Success:
    def __init__(self, value):
        self.value = value

    def unwrap(self):
        return self.value


class Failure:
    def __init__(self, value):
        self.value = value

    def failure(self):
        return self.value


class SignatureValidationError(Exception):
    pass


class Dtype:
    def __str__(self):
        return "int64"


class Series:
    dtype = Dtype()


class Frame:
    columns = ["value"]

    def head(self, _limit):
        return self

    def to_json(self, orient, date_format):
        assert orient == "records"
        assert date_format == "iso"
        return '[{"value": 1}]'

    def __getitem__(self, _name):
        return Series()

    def __len__(self):
        return 1


class Model:
    name = "semanticModel"
    model = {"table": Table()}


def install_stubs():
    ibis = types.ModuleType("ibis")
    ibis._ = Deferred()
    ibis.interval = object()
    ibis.literal = object()
    ibis_common = types.ModuleType("ibis.common")
    ibis_deferred = types.ModuleType("ibis.common.deferred")
    ibis_deferred.Deferred = Deferred
    ibis_expr = types.ModuleType("ibis.expr")
    ibis_types = types.ModuleType("ibis.expr.types")
    ibis_types.Table = Table

    returns = types.ModuleType("returns")
    returns_result = types.ModuleType("returns.result")
    returns_result.Failure = Failure
    returns_result.Success = Success

    bsl = types.ModuleType("boring_semantic_layer")
    bsl.from_yaml = lambda *_args, **_kwargs: {"semanticModel": Model()}
    bsl_utils = types.ModuleType("boring_semantic_layer.utils")
    bsl_utils.safe_eval = lambda *_args, **_kwargs: Success(Table())

    sys.modules.update({
        "ibis": ibis,
        "ibis.common": ibis_common,
        "ibis.common.deferred": ibis_deferred,
        "ibis.expr": ibis_expr,
        "ibis.expr.types": ibis_types,
        "returns": returns,
        "returns.result": returns_result,
        "boring_semantic_layer": bsl,
        "boring_semantic_layer.utils": bsl_utils,
    })


def load_worker():
    install_stubs()
    worker_path = Path(__file__).parents[4] / "python" / "bsl_worker.py"
    spec = importlib.util.spec_from_file_location("data_bridge_bsl_worker", worker_path)
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    return worker


def main():
    worker = load_worker()

    def safe_eval(query, context):
        assert "sm" in context
        if query == "_":
            return Success(Deferred())
        if query == "scalar":
            return Success(42)
        if query == "column":
            return Success(Column())
        if query == "invalidAggregate":
            return Failure(SignatureValidationError(
                "SemanticAggregateOp validation failed for `aggs`: private diagnostic: /secret/model.yml"
            ))
        if query == "failure":
            return Failure(ValueError("private diagnostic: /secret/model.yml"))
        return Success(Table())

    worker.safe_eval = safe_eval
    queries = [
        {"modelPath": "/tmp/model.yml", "model": "semanticModel", "query": "sm.filter(...)", "limit": 10},
        {"modelPath": "/tmp/model.yml", "model": "semanticModel", "query": "_", "limit": 10},
        {"modelPath": "/tmp/model.yml", "model": "semanticModel", "query": "scalar", "limit": 10},
        {"modelPath": "/tmp/model.yml", "model": "semanticModel", "query": "column", "limit": 10},
        {"modelPath": "/tmp/model.yml", "model": "semanticModel", "query": "table", "limit": 10},
        {"modelPath": "/tmp/model.yml", "model": "semanticModel", "query": "invalidAggregate", "limit": 10},
        {"modelPath": "/tmp/model.yml", "model": "semanticModel", "query": "failure", "limit": 10},
    ]
    diagnostics = io.StringIO()
    with contextlib.redirect_stderr(diagnostics):
        results = worker._query_batch({"queries": queries})

    assert [result["ok"] for result in results] == [False, False, False, False, True, False, False]
    assert [results[index]["error"]["code"] for index in range(4)] == [
        worker.BSL_INVALID_SYNTAX,
        worker.BSL_DEFERRED_RESULT,
        worker.BSL_NON_TABULAR_RESULT,
        worker.BSL_NON_TABULAR_RESULT,
    ]
    assert results[4]["output"]["rows"] == [{"value": 1}]
    assert results[5]["error"] == {
        "code": worker.BSL_INVALID_ARGUMENTS,
        "message": (
            "Invalid semantic aggregation arguments: pass measure names positionally, for example "
            'aggregate("measure"); named aggregate aliases require callable expressions'
        ),
    }
    assert results[6]["error"] == {
        "code": worker.BSL_EXECUTION_FAILED,
        "message": "BSL expression could not be evaluated; check the selected model and expression",
    }
    assert "/secret/model.yml" not in str(results)
    assert "/secret/model.yml" in diagnostics.getvalue()


if __name__ == "__main__":
    main()
