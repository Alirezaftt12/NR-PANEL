#!/usr/bin/env bash
set -Eeuo pipefail

nr_die(){ printf 'NR PANEL ERROR: %s\n' "$*" >&2; exit 1; }
nr_is_port(){ [[ "${1:-}" =~ ^[0-9]+$ ]] && (( 10#$1 >= 1024 && 10#$1 <= 65535 )); }
nr_port_free(){ nr_is_port "$1" && ! ss -H -ltn "sport = :$1" 2>/dev/null | grep -q .; }
nr_normalize_path(){ local value="${1#/}"; value="${value%/}"; [[ "$value" =~ ^[A-Za-z0-9_-]{18,64}$ ]] || return 1; printf '%s' "$value"; }
nr_valid_host(){ [[ "${1:-}" =~ ^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$ ]]; }
nr_url_host(){ local host="$1"; [[ "$host" == *:* && "$host" != \[*\] ]] && printf '[%s]' "$host" || printf '%s' "$host"; }
nr_compose_url(){ local scheme="$1" host="$2" port="$3" path="$4"; printf '%s://%s:%s/%s/' "$scheme" "$(nr_url_host "$host")" "$port" "$path"; }
nr_random_port(){ local candidate; for _ in {1..100}; do candidate="$(shuf -i 20000-55000 -n 1)"; nr_port_free "$candidate" && { printf '%s' "$candidate"; return; }; done; return 1; }
nr_random_path(){ openssl rand -base64 32 | tr -d '=+/\n' | cut -c1-24; }
nr_random_secret(){ openssl rand -base64 "${1:-32}" | tr -d '\n'; }
nr_atomic_env_set(){ local file="$1" key="$2" value="$3" temp; temp="$(mktemp)"; awk -v key="$key" -v value="$value" 'BEGIN{done=0} $0 ~ "^"key"=" {print key"="value;done=1;next} {print} END{if(!done)print key"="value}' "$file" >"$temp"; install -m 600 "$temp" "$file"; rm -f "$temp"; }
if [[ "${NR_PANEL_INSTALL_LIB_ONLY:-0}" == 1 ]]; then
  return 0 2>/dev/null || exit 0
fi
