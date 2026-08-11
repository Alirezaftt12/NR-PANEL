# Adding a VPS

Open `/servers` as OWNER or an authorized ADMIN and select **افزودن سرور**. Enter a name, operational role (`ENTRY`, `EXIT`, `RELAY`, or `HYBRID`), and optional metadata. Country, region, and provider are descriptive only and never imply permissions or routing.

NR PANEL creates a `PENDING_INSTALL` record and a cryptographically random `SERVER_JOIN` token. The database stores only its SHA-256 hash. It is bound to the server and Master instance, expires after 15 minutes, and becomes permanently invalid after one exchange. Generating another command revokes all outstanding tokens for that server and writes an audit event.

The UI returns a ready-to-paste `node-install.sh` command. The node installer installs only the Agent and optional Xray—not another Master. It verifies release checksums, preserves any existing Xray configuration, exchanges the one-time token for a unique Agent credential, stores that credential in `/etc/nr-panel/agent.env` mode `0600`, and starts `nr-agent.service`.

Lifecycle:

```text
PENDING_INSTALL → REGISTERED → CONNECTING → ONLINE
```

Enrollment never marks a server online. The first authenticated heartbeat moves it to `CONNECTING`; a subsequent healthy, schema-valid heartbeat moves it to `ONLINE`. Expired heartbeats display `OFFLINE`. Possible terminal/error states are `ERROR` and `REVOKED`.

Metrics—CPU, RAM, swap, disk, load, uptime, RX/TX, sockets, OS, kernel, architecture, Agent version, and Xray state—come from the Agent. Missing values remain unavailable; no random fallback is generated. The permanent Agent credential is never included in the install result or UI.
