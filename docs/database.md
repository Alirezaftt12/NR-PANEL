# Database

PostgreSQL is the source of truth. Kysely provides strongly typed queries; production never relies on automatic schema synchronization.

## Local setup

```powershell
npm run db:up
npm run db:migrate
```

`docker-compose.yml` provides PostgreSQL 16 and Redis 7. Migration files are not mounted into PostgreSQL's one-time init directory; the migration runner records filenames and SHA-256 checksums in `nr_migrations`, executes each migration in a transaction, and rejects changes to already-applied files.

Security tables include `admins`, `roles`, `permissions`, `role_permissions`, `admin_permissions`, `tenants`, `tenant_memberships`, `sessions`, `login_attempts`, and `audit_logs`. Practical indexes cover normalized identifiers, session hashes/expiry, memberships, permissions, audit time/actor/tenant, and failed-login windows.

Roles and permission definitions are seeded idempotently by migration `002_security_foundation.sql`. No OWNER credentials are seeded.

Environment requirements are documented in `.env.example`. Production credentials and `SESSION_SECRET` must come from a secrets manager.
