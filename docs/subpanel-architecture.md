# NR PANEL Sub Panel architecture

## Security boundary

The reseller portal is a tenant-scoped user-management surface. Its authenticated API is rooted at `/api/v1/subpanel/*` and accepts only `RESELLER` or `SUB_RESELLER` sessions. The tenant identifier is never accepted from the browser: `AuthContext.primaryTenantId` is loaded from `admins.tenant_id` for the authenticated session and is used for every portal query.

Infrastructure mutations remain on the master API. Sub-panel roles cannot create or edit servers, Xray instances, inbounds, transports, security, routing, outbounds, agents, backups, or system settings. Hiding those controls in React is only a presentation detail; the backend role checks are the security boundary.

## OWNER assignments

`subpanel_server_assignments` and `subpanel_inbound_assignments` are OWNER-written allowlists. Every assigned inbound must belong to an allowed server. A reseller can create a user only when the inbound assignment exists for its primary tenant and the inbound protocol is included in `subpanel_settings.allowed_protocols`.

Optional capabilities are stored per tenant:

- subscription delivery
- traffic reset
- expiration extension
- credential rotation

The API enforces these capabilities before mutations and secret delivery.

## Transactional user creation

User creation runs in one database transaction:

1. lock the tenant quota row;
2. verify tenant status and expiration;
3. calculate user count and allocated traffic;
4. reject with `USER_LIMIT_EXCEEDED` or `TRAFFIC_QUOTA_EXCEEDED` when required;
5. verify the OWNER-assigned inbound and allowed protocol;
6. generate the protocol credential and typed client URI;
7. insert `vpn_users`, `inbound_clients`, encrypted config artifact, and optional hashed/encrypted subscription token;
8. mark the inbound desired revision pending;
9. commit the desired state and its audit event;
10. invoke the existing validated Xray apply pipeline for that inbound.

The apply pipeline validates and backs up the Xray document, prefers hot client mutation, health-checks the result, and rolls back after an apply failure. A disconnected runtime is reported explicitly; it is never reported as a successful apply.

## Quota semantics

Allocated traffic is `SUM(vpn_users.traffic_limit)` for the tenant. Actual traffic used is `SUM(vpn_users.traffic_used)`. They are deliberately separate values. Traffic reset changes current counters but does not erase aggregate history.

User expiration may not exceed the sub-panel expiration. Disabled or expired panels reject user mutations with `SUBPANEL_EXPIRED`.

## Subscription and config delivery

Generated credentials, config URIs, and recoverable subscription tokens use AES-256-GCM envelopes at rest. Subscription lookup uses an HMAC hash. Raw subscription tokens are not returned by list endpoints or written to logs; an authorized tenant user can request its own link, and token rotation invalidates the previous hash immediately. The public subscription endpoint returns only the generated client URI and does not accept or execute arbitrary Xray JSON.

## Real-data behavior

Dashboard and traffic endpoints query assigned servers, Xray instances, traffic samples, aggregates, and tenant counters. Missing metrics are returned as `null` with `DISCONNECTED`; the portal does not synthesize successful or live production data.
