#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
REPOSITORY="${NR_PANEL_REPOSITORY:-Alirezaftt12/NR-PANEL}"; [[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { printf 'Repository identity is unavailable.\n' >&2; exit 1; }
VERSION="${NR_PANEL_VERSION:-latest}"; if [[ $VERSION == latest ]]; then VERSION="$(curl -fsSL "https://api.github.com/repos/$REPOSITORY/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"; fi
BASE="https://github.com/$REPOSITORY/releases/download/$VERSION"; TMP="$(mktemp -d)"; trap 'rm -rf -- "$TMP"' EXIT
curl -fL --retry 3 "$BASE/nr-panel-node-installer.sh" -o "$TMP/nr-panel-node-installer.sh"; curl -fL --retry 3 "$BASE/nr-panel-node-installer.sh.sha256" -o "$TMP/nr-panel-node-installer.sh.sha256"; (cd "$TMP" && sha256sum -c nr-panel-node-installer.sh.sha256)
NR_PANEL_REPOSITORY="$REPOSITORY" NR_PANEL_VERSION="$VERSION" exec bash "$TMP/nr-panel-node-installer.sh" "$@"
