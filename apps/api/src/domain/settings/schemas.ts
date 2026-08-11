import { isIP } from "node:net";
import {
  INBOUND_PROTOCOLS,
  MASTER_SETTINGS_SECTIONS,
  PERMISSIONS,
  PRESERVE_SECRET_VALUE,
  permissionValues,
  type MasterSettingsSection,
  type MasterSettingsValues,
  type Permission,
  type RestartScope,
} from "@nr/shared";
import { z } from "zod";

const httpUrl = z.string().trim().url().max(2048).refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Only HTTP(S) URLs are allowed");
const emptyOrUrl = z.union([z.literal(""), httpUrl]);
const domain = z.union([z.literal(""), z.string().trim().max(253).regex(/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/)]);
const byteString = z.string().regex(/^\d+$/).refine((value) => BigInt(value) >= 0n).nullable();
const secretInput = z.union([z.literal(""), z.literal(PRESERVE_SECRET_VALUE), z.string().min(6).max(2048)]);
const absolutePath = z.union([z.literal(""), z.string().trim().max(2048).refine((value) => value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value), "Path must be absolute")]);

export function isValidCidr(value: string) {
  const [address, prefix, extra] = value.trim().split("/");
  const family = isIP(address ?? "");
  if (!family || prefix === undefined || extra !== undefined || !/^\d+$/.test(prefix)) return false;
  const numeric = Number(prefix);
  return family === 4 ? numeric >= 0 && numeric <= 32 : numeric >= 0 && numeric <= 128;
}

const cidrList = z.array(z.string().trim().refine(isValidCidr, "Invalid CIDR")).max(128).transform((items) => [...new Set(items)]);
const stringList = (item: z.ZodType<string>, max = 128) => z.array(item).max(max).transform((items) => [...new Set(items)]);
const safeBasePath = z.string().trim().min(1).max(256).transform((value, context) => {
  const normalized = `/${value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
  if (normalized.includes("..") || !/^\/(?:[A-Za-z0-9._~-]+\/)*$/.test(normalized)) {
    context.addIssue({ code: "custom", message: "Unsafe base path" });
    return z.NEVER;
  }
  return normalized;
});
const listenAddress = z.string().trim().max(255).refine((value) => isIP(value) > 0 || ["localhost", "0.0.0.0", "::"].includes(value), "Invalid listen address");
const eventName = z.enum([
  "LOGIN", "LOGIN_FAILURE", "SECURITY_ALERT", "SERVER_OFFLINE", "SERVER_ONLINE", "AGENT_OFFLINE", "XRAY_DOWN",
  "HIGH_CPU", "HIGH_RAM", "HIGH_DISK", "TRAFFIC_QUOTA", "USER_EXPIRATION", "SUBPANEL_EXPIRATION", "BACKUP_COMPLETED", "BACKUP_FAILED",
]);

const generalSchema = z.object({
  panelName: z.string().trim().min(2).max(120), applicationTitle: z.string().trim().min(2).max(120), description: z.string().trim().max(500),
  publicPanelUrl: emptyOrUrl, language: z.enum(["fa", "en"]), theme: z.enum(["light", "dark", "system"]), maintenanceMode: z.boolean(),
  logoUrl: emptyOrUrl, pageSize: z.number().int().min(10).max(200), supportUrl: emptyOrUrl,
}).strict();

const securitySchema = z.object({
  sessionTtlMinutes: z.number().int().min(15).max(43_200), autoLogoutMinutes: z.number().int().min(5).max(10_080),
  maximumConcurrentSessions: z.number().int().min(0).max(100), loginRateLimit: z.number().int().min(3).max(100),
  failedLoginThreshold: z.number().int().min(3).max(100), lockoutMinutes: z.number().int().min(1).max(10_080),
  minimumPasswordLength: z.number().int().min(12).max(128), requireUppercase: z.boolean(), requireLowercase: z.boolean(),
  requireNumber: z.boolean(), requireSpecial: z.boolean(), ipAllowlist: cidrList, securityEventRetentionDays: z.number().int().min(7).max(3650),
}).strict().superRefine((value, context) => {
  if (value.autoLogoutMinutes > value.sessionTtlMinutes) context.addIssue({ code: "custom", path: ["autoLogoutMinutes"], message: "Auto logout cannot exceed session TTL" });
});

const networkSchema = z.object({
  listenAddress, port: z.number().int().min(1).max(65_535), publicDomain: domain, basePath: safeBasePath, trustedProxyCidrs: cidrList,
  publicUrl: emptyOrUrl, allowedOrigins: stringList(httpUrl, 64), reverseProxyAware: z.boolean(), sessionTransport: z.literal("COOKIE"),
}).strict();

const tlsSchema = z.object({ certificatePath: absolutePath, privateKeyPath: secretInput, httpsEnabled: z.boolean() }).strict();

const xraySchema = z.object({
  desiredVersion: z.string().trim().max(64).regex(/^[A-Za-z0-9._+-]*$/), updateChannel: z.enum(["stable", "preview"]), automaticUpdates: z.literal(false),
  validateBeforeApply: z.boolean(), backupBeforeApply: z.boolean(), hotApply: z.boolean(), restartOnlyWhenRequired: z.literal(true), rollbackOnFailure: z.boolean(),
  logLevel: z.enum(["debug", "info", "warning", "error", "none"]), statsEnabled: z.boolean(),
}).strict().superRefine((value, context) => {
  if (!value.validateBeforeApply || !value.backupBeforeApply || !value.rollbackOnFailure) context.addIssue({ code: "custom", message: "NR PANEL safe apply protections cannot be disabled" });
});

const subscriptionSchema = z.object({
  enabled: z.boolean(), publicDomain: domain, listenAddress, port: z.number().int().min(1).max(65_535), basePath: safeBasePath,
  publicUrl: emptyOrUrl, reverseProxyUrl: emptyOrUrl, protection: z.enum(["TOKEN", "TOKEN_AND_EXPIRY"]), updateIntervalHours: z.number().int().min(1).max(720),
  remarkTemplate: z.string().max(500), profileTitle: z.string().max(120), profileSupportUrl: emptyOrUrl, profileUpdateIntervalHours: z.number().int().min(1).max(720),
}).strict();

const subscriptionFormatsSchema = z.object({
  rawEnabled: z.literal(true), jsonEnabled: z.literal(false), mihomoEnabled: z.literal(false), remarkFormat: z.string().max(500), muxEnabled: z.literal(false), xudpEnabled: z.literal(false),
  directRulesEnabled: z.literal(false), routingBehavior: z.literal("PANEL"), clientDetection: z.literal(false),
  finalRoute: z.literal("PROXY"), dnsMode: z.literal("PRESERVE"),
}).strict();

const telegramSchema = z.object({
  enabled: z.boolean(), botToken: secretInput, adminChatIds: stringList(z.string().trim().regex(/^-?\d{3,20}$/), 64), language: z.enum(["fa", "en"]),
  proxyUrl: z.literal(""), apiEndpoint: z.literal("https://api.telegram.org"), schedule: z.enum(["IMMEDIATE", "DIGEST_HOURLY", "DIGEST_DAILY"]), events: stringList(eventName, 32),
}).strict();

const emailSchema = z.object({
  enabled: z.boolean(), smtpHost: z.string().trim().max(253), smtpPort: z.number().int().min(1).max(65_535), encryption: z.enum(["TLS", "STARTTLS"]),
  username: z.string().max(320), password: secretInput, fromAddress: z.union([z.literal(""), z.string().email().max(320)]), fromName: z.string().max(120),
  recipients: stringList(z.string().email().max(320), 64),
}).strict();

const notificationsSchema = z.object({
  channels: z.array(z.enum(["IN_APP", "TELEGRAM", "EMAIL"])).max(3).transform((items) => [...new Set(items)]), events: stringList(eventName, 32),
  cpuWarning: z.number().min(1).max(99), cpuCritical: z.number().min(2).max(100), ramWarning: z.number().min(1).max(99), ramCritical: z.number().min(2).max(100),
  storageWarning: z.number().min(1).max(99), storageCritical: z.number().min(2).max(100), trafficWarning: z.number().min(1).max(99), trafficCritical: z.number().min(2).max(100),
  expirationWarningDays: z.number().int().min(1).max(365), expirationCriticalDays: z.number().int().min(0).max(364),
}).strict().superRefine((value, context) => {
  for (const metric of ["cpu", "ram", "storage", "traffic"] as const) if (value[`${metric}Warning`] >= value[`${metric}Critical`]) context.addIssue({ code: "custom", path: [`${metric}Critical`], message: "Critical threshold must exceed warning" });
  if (value.expirationCriticalDays >= value.expirationWarningDays) context.addIssue({ code: "custom", path: ["expirationCriticalDays"], message: "Critical expiration window must be shorter than warning" });
});

const usersSchema = z.object({
  trafficLimitBytes: byteString, durationDays: z.number().int().min(1).max(3650).nullable(), enabled: z.boolean(), subscriptionEnabled: z.boolean(),
  trafficResetPolicy: z.literal("NEVER"), expirationBehavior: z.literal("DISABLE"), protocol: z.enum(INBOUND_PROTOCOLS),
}).strict();

const subpanelsSchema = z.object({
  userLimit: z.number().int().min(0).max(1_000_000).nullable(), trafficCreditBytes: byteString, expirationDays: z.number().int().min(1).max(3650).nullable(),
  subscriptionPermission: z.boolean(), trafficResetPermission: z.boolean(), userExtendPermission: z.boolean(), credentialRotationPermission: z.boolean(),
}).strict();

const agentsSchema = z.object({
  heartbeatIntervalSeconds: z.number().int().min(5).max(3600), offlineTimeoutSeconds: z.number().int().min(10).max(86_400), commandTimeoutSeconds: z.number().int().min(5).max(3600),
  metricsSamplingSeconds: z.number().int().min(5).max(3600), reconnectPolicy: z.enum(["EXPONENTIAL", "FIXED"]), updatePolicy: z.enum(["MANUAL", "NOTIFY"]),
  serverHealthIntervalSeconds: z.number().int().min(5).max(3600), xrayHealthIntervalSeconds: z.number().int().min(5).max(3600),
}).strict().refine((value) => value.offlineTimeoutSeconds > value.heartbeatIntervalSeconds, { path: ["offlineTimeoutSeconds"], message: "Offline timeout must exceed heartbeat interval" });

const trafficSchema = z.object({
  metricsSamplingSeconds: z.number().int().min(5).max(3600), rawRetentionDays: z.number().int().min(1).max(365), hourlyRetentionDays: z.number().int().min(7).max(1825),
  dailyRetentionDays: z.number().int().min(30).max(3650), displayUnit: z.enum(["AUTO", "GB", "TB"]), quotaWarningPercent: z.number().min(1).max(100),
  resetDefault: z.enum(["MANUAL", "MONTHLY"]), aggregationSchedule: z.enum(["HOURLY", "DAILY"]),
}).strict().superRefine((value, context) => {
  if (value.hourlyRetentionDays < value.rawRetentionDays) context.addIssue({ code: "custom", path: ["hourlyRetentionDays"], message: "Hourly retention must cover raw retention" });
  if (value.dailyRetentionDays < value.hourlyRetentionDays) context.addIssue({ code: "custom", path: ["dailyRetentionDays"], message: "Daily retention must cover hourly retention" });
});

const backupSchema = z.object({
  database: z.boolean(), applicationSettings: z.boolean(), xrayConfigurations: z.boolean(), subpanelData: z.boolean(), subscriptionMetadata: z.boolean(),
  schedule: z.enum(["MANUAL", "DAILY", "WEEKLY"]), scheduleTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), retentionCount: z.number().int().min(1).max(1000),
  retentionDays: z.number().int().min(1).max(3650), storageProvider: z.literal("LOCAL_MANAGED"),
}).strict().refine((value) => value.database || value.applicationSettings || value.xrayConfigurations || value.subpanelData || value.subscriptionMetadata, { message: "Choose at least one backup type" });

const datetimeSchema = z.object({
  timezone: z.string().min(1).max(100).refine((value) => { try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; } }, "Invalid IANA timezone"),
  dateFormat: z.enum(["YYYY-MM-DD", "DD/MM/YYYY", "YYYY/MM/DD"]), timeFormat: z.enum(["24H", "12H"]), calendar: z.enum(["GREGORIAN", "JALALI"]),
}).strict();

const updatesSchema = z.object({
  channel: z.enum(["stable", "preview"]), automaticPanelUpdates: z.literal(false), notifyWhenAvailable: z.boolean(), automaticAgentUpdates: z.literal(false),
}).strict();

export const settingsSchemas = {
  general: generalSchema, security: securitySchema, network: networkSchema, tls: tlsSchema, xray: xraySchema, subscription: subscriptionSchema,
  subscriptionFormats: subscriptionFormatsSchema, telegram: telegramSchema, email: emailSchema, notifications: notificationsSchema,
  users: usersSchema, subpanels: subpanelsSchema, agents: agentsSchema, traffic: trafficSchema, backup: backupSchema, datetime: datetimeSchema, updates: updatesSchema,
} satisfies Record<MasterSettingsSection, z.ZodTypeAny>;

export const defaultSettings: MasterSettingsValues = {
  general: { panelName: "NR PANEL", applicationTitle: "NR PANEL", description: "", publicPanelUrl: "", language: "fa", theme: "light", maintenanceMode: false, logoUrl: "", pageSize: 25, supportUrl: "" },
  security: { sessionTtlMinutes: 480, autoLogoutMinutes: 60, maximumConcurrentSessions: 5, loginRateLimit: 5, failedLoginThreshold: 5, lockoutMinutes: 15, minimumPasswordLength: 12, requireUppercase: true, requireLowercase: true, requireNumber: true, requireSpecial: true, ipAllowlist: [], securityEventRetentionDays: 365 },
  network: { listenAddress: "0.0.0.0", port: 3000, publicDomain: "", basePath: "/", trustedProxyCidrs: ["127.0.0.1/32", "::1/128"], publicUrl: "", allowedOrigins: [], reverseProxyAware: false, sessionTransport: "COOKIE" },
  tls: { certificatePath: "", privateKeyPath: "", httpsEnabled: false },
  xray: { desiredVersion: "", updateChannel: "stable", automaticUpdates: false, validateBeforeApply: true, backupBeforeApply: true, hotApply: true, restartOnlyWhenRequired: true, rollbackOnFailure: true, logLevel: "warning", statsEnabled: true },
  subscription: { enabled: true, publicDomain: "", listenAddress: "127.0.0.1", port: 4000, basePath: "/api/v1/sub/", publicUrl: "", reverseProxyUrl: "", protection: "TOKEN_AND_EXPIRY", updateIntervalHours: 24, remarkTemplate: "{{INBOUND}} - {{USER}}", profileTitle: "NR PANEL", profileSupportUrl: "", profileUpdateIntervalHours: 24 },
  subscriptionFormats: { rawEnabled: true, jsonEnabled: false, mihomoEnabled: false, remarkFormat: "{{INBOUND}} - {{USER}}", muxEnabled: false, xudpEnabled: false, directRulesEnabled: false, routingBehavior: "PANEL", clientDetection: false, finalRoute: "PROXY", dnsMode: "PRESERVE" },
  telegram: { enabled: false, botToken: "", adminChatIds: [], language: "fa", proxyUrl: "", apiEndpoint: "https://api.telegram.org", schedule: "IMMEDIATE", events: ["SECURITY_ALERT", "SERVER_OFFLINE", "AGENT_OFFLINE", "XRAY_DOWN", "BACKUP_FAILED"] },
  email: { enabled: false, smtpHost: "", smtpPort: 465, encryption: "TLS", username: "", password: "", fromAddress: "", fromName: "NR PANEL", recipients: [] },
  notifications: { channels: ["IN_APP"], events: ["SERVER_OFFLINE", "AGENT_OFFLINE", "XRAY_DOWN", "SECURITY_ALERT", "BACKUP_FAILED"], cpuWarning: 75, cpuCritical: 90, ramWarning: 75, ramCritical: 90, storageWarning: 80, storageCritical: 92, trafficWarning: 80, trafficCritical: 95, expirationWarningDays: 7, expirationCriticalDays: 2 },
  users: { trafficLimitBytes: null, durationDays: 30, enabled: true, subscriptionEnabled: true, trafficResetPolicy: "NEVER", expirationBehavior: "DISABLE", protocol: "VLESS" },
  subpanels: { userLimit: 100, trafficCreditBytes: null, expirationDays: 30, subscriptionPermission: true, trafficResetPermission: true, userExtendPermission: true, credentialRotationPermission: true },
  agents: { heartbeatIntervalSeconds: 30, offlineTimeoutSeconds: 90, commandTimeoutSeconds: 60, metricsSamplingSeconds: 30, reconnectPolicy: "EXPONENTIAL", updatePolicy: "MANUAL", serverHealthIntervalSeconds: 30, xrayHealthIntervalSeconds: 15 },
  traffic: { metricsSamplingSeconds: 30, rawRetentionDays: 7, hourlyRetentionDays: 90, dailyRetentionDays: 730, displayUnit: "AUTO", quotaWarningPercent: 80, resetDefault: "MANUAL", aggregationSchedule: "HOURLY" },
  backup: { database: true, applicationSettings: true, xrayConfigurations: true, subpanelData: true, subscriptionMetadata: true, schedule: "MANUAL", scheduleTime: "03:00", retentionCount: 14, retentionDays: 30, storageProvider: "LOCAL_MANAGED" },
  datetime: { timezone: "Asia/Tehran", dateFormat: "YYYY-MM-DD", timeFormat: "24H", calendar: "JALALI" },
  updates: { channel: "stable", automaticPanelUpdates: false, notifyWhenAvailable: true, automaticAgentUpdates: false },
};

export const settingsSectionSchema = z.enum(MASTER_SETTINGS_SECTIONS);
export const sectionPermission: Record<MasterSettingsSection, Permission> = {
  general: PERMISSIONS.SETTINGS_GENERAL_UPDATE, security: PERMISSIONS.SETTINGS_SECURITY_UPDATE, network: PERMISSIONS.SETTINGS_NETWORK_UPDATE,
  tls: PERMISSIONS.SETTINGS_NETWORK_UPDATE, xray: PERMISSIONS.SETTINGS_XRAY_UPDATE, subscription: PERMISSIONS.SETTINGS_SUBSCRIPTION_UPDATE,
  subscriptionFormats: PERMISSIONS.SETTINGS_SUBSCRIPTION_UPDATE, telegram: PERMISSIONS.SETTINGS_INTEGRATIONS_UPDATE, email: PERMISSIONS.SETTINGS_INTEGRATIONS_UPDATE,
  notifications: PERMISSIONS.SETTINGS_INTEGRATIONS_UPDATE, users: PERMISSIONS.SETTINGS_GENERAL_UPDATE, subpanels: PERMISSIONS.SETTINGS_GENERAL_UPDATE,
  agents: PERMISSIONS.SETTINGS_NETWORK_UPDATE, traffic: PERMISSIONS.SETTINGS_GENERAL_UPDATE, backup: PERMISSIONS.SETTINGS_BACKUP_UPDATE,
  datetime: PERMISSIONS.SETTINGS_GENERAL_UPDATE, updates: PERMISSIONS.SETTINGS_UPDATE_MANAGE,
};
export const restartScopesBySection: Partial<Record<MasterSettingsSection, RestartScope[]>> = {
  network: ["PANEL"], tls: ["PANEL"], xray: ["XRAY"], subscription: ["SUBSCRIPTION"], agents: ["AGENT"], traffic: ["AGENT"], datetime: ["PANEL"],
};
export const secretFields = { telegram: { botToken: "telegram.botToken" }, email: { password: "email.password" }, tls: { privateKeyPath: "tls.privateKeyPath" } } as const;
export type SecretName = "telegram.botToken" | "email.password" | "tls.privateKeyPath";

export const apiTokenCreateSchema = z.object({
  name: z.string().trim().min(2).max(120), permissions: z.array(z.enum(permissionValues as [Permission, ...Permission[]])).min(1).max(permissionValues.length).transform((items) => [...new Set(items)]),
  expiresAt: z.string().datetime().nullable(), cidrAllowlist: cidrList,
}).strict().refine((value) => !value.expiresAt || Date.parse(value.expiresAt) > Date.now(), { path: ["expiresAt"], message: "Expiration must be in the future" });
export const apiTokenStateSchema = z.object({ enabled: z.boolean(), confirmation: z.literal("CONFIRM") }).strict();
export const confirmationSchema = z.object({ confirmation: z.literal("CONFIRM") }).strict();
