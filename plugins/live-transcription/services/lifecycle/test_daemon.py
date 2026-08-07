import importlib.util
import pathlib
import sys
import time
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("gpu_lifecycle", pathlib.Path(__file__).with_name("daemon.py"))
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class FakeProvider:
    def __init__(self):
        self.current = "stopped"
        self.starts = 0
        self.stops = 0
    def state(self): return self.current
    def start(self): self.starts += 1; self.current = "running"
    def stop(self): self.stops += 1; self.current = "stopped"


class ReadinessTests(unittest.TestCase):
    def test_rejects_unsafe_authentication_headers(self):
        with self.assertRaises(ValueError):
            MODULE.tcp_ready_targets(
                "ws://127.0.0.1:1/a,ws://127.0.0.1:2/b",
                [{"header": "X-Unsafe", "value": "secret"}, {"header": "Authorization", "value": "Bearer ok"}],
            )
        with self.assertRaises(ValueError):
            MODULE.tcp_ready_targets(
                "ws://127.0.0.1:1/a,ws://127.0.0.1:2/b",
                [{"header": "kyutai-api-key", "value": "bad\r\nvalue"}, {"header": "Authorization", "value": "Bearer ok"}],
            )


class ExoscaleProviderTests(unittest.TestCase):
    def test_transition_timeout_means_request_was_accepted(self):
        provider = MODULE.ExoscaleProvider("exo", "instance", "zone")
        with mock.patch.object(MODULE.subprocess, "run", side_effect=MODULE.subprocess.TimeoutExpired("exo", 20)):
            provider.start()
            provider.stop()


class LeaseControllerTests(unittest.TestCase):
    def test_cold_acquire_reuse_heartbeat_and_release(self):
        provider = FakeProvider()
        controller = MODULE.LeaseController(provider, lambda: True, lease_ttl=.1, idle_grace=.02)
        try:
            first = controller.acquire("request-1")
            duplicate = controller.acquire("request-1")
            second = controller.acquire("request-2")
            self.assertEqual(first.lease_id, duplicate.lease_id)
            self.assertNotEqual(first.lease_id, second.lease_id)
            self.assertEqual(provider.starts, 1)
            controller.heartbeat(first.lease_id)
            controller.release(first.lease_id)
            self.assertEqual(provider.stops, 0)
            controller.release(second.lease_id)
            deadline = time.time() + 3
            while provider.stops == 0 and time.time() < deadline:
                time.sleep(.02)
            self.assertEqual(provider.current, "stopped")
        finally:
            controller.close()

    def test_expired_lease_stops_provider(self):
        provider = FakeProvider()
        controller = MODULE.LeaseController(provider, lambda: True, lease_ttl=.01, idle_grace=.01)
        try:
            controller.acquire("request-1")
            deadline = time.time() + 5
            while provider.current != "stopped" and time.time() < deadline:
                time.sleep(.02)
            self.assertEqual(provider.current, "stopped")
        finally:
            controller.close()

    def test_acquire_waits_for_stopping_provider_then_restarts_it(self):
        provider = FakeProvider()
        states = iter(["stopping", "stopped", "running"])
        provider.state = lambda: next(states, "running")
        controller = MODULE.LeaseController(provider, lambda: True, idle_grace=60)
        try:
            with mock.patch.object(MODULE.time, "sleep", return_value=None):
                lease = controller.acquire("request-during-stop")
            self.assertTrue(lease.lease_id)
            self.assertEqual(provider.starts, 1)
        finally:
            controller.close()

    def test_readiness_failure_does_not_issue_lease(self):
        provider = FakeProvider()
        controller = MODULE.LeaseController(provider, lambda: False, ready_timeout=.02, idle_grace=.01)
        try:
            with self.assertRaises(RuntimeError):
                controller.acquire("request-1")
            self.assertEqual(controller.leases, {})
        finally:
            controller.close()


if __name__ == "__main__":
    unittest.main()
