import { permissionValues, ROLES, type Permission, type Role } from "@nr/shared";
import { sql, type Transaction } from "kysely";
import { AUDIT_ACTIONS } from "../domain/audit-actions.js";
import { assertAdminMutationAllowed } from "../domain/admin-policy.js";
import type { AuditEventInput, LoginAdmin, SessionRecord } from "../domain/identity.js";
import { ApiError } from "../lib/errors.js";
import type { AuthRepository, NewSession, SessionSummary } from "../services/auth-repository.js";
import type { Database } from "./client.js";
import type { SecurityDatabase } from "./types.js";

type Executor = Database | Transaction<SecurityDatabase>;

export type CreateAdminInput = {
  username: string;
  email: string | null;
  passwordHash: string;
  role: Exclude<Role, "OWNER">;
  tenantId: string;
  permissions: Permission[];
  actorId: string;
  actorRole: Role;
  requestId: string;
  ip: string | null;
};

export type UpdateAdminInput = {
  role?: Exclude<Role, "OWNER">;
  status?: "ACTIVE" | "DISABLED";
  permissions?: Permission[];
  actorId: string;
  actorRole: Role;
  requestId: string;
  ip: string | null;
};

function auditValues(event: AuditEventInput) {
  return {
    severity: event.severity ?? "info" as const,
    category: event.category ?? "SECURITY" as const,
    actor_id: event.actorId,
    actor_role: event.actorRole,
    tenant_id: event.tenantId ?? null,
    server_id: null,
    ip: event.ip ?? null,
    action: event.action,
    message: event.message,
    target_type: event.targetType ?? null,
    target_id: event.targetId ?? null,
    request_id: event.requestId ?? null,
    metadata: event.metadata ?? {},
  };
}

export class KyselySecurityRepository implements AuthRepository {
  constructor(private readonly database: Database) {}

  async findAdminByIdentifier(identifier: string): Promise<LoginAdmin | null> {
    const row = await this.database
      .selectFrom("admins")
      .innerJoin("roles", "roles.id", "admins.role_id")
      .select([
        "admins.id",
        "admins.username",
        "admins.email",
        "admins.password_hash as passwordHash",
        "admins.status",
        "admins.enabled",
        "admins.tenant_id as tenantId",
        "roles.name as role",
      ])
      .where((builder) => builder.or([
        builder("admins.username", "=", identifier),
        builder("admins.email", "=", identifier),
      ]))
      .executeTakeFirst();
    return row ?? null;
  }

  async countRecentFailures(identifierHash: string, ip: string | null, since: Date) {
    let query = this.database
      .selectFrom("login_attempts")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("successful", "=", false)
      .where("attempted_at", ">=", since);
    query = ip
      ? query.where((builder) => builder.or([builder("identifier_hash", "=", identifierHash), builder("ip", "=", ip)]))
      : query.where("identifier_hash", "=", identifierHash);
    const result = await query.executeTakeFirstOrThrow();
    return Number(result.count);
  }

  async recordLoginFailure(identifierHash: string, metadata: NewSession["metadata"], reason: string) {
    await this.database.transaction().execute(async (transaction) => {
      await transaction.insertInto("login_attempts").values({
        identifier_hash: identifierHash,
        ip: metadata.ip,
        successful: false,
        failure_reason: reason,
      }).execute();
      await transaction.insertInto("audit_logs").values(auditValues({
        actorId: null,
        actorRole: null,
        action: AUDIT_ACTIONS.AUTH_LOGIN_FAILED,
        targetType: "authentication",
        ip: metadata.ip,
        requestId: metadata.requestId,
        severity: "warning",
        message: "Authentication failed",
        metadata: { identifierHash, reason },
      })).execute();
    });
  }

  async createLoginSession(admin: LoginAdmin, session: NewSession) {
    await this.database.transaction().execute(async (transaction) => {
      await transaction.insertInto("sessions").values({
        id: session.id,
        admin_id: admin.id,
        token_hash: session.tokenHash,
        ip: session.metadata.ip,
        user_agent: session.metadata.userAgent,
        expires_at: session.expiresAt,
        revoked_at: null,
        last_activity_at: new Date(),
      }).execute();
      await transaction.updateTable("admins").set({ last_login_at: new Date(), last_activity_at: new Date(), failed_login_count: 0 }).where("id", "=", admin.id).execute();
      await transaction.insertInto("login_attempts").values({ identifier_hash: sql<string>`encode(digest(${admin.username}, 'sha256'), 'hex')`, ip: session.metadata.ip, successful: true, failure_reason: null }).execute();
      await transaction.insertInto("audit_logs").values(auditValues({
        actorId: admin.id,
        actorRole: admin.role,
        action: admin.role === ROLES.RESELLER || admin.role === ROLES.SUB_RESELLER ? AUDIT_ACTIONS.SUBPANEL_LOGIN : AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
        targetType: "session",
        targetId: session.id,
        ip: session.metadata.ip,
        requestId: session.metadata.requestId,
        message: "Authentication succeeded",
      })).execute();
    });
  }

  async resolveSession(tokenHash: string): Promise<SessionRecord | null> {
    const row = await this.database
      .selectFrom("sessions")
      .innerJoin("admins", "admins.id", "sessions.admin_id")
      .innerJoin("roles", "roles.id", "admins.role_id")
      .select([
        "sessions.id",
        "sessions.admin_id as adminId",
        "sessions.expires_at as expiresAt",
        "sessions.revoked_at as revokedAt",
        "sessions.last_activity_at as lastActivityAt",
        "admins.username",
        "admins.email",
        "admins.status as adminStatus",
        "admins.enabled",
        "admins.tenant_id as tenantId",
        "roles.name as role",
      ])
      .where("sessions.token_hash", "=", tokenHash)
      .executeTakeFirst();
    return row ?? null;
  }

  async getPermissions(adminId: string): Promise<Permission[]> {
    const [rolePermissions, adminPermissions] = await Promise.all([
      this.database
        .selectFrom("admins")
        .innerJoin("role_permissions", "role_permissions.role_id", "admins.role_id")
        .innerJoin("permissions", "permissions.id", "role_permissions.permission_id")
        .select("permissions.code")
        .where("admins.id", "=", adminId)
        .execute(),
      this.database
        .selectFrom("admin_permissions")
        .innerJoin("permissions", "permissions.id", "admin_permissions.permission_id")
        .select("permissions.code")
        .where("admin_permissions.admin_id", "=", adminId)
        .execute(),
    ]);
    return [...new Set([...rolePermissions, ...adminPermissions].map((entry) => entry.code))];
  }

  async getTenantIds(adminId: string) {
    const [admin, memberships] = await Promise.all([
      this.database.selectFrom("admins").select("tenant_id").where("id", "=", adminId).executeTakeFirst(),
      this.database.selectFrom("tenant_memberships").select("tenant_id").where("admin_id", "=", adminId).execute(),
    ]);
    return [...new Set([admin?.tenant_id, ...memberships.map((membership) => membership.tenant_id)].filter(Boolean) as string[])];
  }

  async touchSession(sessionId: string, at: Date) {
    await this.database.updateTable("sessions").set({ last_activity_at: at }).where("id", "=", sessionId).where("revoked_at", "is", null).execute();
  }

  async revokeSession(sessionId: string, adminId: string, audit: AuditEventInput) {
    return this.database.transaction().execute(async (transaction) => {
      const result = await transaction.updateTable("sessions").set({ revoked_at: new Date() }).where("id", "=", sessionId).where("admin_id", "=", adminId).where("revoked_at", "is", null).executeTakeFirst();
      if (Number(result.numUpdatedRows) === 0) return false;
      await transaction.insertInto("audit_logs").values(auditValues(audit)).execute();
      return true;
    });
  }

  async revokeAllSessions(adminId: string, audit: AuditEventInput, exceptSessionId?: string) {
    return this.database.transaction().execute(async (transaction) => {
      let query = transaction.updateTable("sessions").set({ revoked_at: new Date() }).where("admin_id", "=", adminId).where("revoked_at", "is", null);
      if (exceptSessionId) query = query.where("id", "!=", exceptSessionId);
      const result = await query.executeTakeFirst();
      await transaction.insertInto("audit_logs").values(auditValues({ ...audit, metadata: { ...audit.metadata, revokedCount: Number(result.numUpdatedRows) } })).execute();
      return Number(result.numUpdatedRows);
    });
  }

  async listSessions(adminId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const rows = await this.database.selectFrom("sessions").select(["id", "ip", "user_agent as userAgent", "created_at as createdAt", "last_activity_at as lastActivityAt", "expires_at as expiresAt"]).where("admin_id", "=", adminId).where("revoked_at", "is", null).where("expires_at", ">", new Date()).orderBy("created_at", "desc").execute();
    return rows.map((row) => ({ ...row, current: row.id === currentSessionId }));
  }

  async enforceConcurrentSessionLimit(adminId: string, keepSessionId: string, maximumSessions: number) {
    if (maximumSessions <= 0) return 0;
    const active = await this.database.selectFrom("sessions").select("id").where("admin_id", "=", adminId)
      .where("revoked_at", "is", null).where("expires_at", ">", new Date()).orderBy("created_at", "desc").execute();
    const revoke = active.filter((session) => session.id !== keepSessionId).slice(Math.max(0, maximumSessions - 1)).map((session) => session.id);
    if (!revoke.length) return 0;
    const result = await this.database.updateTable("sessions").set({ revoked_at: new Date() }).where("id", "in", revoke).where("admin_id", "=", adminId).executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async changePassword(adminId: string, passwordHash: string, currentSessionId: string, audit: AuditEventInput) {
    await this.database.transaction().execute(async (transaction) => {
      await transaction.updateTable("admins").set({ password_hash: passwordHash, password_changed_at: new Date(), updated_at: new Date() }).where("id", "=", adminId).executeTakeFirstOrThrow();
      await transaction.updateTable("sessions").set({ revoked_at: new Date() }).where("admin_id", "=", adminId).where("id", "!=", currentSessionId).where("revoked_at", "is", null).execute();
      await transaction.insertInto("audit_logs").values(auditValues(audit)).execute();
    });
  }

  async changeUsername(adminId: string, username: string, audit: AuditEventInput) {
    await this.database.transaction().execute(async (transaction) => {
      await transaction.updateTable("admins").set({ username, updated_at: new Date() }).where("id", "=", adminId).execute();
      await transaction.insertInto("audit_logs").values(auditValues(audit)).execute();
    });
  }

  async recordAudit(event: AuditEventInput) {
    await this.database.insertInto("audit_logs").values(auditValues(event)).execute();
  }

  async ownerExists(executor: Executor = this.database) {
    const result = await executor.selectFrom("admins").innerJoin("roles", "roles.id", "admins.role_id").select(({ fn }) => fn.countAll<number>().as("count")).where("roles.name", "=", ROLES.OWNER).executeTakeFirstOrThrow();
    return Number(result.count) > 0;
  }

  async bootstrapOwner(username: string, email: string | null, passwordHash: string) {
    return this.database.transaction().execute(async (transaction) => {
      await sql`select pg_advisory_xact_lock(hashtext('nr-panel-owner-bootstrap'))`.execute(transaction);
      if (await this.ownerExists(transaction)) throw new ApiError(409, "OWNER_ALREADY_EXISTS", "A primary OWNER already exists");
      const role = await transaction.selectFrom("roles").select("id").where("name", "=", ROLES.OWNER).executeTakeFirstOrThrow();
      let tenant = await transaction.selectFrom("tenants").select("id").where("slug", "=", "system").executeTakeFirst();
      tenant ??= await transaction.insertInto("tenants").values({ name: "NR PANEL System", slug: "system", status: "ACTIVE", parent_id: null, created_by: null, traffic_quota: null, user_limit: null, config_limit: null, expires_at: null }).returning("id").executeTakeFirstOrThrow();
      const owner = await transaction.insertInto("admins").values({ username, email, password_hash: passwordHash, role_id: role.id, tenant_id: tenant.id, enabled: true, status: "ACTIVE", last_activity_at: null, last_login_at: null, password_changed_at: new Date(), created_by: null }).returning(["id", "username"]).executeTakeFirstOrThrow();
      await transaction.updateTable("tenants").set({ created_by: owner.id, updated_at: new Date() }).where("id", "=", tenant.id).execute();
      await transaction.insertInto("tenant_memberships").values({ tenant_id: tenant.id, admin_id: owner.id, permissions: [] }).execute();
      await transaction.insertInto("audit_logs").values(auditValues({ actorId: owner.id, actorRole: ROLES.OWNER, tenantId: tenant.id, action: AUDIT_ACTIONS.OWNER_BOOTSTRAPPED, targetType: "admin", targetId: owner.id, message: "Primary OWNER bootstrapped" })).execute();
      return owner;
    });
  }

  async listAdmins() {
    const admins = await this.database.selectFrom("admins").innerJoin("roles", "roles.id", "admins.role_id").select(["admins.id", "admins.username", "admins.email", "admins.status", "admins.last_login_at as lastLoginAt", "admins.created_at as createdAt", "admins.tenant_id as tenantId", "roles.name as role"]).orderBy("admins.created_at", "asc").execute();
    return Promise.all(admins.map(async (admin) => ({ ...admin, permissions: await this.getPermissions(admin.id) })));
  }

  async createAdmin(input: CreateAdminInput) {
    return this.database.transaction().execute(async (transaction) => {
      const [role, tenant] = await Promise.all([
        transaction.selectFrom("roles").select("id").where("name", "=", input.role).executeTakeFirst(),
        transaction.selectFrom("tenants").select(["id", "status"]).where("id", "=", input.tenantId).executeTakeFirst(),
      ]);
      if (!role) throw new ApiError(400, "ROLE_INVALID", "Invalid role");
      if (!tenant || tenant.status !== "ACTIVE") throw new ApiError(400, "TENANT_INVALID", "Invalid tenant");
      const admin = await transaction.insertInto("admins").values({ username: input.username, email: input.email, password_hash: input.passwordHash, role_id: role.id, tenant_id: input.tenantId, enabled: true, status: "ACTIVE", last_activity_at: null, last_login_at: null, password_changed_at: new Date(), created_by: input.actorId }).returning(["id", "username", "email", "status", "tenant_id as tenantId"]).executeTakeFirstOrThrow();
      await transaction.insertInto("tenant_memberships").values({ tenant_id: input.tenantId, admin_id: admin.id, permissions: [] }).execute();
      await this.replaceAdminPermissions(transaction, admin.id, input.permissions, input.actorId);
      await transaction.insertInto("audit_logs").values(auditValues({ actorId: input.actorId, actorRole: input.actorRole, tenantId: input.tenantId, action: AUDIT_ACTIONS.ADMIN_CREATED, targetType: "admin", targetId: admin.id, ip: input.ip, requestId: input.requestId, category: "ADMIN", message: "Administrator created", metadata: { role: input.role, permissions: input.permissions } })).execute();
      return { ...admin, role: input.role, permissions: input.permissions };
    });
  }

  async updateAdmin(adminId: string, input: UpdateAdminInput) {
    return this.database.transaction().execute(async (transaction) => {
      const target = await transaction.selectFrom("admins").innerJoin("roles", "roles.id", "admins.role_id").select(["admins.id", "admins.status", "admins.tenant_id as tenantId", "roles.name as role"]).where("admins.id", "=", adminId).executeTakeFirst();
      if (!target) throw new ApiError(404, "ADMIN_NOT_FOUND", "Administrator not found");
      assertAdminMutationAllowed(input.actorRole, target.role);
      let roleId: string | undefined;
      if (input.role) roleId = (await transaction.selectFrom("roles").select("id").where("name", "=", input.role).executeTakeFirst())?.id;
      if (input.role && !roleId) throw new ApiError(400, "ROLE_INVALID", "Invalid role");
      await transaction.updateTable("admins").set({ ...(roleId ? { role_id: roleId } : {}), ...(input.status ? { status: input.status, enabled: input.status === "ACTIVE" } : {}), updated_at: new Date() }).where("id", "=", adminId).execute();
      if (input.permissions) await this.replaceAdminPermissions(transaction, adminId, input.permissions, input.actorId);
      if (input.status === "DISABLED") await transaction.updateTable("sessions").set({ revoked_at: new Date() }).where("admin_id", "=", adminId).where("revoked_at", "is", null).execute();
      const action = input.status === "DISABLED" ? AUDIT_ACTIONS.ADMIN_DISABLED : input.status === "ACTIVE" ? AUDIT_ACTIONS.ADMIN_ENABLED : AUDIT_ACTIONS.ADMIN_UPDATED;
      const events = [auditValues({ actorId: input.actorId, actorRole: input.actorRole, tenantId: target.tenantId, action, targetType: "admin", targetId: adminId, ip: input.ip, requestId: input.requestId, category: "ADMIN", message: "Administrator updated", metadata: { role: input.role, status: input.status, permissions: input.permissions } })];
      if (input.role && input.role !== target.role) events.push(auditValues({ actorId: input.actorId, actorRole: input.actorRole, tenantId: target.tenantId, action: AUDIT_ACTIONS.ROLE_CHANGED, targetType: "admin", targetId: adminId, ip: input.ip, requestId: input.requestId, category: "ADMIN", message: "Administrator role changed", metadata: { from: target.role, to: input.role } }));
      if (input.permissions) events.push(auditValues({ actorId: input.actorId, actorRole: input.actorRole, tenantId: target.tenantId, action: AUDIT_ACTIONS.PERMISSIONS_CHANGED, targetType: "admin", targetId: adminId, ip: input.ip, requestId: input.requestId, category: "ADMIN", message: "Administrator permissions changed", metadata: { permissions: input.permissions } }));
      await transaction.insertInto("audit_logs").values(events).execute();
      return { id: adminId, updated: true };
    });
  }

  private async replaceAdminPermissions(transaction: Transaction<SecurityDatabase>, adminId: string, permissions: Permission[], grantedBy: string) {
    const uniquePermissions = [...new Set(permissions)].filter((permission): permission is Permission => permissionValues.includes(permission));
    const rows = uniquePermissions.length
      ? await transaction.selectFrom("permissions").select(["id", "code"]).where("code", "in", uniquePermissions).execute()
      : [];
    if (rows.length !== uniquePermissions.length) throw new ApiError(400, "PERMISSION_INVALID", "Invalid permission");
    await transaction.deleteFrom("admin_permissions").where("admin_id", "=", adminId).execute();
    if (rows.length) await transaction.insertInto("admin_permissions").values(rows.map((row) => ({ admin_id: adminId, permission_id: row.id, granted_by: grantedBy }))).execute();
  }

  listRoles() {
    return this.database.selectFrom("roles").select(["id", "name"]).orderBy("name").execute();
  }

  listPermissions() {
    return this.database.selectFrom("permissions").select(["id", "code", "description"]).orderBy("code").execute();
  }

  listTenants() {
    return this.database.selectFrom("tenants").select(["id", "name", "slug", "status", "created_by as createdBy", "created_at as createdAt", "updated_at as updatedAt"]).orderBy("created_at", "asc").execute();
  }

  getTenant(tenantId: string) {
    return this.database.selectFrom("tenants").select(["id", "name", "slug", "status", "created_by as createdBy", "created_at as createdAt", "updated_at as updatedAt"]).where("id", "=", tenantId).executeTakeFirst();
  }

  async createTenant(name: string, slug: string, actor: { id: string; role: Role; requestId: string; ip: string | null }) {
    return this.database.transaction().execute(async (transaction) => {
      const tenant = await transaction.insertInto("tenants").values({ name, slug, status: "ACTIVE", parent_id: null, created_by: actor.id, traffic_quota: null, user_limit: null, config_limit: null, expires_at: null }).returning(["id", "name", "slug", "status", "created_at as createdAt"]).executeTakeFirstOrThrow();
      await transaction.insertInto("audit_logs").values(auditValues({ actorId: actor.id, actorRole: actor.role, tenantId: tenant.id, action: AUDIT_ACTIONS.TENANT_CREATED, targetType: "tenant", targetId: tenant.id, ip: actor.ip, requestId: actor.requestId, category: "SUB_PANEL", message: "Tenant created" })).execute();
      return tenant;
    });
  }

  async updateTenant(tenantId: string, input: { name?: string; status?: "ACTIVE" | "DISABLED" | "EXPIRED"; actorId: string; actorRole: Role; requestId: string; ip: string | null }) {
    return this.database.transaction().execute(async (transaction) => {
      const tenant = await transaction.selectFrom("tenants").select(["id", "name", "status"]).where("id", "=", tenantId).executeTakeFirst();
      if (!tenant) throw new ApiError(404, "TENANT_NOT_FOUND", "Tenant not found");
      await transaction.updateTable("tenants").set({ ...(input.name ? { name: input.name } : {}), ...(input.status ? { status: input.status } : {}), updated_at: new Date() }).where("id", "=", tenantId).execute();
      const action = input.status === "DISABLED" ? AUDIT_ACTIONS.TENANT_DISABLED : AUDIT_ACTIONS.TENANT_UPDATED;
      await transaction.insertInto("audit_logs").values(auditValues({ actorId: input.actorId, actorRole: input.actorRole, tenantId, action, targetType: "tenant", targetId: tenantId, ip: input.ip, requestId: input.requestId, category: "SUB_PANEL", message: "Tenant updated", metadata: { previousStatus: tenant.status, status: input.status, nameChanged: Boolean(input.name) } })).execute();
      return { id: tenantId, updated: true };
    });
  }

  async securitySummary(identity: { userId: string; role: Role; tenantIds: string[] }) {
    let sessionsQuery = this.database.selectFrom("sessions").innerJoin("admins", "admins.id", "sessions.admin_id").select(["sessions.id", "admins.username", "sessions.ip", "sessions.user_agent as userAgent", "sessions.last_activity_at as lastActivityAt", "sessions.expires_at as expiresAt"]).where("sessions.revoked_at", "is", null).where("sessions.expires_at", ">", new Date());
    let auditQuery = this.database.selectFrom("audit_logs").select(["id", "timestamp", "action", "actor_id as actorId", "tenant_id as tenantId", "ip", "message"]).where("action", "in", [AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS, AUDIT_ACTIONS.AUTH_LOGIN_FAILED, AUDIT_ACTIONS.PERMISSION_DENIED]).orderBy("timestamp", "desc").limit(50);
    if (identity.role !== ROLES.OWNER) {
      sessionsQuery = identity.tenantIds.length ? sessionsQuery.where("admins.tenant_id", "in", identity.tenantIds) : sessionsQuery.where("admins.id", "=", identity.userId);
      auditQuery = identity.tenantIds.length ? auditQuery.where((builder) => builder.or([builder("tenant_id", "in", identity.tenantIds), builder("actor_id", "=", identity.userId)])) : auditQuery.where("actor_id", "=", identity.userId);
    }
    const [sessions, events, failedAttempts] = await Promise.all([
      sessionsQuery.orderBy("sessions.last_activity_at", "desc").execute(),
      auditQuery.execute(),
      identity.role === ROLES.OWNER
        ? this.database.selectFrom("login_attempts").select(["id", "ip", "failure_reason as reason", "attempted_at as attemptedAt"]).where("successful", "=", false).orderBy("attempted_at", "desc").limit(30).execute()
        : Promise.resolve([]),
    ]);
    return { sessions, failedAttempts, events };
  }
}
