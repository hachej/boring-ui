from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> int:
    workspace = Path(os.environ.get("BORING_AGENT_WORKSPACE_ROOT", "")).resolve()
    payload = {
        "ok": True,
        "workspace": str(workspace),
        "customEnv": os.environ.get("BORING_PROVISION_TEST_ENV"),
        "args": sys.argv[1:],
        "templateFileExists": (workspace / "seed" / "hello.txt").is_file(),
    }
    print(json.dumps(payload, sort_keys=True))
    return 0
