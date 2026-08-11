# Authorization

Permissions are centralized in `packages/shared/src/index.ts`. Raw permission strings must not be scattered through handlers or components.

Roles:

- `OWNER`: centralized backend bypass for all application permissions; all sensitive actions remain audited.
- `ADMIN`: receives only explicitly assigned role or individual permissions.
- `RESELLER`: receives explicit permissions and tenant memberships.
- `SUB_RESELLER`: schema foundation only; creation is disabled by default.

Fastify authorization primitives are defined in `apps/api/src/lib/auth.ts`:

- `requireAuth`
- `requireRole`
- `requirePermission`
- `requireTenantAccess`

The trusted request context contains only database-derived `userId`, `role`, `permissions`, `tenantIds`, and `sessionId`. Frontend navigation filtering is a usability feature; direct API requests still pass through backend guards.

OWNER accounts cannot be created or changed through normal admin-management routes. Non-OWNER users cannot modify administrators, and the primary OWNER cannot be disabled through `/admins/:id`.
