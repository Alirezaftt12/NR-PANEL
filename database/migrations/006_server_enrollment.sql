-- Real server enrollment, one-time join tokens, per-agent credentials and latest telemetry.

DO $$ BEGIN
  IF (SELECT data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'tenants' AND column_name = 'status') = 'boolean' THEN
    ALTER TABLE tenants ALTER COLUMN status DROP DEFAULT;
    ALTER TABLE tenants ALTER COLUMN status TYPE tenant_status USING (CASE WHEN status THEN 'ACTIVE'::tenant_status ELSE 'DISABLED'::tenant_status END);
    ALTER TABLE tenants ALTER COLUMN status SET DEFAULT 'ACTIVE';
  END IF;
END $$;

ALTER TABLE servers ALTER COLUMN status DROP DEFAULT;
ALTER TABLE servers ALTER COLUMN status TYPE text USING status::text;
ALTER TABLE servers ALTER COLUMN status SET DEFAULT 'PENDING_INSTALL';
ALTER TABLE servers ALTER COLUMN hostname DROP NOT NULL;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'HYBRID';
ALTER TABLE servers ADD COLUMN IF NOT EXISTS country text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS public_address text;
ALTER TABLE servers ADD COLUMN IF NOT EXISTS last_metrics_at timestamptz;

DO $$ BEGIN
  ALTER TABLE servers ADD CONSTRAINT servers_status_check CHECK (status IN (
    'PENDING_INSTALL','REGISTERED','CONNECTING','ONLINE','OFFLINE','ERROR','REVOKED','MAINTENANCE','WARNING'
  ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE servers ADD CONSTRAINT servers_role_check CHECK (role IN ('ENTRY','EXIT','RELAY','HYBRID'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS panel_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  public_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO panel_instances (singleton) VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS server_join_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  master_instance_id uuid NOT NULL REFERENCES panel_instances(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  purpose text NOT NULL DEFAULT 'SERVER_JOIN' CHECK (purpose = 'SERVER_JOIN'),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_server_join_tokens_active ON server_join_tokens(server_id, expires_at)
  WHERE used_at IS NULL AND revoked_at IS NULL;

ALTER TABLE server_agents ADD COLUMN IF NOT EXISTS credential_hash text;
ALTER TABLE server_agents ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'REGISTERED';
ALTER TABLE server_agents ADD COLUMN IF NOT EXISTS version text;
ALTER TABLE server_agents ADD COLUMN IF NOT EXISTS registered_at timestamptz;
ALTER TABLE server_agents ADD COLUMN IF NOT EXISTS last_metrics_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS idx_server_agents_credential_hash ON server_agents(credential_hash) WHERE credential_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS agent_request_nonces (
  request_id uuid PRIMARY KEY,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_nonces_received ON agent_request_nonces(received_at);

CREATE TABLE IF NOT EXISTS server_metrics_latest (
  server_id uuid PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  sampled_at timestamptz NOT NULL,
  cpu_usage numeric(5,2),
  cpu_cores integer,
  ram_used bigint,
  ram_total bigint,
  swap_used bigint,
  swap_total bigint,
  storage_used bigint,
  storage_total bigint,
  load_1 numeric(10,2),
  load_5 numeric(10,2),
  load_15 numeric(10,2),
  uptime_seconds bigint,
  network_rx_rate bigint,
  network_tx_rate bigint,
  network_rx_total bigint,
  network_tx_total bigint,
  tcp_connections integer,
  udp_connections integer,
  process_count integer,
  hostname text,
  os_name text,
  kernel text,
  architecture text,
  ipv4 inet,
  ipv6 inet,
  agent_version text,
  agent_health text NOT NULL CHECK (agent_health IN ('ONLINE','ERROR')),
  xray_status text NOT NULL CHECK (xray_status IN ('ONLINE','NOT_INSTALLED','ERROR','STOPPED')),
  xray_version text,
  xray_uptime_seconds bigint,
  xray_config_valid boolean,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_servers_lifecycle ON servers(status, updated_at DESC);

INSERT INTO permissions (code, description) VALUES
  ('SERVER_JOIN_TOKEN_CREATE', 'Create or rotate one-time server join tokens'),
  ('SERVER_REVOKE', 'Revoke an enrolled server credential')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
