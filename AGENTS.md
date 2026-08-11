# NR PANEL permanent engineering rules

1. Edit complete project files in the repository; do not return loose patch instructions when a task requires implementation.
2. Preserve working functionality during refactors and run lint, typecheck, tests, and build after significant changes.
3. Keep the interface Persian-first, RTL, light by default, with white cards and the subtle red-neon identity.
4. Never introduce fake production data. Development fixtures must be visibly labeled `DEMO`.
5. Never bypass backend authorization or treat hidden frontend UI as a security boundary.
6. Never trust a tenant ID, role, permission, or resource owner supplied by the frontend. Derive access from the authenticated server-side context.
7. Never weaken tenant isolation. Every tenant-owned resource lookup must authorize both the identifier and its tenant ownership.
8. Never store plaintext or recoverable passwords. Use the approved Argon2id password service.
9. Never expose raw session tokens, session hashes, password hashes, agent secrets, private keys, or subscription secrets.
10. Authorization changes require automated permission and cross-tenant tests.
11. Security-sensitive actions require audit records with actor, request ID, target, and safe metadata.
12. OWNER bootstrap must never use default credentials and must refuse a second primary OWNER.
13. Never add arbitrary shell execution. Agent actions remain strictly whitelisted.
