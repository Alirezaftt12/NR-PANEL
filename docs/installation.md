# Fresh Master installation

The supported target is a clean Ubuntu 22.04/24.04 or Debian 12/13 VPS with systemd, `amd64`/`arm64`, root access, network access, and at least 3 GiB free disk.

Run the repository-specific raw `install.sh` command shown in the README. The bootstrap resolves `NR_PANEL_VERSION=latest` to the latest stable GitHub Release; a specific version can be selected with `NR_PANEL_VERSION=v1.0.0`. Release archives and the installer are SHA-256 verified before use. Private repositories must use a separately authenticated release download—never put a PAT in a command, README, frontend, or artifact.

The installer:

1. validates the OS, architecture, systemd, disk, network, and port;
2. preserves an existing installation and offers update/repair/status instead of overwriting it;
3. installs Docker only when a working Docker/Compose installation is absent;
4. generates independent PostgreSQL, Redis, session, encryption, OWNER, port, and web-entry secrets;
5. starts PostgreSQL and Redis and waits for health;
6. executes checksum-tracked migrations and bootstraps exactly one OWNER;
7. starts API, Web, and Nginx using pinned GHCR images;
8. registers the local VPS through the same one-time Agent enrollment flow used by remote servers;
9. installs a pinned, checksum-verified Xray release only when Xray is absent;
10. waits for database, Redis, API, Web, proxy, and authenticated Agent health before printing `NR PANEL INSTALLED`.

Directories are separated: application releases in `/opt/nr-panel`, configuration in `/etc/nr-panel`, persistent state in `/var/lib/nr-panel`, logs in `/var/log/nr-panel`, and backups in `/var/backups/nr-panel`. `/etc/nr-panel/*.env` and `install-result.env` are root-owned mode `0600`. The result file does not retain the plaintext OWNER password.

The random URL is composed automatically. Without TLS it is `http://HOST:PORT/PATH/`; HTTPS is never claimed unless a certificate is explicitly configured and validated. When public address detection fails the installer prints `PUBLIC_ADDRESS_NOT_DETECTED` rather than inventing an address.

Firewall policy is never flushed or disabled. The installer only adds the selected TCP port when `--open-firewall` is explicitly supplied, and records the managed port.
