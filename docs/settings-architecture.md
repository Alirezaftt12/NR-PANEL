# NR PANEL Master Settings Center

## Scope and separation

`/settings` is the master control center for `OWNER` and explicitly authorized `ADMIN` accounts. `RESELLER` and `SUB_RESELLER` accounts keep their isolated account-preference page and cannot enter any master route, even if a permission value is forged in a client request.

The implementation uses 3x-ui only as a feature-coverage reference. NR PANEL retains its own Fastify/Kysely/Next.js architecture, typed desired state, Agent boundary, permission model, audit log and Persian-first design. Xray behavior remains based on the NR PANEL safe apply pipeline and the official Xray configuration/API model.

## Persistence model

Migration `005_master_settings_center.sql` adds:

- `master_settings`: one complete, validated JSON document per code-defined namespace. The namespace has a database check constraint and is not an arbitrary user-defined key.
- `master_setting_secrets`: encrypted envelopes for the three supported settings secrets.
- `settings_change_history`: redacted before/after section metadata, changed field names, actor, request ID and source IP.
- `api_tokens`: one-way token hashes, non-secret prefixes, permission scopes, CIDR restrictions, expiry, last-use state and revocation state.

All reads merge a code-defined safe default with the stored document and validate it with the authoritative Zod schema. Every update validates the entire section before a transaction persists it.

## Namespaces

The implemented namespaces are:

`general`, `security`, `network`, `tls`, `xray`, `subscription`, `subscriptionFormats`, `telegram`, `email`, `notifications`, `users`, `subpanels`, `agents`, `traffic`, `backup`, `datetime`, and `updates`.

`api` is a first-class token resource rather than a settings JSON document. `advanced` is a read-only diagnostics view.

## Permissions

Every master route first requires role `OWNER` or `ADMIN`, then `SETTINGS_VIEW`. Updates additionally require the section permission:

| Permission | Sections/actions |
| --- | --- |
| `SETTINGS_GENERAL_UPDATE` | General, user defaults, sub-panel defaults, traffic, date/time |
| `SETTINGS_SECURITY_UPDATE` | Security, account credentials, API tokens |
| `SETTINGS_NETWORK_UPDATE` | Panel network, TLS, Agent defaults |
| `SETTINGS_XRAY_UPDATE` | Xray policy and desired-config validation |
| `SETTINGS_SUBSCRIPTION_UPDATE` | Subscription delivery and format adapters |
| `SETTINGS_INTEGRATIONS_UPDATE` | Telegram, SMTP and notification policy |
| `SETTINGS_BACKUP_UPDATE` | Backup policy and managed backup action |
| `SETTINGS_UPDATE_MANAGE` | Update policy and explicit checks |
| `SETTINGS_ADVANCED_VIEW` | Safe advanced diagnostics |

`OWNER` receives the existing centralized permission bypass. API tokens intentionally authenticate as scoped `ADMIN` contexts so an OWNER-created token cannot bypass its assigned token permissions.

## Secret management

Supported setting secrets are:

- `telegram.botToken`
- `email.password`
- `tls.privateKeyPath`

They use the existing AES-256-GCM credential envelope and are stored separately from normal settings. Generic settings responses return the `PRESERVE_SECRET_VALUE` sentinel and `configuredSecrets`; they never return plaintext. History and audit metadata contain only changed field names. Fastify log redaction includes all secret request fields.

Telegram connection testing calls the official HTTPS Bot API `getMe` operation. The custom endpoint and proxy fields remain fixed/unavailable until dedicated safe adapters exist. SMTP testing sends a real message through TLS or STARTTLS with logging/debug output disabled.

## Network and TLS

Network writes validate listen addresses, ports, HTTP(S) URLs, safe normalized base paths, origins and CIDRs. Network and TLS values are desired state and receive a persistent `PANEL` restart-required scope. Saving never restarts the current process or silently changes the browser connection.

The TLS status reader parses only the configured certificate file with the Node X.509 API. It exposes subject and expiry, never private-key content. The private-key path is itself treated as an encrypted secret.

## Sessions and account credentials

`AuthService` reads the persisted security policy for new session TTL, idle logout, login thresholds, lockout window, IP allowlist and password changes. Concurrent-session limits revoke the oldest excess sessions. Username changes require the current password and reject common predictable administrator names. Password changes use Argon2id and revoke other sessions.

Maintenance mode blocks non-OWNER mutations while preserving login, logout and OWNER recovery access. It does not stop Xray or disconnect VPN users.

## Xray safety

Settings do not expose raw Xray JSON execution. The validation action delegates to `InboundService.validateDesiredState`, which builds typed desired configuration and calls the configured Xray runtime validator. Inbound mutations continue to use:

`desired state → build/validate → backup → hot apply where supported → restart only when required → health check → rollback on failure`

The current application registers `UnavailableXrayRuntime`; therefore a validation/apply that needs a connected Agent fails explicitly with `503` instead of reporting success.

## Subscription behavior

The global `subscription.enabled` setting is enforced before URL creation, token rotation, enabling a user subscription and public token consumption. A configured public URL changes newly returned subscription URLs without exposing tenant or database identifiers.

Only the existing Raw link adapter is active. JSON, Clash/Mihomo, Mux, XUDP, direct-rule, User-Agent adaptation and output DNS/routing switches are visible as unavailable and their backend schemas require the safe disabled values. They cannot be toggled into a simulated success state.

Subscription tokens remain high entropy, hashed for lookup, encrypted only where an authorized account must retrieve the current URL, rotatable and revocable.

## Defaults and accounting

User defaults are loaded into the actual Inbound client drawer and applied authoritatively by `InboundService` when fields are omitted. Sub-panel defaults are loaded into the actual OWNER creation drawer. Existing users/sub-panels are not mutated.

Traffic settings do not change accounting semantics. Physical server samples and logical user quota counters remain separate. Automatic quota reset and automatic expired-user deletion remain unavailable until their schedulers are implemented.

## API endpoints

- `GET /api/v1/settings`
- `GET /api/v1/settings/:section`
- `PATCH /api/v1/settings/:section`
- `POST /api/v1/settings/:section/reset`
- `GET /api/v1/settings/:section/history`
- `POST /api/v1/settings/security/revoke-sessions`
- `POST /api/v1/settings/telegram/test`
- `POST /api/v1/settings/email/test`
- `POST /api/v1/settings/xray/validate`
- `POST /api/v1/settings/backups/run`
- `POST /api/v1/settings/updates/check`
- `GET|POST /api/v1/settings/api-tokens`
- `POST /api/v1/settings/api-tokens/:id/state`
- `DELETE /api/v1/settings/api-tokens/:id`

Every state-changing API uses CSRF protection for cookie sessions. Bearer API tokens do not use cookie CSRF semantics and are validated by token hash, expiry, state and optional CIDR before authorization.

## Restart scopes

The settings store persists pending scopes rather than automatically restarting a process:

- `PANEL`: network, TLS, date/time
- `XRAY`: Xray policy
- `AGENT`: Agent and sampling changes
- `SUBSCRIPTION`: delivery listener/public routing

The UI shows these scopes after save. A real restart button is intentionally not advertised until the whitelisted Agent/runtime operation is connected.

## Explicitly unavailable

- TOTP 2FA, because enrollment verification, hashed recovery codes and password-confirmed disable are not complete.
- JSON and Clash/Mihomo subscription adapters and advanced output transforms.
- Telegram proxy/custom API endpoint.
- Automatic user reset/cleanup schedulers.
- Managed backup execution and restore runtime.
- Signed NR PANEL release provider, prepare/update/rollback execution.
- Arbitrary service, shell, SQL, filesystem, Xray JSON or Agent command execution (permanently prohibited).

Unavailable actions return an explicit `503` and never emit a success toast.
