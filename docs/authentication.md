# Authentication

NR PANEL uses PostgreSQL-backed accounts and server-side sessions. Passwords are hashed with Argon2id using the centralized service in `apps/api/src/lib/security.ts`.

## Login flow

1. The browser posts `identifier` and `password` to `/api/v1/auth/login` with `x-nr-csrf: 1`.
2. The API normalizes the username/email and applies both Fastify IP rate limiting and account/IP failure-window checks.
3. Unknown accounts perform a dummy Argon2id verification to reduce account-enumeration timing differences.
4. All failures return the generic `AUTH_INVALID_CREDENTIALS` response.
5. A successful login creates 32 random bytes as an opaque token. Only an HMAC-SHA256 hash of that token is stored in `sessions`.
6. The raw token is returned only as the `nr_session` HttpOnly, SameSite=Strict cookie. Production also sets `Secure`.

Sessions have absolute and idle expiration, last-activity tracking, IP/user-agent metadata, revocation timestamps, and database enforcement of account status. Logout revokes the current session; logout-all revokes every session. Password changes retain the current session and revoke the others.

## CSRF and CORS

Cookie-authenticated state-changing requests require the non-simple `x-nr-csrf: 1` header. Browser Origins, when present, must equal `WEB_ORIGIN`. SameSite=Strict cookies and exact credentialed CORS provide additional layers. Agent HMAC endpoints are not browser-cookie endpoints and are exempt from the browser CSRF header.

## OWNER bootstrap

No account or default password is seeded. After migrations:

```powershell
$env:OWNER_USERNAME='your-owner-name'
$env:OWNER_EMAIL='owner@example.com'
$env:OWNER_PASSWORD='a-unique-strong-password'
npm run bootstrap:owner
```

The command does not print the password and uses a PostgreSQL advisory transaction lock. It refuses to create a second primary OWNER.
