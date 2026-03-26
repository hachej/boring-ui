"""Legacy compatibility shim.

Deploy-config validation moved to the TypeScript server test suite:
`src/server/__tests__/fly-deploy-config.test.ts`.

Keep this file as a visible pointer until the remaining Python test cleanup work
is handled, but do not run deploy-config validation here anymore.
"""

from __future__ import annotations

import pytest


pytestmark = pytest.mark.skip(
    reason="Deploy-config validation moved to src/server/__tests__/fly-deploy-config.test.ts"
)
