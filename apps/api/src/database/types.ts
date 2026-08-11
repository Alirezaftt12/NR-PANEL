import type { ColumnType, Generated } from "kysely";
import type { InboundProtocol, InboundSecurity, InboundTransport, MasterSettingsSection, Permission, RestartScope, Role, ServerLifecycleStatus, ServerRole } from "@nr/shared";

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type MutableTimestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface RoleTable { id: Generated<string>; name: Role; created_at: Generated<Date> }
export interface PermissionTable { id: Generated<string>; code: Permission; description: string }
export interface RolePermissionTable { role_id: string; permission_id: string }
export interface AdminPermissionTable { admin_id: string; permission_id: string; granted_by: string | null; created_at: Generated<Date> }
export interface TenantTable {
  id: Generated<string>;
  parent_id: string | null;
  name: string;
  slug: string;
  status: "ACTIVE" | "DISABLED" | "EXPIRED";
  created_by: string | null;
  traffic_quota: string | null;
  traffic_used: Generated<string>;
  user_limit: number | null;
  config_limit: number | null;
  expires_at: Timestamp | null;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}
export interface AdminTable {
  id: Generated<string>;
  username: string;
  email: string | null;
  password_hash: string;
  role_id: string;
  tenant_id: string;
  enabled: boolean;
  status: "ACTIVE" | "DISABLED";
  failed_login_count: Generated<number>;
  last_activity_at: Timestamp | null;
  last_login_at: Timestamp | null;
  password_changed_at: Timestamp;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}
export interface TenantMembershipTable { tenant_id: string; admin_id: string; permissions: unknown }
export interface SessionTable {
  id: string;
  admin_id: string;
  token_hash: string;
  ip: string | null;
  user_agent: string | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  last_activity_at: Timestamp;
  created_at: Generated<Date>;
}
export interface LoginAttemptTable {
  id: Generated<string>;
  identifier_hash: string;
  ip: string | null;
  successful: boolean;
  failure_reason: string | null;
  attempted_at: Generated<Date>;
}
export interface AuditLogTable {
  id: Generated<string>;
  timestamp: Generated<Date>;
  severity: "debug" | "info" | "warning" | "error" | "critical";
  category: "SERVER" | "XRAY" | "SUB_PANEL" | "ADMIN" | "SECURITY" | "CONFIG" | "DATABASE" | "BACKUP" | "SYSTEM" | "ERROR";
  actor_id: string | null;
  actor_role: Role | null;
  tenant_id: string | null;
  server_id: string | null;
  ip: string | null;
  action: string;
  message: string;
  target_type: string | null;
  target_id: string | null;
  request_id: string | null;
  metadata: unknown;
}

export interface ServerTable {
  id: Generated<string>;
  tenant_id: string;
  display_name: string;
  hostname: string | null;
  ipv4: string | null;
  ipv6: string | null;
  region: string | null;
  role: ServerRole;
  country: string | null;
  provider: string | null;
  description: string | null;
  public_address: string | null;
  last_metrics_at: Timestamp | null;
  status: ServerLifecycleStatus;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}

export interface PanelInstanceTable { id: Generated<string>; singleton: boolean; public_url: string | null; created_at: Generated<Date>; updated_at: MutableTimestamp }
export interface ServerJoinTokenTable {
  id: Generated<string>; server_id: string; master_instance_id: string; token_hash: string; purpose: "SERVER_JOIN";
  expires_at: Timestamp; used_at: Timestamp | null; revoked_at: Timestamp | null; created_by: string | null; created_at: Generated<Date>;
}
export interface ServerAgentTable {
  id: Generated<string>; server_id: string; key_id: string; public_key_fingerprint: string; credential_hash: string | null;
  status: "REGISTERED" | "ONLINE" | "ERROR" | "REVOKED"; version: string | null; registered_at: Timestamp | null;
  rotated_at: Timestamp | null; last_heartbeat_at: Timestamp | null; last_metrics_at: Timestamp | null; failed_auth_count: Generated<number>; created_at: Generated<Date>;
}
export interface AgentRequestNonceTable { request_id: string; server_id: string; received_at: Generated<Date> }
export interface ServerMetricsLatestTable {
  server_id: string; sampled_at: Timestamp; cpu_usage: string | null; cpu_cores: number | null; ram_used: string | null; ram_total: string | null;
  swap_used: string | null; swap_total: string | null; storage_used: string | null; storage_total: string | null;
  load_1: string | null; load_5: string | null; load_15: string | null; uptime_seconds: string | null;
  network_rx_rate: string | null; network_tx_rate: string | null; network_rx_total: string | null; network_tx_total: string | null;
  tcp_connections: number | null; udp_connections: number | null; process_count: number | null; hostname: string | null; os_name: string | null;
  kernel: string | null; architecture: string | null; ipv4: string | null; ipv6: string | null; agent_version: string | null;
  agent_health: "ONLINE" | "ERROR"; xray_status: "ONLINE" | "NOT_INSTALLED" | "ERROR" | "STOPPED"; xray_version: string | null;
  xray_uptime_seconds: string | null; xray_config_valid: boolean | null; payload: unknown;
}

export interface XrayInstanceTable {
  id: Generated<string>;
  server_id: string;
  version: string | null;
  status: string;
  config_valid: boolean | null;
  last_restart_at: Timestamp | null;
  uptime_seconds: string | null;
  updated_at: MutableTimestamp;
}

export interface InboundTable {
  id: Generated<string>;
  xray_instance_id: string;
  tenant_id: string;
  name: string;
  tag: string;
  listen_ip: string;
  protocol: InboundProtocol;
  port: number;
  enabled: boolean;
  transport: InboundTransport;
  security: InboundSecurity;
  settings: unknown;
  protocol_config: unknown;
  transport_config: unknown;
  security_config: unknown;
  sniffing_config: unknown;
  sockopt_config: unknown;
  fallbacks_config: unknown;
  routing_config: unknown;
  advanced_config: unknown | null;
  traffic_limit: string | null;
  traffic_used: string;
  expires_at: Timestamp | null;
  desired_revision: number;
  applied_revision: number | null;
  apply_status: "PENDING" | "APPLYING" | "APPLIED" | "FAILED" | "ROLLED_BACK";
  last_apply_error: string | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}

export interface VpnUserTable {
  id: Generated<string>;
  tenant_id: string;
  server_id: string | null;
  created_by: string | null;
  username: string;
  display_name: string;
  email: string | null;
  uuid: string;
  protocol: InboundProtocol;
  traffic_limit: string | null;
  traffic_used: string;
  expires_at: Timestamp | null;
  enabled: boolean;
  subscription_enabled: boolean;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}

export interface InboundClientTable {
  id: Generated<string>;
  inbound_id: string;
  vpn_user_id: string;
  tenant_id: string;
  credential_ciphertext: string;
  flow: string | null;
  enabled: boolean;
  traffic_limit: string | null;
  traffic_used: string;
  expires_at: Timestamp | null;
  created_by: string | null;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}

export interface XrayConfigBackupTable {
  id: Generated<string>;
  tenant_id: string;
  xray_instance_id: string;
  config_ciphertext: string;
  config_hash: string;
  created_by: string | null;
  created_at: Generated<Date>;
}

export interface InboundApplyRevisionTable {
  id: Generated<string>;
  inbound_id: string;
  tenant_id: string;
  desired_revision: number;
  strategy: "NOOP" | "HOT_CLIENTS" | "HOT_INBOUND" | "RESTART_REQUIRED";
  status: "VALIDATING" | "APPLYING" | "APPLIED" | "FAILED" | "ROLLED_BACK";
  desired_hash: string;
  previous_hash: string | null;
  backup_id: string | null;
  validation_errors: unknown;
  error_code: string | null;
  error_message: string | null;
  started_at: Generated<Date>;
  completed_at: Timestamp | null;
  created_by: string | null;
}

export interface SubpanelSettingsTable {
  tenant_id: string;
  panel_name: string;
  display_name: string;
  allowed_protocols: InboundProtocol[];
  allow_subscription: boolean;
  allow_traffic_reset: boolean;
  allow_extend: boolean;
  allow_credential_rotation: boolean;
  theme: "light" | "dark";
  language: "fa" | "en";
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}

export interface SubpanelServerAssignmentTable {
  tenant_id: string;
  server_id: string;
  assigned_by: string | null;
  created_at: Generated<Date>;
}

export interface SubpanelInboundAssignmentTable {
  tenant_id: string;
  inbound_id: string;
  assigned_by: string | null;
  created_at: Generated<Date>;
}

export interface ConfigTable {
  id: Generated<string>;
  tenant_id: string;
  vpn_user_id: string;
  server_id: string | null;
  protocol: string;
  template_version: string | null;
  generated_at: Generated<Date>;
  expires_at: Timestamp | null;
  revoked_at: Timestamp | null;
  inbound_client_id: string | null;
  config_ciphertext: string | null;
  share_uri_ciphertext: string | null;
  format: "URI" | "JSON";
}

export interface SubscriptionTable {
  id: Generated<string>;
  tenant_id: string;
  vpn_user_id: string;
  token_hash: string;
  expires_at: Timestamp | null;
  revoked_at: Timestamp | null;
  last_access_at: Timestamp | null;
  created_at: Generated<Date>;
  token_ciphertext: string | null;
  enabled: boolean;
  rotated_at: Timestamp | null;
}

export interface TrafficSampleTable {
  id: Generated<string>;
  server_id: string;
  sampled_at: Generated<Date>;
  rx_bytes: string;
  tx_bytes: string;
  cpu_percent: string | null;
  ram_bytes: string | null;
}

export interface TrafficAggregateTable {
  id: Generated<string>;
  tenant_id: string | null;
  server_id: string | null;
  vpn_user_id: string | null;
  bucket_start: Timestamp;
  granularity: "hour" | "day" | "month";
  rx_bytes: string;
  tx_bytes: string;
}

export interface VpnUserUsageTable {
  id: Generated<string>;
  vpn_user_id: string;
  sampled_at: Generated<Date>;
  upload_bytes: string;
  download_bytes: string;
}

export interface MasterSettingsTable {
  namespace: MasterSettingsSection;
  value: unknown;
  version: number;
  restart_scopes: RestartScope[];
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}

export interface MasterSettingSecretTable {
  name: "telegram.botToken" | "email.password" | "tls.privateKeyPath";
  ciphertext: string;
  updated_by: string | null;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}

export interface SettingsChangeHistoryTable {
  id: Generated<string>;
  namespace: MasterSettingsSection;
  actor_id: string | null;
  changed_fields: string[];
  before_metadata: unknown;
  after_metadata: unknown;
  request_id: string | null;
  ip: string | null;
  created_at: Generated<Date>;
}

export interface ApiTokenTable {
  id: Generated<string>;
  name: string;
  prefix: string;
  token_hash: string;
  permissions: Permission[];
  cidr_allowlist: string[];
  created_by: string;
  expires_at: Timestamp | null;
  last_used_at: Timestamp | null;
  enabled: boolean;
  revoked_at: Timestamp | null;
  created_at: Generated<Date>;
  updated_at: MutableTimestamp;
}

export interface SecurityDatabase {
  roles: RoleTable;
  permissions: PermissionTable;
  role_permissions: RolePermissionTable;
  admin_permissions: AdminPermissionTable;
  admins: AdminTable;
  tenants: TenantTable;
  tenant_memberships: TenantMembershipTable;
  sessions: SessionTable;
  login_attempts: LoginAttemptTable;
  audit_logs: AuditLogTable;
  servers: ServerTable;
  panel_instances: PanelInstanceTable;
  server_join_tokens: ServerJoinTokenTable;
  server_agents: ServerAgentTable;
  agent_request_nonces: AgentRequestNonceTable;
  server_metrics_latest: ServerMetricsLatestTable;
  xray_instances: XrayInstanceTable;
  inbounds: InboundTable;
  vpn_users: VpnUserTable;
  inbound_clients: InboundClientTable;
  xray_config_backups: XrayConfigBackupTable;
  inbound_apply_revisions: InboundApplyRevisionTable;
  subpanel_settings: SubpanelSettingsTable;
  subpanel_server_assignments: SubpanelServerAssignmentTable;
  subpanel_inbound_assignments: SubpanelInboundAssignmentTable;
  configs: ConfigTable;
  subscriptions: SubscriptionTable;
  traffic_samples: TrafficSampleTable;
  traffic_aggregates: TrafficAggregateTable;
  vpn_user_usage: VpnUserUsageTable;
  master_settings: MasterSettingsTable;
  master_setting_secrets: MasterSettingSecretTable;
  settings_change_history: SettingsChangeHistoryTable;
  api_tokens: ApiTokenTable;
}
