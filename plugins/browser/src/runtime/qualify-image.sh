#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
image=${1:-boring-browser:qualification}

# The build downloads the named wheel and verifies this exact digest before install.
grep -q 'BROWSER_USE_VERSION=0.13.8' "$root/image/Dockerfile"
grep -q 'BROWSER_USE_WHEEL_SHA256=9ea4db1b79504f028b01eec49d15cd4674929395010023f09baca45b5dacb2df' "$root/image/Dockerfile"
# Source-level fail-closed invariants.
if grep -R -E 'x11vnc .*-(nopw|usepw)' "$root/image"; then exit 1; fi
if grep -R -E 'remote-debugging-(address=0\.0\.0\.0|port=9222)' "$root/image"; then exit 1; fi
grep -q 'dedicated-uid-private-channel' "$root/qualification.json"
grep -q 'BrowserSession' "$root/image/service.py"
if grep -R -E 'browser_use.*Agent|from browser_use import Agent' "$root/image/service.py"; then exit 1; fi

docker build --network=host --pull=false -t "$image" "$root/image"
image_id=$(docker image inspect "$image" --format '{{.Id}}')
network="boring-browser-qualify-$$"
name="boring-browser-qualify-$$"
agent="boring-agent-qualify-$$"
cleanup() { docker rm -f "$name" "$agent" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
docker network create --internal "$network" >/dev/null
docker run -d --name "$name" --network "$network" "$image" >/dev/null

i=0
until docker exec "$name" test -S /run/boring-browser/control.sock; do i=$((i+1)); [ "$i" -lt 60 ] || { docker logs "$name"; exit 1; }; sleep 1; done
# Fixed service identity and private bytes.
test "$(docker exec "$name" stat -c %u:%g:%a /run/boring-browser/control.sock)" = "2000:2000:600"
test "$(docker exec "$name" stat -c %u:%g:%a /var/lib/boring-browser)" = "2000:2000:700"
docker exec "$name" sh -c "ps -eo uid,args | grep '[p]ython /opt/boring-browser/service.py' | grep '^ *2000 '" >/dev/null
docker exec "$name" sh -c "ps -eo args | grep '[x]11vnc.*5901' | grep -- '-viewonly'" >/dev/null
docker exec "$name" sh -c "ps -eo args | grep '[x]11vnc.*5902' | grep -v -- '-viewonly'" >/dev/null
if docker exec "$name" sh -c "ps -eo args | grep '[x]11vnc' | grep -- '-nopw'" >/dev/null; then exit 1; fi

invoke() {
  payload=$1
  docker exec --user 2000 "$name" python -c 'import socket,sys; s=socket.socket(socket.AF_UNIX); s.connect("/run/boring-browser/control.sock"); s.sendall((sys.argv[1]+"\n").encode()); print(s.makefile().readline(), end="")' "$payload"
}
invoke '{"v":1,"operation":"start"}' | grep -q '"status":"ok"'
# Browser-Use controls the displayed Chromium; action and observation traverse the same BrowserSession.
docker exec --user 2000 "$name" sh -c 'mkdir -p /tmp/site && printf "<title>before</title><a href=/after.html>go</a>" >/tmp/site/index.html && printf "<title>after</title>" >/tmp/site/after.html'
docker exec -d --user 2000 "$name" python -m http.server 8765 -d /tmp/site
i=0
until docker exec "$name" curl -fsS http://127.0.0.1:8765/ >/dev/null; do i=$((i+1)); [ "$i" -lt 20 ] || exit 1; sleep 1; done
invoke '{"v":1,"operation":"act","payload":{"kind":"navigate","url":"http://127.0.0.1:8765/"}}' | grep -q '"status":"ok"'
invoke '{"v":1,"operation":"observe"}' | grep -q '"title":"before"'
invoke '{"v":1,"operation":"act","payload":{"kind":"click","target":{"index":0}}}' | grep -q '"status":"ok"'
i=0
until invoke '{"v":1,"operation":"observe"}' | grep -q '"title":"after"'; do i=$((i+1)); [ "$i" -lt 20 ] || exit 1; sleep 1; done
# Browser-Use 0.13.8 uses loopback CDP internally. It is neither published nor reachable from a separately namespaced Agent.
if docker port "$name" | grep -q .; then exit 1; fi
docker run -d --name "$agent" --network none --user 1000:1000 --entrypoint /bin/sleep "$image" 120 >/dev/null
if docker exec "$agent" sh -c 'curl -fsS --max-time 1 http://127.0.0.1:9222/json/version' >/dev/null 2>&1; then exit 1; fi
test "$(docker inspect "$name" --format '{{.NetworkSettings.SandboxKey}}')" != "$(docker inspect "$agent" --format '{{.NetworkSettings.SandboxKey}}')"
if docker exec "$agent" test -e /run/boring-browser/control.sock; then exit 1; fi
if docker exec "$agent" test -e /var/lib/boring-browser/profile; then exit 1; fi
invoke '{"v":1,"operation":"stop"}' | grep -q '"status":"ok"'
if docker exec "$name" test -e /var/lib/boring-browser/profile; then exit 1; fi
printf 'qualified image=%s browser-use=0.13.8 isolation=dedicated-uid-private-channel same-chromium=passed agent-cdp-reachability=denied\n' "$image_id"
