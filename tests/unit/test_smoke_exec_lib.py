from __future__ import annotations

from tests.smoke.smoke_lib import exec as exec_module


def test_collect_job_output_concatenates_string_chunk_data() -> None:
    assert exec_module.collect_job_output(
        [
            "hello ",
            {"stream": "stderr", "data": ""},
            "world",
            {"stream": "stdout", "data": None},
        ]
    ) == "hello world"


def test_wait_for_exec_job_polls_until_done(monkeypatch) -> None:
    class _FakeClient:
        def set_phase(self, _phase: str) -> None:
            return None

    responses = iter(
        [
            {"chunks": ["hello "], "cursor": 1, "done": False},
            {"chunks": ["world"], "cursor": 2, "done": True, "exit_code": 0},
        ]
    )

    monkeypatch.setattr(exec_module, "read_exec_job", lambda client, job_id, after=None: next(responses))
    monkeypatch.setattr(exec_module.time, "sleep", lambda _delay: None)

    result = exec_module.wait_for_exec_job(_FakeClient(), "job-1", timeout_seconds=1.0, poll_interval=0.01)

    assert result["done"] is True
    assert result["exit_code"] == 0
    assert result["combined_output"] == "hello world"
