#!/bin/sh
set -eu
# Fixed protocol only. The trusted server supplies intent, opaque UUID session id, epoch, and action on stdin.
intent=${1:-}; session=${2:-}; epoch=${3:-}
case "$session" in *[!a-fA-F0-9-]*|'') exit 2;; esac
case "$epoch" in *[!0-9]*|'') exit 2;; esac
umask 077
root="${TMPDIR:-/tmp}/boring-browser-$session"; mkdir -p "$root"
pid_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
stop_pid() { [ ! -f "$1" ] || ! kill "$(cat "$1")" 2>/dev/null || true; rm -f "$1"; }
start_vnc() {
  stop_pid "$root/x11vnc.pid"
  mode=$1; extra="-viewonly"; [ "$mode" = human ] && extra=""
  # shellcheck disable=SC2086
  x11vnc -display :97 -localhost -rfbport 5900 -forever -shared -nopw $extra >"$root/x11vnc.log" 2>&1 & echo $! >"$root/x11vnc.pid"
}
case "$intent" in
 ensure)
  command -v browser-use >/dev/null; command -v chromium >/dev/null; command -v Xvfb >/dev/null; command -v x11vnc >/dev/null; command -v websockify >/dev/null; command -v curl >/dev/null
  pid_alive "$root/xvfb.pid" || { Xvfb :97 -screen 0 1280x800x24 -nolisten tcp >"$root/xvfb.log" 2>&1 & echo $! >"$root/xvfb.pid"; }
  pid_alive "$root/chromium.pid" || { DISPLAY=:97 chromium --no-first-run --disable-sync --disable-quic --disable-webrtc --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222 --user-data-dir="$root/profile" about:blank >"$root/chromium.log" 2>&1 & echo $! >"$root/chromium.pid"; }
  start_vnc agent
  pid_alive "$root/websockify.pid" || { websockify --web=/usr/share/novnc 127.0.0.1:6080 127.0.0.1:5900 >"$root/websockify.log" 2>&1 & echo $! >"$root/websockify.pid"; }
  i=0; until curl -fsS --max-time 1 http://127.0.0.1:9222/json/version >/dev/null && pid_alive "$root/websockify.pid"; do i=$((i + 1)); [ "$i" -lt 30 ] || exit 1; sleep 1; done
  ;;
 status) pid_alive "$root/chromium.pid" && pid_alive "$root/websockify.pid";;
 observe) exec python3 "$(dirname "$0")/browser_adapter.py" observe;;
 act) exec python3 "$(dirname "$0")/browser_adapter.py" act;;
 takeover) start_vnc human;;
 return) start_vnc agent;;
 stop) stop_pid "$root/websockify.pid"; stop_pid "$root/x11vnc.pid"; stop_pid "$root/chromium.pid"; stop_pid "$root/xvfb.pid"; rm -rf "$root";;
 *) exit 2;;
esac
