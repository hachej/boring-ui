#!/usr/bin/env python3
"""Closed Browser-Use CLI adapter. It never constructs Browser-Use Agent/model objects."""
import json, subprocess, sys
CDP = "http://127.0.0.1:9222"
BASE = ["browser-use", "--cdp-url", CDP, "--session", "boring", "--json"]
def run(args):
    result = subprocess.run(BASE + args, text=True, capture_output=True, timeout=30, check=False)
    if result.returncode:
        print("browser operation failed", file=sys.stderr); raise SystemExit(1)
    print(result.stdout[:32768])
if len(sys.argv) != 2 or sys.argv[1] not in {"observe", "act"}: raise SystemExit(2)
if sys.argv[1] == "observe":
    run(["state"])
    raise SystemExit(0)
a = json.load(sys.stdin)
kind = a.get("kind"); target = a.get("target", {}).get("index")
if kind == "navigate": run(["open", a["url"]])
elif kind == "click": run(["click", str(target)])
elif kind == "type": run(["input", str(target), a["text"]])
elif kind == "select": run(["select", str(target), a["value"]])
elif kind == "upload":
    # resourceRef must be resolved to an authorized quarantine path by Host before this adapter is enabled.
    raise SystemExit("upload requires a Host resource resolver")
elif kind == "download": run(["click", str(target)])
else: raise SystemExit("unsupported action")
