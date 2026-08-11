-- Isolated reseller portal: OWNER-assigned infrastructure and tenant-scoped users.

CREATE TABLE IF NOT EXISTS subpanel_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  panel_name text NOT NULL,
  display_name text NOT NULL,
  allowed_protocols text[] NOT NULL DEFAULT ARRAY['VLESS','VMess','Trojan','Shadowsocks']::text[],
  allow_subscription boolean NOT NULL DEFAULT true,
  allow_traffic_reset boolean NOT NULL DEFAULT true,
  allow_extend boolean NOT NULL DEFAULT true,
  allow_credential_rotation boolean NOT NULL DEFAULT true,
  theme text NOT NULL DEFAULT 'light' CHECK (theme IN ('light','dark')),
  language text NOT NULL DEFAULT 'fa' CHECK (language IN ('fa','en')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (allowed_protocols <@ ARRAY['VLESS','VMess','Trojan','Shadowsocks']::text[])
);

CREATE TABLE IF NOT EXISTS subpanel_server_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, server_id)
);

CREATE TABLE IF NOT EXISTS subpanel_inbound_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  inbound_id uuid NOT NULL REFERENCES inbounds(id) ON DELETE CASCADE,
  assigned_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, inbound_id)
);

CREATE INDEX IF NOT EXISTS idx_subpanel_server_assignments_server ON subpanel_server_assignments(server_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_subpanel_inbound_assignments_inbound ON subpanel_inbound_assignments(inbound_id, tenant_id);

ALTER TABLE configs ADD COLUMN IF NOT EXISTS inbound_client_id uuid REFERENCES inbound_clients(id) ON DELETE CASCADE;
ALTER TABLE configs ADD COLUMN IF NOT EXISTS config_ciphertext text;
ALTER TABLE configs ADD COLUMN IF NOT EXISTS share_uri_ciphertext text;
ALTER TABLE configs ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'URI' CHECK (format IN ('URI','JSON'));
CREATE INDEX IF NOT EXISTS idx_configs_tenant_client ON configs(tenant_id, inbound_client_id) WHERE revoked_at IS NULL;

ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS token_ciphertext text;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS rotated_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_active_user ON subscriptions(vpn_user_id) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_vpn_users_tenant_created ON vpn_users(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_traffic_aggregates_tenant_bucket ON traffic_aggregates(tenant_id, bucket_start DESC);
