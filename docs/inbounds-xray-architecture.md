# Inbounds and safe Xray application

NR PANEL models an Inbound as the parent resource and attaches one or more VPN users through `inbound_clients`. Users, subscriptions, generated configs, and node/runtime state remain separate concerns.

## Source-of-truth boundaries

- PostgreSQL stores desired inbound state, reusable VPN-user identity, inbound membership, encrypted credentials, apply revisions, and encrypted config backups.
- Typed protocol, transport, and security adapters build Xray configuration. React never builds Xray JSON.
- The server agent is the only component allowed to validate or mutate a running Xray instance.
- The API exposes named operations only. It does not expose an endpoint that executes arbitrary Xray config or shell input.
- Subscriptions remain separate from the Inbounds aggregate; an inbound client only records whether subscription delivery is enabled.

## Apply workflow

1. Authorize the actor and scope the resource lookup to an allowed tenant.
2. Persist desired state and increment its revision.
3. Build a complete instance config through typed adapters and validate protocol/transport/security compatibility.
4. Read the applied config and compute a target-aware diff.
5. Ask the agent to run Xray's config test.
6. Encrypt and store a backup of the applied config.
7. Prefer Xray HandlerService user mutation for client-only changes.
8. Prefer HandlerService inbound replacement for typed inbound changes.
9. Restart with the complete instance config only when the runtime lacks a safe hot operation or an advanced allocation field requires it.
10. Health-check the runtime. On failure, restore the previous config and health-check the rollback.
11. Record the result in `inbound_apply_revisions` and in the security audit log.

The current `UnavailableXrayRuntime` deliberately rejects runtime actions until the signed agent transport implements the typed interface. Desired state can still be stored and its failed apply state remains visible; the panel never reports a fake runtime success.

## Adapter coverage

- Protocols: VLESS, VMess, Trojan, Shadowsocks
- Transports: RAW/TCP, WebSocket, gRPC, XHTTP (only after runtime capability confirmation)
- Security: none, TLS, REALITY
- Extra typed settings: sniffing, fallbacks, sockopt, PROXY protocol, HTTP obfuscation, trusted XFF headers, dialer/outbound and balancer references
- Advanced JSON: OWNER or authorized ADMIN only; protected typed fields cannot be overridden

## Architectural references

- [3x-ui architecture](https://github.com/MHSanaei/3x-ui/blob/main/docs/architecture.md): database-to-config pipeline, runtime abstraction, and hot-diff preference.
- [Marzban](https://github.com/Gozargah/Marzban): separation of users, subscriptions, multi-node state, and Xray-backed configuration.
- [Hiddify Manager](https://github.com/hiddify/Hiddify-Manager): operational inspiration for multi-core/node management, automatic backups, and user limits.
- [Xray API](https://xtls.github.io/en/config/api.html): HandlerService support for inbound/outbound lifecycle and user mutation.
- [Xray transport configuration](https://xtls.github.io/en/config/transport.html): protocol, transport, TLS/REALITY, and sockopt compatibility source of truth.

