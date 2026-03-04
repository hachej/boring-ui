#!/usr/bin/env bash
set -euo pipefail
cd /home/sprite/app

PYTHON_BIN_DIR="$(dirname "$(python3 -c 'import sys; print(sys.executable)')")"
export PATH="/root/.bun/bin:${PYTHON_BIN_DIR}:/home/sprite/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"

# PYTHONPATH extras from site-packages
EXTRAS="$(python3 -c "
import os, site
e = []
for b in site.getsitepackages() + [site.getusersitepackages()]:
    for r in ('src/web', 'interface/boring-ui/src/back'):
        c = os.path.join(b, r)
        if os.path.isdir(c): e.append(c)
print(':'.join(e))
")"
[ -n "${EXTRAS}" ] && export PYTHONPATH="${EXTRAS}${PYTHONPATH:+:${PYTHONPATH}}"

[ -f lib/libduckdb.so ] && export LD_LIBRARY_PATH="/home/sprite/app/lib${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"

# Init a git repo as sprite so the git and file-tree modules work
if [ ! -d .git ]; then
  gosu sprite git config --global --add safe.directory /home/sprite/app
  gosu sprite git init -q
  gosu sprite git config user.email "sandbox@boring.tools"
  gosu sprite git config user.name "sandbox"
  gosu sprite git commit -q --allow-empty -m "init"
fi

export HOME=/home/sprite
export BM_WORKSPACE_ROOT=/home/sprite/app
[ -d web_static ] && export BORING_MACRO_STATIC_DIR=/home/sprite/app/web_static
[ -f companion_service/launch.sh ] && export BM_COMPANION_COMMAND="bash /home/sprite/app/companion_service/launch.sh"

# Run as non-root sprite user (claude refuses --dangerously-skip-permissions as root)
# Ensure PATH is inherited (bun/claude are in /root/.bun/bin, symlinked to /usr/local/bin)
exec gosu sprite env PATH="$PATH" HOME="$HOME" \
  PYTHONPATH="${PYTHONPATH:-}" \
  LD_LIBRARY_PATH="${LD_LIBRARY_PATH:-}" \
  BM_WORKSPACE_ROOT="$BM_WORKSPACE_ROOT" \
  BORING_MACRO_STATIC_DIR="${BORING_MACRO_STATIC_DIR:-}" \
  BM_COMPANION_COMMAND="${BM_COMPANION_COMMAND:-}" \
  BM_CHAT_PROVIDER="${BM_CHAT_PROVIDER:-}" \
  BM_COMPANION_AUTOSTART="${BM_COMPANION_AUTOSTART:-}" \
  python3 -m uvicorn src.web.backend.runtime:app \
  --host 0.0.0.0 --port 8080 --ws websockets
