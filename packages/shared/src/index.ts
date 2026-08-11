export const ROLES = {
  OWNER: "OWNER",
  ADMIN: "ADMIN",
  RESELLER: "RESELLER",
  SUB_RESELLER: "SUB_RESELLER",
} as const;

export const roleValues = Object.values(ROLES);
export type Role = (typeof roleValues)[number];

export const PERMISSIONS = {
  DASHBOARD_VIEW: "DASHBOARD_VIEW",
  ADMIN_VIEW: "ADMIN_VIEW",
  ADMIN_CREATE: "ADMIN_CREATE",
  ADMIN_UPDATE: "ADMIN_UPDATE",
  ADMIN_DISABLE: "ADMIN_DISABLE",
  SERVER_VIEW: "SERVER_VIEW",
  SERVER_CREATE: "SERVER_CREATE",
  SERVER_UPDATE: "SERVER_UPDATE",
  SERVER_CONTROL: "SERVER_CONTROL",
  SERVER_JOIN_TOKEN_CREATE: "SERVER_JOIN_TOKEN_CREATE",
  SERVER_REVOKE: "SERVER_REVOKE",
  USER_VIEW: "USER_VIEW",
  USER_CREATE: "USER_CREATE",
  USER_UPDATE: "USER_UPDATE",
  USER_DELETE: "USER_DELETE",
  USER_EXTEND: "USER_EXTEND",
  USER_RESET_TRAFFIC: "USER_RESET_TRAFFIC",
  CONFIG_VIEW: "CONFIG_VIEW",
  CONFIG_CREATE: "CONFIG_CREATE",
  CONFIG_DELETE: "CONFIG_DELETE",
  SUBPANEL_VIEW: "SUBPANEL_VIEW",
  SUBPANEL_CREATE: "SUBPANEL_CREATE",
  SUBPANEL_UPDATE: "SUBPANEL_UPDATE",
  SUBPANEL_DISABLE: "SUBPANEL_DISABLE",
  TRAFFIC_VIEW: "TRAFFIC_VIEW",
  LOG_VIEW: "LOG_VIEW",
  BACKUP_VIEW: "BACKUP_VIEW",
  BACKUP_CREATE: "BACKUP_CREATE",
  BACKUP_RESTORE: "BACKUP_RESTORE",
  SECURITY_VIEW: "SECURITY_VIEW",
  SETTINGS_VIEW: "SETTINGS_VIEW",
  SETTINGS_UPDATE: "SETTINGS_UPDATE",
  SETTINGS_GENERAL_UPDATE: "SETTINGS_GENERAL_UPDATE",
  SETTINGS_SECURITY_UPDATE: "SETTINGS_SECURITY_UPDATE",
  SETTINGS_NETWORK_UPDATE: "SETTINGS_NETWORK_UPDATE",
  SETTINGS_XRAY_UPDATE: "SETTINGS_XRAY_UPDATE",
  SETTINGS_SUBSCRIPTION_UPDATE: "SETTINGS_SUBSCRIPTION_UPDATE",
  SETTINGS_INTEGRATIONS_UPDATE: "SETTINGS_INTEGRATIONS_UPDATE",
  SETTINGS_BACKUP_UPDATE: "SETTINGS_BACKUP_UPDATE",
  SETTINGS_UPDATE_MANAGE: "SETTINGS_UPDATE_MANAGE",
  SETTINGS_ADVANCED_VIEW: "SETTINGS_ADVANCED_VIEW",
  XRAY_VIEW: "XRAY_VIEW",
  XRAY_CONTROL: "XRAY_CONTROL",
  SYSTEM_REBOOT: "SYSTEM_REBOOT",
  SYSTEM_SHUTDOWN: "SYSTEM_SHUTDOWN",
} as const;

export const permissionValues = Object.values(PERMISSIONS);
export type Permission = (typeof permissionValues)[number];

export const agentActions = ["xray.start", "xray.stop", "xray.restart", "system.reboot", "system.shutdown"] as const;
export type AgentAction = (typeof agentActions)[number];
export type DataState = "LIVE" | "DEMO" | "DISCONNECTED" | "ERROR";

export const SERVER_ROLES = ["ENTRY", "EXIT", "RELAY", "HYBRID"] as const;
export type ServerRole = (typeof SERVER_ROLES)[number];
export const SERVER_LIFECYCLE_STATUSES = ["PENDING_INSTALL", "REGISTERED", "CONNECTING", "ONLINE", "OFFLINE", "ERROR", "REVOKED", "MAINTENANCE", "WARNING"] as const;
export type ServerLifecycleStatus = (typeof SERVER_LIFECYCLE_STATUSES)[number];

export type ServerMetricSnapshot = {
  sampledAt: string;
  cpu: { usage: number | null; cores: number | null };
  ram: { used: string | null; total: string | null };
  swap: { used: string | null; total: string | null };
  storage: { used: string | null; total: string | null };
  load: [number | null, number | null, number | null];
  uptimeSeconds: string | null;
  network: { rxRate: string | null; txRate: string | null; rxTotal: string | null; txTotal: string | null };
  connections: { tcp: number | null; udp: number | null };
  processCount: number | null;
};

export type ServerSummary = {
  id: string;
  displayName: string;
  role: ServerRole;
  country: string | null;
  region: string | null;
  provider: string | null;
  description: string | null;
  status: ServerLifecycleStatus;
  dataState: Exclude<DataState, "DEMO">;
  hostname: string | null;
  publicAddress: string | null;
  ipv4: string | null;
  ipv6: string | null;
  os: string | null;
  kernel: string | null;
  architecture: string | null;
  agentVersion: string | null;
  agentStatus: "PENDING" | "REGISTERED" | "ONLINE" | "ERROR" | "REVOKED";
  xrayStatus: "ONLINE" | "NOT_INSTALLED" | "ERROR" | "STOPPED" | "UNKNOWN";
  xrayVersion: string | null;
  lastHeartbeatAt: string | null;
  lastMetricsAt: string | null;
  metrics: ServerMetricSnapshot | null;
  createdAt: string;
};

export type ServerJoinCommand = {
  serverId: string;
  joinToken: string;
  expiresAt: string;
  installCommand: string;
  masterUrl: string;
};

export type MasterDashboardData = {
  state: Exclude<DataState, "DEMO">;
  updatedAt: string | null;
  server: ServerSummary | null;
  error?: string;
};

export const hasPermission = (role: Role, granted: readonly Permission[], required: Permission) =>
  role === ROLES.OWNER || granted.includes(required);

export const canAccessTenant = (role: Role, tenantIds: readonly string[], resourceTenantId: string) =>
  role === ROLES.OWNER || tenantIds.includes(resourceTenantId);

export const INBOUND_PROTOCOLS = ["VLESS", "VMess", "Trojan", "Shadowsocks"] as const;
export type InboundProtocol = (typeof INBOUND_PROTOCOLS)[number];

export const INBOUND_TRANSPORTS = ["TCP", "WEBSOCKET", "GRPC", "XHTTP"] as const;
export type InboundTransport = (typeof INBOUND_TRANSPORTS)[number];

export const INBOUND_SECURITIES = ["NONE", "TLS", "REALITY"] as const;
export type InboundSecurity = (typeof INBOUND_SECURITIES)[number];
export const PRESERVE_SECRET_VALUE = "__NR_PANEL_PRESERVE_SECRET__";

export type XrayFallback = {
  name?: string;
  alpn?: "" | "h2" | "http/1.1";
  path?: string;
  destination: string;
  proxyProtocolVersion: 0 | 1 | 2;
};

export type InboundProtocolConfig =
  | { kind: "VLESS"; decryption: "none" }
  | { kind: "VMess"; disableInsecureEncryption: boolean }
  | { kind: "Trojan" }
  | { kind: "Shadowsocks"; method: "aes-128-gcm" | "aes-256-gcm" | "chacha20-poly1305" | "2022-blake3-aes-128-gcm" | "2022-blake3-aes-256-gcm"; network: "tcp" | "udp" | "tcp,udp"; serverPassword: string };

export type InboundTransportConfig =
  | { kind: "TCP"; headerType: "none" | "http"; requestPath?: string }
  | { kind: "WEBSOCKET"; path: string; host?: string; heartbeatPeriod?: number }
  | { kind: "GRPC"; serviceName: string; multiMode: boolean; idleTimeout?: number; healthCheckTimeout?: number }
  | { kind: "XHTTP"; path: string; host?: string; mode: "auto" | "packet-up" | "stream-up" };

export type InboundSecurityConfig =
  | { kind: "NONE" }
  | { kind: "TLS"; serverName?: string; alpn: string[]; minVersion: "1.2" | "1.3"; certificateFile: string; keyFile: string; rejectUnknownSni: boolean }
  | { kind: "REALITY"; target: string; serverNames: string[]; privateKey: string; shortIds: string[]; show: boolean; proxyProtocolVersion: 0 | 1 | 2 };

export type SniffingConfig = {
  enabled: boolean;
  destinationOverrides: Array<"http" | "tls" | "quic" | "fakedns">;
  metadataOnly: boolean;
  routeOnly: boolean;
  domainsExcluded: string[];
  domainsOnly: string[];
};

export type SockoptConfig = {
  acceptProxyProtocol: boolean;
  tcpFastOpen: boolean;
  tcpKeepAliveIdle?: number;
  tcpKeepAliveInterval?: number;
  tcpUserTimeout?: number;
  congestion?: "bbr" | "cubic" | "reno";
  domainStrategy: "AsIs" | "UseIP" | "UseIPv4" | "UseIPv6" | "ForceIP" | "ForceIPv4" | "ForceIPv6";
  dialerProxy?: string;
  trustedXForwardedFor: string[];
};

export type InboundRoutingConfig = { outboundTag?: string; balancerTag?: string };

export type InboundClientSummary = {
  id: string;
  userId: string;
  name: string;
  email: string | null;
  publicId: string;
  credentialPreview: string;
  enabled: boolean;
  trafficLimit: string | null;
  trafficUsed: string;
  expiresAt: string | null;
  subscriptionEnabled: boolean;
  expired: boolean;
};

export type InboundSummary = {
  id: string;
  tenantId: string;
  serverId: string;
  serverName: string;
  name: string;
  tag: string;
  listenIp: string;
  port: number;
  protocol: InboundProtocol;
  transport: InboundTransport;
  security: InboundSecurity;
  enabled: boolean;
  trafficLimit: string | null;
  trafficUsed: string;
  expiresAt: string | null;
  desiredRevision: number;
  appliedRevision: number | null;
  applyStatus: "PENDING" | "APPLYING" | "APPLIED" | "FAILED" | "ROLLED_BACK";
  lastApplyError: string | null;
  clientCount: number;
  activeClientCount: number;
  clients: InboundClientSummary[];
};

export type InboundDetail = InboundSummary & {
  protocolConfig: InboundProtocolConfig;
  transportConfig: InboundTransportConfig;
  securityConfig: InboundSecurityConfig;
  sniffing: SniffingConfig;
  sockopt: SockoptConfig;
  fallbacks: XrayFallback[];
  routing: InboundRoutingConfig;
  advancedConfig: Record<string, unknown> | null;
};

export type InboundServerOption = { id: string; name: string; status: ServerLifecycleStatus; xrayVersion: string | null };

export type InboundsPageData = {
  inbounds: InboundSummary[];
  servers: InboundServerOption[];
  runtime: { state: "CONNECTED" | "DISCONNECTED"; message: string; supportsXhttp: boolean; supportsHotApply: boolean };
  userDefaults?: UserDefaultSettings;
};

export const SUBPANEL_CAPABILITIES = ["subscription", "trafficReset", "extend", "credentialRotation"] as const;
export type SubpanelCapability = (typeof SUBPANEL_CAPABILITIES)[number];

export type SubpanelQuotaSnapshot = {
  userLimit: number | null;
  createdUsers: number;
  remainingUsers: number | null;
  trafficCredit: string | null;
  allocatedTraffic: string;
  remainingAllocatableTraffic: string | null;
  actualTrafficUsed: string;
  expiresAt: string | null;
  status: "ACTIVE" | "DISABLED" | "EXPIRED";
};

export type SubpanelServerStatus = {
  id: string;
  name: string;
  hostname: string | null;
  status: ServerLifecycleStatus;
  dataState: DataState;
  sampledAt: string | null;
  cpuPercent: number | null;
  ramBytes: string | null;
  storageBytes: string | null;
  uptimeSeconds: string | null;
  xrayStatus: string | null;
  xrayVersion: string | null;
  rxBytes: string | null;
  txBytes: string | null;
};

export type SubpanelAssignedInbound = {
  id: string;
  name: string;
  tag: string;
  serverId: string;
  serverName: string;
  protocol: InboundProtocol;
  enabled: boolean;
  userCount: number;
  trafficUsed: string;
};

export type SubpanelUserSummary = {
  id: string;
  clientId: string;
  inboundId: string;
  inboundName: string;
  serverId: string;
  serverName: string;
  username: string;
  displayName: string;
  protocol: InboundProtocol;
  enabled: boolean;
  trafficLimit: string | null;
  trafficUsed: string;
  remainingTraffic: string | null;
  expiresAt: string | null;
  expired: boolean;
  subscriptionEnabled: boolean;
  configAvailable: boolean;
  subscriptionAvailable: boolean;
  createdAt: string;
};

export type SubpanelCapabilities = Record<SubpanelCapability, boolean>;

export type SubpanelDashboardData = {
  panelName: string;
  quota: SubpanelQuotaSnapshot;
  capabilities: SubpanelCapabilities;
  servers: SubpanelServerStatus[];
};

export type SubpanelUsersPageData = {
  quota: SubpanelQuotaSnapshot;
  capabilities: SubpanelCapabilities;
  assignedInbounds: SubpanelAssignedInbound[];
  users: SubpanelUserSummary[];
};

export type SubpanelTrafficPoint = { bucket: string; rxBytes: string; txBytes: string };
export type SubpanelTrafficBreakdown = { id: string; label: string; trafficUsed: string };
export type SubpanelTrafficData = {
  range: "24h" | "7d" | "30d" | "all";
  quota: SubpanelQuotaSnapshot;
  series: SubpanelTrafficPoint[];
  topUsers: SubpanelTrafficBreakdown[];
  byInbound: SubpanelTrafficBreakdown[];
  dataState: DataState;
};

export type SubpanelSubscriptionSummary = {
  id: string;
  userId: string;
  username: string;
  inboundName: string;
  enabled: boolean;
  expiresAt: string | null;
  lastAccessAt: string | null;
  rotatedAt: string | null;
};

export type SubpanelSettingsData = {
  panelName: string;
  displayName: string;
  username: string;
  email: string | null;
  theme: "light" | "dark";
  language: "fa" | "en";
  capabilities: SubpanelCapabilities;
};

export type MasterSubpanelSummary = {
  tenantId: string;
  panelName: string;
  username: string;
  status: "ACTIVE" | "DISABLED" | "EXPIRED";
  userLimit: number | null;
  trafficCredit: string | null;
  expiresAt: string | null;
  allowedServerIds: string[];
  assignedInboundIds: string[];
  allowedProtocols: InboundProtocol[];
  capabilities: SubpanelCapabilities;
  createdUsers: number;
  allocatedTraffic: string;
};

export type MasterSubpanelOptions = {
  servers: Array<{ id: string; name: string }>;
  inbounds: Array<{ id: string; name: string; serverId: string; serverName: string; protocol: InboundProtocol; enabled: boolean }>;
  defaults?: SubpanelDefaultSettings;
};

export const MASTER_SETTINGS_SECTIONS = [
  "general", "security", "network", "tls", "xray", "subscription", "subscriptionFormats", "telegram", "email",
  "notifications", "users", "subpanels", "agents", "traffic", "backup", "datetime", "updates",
] as const;
export type MasterSettingsSection = (typeof MASTER_SETTINGS_SECTIONS)[number];
export type SettingsNavigationSection = MasterSettingsSection | "api" | "advanced";
export type RestartScope = "PANEL" | "XRAY" | "AGENT" | "SUBSCRIPTION";

export type GeneralSettings = {
  panelName: string; applicationTitle: string; description: string; publicPanelUrl: string; language: "fa" | "en";
  theme: "light" | "dark" | "system"; maintenanceMode: boolean; logoUrl: string; pageSize: number; supportUrl: string;
};
export type SecuritySettings = {
  sessionTtlMinutes: number; autoLogoutMinutes: number; maximumConcurrentSessions: number; loginRateLimit: number;
  failedLoginThreshold: number; lockoutMinutes: number; minimumPasswordLength: number; requireUppercase: boolean;
  requireLowercase: boolean; requireNumber: boolean; requireSpecial: boolean; ipAllowlist: string[]; securityEventRetentionDays: number;
};
export type NetworkSettings = {
  listenAddress: string; port: number; publicDomain: string; basePath: string; trustedProxyCidrs: string[]; publicUrl: string;
  allowedOrigins: string[]; reverseProxyAware: boolean; sessionTransport: "COOKIE";
};
export type TlsSettings = {
  certificatePath: string; privateKeyPath: string; httpsEnabled: boolean;
};
export type XraySettings = {
  desiredVersion: string; updateChannel: "stable" | "preview"; automaticUpdates: boolean; validateBeforeApply: boolean;
  backupBeforeApply: boolean; hotApply: boolean; restartOnlyWhenRequired: boolean; rollbackOnFailure: boolean;
  logLevel: "debug" | "info" | "warning" | "error" | "none"; statsEnabled: boolean;
};
export type SubscriptionSettings = {
  enabled: boolean; publicDomain: string; listenAddress: string; port: number; basePath: string; publicUrl: string;
  reverseProxyUrl: string; protection: "TOKEN" | "TOKEN_AND_EXPIRY"; updateIntervalHours: number; remarkTemplate: string;
  profileTitle: string; profileSupportUrl: string; profileUpdateIntervalHours: number;
};
export type SubscriptionFormatsSettings = {
  rawEnabled: boolean; jsonEnabled: boolean; mihomoEnabled: boolean; remarkFormat: string; muxEnabled: boolean; xudpEnabled: boolean;
  directRulesEnabled: boolean; routingBehavior: "PANEL" | "CLIENT" | "MINIMAL"; clientDetection: boolean;
  finalRoute: "PROXY" | "DIRECT" | "BLOCK"; dnsMode: "SYSTEM" | "REMOTE" | "PRESERVE";
};
export type TelegramSettings = {
  enabled: boolean; botToken: string; adminChatIds: string[]; language: "fa" | "en"; proxyUrl: string;
  apiEndpoint: string; schedule: "IMMEDIATE" | "DIGEST_HOURLY" | "DIGEST_DAILY"; events: string[];
};
export type EmailSettings = {
  enabled: boolean; smtpHost: string; smtpPort: number; encryption: "TLS" | "STARTTLS"; username: string; password: string;
  fromAddress: string; fromName: string; recipients: string[];
};
export type NotificationSettings = {
  channels: Array<"IN_APP" | "TELEGRAM" | "EMAIL">; events: string[]; cpuWarning: number; cpuCritical: number;
  ramWarning: number; ramCritical: number; storageWarning: number; storageCritical: number; trafficWarning: number;
  trafficCritical: number; expirationWarningDays: number; expirationCriticalDays: number;
};
export type UserDefaultSettings = {
  trafficLimitBytes: string | null; durationDays: number | null; enabled: boolean; subscriptionEnabled: boolean;
  trafficResetPolicy: "NEVER" | "MONTHLY"; expirationBehavior: "DISABLE" | "DELETE"; protocol: InboundProtocol;
};
export type SubpanelDefaultSettings = {
  userLimit: number | null; trafficCreditBytes: string | null; expirationDays: number | null; subscriptionPermission: boolean;
  trafficResetPermission: boolean; userExtendPermission: boolean; credentialRotationPermission: boolean;
};
export type AgentSettings = {
  heartbeatIntervalSeconds: number; offlineTimeoutSeconds: number; commandTimeoutSeconds: number; metricsSamplingSeconds: number;
  reconnectPolicy: "EXPONENTIAL" | "FIXED"; updatePolicy: "MANUAL" | "NOTIFY"; serverHealthIntervalSeconds: number; xrayHealthIntervalSeconds: number;
};
export type TrafficSettings = {
  metricsSamplingSeconds: number; rawRetentionDays: number; hourlyRetentionDays: number; dailyRetentionDays: number;
  displayUnit: "AUTO" | "GB" | "TB"; quotaWarningPercent: number; resetDefault: "MANUAL" | "MONTHLY";
  aggregationSchedule: "HOURLY" | "DAILY";
};
export type BackupSettings = {
  database: boolean; applicationSettings: boolean; xrayConfigurations: boolean; subpanelData: boolean; subscriptionMetadata: boolean;
  schedule: "MANUAL" | "DAILY" | "WEEKLY"; scheduleTime: string; retentionCount: number; retentionDays: number;
  storageProvider: "LOCAL_MANAGED";
};
export type DateTimeSettings = {
  timezone: string; dateFormat: "YYYY-MM-DD" | "DD/MM/YYYY" | "YYYY/MM/DD"; timeFormat: "24H" | "12H"; calendar: "GREGORIAN" | "JALALI";
};
export type UpdateSettings = {
  channel: "stable" | "preview"; automaticPanelUpdates: false; notifyWhenAvailable: boolean; automaticAgentUpdates: false;
};

export type MasterSettingsValues = {
  general: GeneralSettings; security: SecuritySettings; network: NetworkSettings; tls: TlsSettings; xray: XraySettings;
  subscription: SubscriptionSettings; subscriptionFormats: SubscriptionFormatsSettings; telegram: TelegramSettings; email: EmailSettings;
  notifications: NotificationSettings; users: UserDefaultSettings; subpanels: SubpanelDefaultSettings; agents: AgentSettings;
  traffic: TrafficSettings; backup: BackupSettings; datetime: DateTimeSettings; updates: UpdateSettings;
};

export type SettingsSectionEnvelope<S extends MasterSettingsSection = MasterSettingsSection> = {
  section: S; value: MasterSettingsValues[S]; version: number; updatedAt: string | null; updatedBy: string | null;
  restartRequired: RestartScope[]; configuredSecrets: string[];
  runtimeApply?: Array<{ state: "APPLIED" | "FAILED" | "ROLLED_BACK"; strategy: string; reason: string; errorCode?: string; errorMessage?: string }>;
};
export type SettingsWarning = { code: string; section: SettingsNavigationSection; level: "info" | "warning" | "critical"; message: string };
export type ConnectionDiagnostics = { host: string; protocol: string; port: number | null; https: boolean; environment: string; panelVersion: string };
export type CertificateDiagnostics = { status: "ACTIVE" | "MISSING" | "INVALID" | "UNAVAILABLE"; expiresAt: string | null; subject: string | null; lastCheckedAt: string };
export type SystemDiagnostics = {
  database: "HEALTHY" | "UNHEALTHY"; redis: "UNAVAILABLE"; api: "HEALTHY"; websocket: "UNAVAILABLE";
  agents: { total: number; online: number }; xray: { total: number; running: number; configValid: number; versions: string[]; nodes: string[] };
  storage: "UNAVAILABLE"; queue: "UNAVAILABLE";
};
export type MasterSettingsSnapshot = {
  sections: { [S in MasterSettingsSection]: SettingsSectionEnvelope<S> };
  warnings: SettingsWarning[]; connection: ConnectionDiagnostics; certificate: CertificateDiagnostics; diagnostics: SystemDiagnostics;
};
export type SettingsHistoryEntry = { id: string; section: MasterSettingsSection; actorId: string | null; actorUsername: string | null; changedFields: string[]; createdAt: string };

export type ApiTokenSummary = {
  id: string; name: string; prefix: string; permissions: Permission[]; cidrAllowlist: string[]; expiresAt: string | null;
  lastUsedAt: string | null; enabled: boolean; createdAt: string; revokedAt: string | null;
};
export type ApiTokenCreated = { token: ApiTokenSummary; secret: string };
