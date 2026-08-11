import { createHash, randomBytes } from "node:crypto";
import { ROLES, type ApiTokenCreated, type ApiTokenSummary, type MasterSettingsSection, type MasterSettingsValues, type Permission, type RestartScope, type Role, type SettingsHistoryEntry } from "@nr/shared";
import { sql, type Transaction } from "kysely";
import type { Database } from "../../database/client.js";
import type { SecurityDatabase } from "../../database/types.js";
import { encryptCredential, decryptCredential } from "../inbounds/credential-vault.js";
import type { RequestMetadata } from "../identity.js";
import type { SecretName } from "./schemas.js";

type Executor = Database | Transaction<SecurityDatabase>;
type Actor = { userId: string; role: Role; tenantId: string | null };

export type StoredSettingsRow = {
  namespace: MasterSettingsSection;
  value: unknown;
  version: number;
  restartScopes: RestartScope[];
  updatedBy: string | null;
  updatedAt: Date;
};

export type ApiTokenRecord = {
  id: string; createdBy: string; creatorUsername: string; creatorTenantId: string; creatorEnabled: boolean; creatorStatus: "ACTIVE" | "DISABLED";
  permissions: Permission[]; cidrAllowlist: string[]; expiresAt: Date | null;
};

function auditValues(actor: Actor, metadata: RequestMetadata, action: string, message: string, section: string, fields: string[], warning = false) {
  return {
    severity: warning ? "warning" as const : "info" as const, category: "CONFIG" as const, actor_id: actor.userId, actor_role: actor.role,
    tenant_id: actor.tenantId, server_id: null, ip: metadata.ip, action, message, target_type: "master_settings", target_id: section,
    request_id: metadata.requestId, metadata: { section, changedFields: fields },
  };
}

function tokenSummary(row: {
  id: string; name: string; prefix: string; permissions: Permission[]; cidrAllowlist: string[]; expiresAt: Date | null; lastUsedAt: Date | null;
  enabled: boolean; createdAt: Date; revokedAt: Date | null;
}): ApiTokenSummary {
  return {
    id: row.id, name: row.name, prefix: row.prefix, permissions: row.permissions, cidrAllowlist: row.cidrAllowlist,
    expiresAt: row.expiresAt?.toISOString() ?? null, lastUsedAt: row.lastUsedAt?.toISOString() ?? null, enabled: row.enabled,
    createdAt: row.createdAt.toISOString(), revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export class KyselySettingsRepository {
  constructor(private readonly database: Database) {}

  async rows(): Promise<StoredSettingsRow[]> {
    const rows = await this.database.selectFrom("master_settings").select([
      "namespace", "value", "version", "restart_scopes as restartScopes", "updated_by as updatedBy", "updated_at as updatedAt",
    ]).execute();
    return rows;
  }

  async row(section: MasterSettingsSection): Promise<StoredSettingsRow | null> {
    return await this.database.selectFrom("master_settings").select([
      "namespace", "value", "version", "restart_scopes as restartScopes", "updated_by as updatedBy", "updated_at as updatedAt",
    ]).where("namespace", "=", section).executeTakeFirst() ?? null;
  }

  async configuredSecrets() {
    const rows = await this.database.selectFrom("master_setting_secrets").select("name").execute();
    return new Set(rows.map((row) => row.name as SecretName));
  }

  async secret(name: SecretName) {
    const row = await this.database.selectFrom("master_setting_secrets").select("ciphertext").where("name", "=", name).executeTakeFirst();
    return row ? decryptCredential(row.ciphertext) : null;
  }

  async save(input: {
    section: MasterSettingsSection; value: MasterSettingsValues[MasterSettingsSection]; changedFields: string[]; restartScopes: RestartScope[];
    secrets: Partial<Record<SecretName, string | null>>; actor: Actor; metadata: RequestMetadata; auditAction: string;
  }) {
    await this.database.transaction().execute(async (transaction) => {
      const current = await transaction.selectFrom("master_settings").select(["value", "version", "restart_scopes"]).where("namespace", "=", input.section).forUpdate().executeTakeFirst();
      const nextRestartScopes = [...new Set([...(current?.restart_scopes ?? []), ...input.restartScopes])];
      await transaction.insertInto("master_settings").values({
        namespace: input.section, value: input.value, version: (current?.version ?? 0) + 1, restart_scopes: nextRestartScopes,
        updated_by: input.actor.userId, updated_at: new Date(),
      }).onConflict((conflict) => conflict.column("namespace").doUpdateSet({
        value: input.value, version: (current?.version ?? 0) + 1, restart_scopes: nextRestartScopes, updated_by: input.actor.userId, updated_at: new Date(),
      })).execute();

      for (const [name, value] of Object.entries(input.secrets) as Array<[SecretName, string | null]>) {
        if (value === null) await transaction.deleteFrom("master_setting_secrets").where("name", "=", name).execute();
        else await transaction.insertInto("master_setting_secrets").values({ name, ciphertext: encryptCredential(value), updated_by: input.actor.userId, updated_at: new Date() })
          .onConflict((conflict) => conflict.column("name").doUpdateSet({ ciphertext: encryptCredential(value), updated_by: input.actor.userId, updated_at: new Date() })).execute();
      }

      await transaction.insertInto("settings_change_history").values({
        namespace: input.section, actor_id: input.actor.userId, changed_fields: input.changedFields,
        before_metadata: current?.value ?? {}, after_metadata: input.value, request_id: input.metadata.requestId, ip: input.metadata.ip,
      }).execute();
      await transaction.insertInto("audit_logs").values(auditValues(input.actor, input.metadata, input.auditAction, "Master settings section changed", input.section, input.changedFields, input.section === "security" || input.section === "network" || input.section === "tls")).execute();
    });
    return this.row(input.section);
  }

  async history(section: MasterSettingsSection, limit = 30): Promise<SettingsHistoryEntry[]> {
    const rows = await this.database.selectFrom("settings_change_history")
      .leftJoin("admins", "admins.id", "settings_change_history.actor_id")
      .select(["settings_change_history.id", "settings_change_history.namespace as section", "settings_change_history.actor_id as actorId", "admins.username as actorUsername", "settings_change_history.changed_fields as changedFields", "settings_change_history.created_at as createdAt"])
      .where("settings_change_history.namespace", "=", section).orderBy("settings_change_history.created_at", "desc").limit(limit).execute();
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  async diagnostics() {
    await sql`select 1`.execute(this.database);
    const [servers, xray, instances] = await Promise.all([
      this.database.selectFrom("servers").select(({ fn }) => [fn.countAll<number>().as("total"), fn.count<number>(sql`case when status = 'ONLINE' then 1 end`).as("online")]).executeTakeFirstOrThrow(),
      this.database.selectFrom("xray_instances").select(({ fn }) => [fn.countAll<number>().as("total"), fn.count<number>(sql`case when status = 'RUNNING' then 1 end`).as("running"), fn.count<number>(sql`case when config_valid = true then 1 end`).as("valid")]).executeTakeFirstOrThrow(),
      this.database.selectFrom("xray_instances").innerJoin("servers", "servers.id", "xray_instances.server_id").select(["xray_instances.version", "servers.display_name as node"]).execute(),
    ]);
    return { servers: { total: Number(servers.total), online: Number(servers.online) }, xray: { total: Number(xray.total), running: Number(xray.running), configValid: Number(xray.valid), versions: [...new Set(instances.map((item) => item.version).filter((item): item is string => Boolean(item)))], nodes: [...new Set(instances.map((item) => item.node))] } };
  }

  private scopedTokens(auth: { userId: string; role: Role }, executor: Executor = this.database) {
    let query = executor.selectFrom("api_tokens").select([
      "id", "name", "prefix", "permissions", "cidr_allowlist as cidrAllowlist", "expires_at as expiresAt", "last_used_at as lastUsedAt",
      "enabled", "created_at as createdAt", "revoked_at as revokedAt",
    ]);
    if (auth.role !== ROLES.OWNER) query = query.where("created_by", "=", auth.userId);
    return query;
  }

  async listApiTokens(auth: { userId: string; role: Role }) {
    const rows = await this.scopedTokens(auth).orderBy("created_at", "desc").execute();
    return rows.map(tokenSummary);
  }

  async createApiToken(input: { name: string; permissions: Permission[]; expiresAt: string | null; cidrAllowlist: string[] }, actor: Actor, metadata: RequestMetadata): Promise<ApiTokenCreated> {
    const body = randomBytes(32).toString("base64url");
    const secret = `nrp_${body}`;
    const prefix = `nrp_${body.slice(0, 8)}`;
    const hash = createHash("sha256").update(secret).digest("hex");
    const row = await this.database.transaction().execute(async (transaction) => {
      const created = await transaction.insertInto("api_tokens").values({
        name: input.name, prefix, token_hash: hash, permissions: input.permissions, cidr_allowlist: input.cidrAllowlist, created_by: actor.userId,
        expires_at: input.expiresAt ? new Date(input.expiresAt) : null, last_used_at: null, enabled: true, revoked_at: null, updated_at: new Date(),
      }).returning(["id", "name", "prefix", "permissions", "cidr_allowlist as cidrAllowlist", "expires_at as expiresAt", "last_used_at as lastUsedAt", "enabled", "created_at as createdAt", "revoked_at as revokedAt"]).executeTakeFirstOrThrow();
      await transaction.insertInto("audit_logs").values(auditValues(actor, metadata, "API_TOKEN_CREATED", "Scoped API token created", "api", ["name", "permissions", "expiresAt", "cidrAllowlist"], true)).execute();
      return created;
    });
    return { token: tokenSummary(row), secret };
  }

  async setApiTokenState(id: string, enabled: boolean, actor: Actor, metadata: RequestMetadata) {
    return this.database.transaction().execute(async (transaction) => {
      const current = await this.scopedTokens(actor, transaction).where("id", "=", id).executeTakeFirst();
      if (!current) return false;
      await transaction.updateTable("api_tokens").set({ enabled, updated_at: new Date() }).where("id", "=", id).execute();
      await transaction.insertInto("audit_logs").values(auditValues(actor, metadata, enabled ? "API_TOKEN_ENABLED" : "API_TOKEN_DISABLED", `API token ${enabled ? "enabled" : "disabled"}`, "api", ["enabled"], true)).execute();
      return true;
    });
  }

  async revokeApiToken(id: string, actor: Actor, metadata: RequestMetadata) {
    return this.database.transaction().execute(async (transaction) => {
      const current = await this.scopedTokens(actor, transaction).where("id", "=", id).executeTakeFirst();
      if (!current) return false;
      await transaction.updateTable("api_tokens").set({ enabled: false, revoked_at: new Date(), updated_at: new Date() }).where("id", "=", id).execute();
      await transaction.insertInto("audit_logs").values(auditValues(actor, metadata, "API_TOKEN_REVOKED", "API token revoked", "api", ["revokedAt", "enabled"], true)).execute();
      return true;
    });
  }

  async resolveApiToken(secret: string): Promise<ApiTokenRecord | null> {
    const hash = createHash("sha256").update(secret).digest("hex");
    const row = await this.database.selectFrom("api_tokens")
      .innerJoin("admins", "admins.id", "api_tokens.created_by")
      .select([
        "api_tokens.id", "api_tokens.created_by as createdBy", "admins.username as creatorUsername", "admins.tenant_id as creatorTenantId",
        "admins.enabled as creatorEnabled", "admins.status as creatorStatus", "api_tokens.permissions", "api_tokens.cidr_allowlist as cidrAllowlist", "api_tokens.expires_at as expiresAt",
      ])
      .where("api_tokens.token_hash", "=", hash).where("api_tokens.enabled", "=", true).where("api_tokens.revoked_at", "is", null).executeTakeFirst();
    if (!row || (row.expiresAt && row.expiresAt <= new Date())) return null;
    await this.database.updateTable("api_tokens").set({ last_used_at: new Date(), updated_at: new Date() }).where("id", "=", row.id).execute();
    return row;
  }

  async tokenTenantIds(adminId: string) {
    const rows = await this.database.selectFrom("tenant_memberships").select("tenant_id").where("admin_id", "=", adminId).execute();
    return rows.map((row) => row.tenant_id);
  }

  async revokeOtherSessions(actor: Actor & { sessionId: string }, metadata: RequestMetadata) {
    return this.database.transaction().execute(async (transaction) => {
      const result = await transaction.updateTable("sessions").set({ revoked_at: new Date() })
        .where("admin_id", "=", actor.userId).where("id", "!=", actor.sessionId).where("revoked_at", "is", null).executeTakeFirst();
      const count = Number(result.numUpdatedRows);
      await transaction.insertInto("audit_logs").values(auditValues(actor, metadata, "AUTH_LOGOUT_OTHER_SESSIONS", "Other active sessions revoked from Settings", "security", ["sessions"], true)).execute();
      return count;
    });
  }
}
