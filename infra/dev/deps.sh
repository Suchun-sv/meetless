#!/usr/bin/env bash
# Dev/test dependencies for Meetless. Only touches resources named meetless-*.
#   infra/dev/deps.sh start     start meetless-pg (Postgres 16, 127.0.0.1:55433) and
#                               meetless-office (LibreOffice conversion, 127.0.0.1:55434; image built on first start)
#   infra/dev/deps.sh stop      stop containers (data volume kept)
#   infra/dev/deps.sh status    show meetless-* containers / volumes
#   infra/dev/deps.sh reset     remove meetless-* containers, network and volumes (DATA LOSS, meetless only)
#   infra/dev/deps.sh psql      open psql in the container
#   infra/dev/deps.sh build     (re)build the meetless-office image
#   infra/dev/deps.sh fixtures  regenerate fixtures/office/* with python-pptx/python-docx in meetless-office
set -euo pipefail
export PATH="$HOME/bin:$PATH"
export DOCKER_HOST="${DOCKER_HOST:-unix:///run/user/$(id -u)/docker.sock}"
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/compose.yaml")

case "${1:-}" in
  start)
    "${compose[@]}" up -d --wait meetless-pg meetless-office
    echo "meetless-pg ready: postgres://meetless:meetless-dev-only@127.0.0.1:55433/meetless"
    echo "meetless-office ready: http://127.0.0.1:55434 ($(curl -s http://127.0.0.1:55434/health))"
    ;;
  build) "${compose[@]}" build meetless-office ;;
  fixtures)
    out="$here/../../fixtures/office"
    mkdir -p "$out"
    docker run --rm --name meetless-office-fixtures --network none -v "$out:/out" --user 0:0 \
      meetless-office:dev python3 /opt/meetless/make_fixtures.py /out
    ;;
  stop) "${compose[@]}" stop ;;
  status)
    docker ps -a --filter name=meetless- --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
    docker volume ls --filter name=meetless- --format '{{.Name}}'
    ;;
  reset)
    # compose down -v removes only the resources declared in compose.yaml (all meetless-*).
    "${compose[@]}" down -v --remove-orphans
    ;;
  psql) docker exec -it meetless-pg psql -U meetless -d meetless ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
