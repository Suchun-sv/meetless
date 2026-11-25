#!/usr/bin/env bash
# Electron e2e smoke test in a disposable container with Xvfb (never on the host desktop).
# Uses the local Playwright image (has Xvfb + GTK/NSS libs, no Node: the test runs on Electron's Node).
# Requires: infra/dev/deps.sh start (meetless-pg), pnpm install. Builds the desktop app first.
set -euo pipefail
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
image="${MEETLESS_XVFB_IMAGE:-mcr.microsoft.com/playwright/python:v1.64.1-noble}"
# One container per block (contract §9): node scripts/block.mjs env <block> sets MEETLESS_XVFB_NAME.
# Warning: a leftover MEETLESS_XVFB_NAME from another block's env would remove that block's container; unset it or set your own.
name="${MEETLESS_XVFB_NAME:-meetless-xvfb}"
case "$name" in meetless-xvfb|meetless-xvfb-*) ;; *) echo "MEETLESS_XVFB_NAME must be meetless-xvfb or meetless-xvfb-<x>, not $name" >&2; exit 2 ;; esac

# Electron 45 has no postinstall download; fetch the binary if a fresh install left it out.
[ -x "$repo/apps/desktop/node_modules/electron/dist/electron" ] || (cd "$repo/apps/desktop" && node node_modules/electron/install.js)
(cd "$repo/apps/desktop" && pnpm build >/dev/null)
docker rm -f "$name" >/dev/null 2>&1 || true
# Xvfb is started directly (xvfb-run's readiness handshake hangs as a container entrypoint).
docker run --rm --init --name "$name" --network meetless-dev-net --shm-size=1g \
  -v "$repo:$repo" -w "$repo/apps/desktop" -e HOME=/tmp/home -e DISPLAY=:99 \
  -e MEETLESS_SHOTS_DIR="${MEETLESS_SHOTS_DIR:-.data/electron-shots}" \
  "$image" \
  bash -c 'Xvfb :99 -screen 0 1440x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & for i in $(seq 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done; ELECTRON_RUN_AS_NODE=1 timeout 300 ./node_modules/electron/dist/electron e2e-electron/run.mjs' 
