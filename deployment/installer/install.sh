#!/usr/bin/env bash
# shellcheck disable=SC1091,SC2016
set -Eeuo pipefail
umask 077
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
NR_PANEL_INSTALL_LIB_ONLY=1 source "$SCRIPT_DIR/lib.sh"

REPOSITORY="${NR_PANEL_REPOSITORY:-Alirezaftt12/NR-PANEL}"
VERSION="${NR_PANEL_VERSION:-latest}"
DOMAIN=""; PUBLIC_ADDRESS=""; REQUESTED_PORT=""; UPDATE=0; OPEN_FIREWALL=0
while (($#)); do case "$1" in --repository) REPOSITORY="$2"; shift 2;; --version) VERSION="$2"; shift 2;; --domain) DOMAIN="$2"; shift 2;; --public-address) PUBLIC_ADDRESS="$2"; shift 2;; --port) REQUESTED_PORT="$2"; shift 2;; --open-firewall) OPEN_FIREWALL=1; shift;; --update) UPDATE=1; shift;; *) nr_die "Unknown option: $1";; esac; done
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || nr_die "Repository identity is unavailable. Set NR_PANEL_REPOSITORY to the verified repository identifier; never embed a private GitHub token."
[[ $EUID -eq 0 ]] || nr_die "Run the installer as root (or with sudo)."
[[ -d /run/systemd/system ]] || nr_die "systemd is required."
source /etc/os-release
case "${ID}:${VERSION_ID}" in ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;; *) nr_die "Unsupported operating system: ${PRETTY_NAME:-unknown}";; esac
case "$(uname -m)" in x86_64|aarch64|arm64) :;; *) nr_die "Unsupported architecture: $(uname -m)";; esac
(( $(df -Pk / | awk 'NR==2{print $4}') > 3145728 )) || nr_die "At least 3 GiB free disk space is required."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg jq openssl tar gzip unzip iproute2 >/dev/null
curl -fsS --connect-timeout 10 https://api.github.com/ >/dev/null || nr_die "Working network access to GitHub is required."
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/%s %s stable\n' "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" >/etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null

if [[ -e /etc/nr-panel/install-result.env && $UPDATE -eq 0 ]]; then
  printf 'Existing NR PANEL detected\n1. Update\n2. Repair\n3. Show Status\n4. Exit\n> '
  read -r choice
  case "$choice" in 1) exec /usr/local/bin/nr-panel update;; 2) UPDATE=1;; 3) exec /usr/local/bin/nr-panel status;; *) exit 0;; esac
fi

if [[ $VERSION == latest ]]; then VERSION="$(curl -fsSL "https://api.github.com/repos/$REPOSITORY/releases/latest" | jq -er .tag_name)" || nr_die "No stable GitHub release was found"; fi
[[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$ ]] || nr_die "Invalid release version: $VERSION"
OWNER="${REPOSITORY%%/*}"; REPO="${REPOSITORY##*/}"; OWNER_LOWER="${OWNER,,}"; REPO_LOWER="${REPO,,}"
IMAGE_PREFIX="ghcr.io/$OWNER_LOWER/$REPO_LOWER"
RELEASE_BASE="https://github.com/$REPOSITORY/releases/download/$VERSION"
ASSET="nr-panel-release-$VERSION.tar.gz"; TEMP_DIR="$(mktemp -d)"; trap 'rm -rf -- "$TEMP_DIR"' EXIT
curl -fL --retry 3 "$RELEASE_BASE/$ASSET" -o "$TEMP_DIR/$ASSET"
curl -fL --retry 3 "$RELEASE_BASE/SHA256SUMS" -o "$TEMP_DIR/SHA256SUMS"
(cd "$TEMP_DIR" && grep "  $ASSET$" SHA256SUMS | sha256sum -c -) || nr_die "Release checksum verification failed"

for directory in /opt/nr-panel/releases /etc/nr-panel /var/lib/nr-panel/postgres /var/lib/nr-panel/redis /var/log/nr-panel /var/backups/nr-panel; do install -d -m 0750 "$directory"; done
RELEASE_DIR="/opt/nr-panel/releases/$VERSION"; install -d -m 0750 "$RELEASE_DIR"; tar -xzf "$TEMP_DIR/$ASSET" -C "$RELEASE_DIR"
[[ -f "$RELEASE_DIR/deployment/compose/compose.production.yml" ]] || nr_die "Release artifact is incomplete"
PREVIOUS_TARGET="$(readlink -f /opt/nr-panel/current 2>/dev/null || true)"; ln -sfn "$RELEASE_DIR" /opt/nr-panel/current

if [[ -r /etc/nr-panel/install-result.env ]]; then set -a; source /etc/nr-panel/install-result.env; set +a; fi
if [[ -r /etc/nr-panel/compose.env ]]; then set -a; source /etc/nr-panel/compose.env; set +a; fi
PREVIOUS_VERSION="${NR_PANEL_VERSION:-}"
if [[ -r /etc/nr-panel/production.env ]]; then set -a; source /etc/nr-panel/production.env; set +a; fi
if [[ -z $REQUESTED_PORT && -z ${PANEL_PORT:-} && -t 0 ]]; then
  printf 'Panel port:\n1. Automatic secure/random port (default)\n2. Custom port\n> '
  read -r port_choice
  if [[ $port_choice == 2 ]]; then read -r -p 'Custom unprivileged TCP port: ' REQUESTED_PORT; elif [[ -n $port_choice && $port_choice != 1 ]]; then nr_die "Invalid port selection"; fi
fi
if [[ -n $REQUESTED_PORT ]]; then nr_port_free "$REQUESTED_PORT" || nr_die "Requested port is invalid or occupied"; PANEL_PORT="$REQUESTED_PORT"; elif [[ -z ${PANEL_PORT:-} ]]; then PANEL_PORT="$(nr_random_port)" || nr_die "Could not allocate a free port"; fi
PANEL_PATH="${PANEL_PATH:-$(nr_random_path)}"; PANEL_PATH="$(nr_normalize_path "$PANEL_PATH")" || nr_die "Generated path is invalid"
OWNER_USERNAME="${OWNER_USERNAME:-nr_$(openssl rand -hex 8)}"; INITIAL_OWNER_PASSWORD=""; if [[ $UPDATE -eq 0 ]]; then OWNER_PASSWORD="$(nr_random_secret 24)"; INITIAL_OWNER_PASSWORD="$OWNER_PASSWORD"; fi
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 24)}"; REDIS_PASSWORD="${REDIS_PASSWORD:-$(openssl rand -hex 24)}"; SESSION_SECRET="${SESSION_SECRET:-$(nr_random_secret 48)}"; CONFIG_ENCRYPTION_KEY="${CONFIG_ENCRYPTION_KEY:-$(nr_random_secret 48)}"
DISCOVERED_ADDRESS="${PUBLIC_ADDRESS:-$(curl -4 -fsS --max-time 8 https://api.ipify.org || true)}"; [[ -n $DISCOVERED_ADDRESS ]] || DISCOVERED_ADDRESS="$(hostname -I | awk '{print $1}')"
[[ -z $DISCOVERED_ADDRESS ]] || nr_valid_host "$DISCOVERED_ADDRESS" || nr_die "Detected public address is invalid"
[[ -z $DOMAIN ]] || nr_valid_host "$DOMAIN" || nr_die "Domain is invalid"
SERVER_ADDRESS="${DISCOVERED_ADDRESS:-PUBLIC_ADDRESS_NOT_DETECTED}"
if [[ -n $DOMAIN ]]; then PANEL_HOST="$DOMAIN"; elif [[ -n $DISCOVERED_ADDRESS ]]; then PANEL_HOST="$DISCOVERED_ADDRESS"; else PANEL_HOST=127.0.0.1; fi
PANEL_SCHEME=http; PANEL_URL="$(nr_compose_url "$PANEL_SCHEME" "$PANEL_HOST" "$PANEL_PORT" "$PANEL_PATH")"
URL_HOST="$(nr_url_host "$PANEL_HOST")"
NODE_INSTALL_URL="https://raw.githubusercontent.com/$REPOSITORY/main/node-install.sh"

cat >/etc/nr-panel/production.env <<EOF
NODE_ENV=production
DEMO_MODE=false
API_PORT=4000
WEB_ORIGIN=http://$URL_HOST:$PANEL_PORT
SESSION_SECRET=$SESSION_SECRET
CONFIG_ENCRYPTION_KEY=$CONFIG_ENCRYPTION_KEY
SUBSCRIPTION_PUBLIC_BASE_URL=http://$URL_HOST:$PANEL_PORT/api/v1/sub
MASTER_PUBLIC_URL=${PANEL_URL%/}
NR_PANEL_NODE_INSTALL_URL=$NODE_INSTALL_URL
SERVER_JOIN_TTL_SECONDS=900
PANEL_VERSION=$VERSION
EOF
cat >/etc/nr-panel/compose.env <<EOF
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
REDIS_PASSWORD=$REDIS_PASSWORD
NR_PANEL_IMAGE_PREFIX=$IMAGE_PREFIX
NR_PANEL_VERSION=$VERSION
PANEL_PORT=$PANEL_PORT
PANEL_PATH=$PANEL_PATH
NR_PANEL_DATA_DIR=/var/lib/nr-panel
NR_PANEL_CONFIG_DIR=/etc/nr-panel
NR_PANEL_CURRENT_DIR=/opt/nr-panel/current
EOF
chmod 600 /etc/nr-panel/production.env /etc/nr-panel/compose.env
COMPOSE=(docker compose --env-file /etc/nr-panel/compose.env -f /opt/nr-panel/current/deployment/compose/compose.production.yml)
rollback_release(){
  [[ -n $PREVIOUS_TARGET ]] || return 0
  ln -sfn "$PREVIOUS_TARGET" /opt/nr-panel/current
  [[ -z $PREVIOUS_VERSION ]] || nr_atomic_env_set /etc/nr-panel/compose.env NR_PANEL_VERSION "$PREVIOUS_VERSION"
  docker compose --env-file /etc/nr-panel/compose.env -f /opt/nr-panel/current/deployment/compose/compose.production.yml up -d api web proxy >/dev/null 2>&1 || true
}
if [[ $UPDATE -eq 1 && -n $PREVIOUS_TARGET ]]; then /usr/local/bin/nr-panel backup; fi
"${COMPOSE[@]}" pull
"${COMPOSE[@]}" up -d postgres redis
for _ in {1..40}; do "${COMPOSE[@]}" exec -T postgres pg_isready -U nrpanel -d nrpanel >/dev/null 2>&1 && "${COMPOSE[@]}" exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" ping' 2>/dev/null | grep -q PONG && break; sleep 3; done
"${COMPOSE[@]}" exec -T postgres pg_isready -U nrpanel -d nrpanel >/dev/null || nr_die "PostgreSQL health check failed"
"${COMPOSE[@]}" run --rm api node apps/api/dist/scripts/migrate.js
if [[ $UPDATE -eq 0 ]]; then export OWNER_USERNAME OWNER_PASSWORD; "${COMPOSE[@]}" run --rm -e OWNER_USERNAME -e OWNER_PASSWORD api node apps/api/dist/scripts/bootstrap-owner.js >/dev/null; unset OWNER_PASSWORD; fi
"${COMPOSE[@]}" up -d api web proxy
for _ in {1..40}; do curl -fsS "http://127.0.0.1:$PANEL_PORT/healthz" >/dev/null && curl -fsS "http://127.0.0.1:$PANEL_PORT/$PANEL_PATH/" >/dev/null && break; sleep 3; done
curl -fsS "http://127.0.0.1:$PANEL_PORT/healthz" >/dev/null || { rollback_release; nr_die "Application health check failed; previous release restored"; }

if [[ $UPDATE -eq 0 ]]; then
  JOIN_JSON="$("${COMPOSE[@]}" run --rm -e LOCAL_SERVER_NAME='Local Server' api node apps/api/dist/scripts/bootstrap-local-server.js)"
  JOIN_TOKEN="$(jq -er .joinToken <<<"$JOIN_JSON")"
  unset JOIN_JSON
  NR_PANEL_REPOSITORY="$REPOSITORY" NR_PANEL_VERSION="$VERSION" bash /opt/nr-panel/current/deployment/installer/node-install.sh --master-url "http://127.0.0.1:$PANEL_PORT" --join-token "$JOIN_TOKEN"
  unset JOIN_TOKEN
fi

install -m 0755 /opt/nr-panel/current/deployment/installer/nr-panel /usr/local/bin/nr-panel
cat >/etc/nr-panel/install-result.env <<EOF
PANEL_URL=$PANEL_URL
PANEL_SCHEME=$PANEL_SCHEME
PANEL_HOST=$PANEL_HOST
PANEL_PORT=$PANEL_PORT
PANEL_PATH=$PANEL_PATH
OWNER_USERNAME=$OWNER_USERNAME
NR_PANEL_VERSION=$VERSION
NR_PANEL_REPOSITORY=$REPOSITORY
SERVER_ADDRESS=$SERVER_ADDRESS
EOF
chown root:root /etc/nr-panel/install-result.env; chmod 600 /etc/nr-panel/install-result.env

if [[ $OPEN_FIREWALL -eq 1 ]]; then
  if command -v ufw >/dev/null && ufw status | grep -q '^Status: active'; then ufw allow "$PANEL_PORT/tcp" comment 'NR PANEL managed'; printf '%s\n' "$PANEL_PORT" >/etc/nr-panel/firewall-managed; elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then firewall-cmd --permanent --add-port="$PANEL_PORT/tcp"; firewall-cmd --reload; printf '%s\n' "$PANEL_PORT" >/etc/nr-panel/firewall-managed; fi
fi
printf '\n==================================================\n              NR PANEL INSTALLED\n==================================================\n\nPanel URL:\n%s\n\nUsername:\n%s\n\nPassword:\n%s\n\nPort:\n%s\n\nPath:\n/%s/\n\nServer IP:\n%s\n\nNR PANEL CLI:\nnr-panel\n\n==================================================\n' "$PANEL_URL" "$OWNER_USERNAME" "${INITIAL_OWNER_PASSWORD:-Password unchanged during update}" "$PANEL_PORT" "$PANEL_PATH" "$SERVER_ADDRESS"
