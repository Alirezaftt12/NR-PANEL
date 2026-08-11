# NR PANEL

NR PANEL is a Persian-first, multi-tenant control plane for real Xray infrastructure. It contains a Next.js 16 interface, Fastify API, PostgreSQL security model, Redis, an authenticated Linux Agent, typed Xray desired-state management, and secure server enrollment.

## Quick Install

Ubuntu 22.04/24.04 and Debian 12/13 (`amd64` or `arm64`):

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Alirezaftt12/NR-PANEL/main/install.sh)
```

The repository is currently **private**. GitHub blocks unauthenticated `raw.githubusercontent.com` downloads from private repositories, so the command above becomes directly usable only if this repository is made public or the verified release artifacts are exposed through an authorized distribution endpoint. Never embed a GitHub Personal Access Token in this command, in the panel, or in a release artifact.

The bootstrap script resolves a stable GitHub release, verifies SHA-256 checksums, pulls pinned GHCR images, provisions PostgreSQL and Redis with generated secrets, runs migrations, creates a random OWNER credential, starts the real local Agent, and performs health checks before printing success.

The terminal prints the Panel URL, generated username, generated password, port, and path once. There is no default credential and production starts with `DEMO_MODE=false`.

Management command:

```bash
sudo nr-panel
sudo nr-panel status
sudo nr-panel show-access
sudo nr-panel reset-password
sudo nr-panel backup
sudo nr-panel update
sudo nr-panel diagnostics
```

## Architecture

```text
Nginx entry path → Next.js Web → Fastify API
                              ├─ PostgreSQL 16
                              ├─ Redis 7
                              ├─ typed Xray safe-apply pipeline
                              └─ one-time Agent enrollment
                                          │ outbound HTTPS
                              nr-agent.service + real host telemetry
```

Production never substitutes fake CPU, memory, traffic, Xray, users, servers, logs, or command success. Missing telemetry is represented as `DISCONNECTED` or `ERROR`. Development fixtures remain test-only or explicitly labeled `DEMO`.

## Development

1. Copy `.env.example` to `.env` and replace the development secrets.
2. Run `npm install`.
3. Start PostgreSQL and Redis with `npm run db:up`.
4. Run `npm run db:migrate` and `npm run bootstrap:owner`.
5. Run `npm run dev`.

Quality commands: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`.

Documentation: [installation](docs/installation.md), [server join](docs/server-join.md), [updates](docs/update.md), [recovery](docs/recovery.md), and [uninstall](docs/uninstall.md).
