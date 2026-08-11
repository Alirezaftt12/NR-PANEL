-- Typed master settings namespaces, encrypted integration secrets, redacted history and scoped API tokens.

CREATE TABLE IF NOT EXISTS master_settings (
  namespace text PRIMARY KEY,
  value jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  restart_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  updated_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (namespace IN (
    'general','security','network','tls','xray','subscription','subscriptionFormats','telegram','email',
    'notifications','users','subpanels','agents','traffic','backup','datetime','updates'
  )),
  CHECK (restart_scopes <@ ARRAY['PANEL','XRAY','AGENT','SUBSCRIPTION']::text[])
);

CREATE TABLE IF NOT EXISTS master_setting_secrets (
  name text PRIMARY KEY,
  ciphertext text NOT NULL,
  updated_by uuid REFERENCES admins(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (name IN ('telegram.botToken','email.password','tls.privateKeyPath'))
);

CREATE TABLE IF NOT EXISTS settings_change_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace text NOT NULL,
  actor_id uuid REFERENCES admins(id) ON DELETE SET NULL,
  changed_fields text[] NOT NULL DEFAULT ARRAY[]::text[],
  before_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (namespace IN (
    'general','security','network','tls','xray','subscription','subscriptionFormats','telegram','email',
    'notifications','users','subpanels','agents','traffic','backup','datetime','updates'
  ))
);
CREATE INDEX IF NOT EXISTS idx_settings_history_namespace_time ON settings_change_history(namespace, created_at DESC);

CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  prefix text NOT NULL UNIQUE,
  token_hash text NOT NULL UNIQUE,
  permissions text[] NOT NULL DEFAULT ARRAY[]::text[],
  cidr_allowlist cidr[] NOT NULL DEFAULT ARRAY[]::cidr[],
  created_by uuid NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  expires_at timestamptz,
  last_used_at timestamptz,
  enabled boolean NOT NULL DEFAULT true,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_tokens_creator ON api_tokens(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_tokens_active_hash ON api_tokens(token_hash) WHERE enabled = true AND revoked_at IS NULL;

INSERT INTO permissions (code, description) VALUES
  ('SETTINGS_GENERAL_UPDATE', 'Update general, locale and default settings'),
  ('SETTINGS_SECURITY_UPDATE', 'Update authentication and security settings'),
  ('SETTINGS_NETWORK_UPDATE', 'Update panel network and TLS desired settings'),
  ('SETTINGS_XRAY_UPDATE', 'Update Xray desired runtime policy'),
  ('SETTINGS_SUBSCRIPTION_UPDATE', 'Update subscription delivery and output formats'),
  ('SETTINGS_INTEGRATIONS_UPDATE', 'Update Telegram, email and notification integrations'),
  ('SETTINGS_BACKUP_UPDATE', 'Update backup policy and run safe backups'),
  ('SETTINGS_UPDATE_MANAGE', 'Check, prepare and explicitly run supported updates'),
  ('SETTINGS_ADVANCED_VIEW', 'View safe advanced diagnostics')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;
