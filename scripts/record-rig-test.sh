#!/usr/bin/env bash
# Smoke-test the recording rig.
# Xvfb + playwright-headed chromium + ffmpeg x11grab.
# Drives a known-animating local page to verify we get real video frames.
set -euo pipefail

DISPLAY_NUM=:99
OUT_DIR="$(cd "$(dirname "$0")/.." && pwd)/docs/assets/readme/_recording"
mkdir -p "$OUT_DIR"
RAW="$OUT_DIR/rig-test.mp4"
PAGE="$OUT_DIR/anim.html"

# Animated test page — a pulsing dot that moves. Definitely-not-blank frames.
cat > "$PAGE" <<'HTML'
<!doctype html><html><head><style>
  body { margin:0; background:#0f172a; height:100vh; overflow:hidden; }
  .dot {
    position:absolute; top:50%; left:50%;
    width:100px; height:100px; margin:-50px;
    border-radius:50%; background:#f97316;
    animation: bounce 2s ease-in-out infinite alternate,
               pulse 0.8s ease-in-out infinite alternate;
  }
  @keyframes bounce { from { transform: translateX(-500px); } to { transform: translateX(500px); } }
  @keyframes pulse { from { transform: scale(0.7); opacity: 0.7; } to { transform: scale(1.3); opacity: 1; } }
</style></head><body><div class="dot"></div></body></html>
HTML

cleanup() {
  echo "[rig] cleanup"
  [ -n "${FFMPEG_PID:-}" ] && kill "$FFMPEG_PID" 2>/dev/null || true
  [ -n "${CHROME_PID:-}" ] && kill "$CHROME_PID" 2>/dev/null || true
  [ -n "${XVFB_PID:-}" ] && kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "[rig] starting Xvfb :99"
Xvfb "$DISPLAY_NUM" -screen 0 1280x720x24 -nolisten tcp &
XVFB_PID=$!
sleep 1

echo "[rig] launching chromium (playwright bundle) on Xvfb"
DISPLAY="$DISPLAY_NUM" /home/ubuntu/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome \
  --window-size=1280,720 --window-position=0,0 \
  --no-first-run --no-default-browser-check \
  --disable-features=Translate,site-per-process \
  --no-sandbox \
  "file://$PAGE" >/dev/null 2>&1 &
CHROME_PID=$!
sleep 3

echo "[rig] capturing 5s with ffmpeg"
ffmpeg -y -loglevel error \
  -f x11grab -framerate 24 -video_size 1280x720 -i "$DISPLAY_NUM" \
  -t 5 \
  -c:v libx264 -pix_fmt yuv420p -preset ultrafast \
  "$RAW" &
FFMPEG_PID=$!
wait "$FFMPEG_PID" || true

echo "[rig] result:"
ls -la "$RAW"
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=nb_read_frames,width,height,duration -of default=nw=1 "$RAW"
