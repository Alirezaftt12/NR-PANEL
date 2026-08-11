#!/usr/bin/env bash
# shellcheck disable=SC1091
set -Eeuo pipefail
umask 077
MASTER_URL=""; JOIN_TOKEN=""; REPOSITORY="${NR_PANEL_REPOSITORY:-Alirezaftt12/NR-PANEL}"; VERSION="${NR_PANEL_VERSION:-latest}"; XRAY_VERSION="${XRAY_VERSION:-v26.3.27}"
while (($#)); do case "$1" in --master-url) MASTER_URL="${2%/}"; shift 2;; --join-token) JOIN_TOKEN="$2"; shift 2;; --repository) REPOSITORY="$2"; shift 2;; --version) VERSION="$2"; shift 2;; --skip-xray) XRAY_VERSION=""; shift;; *) printf 'Unknown option: %s\n' "$1" >&2; exit 1;; esac; done
die(){ printf 'NR SERVER ERROR: %s\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Run node installer as root (or with sudo)."
[[ -d /run/systemd/system ]] || die "systemd is required."
[[ "$MASTER_URL" =~ ^https?:// ]] || die "--master-url is required"
[[ "$JOIN_TOKEN" =~ ^nrj_[A-Za-z0-9_-]{40,}$ ]] || die "--join-token is invalid"
[[ "$REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die "Repository identity is unavailable"
WORK_DIR="$(mktemp -d)"; trap 'rm -rf -- "$WORK_DIR"' EXIT
source /etc/os-release
case "${ID}:${VERSION_ID}" in ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;; *) die "Unsupported operating system";; esac
case "$(uname -m)" in x86_64) XRAY_ARCH=64;; aarch64|arm64) XRAY_ARCH=arm64-v8a;; *) die "Unsupported architecture";; esac
export DEBIAN_FRONTEND=noninteractive; apt-get update -qq; apt-get install -y -qq ca-certificates curl jq openssl unzip gnupg >/dev/null
if ! command -v docker >/dev/null; then install -m 0755 -d /etc/apt/keyrings; curl -fsSL "https://download.docker.com/linux/$ID/gpg" | gpg --dearmor -o /etc/apt/keyrings/docker.gpg; chmod a+r /etc/apt/keyrings/docker.gpg; printf 'deb [arch=%s signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/%s %s stable\n' "$(dpkg --print-architecture)" "$ID" "$VERSION_CODENAME" >/etc/apt/sources.list.d/docker.list; apt-get update -qq; apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null; fi
systemctl enable --now docker >/dev/null
if [[ $VERSION == latest ]]; then VERSION="$(curl -fsSL "https://api.github.com/repos/$REPOSITORY/releases/latest" | jq -er .tag_name)"; fi
OWNER="${REPOSITORY%%/*}"; REPO="${REPOSITORY##*/}"; AGENT_IMAGE="ghcr.io/${OWNER,,}/${REPO,,}-agent:$VERSION"
docker pull "$AGENT_IMAGE" >/dev/null

XRAY_RESULT=NOT_INSTALLED
if [[ -n $XRAY_VERSION ]]; then
  if command -v xray >/dev/null 2>&1 || [[ -x /usr/local/bin/xray ]]; then XRAY_RESULT="EXISTING - PRESERVED";
  else
    ASSET="Xray-linux-$XRAY_ARCH.zip"; BASE="https://github.com/XTLS/Xray-core/releases/download/$XRAY_VERSION"
    curl -fL --retry 3 "$BASE/$ASSET" -o "$WORK_DIR/$ASSET"; curl -fL --retry 3 "$BASE/$ASSET.dgst" -o "$WORK_DIR/$ASSET.dgst"
    EXPECTED="$(awk -F= 'toupper($1) ~ /SHA2-256|SHA256/ {gsub(/[[:space:]]/,"",$2); print tolower($2); exit}' "$WORK_DIR/$ASSET.dgst")"; ACTUAL="$(sha256sum "$WORK_DIR/$ASSET" | awk '{print $1}')"; [[ -n $EXPECTED && $EXPECTED == "$ACTUAL" ]] || die "Xray checksum verification failed"
    unzip -q "$WORK_DIR/$ASSET" -d "$WORK_DIR/xray"; install -m 0755 "$WORK_DIR/xray/xray" /usr/local/bin/xray; install -d -m 0750 /usr/local/etc/xray /usr/local/share/xray
    [[ -f /usr/local/etc/xray/config.json ]] || printf '%s\n' '{"log":{"loglevel":"warning"},"inbounds":[],"outbounds":[{"protocol":"freedom","tag":"direct"}]}' >/usr/local/etc/xray/config.json
    [[ -f "$WORK_DIR/xray/geoip.dat" ]] && install -m 0644 "$WORK_DIR/xray/geoip.dat" /usr/local/share/xray/geoip.dat; [[ -f "$WORK_DIR/xray/geosite.dat" ]] && install -m 0644 "$WORK_DIR/xray/geosite.dat" /usr/local/share/xray/geosite.dat
    cat >/etc/systemd/system/xray.service <<'EOF'
[Unit]
Description=Xray Service managed by NR PANEL
After=network.target
[Service]
User=nobody
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ExecStart=/usr/local/bin/xray run -c /usr/local/etc/xray/config.json
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
EOF
    /usr/local/bin/xray run -test -c /usr/local/etc/xray/config.json >/dev/null; systemctl daemon-reload; systemctl enable --now xray.service; XRAY_RESULT=ONLINE
  fi
fi

jq -nc --arg token "$JOIN_TOKEN" --arg host "$(hostname)" --arg version "$VERSION" '{joinToken:$token,hostname:$host,agentVersion:$version,publicAddress:null}' >"$WORK_DIR/enroll.json"; unset JOIN_TOKEN
ENROLL="$(curl -fsS -X POST "$MASTER_URL/api/v1/agents/enroll" -H 'content-type: application/json' --data-binary "@$WORK_DIR/enroll.json")" || die "Master enrollment failed"; rm -f "$WORK_DIR/enroll.json"
AGENT_CREDENTIAL="$(jq -er .data.credential <<<"$ENROLL")"; SERVER_ID="$(jq -er .data.serverId <<<"$ENROLL")"; SERVER_NAME="$(jq -er .data.serverName <<<"$ENROLL")"; unset ENROLL
install -d -m 0750 /etc/nr-panel /var/lib/nr-panel /var/log/nr-panel
cat >/etc/nr-panel/agent.env <<EOF
MASTER_PUBLIC_URL=$MASTER_URL
AGENT_CREDENTIAL=$AGENT_CREDENTIAL
AGENT_VERSION=$VERSION
AGENT_HEARTBEAT_SECONDS=30
HOST_ROOT=/host
EOF
chmod 600 /etc/nr-panel/agent.env
cat >/etc/systemd/system/nr-agent.service <<EOF
[Unit]
Description=NR PANEL authenticated server agent
After=docker.service network-online.target
Requires=docker.service
[Service]
EnvironmentFile=/etc/nr-panel/agent.env
ExecStartPre=-/usr/bin/docker rm -f nr-panel-agent
ExecStart=/usr/bin/docker run --name nr-panel-agent --network host --pid host --uts host --read-only --cap-drop ALL --security-opt no-new-privileges --env-file /etc/nr-panel/agent.env -v /:/host:ro $AGENT_IMAGE
ExecStop=/usr/bin/docker stop -t 15 nr-panel-agent
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload; systemctl enable --now nr-agent.service
printf 'authorization: Bearer %s\n' "$AGENT_CREDENTIAL" >"$WORK_DIR/agent-header"; chmod 600 "$WORK_DIR/agent-header"
CONNECTED=0; for _ in {1..24}; do STATUS="$(curl -fsS "$MASTER_URL/api/v1/agents/status" -H "@$WORK_DIR/agent-header" | jq -r '.data.status // empty' || true)"; [[ $STATUS == ONLINE ]] && { CONNECTED=1; break; }; sleep 5; done
unset AGENT_CREDENTIAL
[[ $CONNECTED -eq 1 ]] || die "Agent started but Master did not confirm ONLINE status"
printf '\n==================================================\n          NR SERVER CONNECTED\n==================================================\n\nServer:\n%s\n\nMaster:\n%s\n\nAgent:\nONLINE\n\nAgent Version:\n%s\n\nXray:\n%s\n\nServer ID:\n%s\n\n==================================================\n' "$SERVER_NAME" "$MASTER_URL" "$VERSION" "$XRAY_RESULT" "$SERVER_ID"
