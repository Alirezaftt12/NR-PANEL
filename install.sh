#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
REPOSITORY="${NR_PANEL_REPOSITORY:-Alirezaftt12/NR-PANEL}"
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { printf 'Repository identity is invalid. Set NR_PANEL_REPOSITORY to the verified repository identifier.\n' >&2; exit 1; }
VERSION="${NR_PANEL_VERSION:-latest}"
if [[ "$VERSION" == latest ]]; then VERSION="$(curl -fsSL "https://api.github.com/repos/$REPOSITORY/releases/latest" | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n1)"; fi
BASE="https://github.com/$REPOSITORY/releases/download/$VERSION"; TMP="$(mktemp -d)"; trap 'rm -rf -- "$TMP"' EXIT
curl -fL --retry 3 "$BASE/nr-panel-installer.sh" -o "$TMP/install.sh"
curl -fL --retry 3 "$BASE/nr-panel-installer.sh.sha256" -o "$TMP/install.sh.sha256"
curl -fL --retry 3 "$BASE/nr-panel-installer-lib.sh" -o "$TMP/lib.sh"
curl -fL --retry 3 "$BASE/nr-panel-installer-lib.sh.sha256" -o "$TMP/lib.sh.sha256"
(cd "$TMP" && sha256sum -c install.sh.sha256 && sha256sum -c lib.sh.sha256)
NR_PANEL_REPOSITORY="$REPOSITORY" NR_PANEL_VERSION="$VERSION" exec bash "$TMP/install.sh" "$@"
