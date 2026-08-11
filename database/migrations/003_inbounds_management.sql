-- Typed Inbounds -> Clients domain and safe Xray apply history.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'status' AND data_type = 'boolean'
  ) THEN
    ALTER TABLE tenants ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE tenants ALTER COLUMN status TYPE tenant_status
      USING (CASE WHEN status THEN 'ACTIVE'::tenant_status ELSE 'DISABLED'::tenant_status END);
    ALTER TABLE tenants ALTER COLUMN status SET DEFAULT 'ACTIVE'::tenant_status;
  END IF;
END $$;

ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS tag text;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS listen_ip inet NOT NULL DEFAULT '0.0.0.0';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS transport text NOT NULL DEFAULT 'TCP';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS security text NOT NULL DEFAULT 'NONE';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS protocol_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS transport_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS security_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS sniffing_config jsonb NOT NULL DEFAULT '{"enabled":false,"destOverride":[]}';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS sockopt_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS fallbacks_config jsonb NOT NULL DEFAULT '[]';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS routing_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS advanced_config jsonb;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS traffic_limit bigint;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS traffic_used bigint NOT NULL DEFAULT 0;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS desired_revision integer NOT NULL DEFAULT 1;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS applied_revision integer;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS apply_status text NOT NULL DEFAULT 'PENDING';
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS last_apply_error text;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES admins(id) ON DELETE SET NULL;
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE inbounds ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

UPDATE inbounds AS inbound
SET tenant_id = server.tenant_id,
    name = COALESCE(inbound.name, 'Inbound ' || inbound.port::text),
    tag = COALESCE(inbound.tag, 'inbound-' || replace(inbound.id::text, '-', ''))
FROM xray_instances AS instance
JOIN servers AS server ON server.id = instance.server_id
WHERE inbound.xray_instance_id = instance.id
  AND (inbound.tenant_id IS NULL OR inbound.name IS NULL OR inbound.tag IS NULL);

ALTER TABLE inbounds ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE inbounds ALTER COLUMN name SET NOT NULL;
ALTER TABLE inbounds ALTER COLUMN tag SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE inbounds ADD CONSTRAINT inbounds_transport_check
    CHECK (transport IN ('TCP', 'WEBSOCKET', 'GRPC', 'XHTTP'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE inbounds ADD CONSTRAINT inbounds_security_check
    CHECK (security IN ('NONE', 'TLS', 'REALITY'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE inbounds ADD CONSTRAINT inbounds_apply_status_check
    CHECK (apply_status IN ('PENDING', 'APPLYING', 'APPLIED', 'FAILED', 'ROLLED_BACK'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_inbounds_instance_tag ON inbounds(xray_instance_id, tag);
CREATE INDEX IF NOT EXISTS idx_inbounds_tenant ON inbounds(tenant_id, created_at DESC);

ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS display_name text;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS email citext;
ALTER TABLE vpn_users ADD COLUMN IF NOT EXISTS subscription_enabled boolean NOT NULL DEFAULT false;
UPDATE vpn_users SET display_name = username WHERE display_name IS NULL;
ALTER TABLE vpn_users ALTER COLUMN display_name SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vpn_users_tenant_email
  ON vpn_users(tenant_id, email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS inbound_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_id uuid NOT NULL REFERENCES inbounds(id) ON DELETE CASCADE,
  vpn_user_id uuid NOT NULL REFERENCES vpn_users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  credential_ciphertext text NOT NULL,
  flow text,
  enabled boolean NOT NULL DEFAULT true,
  traffic_limit bigint,
  traffic_used bigint NOT NULL DEFAULT 0,
  expires_at timestamptz,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(inbound_id, vpn_user_id)
);
CREATE INDEX IF NOT EXISTS idx_inbound_clients_inbound ON inbound_clients(inbound_id, created_at);
CREATE INDEX IF NOT EXISTS idx_inbound_clients_tenant ON inbound_clients(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbound_clients_expiry ON inbound_clients(expires_at) WHERE expires_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS xray_config_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  xray_instance_id uuid NOT NULL REFERENCES xray_instances(id) ON DELETE CASCADE,
  config_ciphertext text NOT NULL,
  config_hash text NOT NULL,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_xray_config_backups_instance
  ON xray_config_backups(xray_instance_id, created_at DESC);

CREATE TABLE IF NOT EXISTS inbound_apply_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inbound_id uuid NOT NULL REFERENCES inbounds(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  desired_revision integer NOT NULL,
  strategy text NOT NULL CHECK(strategy IN ('NOOP', 'HOT_CLIENTS', 'HOT_INBOUND', 'RESTART_REQUIRED')),
  status text NOT NULL CHECK(status IN ('VALIDATING', 'APPLYING', 'APPLIED', 'FAILED', 'ROLLED_BACK')),
  desired_hash text NOT NULL,
  previous_hash text,
  backup_id uuid REFERENCES xray_config_backups(id) ON DELETE SET NULL,
  validation_errors jsonb NOT NULL DEFAULT '[]',
  error_code text,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_inbound_apply_revisions_inbound
  ON inbound_apply_revisions(inbound_id, started_at DESC);
