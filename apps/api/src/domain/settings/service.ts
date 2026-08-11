import { X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isIP } from "node:net";
import {
  MASTER_SETTINGS_SECTIONS,
  PRESERVE_SECRET_VALUE,
  ROLES,
  type ApiTokenCreated,
  type ApiTokenSummary,
  type CertificateDiagnostics,
  type ConnectionDiagnostics,
  type MasterSettingsSection,
  type MasterSettingsSnapshot,
  type MasterSettingsValues,
  type Permission,
  type SettingsSectionEnvelope,
  type SettingsWarning,
  type SystemDiagnostics,
} from "@nr/shared";
import nodemailer from "nodemailer";
import { ApiError } from "../../lib/errors.js";
import type { AuthContext, RequestMetadata } from "../identity.js";
import type { KyselySettingsRepository, StoredSettingsRow } from "./repository.js";
import {
  defaultSettings,
  restartScopesBySection,
  secretFields,
  settingsSchemas,
  type SecretName,
} from "./schemas.js";

type ConnectionInput = { host: string; protocol: string; port: number | null; https: boolean; environment: string; panelVersion: string };
type XrayValidator = (auth: AuthContext) => Promise<unknown>;
type XrayApplier = (auth: AuthContext) => Promise<Array<{ state: "APPLIED" | "FAILED" | "ROLLED_BACK"; strategy: string; reason: string; errorCode?: string; errorMessage?: string }>>;
type Actor = { userId: string; role: AuthContext["role"]; tenantId: string | null };

const auditActionBySection: Record<MasterSettingsSection, string> = {
  general: "SETTING_GENERAL_CHANGED", security: "SETTING_SECURITY_CHANGED", network: "PANEL_NETWORK_CHANGED", tls: "TLS_SETTINGS_CHANGED",
  xray: "XRAY_SETTINGS_CHANGED", subscription: "SUBSCRIPTION_SETTINGS_CHANGED", subscriptionFormats: "SUBSCRIPTION_FORMATS_CHANGED",
  telegram: "TELEGRAM_SETTINGS_CHANGED", email: "EMAIL_SETTINGS_CHANGED", notifications: "NOTIFICATION_SETTINGS_CHANGED",
  users: "USER_DEFAULT_SETTINGS_CHANGED", subpanels: "SUBPANEL_DEFAULT_SETTINGS_CHANGED", agents: "AGENT_SETTINGS_CHANGED",
  traffic: "TRAFFIC_SETTINGS_CHANGED", backup: "BACKUP_SETTINGS_CHANGED", datetime: "DATETIME_SETTINGS_CHANGED", updates: "UPDATE_SETTINGS_CHANGED",
};

function clone<T>(value: T): T { return structuredClone(value); }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function equal(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function actor(auth: AuthContext): Actor { return { userId: auth.userId, role: auth.role, tenantId: auth.primaryTenantId ?? auth.tenantIds[0] ?? null }; }

function ipv4(value: string) { return value.split(".").reduce((result, part) => (result << 8n) | BigInt(Number(part)), 0n); }
function ipv6(value: string) {
  const source = value.split("%")[0].toLowerCase();
  const sides = source.split("::");
  if (sides.length > 2) throw new Error("invalid IPv6");
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  if (groups.length !== 8) throw new Error("invalid IPv6");
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group || "0"}`), 0n);
}
export function ipMatchesCidr(ip: string, cidr: string) {
  const [network, prefixText] = cidr.split("/");
  const family = isIP(ip); const networkFamily = isIP(network);
  if (!family || family !== networkFamily) return false;
  const bits = family === 4 ? 32 : 128; const prefix = Number(prefixText);
  const value = family === 4 ? ipv4(ip) : ipv6(ip); const base = family === 4 ? ipv4(network) : ipv6(network);
  const shift = BigInt(bits - prefix);
  return (value >> shift) === (base >> shift);
}

export class SettingsService {
  private xrayValidator: XrayValidator | null = null;
  private xrayApplier: XrayApplier | null = null;
  constructor(private readonly repository: KyselySettingsRepository) {}

  setXrayValidator(validator: XrayValidator) { this.xrayValidator = validator; }
  setXrayApplier(applier: XrayApplier) { this.xrayApplier = applier; }

  private parsed<S extends MasterSettingsSection>(section: S, row: StoredSettingsRow | null): MasterSettingsValues[S] {
    const merged = { ...defaultSettings[section], ...object(row?.value) };
    const parsed = settingsSchemas[section].safeParse(merged);
    return (parsed.success ? parsed.data : clone(defaultSettings[section])) as MasterSettingsValues[S];
  }

  async value<S extends MasterSettingsSection>(section: S, includeSecrets = false): Promise<MasterSettingsValues[S]> {
    const value = this.parsed(section, await this.repository.row(section));
    if (!includeSecrets || !(section in secretFields)) return value;
    const result = clone(value) as Record<string, unknown>;
    for (const [field, name] of Object.entries(secretFields[section as keyof typeof secretFields]) as Array<[string, SecretName]>) result[field] = await this.repository.secret(name) ?? "";
    return result as MasterSettingsValues[S];
  }

  private publicValue<S extends MasterSettingsSection>(section: S, value: MasterSettingsValues[S], configured: Set<SecretName>) {
    const result = clone(value) as Record<string, unknown>;
    const sectionSecrets = section in secretFields ? secretFields[section as keyof typeof secretFields] : null;
    if (sectionSecrets) for (const [field, name] of Object.entries(sectionSecrets) as Array<[string, SecretName]>) result[field] = configured.has(name) ? PRESERVE_SECRET_VALUE : "";
    return result as MasterSettingsValues[S];
  }

  private envelope<S extends MasterSettingsSection>(section: S, value: MasterSettingsValues[S], row: StoredSettingsRow | null, configured: Set<SecretName>): SettingsSectionEnvelope<S> {
    const names = section in secretFields ? Object.entries(secretFields[section as keyof typeof secretFields]).filter(([, name]) => configured.has(name as SecretName)).map(([field]) => field) : [];
    return {
      section, value: this.publicValue(section, value, configured), version: row?.version ?? 1, updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: row?.updatedBy ?? null, restartRequired: row?.restartScopes ?? [], configuredSecrets: names,
    };
  }

  private async certificate(settings: MasterSettingsValues["tls"]): Promise<CertificateDiagnostics> {
    const checked = new Date().toISOString();
    if (!settings.certificatePath) return { status: "MISSING", expiresAt: null, subject: null, lastCheckedAt: checked };
    try {
      const certificate = new X509Certificate(await readFile(settings.certificatePath));
      return { status: new Date(certificate.validTo) > new Date() ? "ACTIVE" : "INVALID", expiresAt: new Date(certificate.validTo).toISOString(), subject: certificate.subject, lastCheckedAt: checked };
    } catch { return { status: "UNAVAILABLE", expiresAt: null, subject: null, lastCheckedAt: checked }; }
  }

  private warnings(values: MasterSettingsValues, connection: ConnectionDiagnostics, certificate: CertificateDiagnostics): SettingsWarning[] {
    const warnings: SettingsWarning[] = [];
    if (!connection.https) warnings.push({ code: "PANEL_HTTP", section: "tls", level: "critical", message: "اتصال پنل امن نیست؛ برای حفاظت از اطلاعات ورود HTTPS را فعال کنید." });
    if (values.network.basePath === "/") warnings.push({ code: "PREDICTABLE_BASE_PATH", section: "network", level: "warning", message: "مسیر پایه پنل قابل پیش‌بینی است؛ این مورد به‌تنهایی کنترل امنیتی محسوب نمی‌شود." });
    if (!values.tls.httpsEnabled || certificate.status !== "ACTIVE") warnings.push({ code: "TLS_INACTIVE", section: "tls", level: "warning", message: "گواهی TLS فعال و معتبر برای پنل تأیید نشده است." });
    warnings.push({ code: "TWO_FACTOR_UNAVAILABLE", section: "security", level: "info", message: "TOTP هنوز به‌صورت کامل پیاده‌سازی نشده و در این نسخه غیرفعال است." });
    if (values.security.sessionTtlMinutes > 1440) warnings.push({ code: "LONG_SESSION", section: "security", level: "warning", message: "طول عمر نشست بیش از ۲۴ ساعت است." });
    if (values.subscription.enabled && (!values.subscription.publicUrl || values.subscription.publicUrl.startsWith("http://"))) warnings.push({ code: "SUBSCRIPTION_WITHOUT_HTTPS", section: "subscription", level: "warning", message: "آدرس عمومی Subscription باید از HTTPS استفاده کند." });
    return warnings;
  }

  async snapshot(connection: ConnectionInput): Promise<MasterSettingsSnapshot> {
    const [rows, configured, runtime] = await Promise.all([this.repository.rows(), this.repository.configuredSecrets(), this.repository.diagnostics()]);
    const rowMap = new Map(rows.map((row) => [row.namespace, row]));
    const values = {} as MasterSettingsValues;
    const envelopes = {} as MasterSettingsSnapshot["sections"];
    for (const section of MASTER_SETTINGS_SECTIONS) {
      const row = rowMap.get(section) ?? null;
      const value = this.parsed(section, row);
      values[section] = value as never;
      envelopes[section] = this.envelope(section, value, row, configured) as never;
    }
    const certificate = await this.certificate(values.tls);
    const diagnostics: SystemDiagnostics = {
      database: "HEALTHY", redis: "UNAVAILABLE", api: "HEALTHY", websocket: "UNAVAILABLE", agents: runtime.servers,
      xray: runtime.xray, storage: "UNAVAILABLE", queue: "UNAVAILABLE",
    };
    return { sections: envelopes, warnings: this.warnings(values, connection, certificate), connection, certificate, diagnostics };
  }

  async section<S extends MasterSettingsSection>(section: S) {
    const [row, configured] = await Promise.all([this.repository.row(section), this.repository.configuredSecrets()]);
    return this.envelope(section, this.parsed(section, row), row, configured);
  }

  private async normalizeSecrets<S extends MasterSettingsSection>(section: S, value: MasterSettingsValues[S], configured: Set<SecretName>) {
    const clean = clone(value) as Record<string, unknown>;
    const updates: Partial<Record<SecretName, string | null>> = {};
    const changed: string[] = [];
    const mappings = section in secretFields ? secretFields[section as keyof typeof secretFields] : null;
    if (!mappings) return { clean: clean as MasterSettingsValues[S], updates, changed };
    for (const [field, name] of Object.entries(mappings) as Array<[string, SecretName]>) {
      const input = String(clean[field] ?? "");
      if (input === PRESERVE_SECRET_VALUE) {
        if (!configured.has(name)) throw new ApiError(400, "SECRET_NOT_CONFIGURED", `${field} is not configured`);
      } else {
        updates[name] = input || null;
        changed.push(field);
      }
      clean[field] = "";
    }
    return { clean: clean as MasterSettingsValues[S], updates, changed };
  }

  async update<S extends MasterSettingsSection>(section: S, input: unknown, auth: AuthContext, metadata: RequestMetadata) {
    const parsed = settingsSchemas[section].parse(input) as MasterSettingsValues[S];
    const [currentRow, configured] = await Promise.all([this.repository.row(section), this.repository.configuredSecrets()]);
    const current = this.parsed(section, currentRow);
    const normalized = await this.normalizeSecrets(section, parsed, configured);
    const willConfigure = new Set(configured);
    for (const [name, secret] of Object.entries(normalized.updates) as Array<[SecretName, string | null]>) {
      if (secret === null) willConfigure.delete(name);
      else willConfigure.add(name);
    }
    if (section === "telegram" && (normalized.clean as MasterSettingsValues["telegram"]).enabled && !willConfigure.has("telegram.botToken")) throw new ApiError(400, "TELEGRAM_TOKEN_REQUIRED", "Telegram cannot be enabled without a bot token");
    if (section === "email" && (normalized.clean as MasterSettingsValues["email"]).enabled && !willConfigure.has("email.password")) throw new ApiError(400, "SMTP_PASSWORD_REQUIRED", "Email cannot be enabled without an SMTP password");
    if (section === "tls" && (normalized.clean as MasterSettingsValues["tls"]).httpsEnabled && (!(normalized.clean as MasterSettingsValues["tls"]).certificatePath || !willConfigure.has("tls.privateKeyPath"))) throw new ApiError(400, "TLS_MATERIAL_REQUIRED", "TLS requires a certificate path and configured private key path");

    const changedFields = Object.keys(normalized.clean as Record<string, unknown>).filter((field) => !equal((current as Record<string, unknown>)[field], (normalized.clean as Record<string, unknown>)[field]));
    for (const field of normalized.changed) if (!changedFields.includes(field)) changedFields.push(field);
    if (!changedFields.length) return this.section(section);
    let action = auditActionBySection[section];
    if (section === "general" && changedFields.includes("maintenanceMode")) action = (normalized.clean as MasterSettingsValues["general"]).maintenanceMode ? "MAINTENANCE_ENABLED" : "MAINTENANCE_DISABLED";
    await this.repository.save({
      section, value: normalized.clean as MasterSettingsValues[MasterSettingsSection], changedFields,
      restartScopes: restartScopesBySection[section] ?? [], secrets: normalized.updates, actor: actor(auth), metadata, auditAction: action,
    });
    const envelope = await this.section(section);
    if (section === "xray" && this.xrayApplier) return { ...envelope, runtimeApply: await this.xrayApplier(auth) };
    return envelope;
  }

  async reset(section: MasterSettingsSection, auth: AuthContext, metadata: RequestMetadata) {
    return this.update(section, defaultSettings[section], auth, metadata);
  }

  history(section: MasterSettingsSection) { return this.repository.history(section); }
  listApiTokens(auth: AuthContext): Promise<ApiTokenSummary[]> { return this.repository.listApiTokens(auth); }
  async createApiToken(input: { name: string; permissions: Permission[]; expiresAt: string | null; cidrAllowlist: string[] }, auth: AuthContext, metadata: RequestMetadata): Promise<ApiTokenCreated> {
    if (auth.role !== ROLES.OWNER && input.permissions.some((permission) => !auth.permissions.includes(permission))) throw new ApiError(403, "API_TOKEN_PERMISSION_ESCALATION", "A token cannot receive permissions that its creator does not hold");
    return this.repository.createApiToken(input, actor(auth), metadata);
  }

  async setApiTokenState(id: string, enabled: boolean, auth: AuthContext, metadata: RequestMetadata) {
    if (!(await this.repository.setApiTokenState(id, enabled, actor(auth), metadata))) throw new ApiError(404, "API_TOKEN_NOT_FOUND", "API token not found");
  }
  async revokeApiToken(id: string, auth: AuthContext, metadata: RequestMetadata) {
    if (!(await this.repository.revokeApiToken(id, actor(auth), metadata))) throw new ApiError(404, "API_TOKEN_NOT_FOUND", "API token not found");
  }

  async authenticateApiToken(secret: string, ip: string): Promise<AuthContext> {
    if (!secret.startsWith("nrp_") || secret.length < 40) throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required");
    const record = await this.repository.resolveApiToken(secret);
    if (!record || !record.creatorEnabled || record.creatorStatus !== "ACTIVE") throw new ApiError(401, "AUTH_REQUIRED", "Authentication is required");
    if (record.cidrAllowlist.length && !record.cidrAllowlist.some((cidr) => ipMatchesCidr(ip, cidr))) throw new ApiError(403, "API_TOKEN_IP_DENIED", "API token is not allowed from this address");
    const memberships = await this.repository.tokenTenantIds(record.createdBy);
    const tenantIds = [...new Set([record.creatorTenantId, ...memberships])];
    return {
      userId: record.createdBy, username: `${record.creatorUsername} · API`, email: null, role: ROLES.ADMIN, permissions: record.permissions,
      primaryTenantId: record.creatorTenantId, tenantIds, sessionId: `api-token:${record.id}`,
      sessionExpiresAt: record.expiresAt?.toISOString() ?? new Date(Date.now() + 86_400_000).toISOString(),
    };
  }

  async securityPolicy() { return this.value("security"); }
  async isMaintenanceMode() { return (await this.value("general")).maintenanceMode; }
  async userDefaults() { return this.value("users"); }
  async subpanelDefaults() { return this.value("subpanels"); }
  async xrayPolicy() { return this.value("xray"); }

  async revokeOtherSessions(auth: AuthContext, metadata: RequestMetadata) {
    return this.repository.revokeOtherSessions({ ...actor(auth), sessionId: auth.sessionId }, metadata);
  }

  async testTelegram() {
    const settings = await this.value("telegram", true);
    if (!settings.botToken) throw new ApiError(400, "TELEGRAM_TOKEN_REQUIRED", "Telegram bot token is not configured");
    try {
      const response = await fetch(`${settings.apiEndpoint}/bot${settings.botToken}/getMe`, { signal: AbortSignal.timeout(10_000) });
      const result = await response.json() as { ok?: boolean; result?: { username?: string } };
      if (!response.ok || !result.ok) throw new Error("telegram rejected credentials");
      return { connected: true, botUsername: result.result?.username ?? null };
    } catch { throw new ApiError(502, "TELEGRAM_CONNECTION_FAILED", "Telegram connection test failed; verify the token and outbound network access"); }
  }

  async testEmail(recipient?: string) {
    const settings = await this.value("email", true);
    const target = recipient || settings.recipients[0];
    if (!settings.smtpHost || !settings.fromAddress || !target || !settings.password) throw new ApiError(400, "SMTP_CONFIGURATION_INCOMPLETE", "SMTP host, credentials, sender and recipient are required");
    try {
      const transport = nodemailer.createTransport({
        host: settings.smtpHost, port: settings.smtpPort, secure: settings.encryption === "TLS", requireTLS: settings.encryption === "STARTTLS",
        auth: settings.username ? { user: settings.username, pass: settings.password } : undefined, logger: false, debug: false,
      });
      const info = await transport.sendMail({ from: { name: settings.fromName || "NR PANEL", address: settings.fromAddress }, to: target, subject: "NR PANEL · SMTP Test", text: "This message confirms that NR PANEL SMTP delivery is configured correctly." });
      transport.close();
      return { delivered: true, accepted: info.accepted.map(String), rejected: info.rejected.map(String), messageId: info.messageId };
    } catch { throw new ApiError(502, "SMTP_TEST_FAILED", "SMTP test failed; verify the server, encryption mode and credentials"); }
  }

  async validateXray(auth: AuthContext) {
    if (!this.xrayValidator) throw new ApiError(503, "XRAY_RUNTIME_UNAVAILABLE", "Xray validation adapter is unavailable");
    return this.xrayValidator(auth);
  }

  runBackup(): never { throw new ApiError(503, "BACKUP_RUNTIME_UNAVAILABLE", "The managed backup runtime is not connected; no backup was claimed or created"); }
  checkUpdates(): never { throw new ApiError(503, "UPDATE_PROVIDER_UNAVAILABLE", "No signed NR PANEL release provider is configured; no update was performed"); }
}
