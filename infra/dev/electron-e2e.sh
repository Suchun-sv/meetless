#!/usr/bin/env bash
# Electron e2e smoke test in a disposable container with Xvfb (never on the host desktop).
# Uses the local Playwright image (has Xvfb + GTK/NSS libs, no Node: the test runs on Electron's Node).
# Requires: pnpm install; for MEETLESS_UI=legacy also infra/dev/deps.sh start (meetless-pg). Builds the desktop app first.
# MEETLESS_UI=expo (default) builds the Expo renderer and runs e2e-electron/expo-smoke.mjs against a
# server (MEETLESS_SMOKE_SERVER) as the sample user Alex, plus any MEETLESS_SMOKE_PATHS (MEETLESS_E2E=regression:
# e2e-electron/regression.mjs, the major-version run); MEETLESS_UI=legacy runs the old
# e2e-electron/run.mjs against its own server in meetless-dev-net.
set -euo pipefail
export PATH="$HOME/bin:$HOME/.local/bin:$PATH"
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
repo="$(cd "$(dirname "$0")/../.." && pwd)"
image="${MEETLESS_XVFB_IMAGE:-mcr.microsoft.com/playwright/python:v1.64.1-noble}"
# One container per block (contract §9): node scripts/block.mjs env <block> sets MEETLESS_XVFB_NAME.
# Warning: a leftover MEETLESS_XVFB_NAME from another block's env would remove that block's container; unset it or set your own.
name="${MEETLESS_XVFB_NAME:-meetless-xvfb}"
case "$name" in meetless-xvfb|meetless-xvfb-*) ;; *) echo "MEETLESS_XVFB_NAME must be meetless-xvfb or meetless-xvfb-<x>, not $name" >&2; exit 2 ;; esac
ui="${MEETLESS_UI:-expo}"
# Machine-local settings (server URL, its address, token file): .data/smoke.env, untracked, if present.
# shellcheck disable=SC1091
if [ -f "$repo/.data/smoke.env" ]; then set -a; . "$repo/.data/smoke.env"; set +a; fi

# Electron 45 has no postinstall download; fetch the binary if a fresh install left it out.
[ -x "$repo/apps/desktop/node_modules/electron/dist/electron" ] || (cd "$repo/apps/desktop" && node node_modules/electron/install.js)
(cd "$repo/apps/desktop" && MEETLESS_UI="$ui" pnpm build >/dev/null)
docker rm -f "$name" >/dev/null 2>&1 || true
if [ "$ui" = legacy ]; then
  script=e2e-electron/run.mjs
  net=(--network meetless-dev-net)
else
  script=e2e-electron/expo-smoke.mjs
  server="${MEETLESS_SMOKE_SERVER:?set MEETLESS_SMOKE_SERVER (or .data/smoke.env)}"
  host="$(echo "$server" | sed -E 's#^https?://([^/:]+).*#\1#')"
  export MEETLESS_SMOKE_TOKEN="${MEETLESS_SMOKE_TOKEN:-$(cat "${MEETLESS_SMOKE_TOKEN_FILE:?set MEETLESS_SMOKE_TOKEN or MEETLESS_SMOKE_TOKEN_FILE}")}"
  net=(-e MEETLESS_SMOKE_SERVER="$server" -e MEETLESS_SMOKE_TOKEN -e MEETLESS_SMOKE_PATHS)
  # A server name the container cannot resolve (a private DNS name): pin it to MEETLESS_SMOKE_SERVER_IP.
  [ -n "${MEETLESS_SMOKE_SERVER_IP:-}" ] && net+=(--add-host "$host:$MEETLESS_SMOKE_SERVER_IP")
  if [ "${MEETLESS_E2E:-}" = regression ]; then
    # The major-version run (e2e-electron/regression.mjs): the server's name is 127.0.0.1 in the container,
    # where the run forwards it to MEETLESS_SMOKE_UPSTREAM and can cut it; DocumentServer comes from
    # meetless-dev-net (MEETLESS_OFFICE_UPSTREAM, e.g. meetless-onlyoffice:80) on 127.0.0.1:55435.
    script=e2e-electron/regression.mjs
    net=(--network meetless-dev-net --add-host "$host:127.0.0.1" -e MEETLESS_SMOKE_SERVER="$server" -e MEETLESS_SMOKE_TOKEN
      -e MEETLESS_SMOKE_UPSTREAM="${MEETLESS_SMOKE_UPSTREAM:?set MEETLESS_SMOKE_UPSTREAM}" -e MEETLESS_OFFICE_UPSTREAM -e MEETLESS_TEST_PROJECT -e MEETLESS_TEST_ARTIFACT)
  fi
fi
# Xvfb is started directly (xvfb-run's readiness handshake hangs as a container entrypoint).
docker run --rm --init --name "$name" "${net[@]}" --shm-size=1g \
  -v "$repo:$repo" -w "$repo/apps/desktop" -e HOME=/tmp/home -e DISPLAY=:99 \
  -e MEETLESS_SHOTS_DIR="${MEETLESS_SHOTS_DIR:-.data/electron-shots}" -e SCRIPT="$script" \
  "$image" \
  bash -c 'Xvfb :99 -screen 0 1440x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 & for i in $(seq 50); do [ -e /tmp/.X11-unix/X99 ] && break; sleep 0.1; done; ELECTRON_RUN_AS_NODE=1 timeout 300 ./node_modules/electron/dist/electron "$SCRIPT"'
