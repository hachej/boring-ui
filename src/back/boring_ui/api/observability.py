"""Shared request logging and metrics helpers."""

from __future__ import annotations

import json
import logging
import threading
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any


def log_event(logger: logging.Logger, event: str, **fields: Any) -> None:
    """Emit a structured log record."""

    logger.info(event, extra={"event_name": event, "event_fields": fields})


class JsonLogFormatter(logging.Formatter):
    """Minimal JSON formatter for request/event logs."""

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        event_name = getattr(record, "event_name", "")
        if event_name:
            payload["event"] = event_name
        fields = getattr(record, "event_fields", None)
        if isinstance(fields, dict):
            payload.update(fields)
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, sort_keys=True)


def configure_structured_logging() -> None:
    """Install a JSON formatter on the root logger once."""

    root = logging.getLogger()
    if getattr(root, "_boring_ui_json_logging", False):
        return

    if not root.handlers:
        handler = logging.StreamHandler()
        root.addHandler(handler)

    for handler in root.handlers:
        handler.setFormatter(JsonLogFormatter())

    root.setLevel(logging.INFO)
    root._boring_ui_json_logging = True  # type: ignore[attr-defined]


@dataclass
class HistogramMetric:
    count: int = 0
    total: float = 0.0


@dataclass
class MetricsRegistry:
    """Tiny Prometheus-style metrics registry."""

    _lock: threading.Lock = field(default_factory=threading.Lock)
    _counters: dict[str, float] = field(default_factory=lambda: defaultdict(float))
    _gauges: dict[str, float] = field(default_factory=dict)
    _histograms: dict[str, HistogramMetric] = field(default_factory=lambda: defaultdict(HistogramMetric))

    def inc(self, name: str, amount: float = 1.0) -> None:
        with self._lock:
            self._counters[name] += amount

    def set_gauge(self, name: str, value: float) -> None:
        with self._lock:
            self._gauges[name] = value

    def observe(self, name: str, value: float) -> None:
        with self._lock:
            metric = self._histograms[name]
            metric.count += 1
            metric.total += value

    def snapshot(self) -> dict[str, Any]:
        with self._lock:
            return {
                "counters": dict(self._counters),
                "gauges": dict(self._gauges),
                "histograms": {
                    name: {"count": metric.count, "sum": metric.total}
                    for name, metric in self._histograms.items()
                },
            }

    def render_prometheus(self) -> str:
        snap = self.snapshot()
        lines: list[str] = []

        for name, value in sorted(snap["counters"].items()):
            lines.append(f"# TYPE {name} counter")
            lines.append(f"{name} {value}")

        for name, value in sorted(snap["gauges"].items()):
            lines.append(f"# TYPE {name} gauge")
            lines.append(f"{name} {value}")

        for name, metric in sorted(snap["histograms"].items()):
            lines.append(f"# TYPE {name} summary")
            lines.append(f"{name}_count {metric['count']}")
            lines.append(f"{name}_sum {metric['sum']}")

        return "\n".join(lines) + ("\n" if lines else "")


def ensure_metrics_registry(app) -> MetricsRegistry:
    """Create or return the application metrics registry."""

    registry = getattr(app.state, "metrics_registry", None)
    if registry is None:
        registry = MetricsRegistry()
        app.state.metrics_registry = registry
    return registry
