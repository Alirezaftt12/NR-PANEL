CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
  CREATE TYPE tenant_status AS ENUM ('ACTIVE', 'DISABLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE admin_status AS ENUM ('ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS slug text;
UPDATE tenants SET slug = 'tenant-' || replace(id::text, '-', '') WHERE slug IS NULL;
ALTER TABLE tenants ALTER COLUMN slug SET NOT NULL;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status tenant_status NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS created_by uuid;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(lower(slug));

ALTER TABLE admins ALTER COLUMN username TYPE citext USING username::citext;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS email citext;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS status admin_status NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE admins ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS password_changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE admins ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES admins(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admins_email ON admins(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_admins_status ON admins(status);

DO $$ BEGIN
  ALTER TABLE tenants ADD CONSTRAINT tenants_created_by_fkey FOREIGN KEY (created_by) REFERENCES admins(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS admin_permissions (
  admin_id uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (admin_id, permission_id)
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_activity_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_active_admin ON sessions(admin_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier_hash text NOT NULL,
  ip inet,
  successful boolean NOT NULL DEFAULT false,
  failure_reason text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier_time ON login_attempts(identifier_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip_time ON login_attempts(ip, attempted_at DESC);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS actor_role admin_role;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_type text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS target_id text;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS request_id text;
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_logs(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_memberships_admin ON tenant_memberships(admin_id, tenant_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission ON role_permissions(permission_id, role_id);
CREATE INDEX IF NOT EXISTS idx_admin_permissions_permission ON admin_permissions(permission_id, admin_id);

INSERT INTO roles (name) VALUES
  ('OWNER'), ('ADMIN'), ('RESELLER'), ('SUB_RESELLER')
ON CONFLICT (name) DO NOTHING;

INSERT INTO permissions (code, description) VALUES
  ('DASHBOARD_VIEW', 'View the master dashboard'),
  ('ADMIN_VIEW', 'View administrator accounts'),
  ('ADMIN_CREATE', 'Create administrator accounts'),
  ('ADMIN_UPDATE', 'Update administrator role and permissions'),
  ('ADMIN_DISABLE', 'Enable or disable administrator accounts'),
  ('SERVER_VIEW', 'View servers'),
  ('SERVER_CREATE', 'Create servers'),
  ('SERVER_UPDATE', 'Update servers'),
  ('SERVER_CONTROL', 'Control approved server services'),
  ('USER_VIEW', 'View VPN users'),
  ('USER_CREATE', 'Create VPN users'),
  ('USER_UPDATE', 'Update VPN users'),
  ('USER_DELETE', 'Delete VPN users'),
  ('USER_EXTEND', 'Extend VPN users'),
  ('USER_RESET_TRAFFIC', 'Reset VPN user traffic'),
  ('CONFIG_VIEW', 'View configurations'),
  ('CONFIG_CREATE', 'Create configurations'),
  ('CONFIG_DELETE', 'Delete configurations'),
  ('SUBPANEL_VIEW', 'View tenants and sub-panels'),
  ('SUBPANEL_CREATE', 'Create tenants and sub-panels'),
  ('SUBPANEL_UPDATE', 'Update tenants and sub-panels'),
  ('SUBPANEL_DISABLE', 'Disable tenants and sub-panels'),
  ('TRAFFIC_VIEW', 'View traffic'),
  ('LOG_VIEW', 'View logs'),
  ('BACKUP_VIEW', 'View backups'),
  ('BACKUP_CREATE', 'Create backups'),
  ('BACKUP_RESTORE', 'Restore backups'),
  ('SECURITY_VIEW', 'View security events and sessions'),
  ('SETTINGS_VIEW', 'View settings'),
  ('SETTINGS_UPDATE', 'Update settings'),
  ('XRAY_VIEW', 'View Xray status'),
  ('XRAY_CONTROL', 'Control Xray'),
  ('SYSTEM_REBOOT', 'Reboot approved servers'),
  ('SYSTEM_SHUTDOWN', 'Shutdown approved servers')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
