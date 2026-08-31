#!/bin/sh
set -eu
umask 077
install -d -m 0700 -o boring-browser -g boring-browser /run/boring-browser /var/lib/boring-browser
password=$(python -c 'import secrets; print(secrets.token_hex(24))')
setpriv --reuid=2000 --regid=2000 --clear-groups x11vnc -storepasswd "$password" /run/boring-browser/vnc.pass >/dev/null
unset password

as_browser() { setpriv --reuid=2000 --regid=2000 --clear-groups "$@"; }
as_browser Xvfb :97 -screen 0 1280x800x24 -nolisten tcp > /run/boring-browser/xvfb.log 2>&1 &
i=0
until [ -S /tmp/.X11-unix/X97 ]; do i=$((i+1)); [ "$i" -lt 50 ] || exit 1; sleep 0.1; done
as_browser x11vnc -display :97 -localhost -rfbport 5901 -forever -shared -viewonly -rfbauth /run/boring-browser/vnc.pass > /run/boring-browser/observe-vnc.log 2>&1 &
as_browser x11vnc -display :97 -localhost -rfbport 5902 -forever -shared -rfbauth /run/boring-browser/vnc.pass > /run/boring-browser/control-vnc.log 2>&1 &
as_browser websockify --web=/usr/share/novnc 0.0.0.0:6081 127.0.0.1:5901 > /run/boring-browser/observe-web.log 2>&1 &
as_browser websockify --web=/usr/share/novnc 0.0.0.0:6082 127.0.0.1:5902 > /run/boring-browser/control-web.log 2>&1 &

cleanup() { kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM
exec setpriv --reuid=2000 --regid=2000 --clear-groups env DISPLAY=:97 HOME=/var/lib/boring-browser python /opt/boring-browser/service.py
