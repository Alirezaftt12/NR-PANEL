# Multi-tenant security

`tenants` and `tenant_memberships` are the source of tenant scope. A tenant has a UUID, unique slug, status, creator, and timestamps. Reseller quota/business behavior belongs to later phases.

For every tenant-owned lookup:

1. Authenticate the opaque session.
2. Load role, permissions, account status, and tenant memberships from PostgreSQL.
3. Check the required permission.
4. Compare the resource's stored tenant ID with the trusted membership list.
5. Return a non-disclosing 403/404 without serializing the resource when access fails.
6. Audit meaningful denials with request ID and safe metadata.

Client-provided `tenantId` never expands scope. OWNER may bypass tenant membership centrally. Other roles may only access stored memberships. Tests cover cross-tenant access in both directions and a known-resource-ID/forged-tenant IDOR case.
