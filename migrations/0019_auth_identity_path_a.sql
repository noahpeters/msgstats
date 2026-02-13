ALTER TABLE users ADD COLUMN auth_ready_at INTEGER;

-- Keep auth0_sub column for backward compatibility during rollout; code no longer uses it.

CREATE TABLE IF NOT EXISTS user_identities (
  provider TEXT NOT NULL CHECK(provider IN ('google','apple')),
  provider_sub TEXT NOT NULL,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_sub)
);

CREATE INDEX IF NOT EXISTS idx_user_identities_user_id ON user_identities (user_id);

CREATE TABLE IF NOT EXISTS user_passwords (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  algo TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON password_reset_tokens (user_id);

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  sign_count INTEGER NOT NULL,
  transports TEXT,
  aaguid TEXT,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_user_id ON webauthn_credentials (user_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  token TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK(purpose IN ('register','login')),
  user_id TEXT,
  challenge TEXT NOT NULL,
  rp_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webauthn_challenges_user_id ON webauthn_challenges (user_id);

ALTER TABLE auth_sessions ADD COLUMN is_bootstrap INTEGER NOT NULL DEFAULT 0;
ALTER TABLE auth_sessions ADD COLUMN bootstrap_expires_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_bootstrap ON auth_sessions (user_id, is_bootstrap, revoked_at);

ALTER TABLE auth_tx ADD COLUMN provider TEXT;
CREATE INDEX IF NOT EXISTS idx_auth_tx_created_at ON auth_tx (created_at);
